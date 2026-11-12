-- R2 (pilot remediation spec): database-level authorisation that doesn't trust the caller.
--
-- 1. The definer functions that bypass row-level security no longer take a user id as a parameter.
--    They read the identity the application set for this transaction (app_user()) and refuse when
--    there is none. Binding that identity to a server-side session needs production sign-in (R1) and
--    is not part of this migration.
-- 2. jada_pick_up only accepts a discovery that is actually waiting and not already someone else's.
-- 3. jada_release lets the assigned engineer hand a discovery back, which ends their access.
-- 4. Same-firm references: a child row can only point at a parent row of the same firm.
--    Existing rows are checked first; if any break the rule the migration stops and lists them,
--    rather than changing anything.
-- signin_directory() stays for demo mode; scripts/migrate.ts revokes it when NODE_ENV=production.

drop function jada_queue(uuid);
drop function jada_pick_up(uuid, uuid);
drop function knowledge_candidates(uuid, text[]);

-- Discoveries waiting for an engineer: firm name and reason only, until someone picks one up.
create function jada_queue()
returns table (discovery_id uuid, firm_name text, reason text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select d.id, o.name,
         case when exists (select 1 from escalations e where e.discovery_id = d.id and e.status = 'open')
              then 'Someone asked for help' else 'Priorities approved — implementation pack ready' end,
         d.created_at
    from discoveries d join organisations o on o.id = d.org_id
   where app_user() is not null
     and exists (select 1 from jada_staff_roles r where r.user_id = app_user() and r.role = 'engineer')
     and not exists (select 1 from jada_assignments a where a.discovery_id = d.id)
     and (d.status = 'priorities_approved'
          or exists (select 1 from escalations e where e.discovery_id = d.id and e.status = 'open'))
   order by d.created_at
$$;

-- Picks up a waiting discovery for the caller. Returns 'ok', or why it was refused:
-- 'no_identity', 'not_engineer', 'not_found', 'not_waiting' or 'taken'.
create function jada_pick_up(p_discovery uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_user uuid := app_user(); v_org uuid; v_status text;
begin
  if v_user is null then return 'no_identity'; end if;
  if not exists (select 1 from jada_staff_roles where user_id = v_user and role = 'engineer') then return 'not_engineer'; end if;
  select org_id, status::text into v_org, v_status from discoveries where id = p_discovery for update;
  if v_org is null then return 'not_found'; end if;
  if exists (select 1 from jada_assignments where discovery_id = p_discovery and staff_user_id = v_user) then return 'ok'; end if;
  if exists (select 1 from jada_assignments where discovery_id = p_discovery) then return 'taken'; end if;
  if not (v_status = 'priorities_approved'
          or exists (select 1 from escalations e where e.discovery_id = p_discovery and e.status = 'open')) then return 'not_waiting'; end if;
  insert into jada_assignments (discovery_id, staff_user_id) values (p_discovery, v_user);
  insert into audit_log (org_id, discovery_id, actor, action, entity_type, entity_id)
    values (v_org, p_discovery, 'jada:' || v_user, 'jada.picked_up', 'discovery', p_discovery::text);
  return 'ok';
end $$;

-- The assigned engineer hands a discovery back. Their access ends at once (row-level security reads
-- jada_assignments). Returns false if the caller wasn't assigned to it.
create function jada_release(p_discovery uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_user uuid := app_user(); v_org uuid;
begin
  if v_user is null then return false; end if;
  delete from jada_assignments where discovery_id = p_discovery and staff_user_id = v_user;
  if not found then return false; end if;
  select org_id into v_org from discoveries where id = p_discovery;
  insert into audit_log (org_id, discovery_id, actor, action, entity_type, entity_id)
    values (v_org, p_discovery, 'jada:' || v_user, 'jada.released', 'discovery', p_discovery::text);
  return true;
end $$;

-- Pain points seen in discoveries but missing from a release: aggregated across firms with no firm
-- identifiers or quotes, and only when at least two firms raised them. Only for JADA knowledge staff.
create function knowledge_candidates(p_known_keys text[])
returns table (key text, title text, stage_id text, firms bigint)
language sql stable security definer set search_path = public as $$
  select pp.key, min(pp.title), mode() within group (order by pp.stage_id), count(distinct pp.org_id)
    from pain_points pp
   where app_user() is not null
     and exists (select 1 from jada_staff_roles r where r.user_id = app_user())
     and not (pp.key = any(p_known_keys))
   group by pp.key
  having count(distinct pp.org_id) >= 2
   order by count(distinct pp.org_id) desc, pp.key
$$;

revoke all on function jada_queue(), jada_pick_up(uuid), jada_release(uuid), knowledge_candidates(text[]) from public;
grant execute on function jada_queue(), jada_pick_up(uuid), jada_release(uuid), knowledge_candidates(text[]) to builda_app;

-- Same-firm references. Each pair is (child table, column, parent table).
do $$
declare
  refs text[][] := array[
    ['participants', 'discovery_id', 'discoveries'],
    ['interview_sessions', 'discovery_id', 'discoveries'], ['interview_sessions', 'participant_id', 'participants'],
    ['evidence_records', 'discovery_id', 'discoveries'], ['evidence_records', 'session_id', 'interview_sessions'], ['evidence_records', 'node_id', 'kn_nodes'],
    ['pain_points', 'discovery_id', 'discoveries'],
    ['opportunities', 'discovery_id', 'discoveries'], ['opportunities', 'pain_point_id', 'pain_points'],
    ['corrections', 'discovery_id', 'discoveries'],
    ['escalations', 'discovery_id', 'discoveries'], ['escalations', 'session_id', 'interview_sessions'],
    ['ai_usage', 'discovery_id', 'discoveries'],
    ['audit_log', 'discovery_id', 'discoveries'],
    ['invitations', 'discovery_id', 'discoveries'], ['invitations', 'participant_id', 'participants'],
    ['follow_ups', 'discovery_id', 'discoveries'], ['follow_ups', 'participant_id', 'participants'],
    ['analysis_runs', 'discovery_id', 'discoveries'],
    ['reports', 'discovery_id', 'discoveries'],
    ['priority_approvals', 'discovery_id', 'discoveries'], ['priority_approvals', 'proceed_with', 'pain_points'],
    ['implementation_packs', 'discovery_id', 'discoveries'], ['implementation_packs', 'pain_point_id', 'pain_points'],
    ['implementation_packs', 'approval_id', 'priority_approvals'],
    ['pack_reviews', 'discovery_id', 'discoveries'], ['pack_reviews', 'pack_id', 'implementation_packs'],
    ['kn_nodes', 'discovery_id', 'discoveries'], ['kn_nodes', 'merged_into', 'kn_nodes'], ['kn_nodes', 'part_of', 'kn_nodes'],
    ['kn_evidence', 'discovery_id', 'discoveries'], ['kn_evidence', 'session_id', 'interview_sessions'],
    ['kn_claims', 'discovery_id', 'discoveries'], ['kn_claims', 'object_node_id', 'kn_nodes'], ['kn_claims', 'subject_id', 'kn_nodes'],
    ['kn_claims', 'superseded_by', 'kn_claims'],
    ['kn_claim_evidence', 'discovery_id', 'discoveries'], ['kn_claim_evidence', 'claim_id', 'kn_claims'], ['kn_claim_evidence', 'evidence_id', 'kn_evidence'],
    ['kn_gaps', 'discovery_id', 'discoveries'], ['kn_gaps', 'session_id', 'interview_sessions'], ['kn_gaps', 'subject_id', 'kn_nodes']
  ];
  parents text[] := array['discoveries', 'participants', 'interview_sessions', 'pain_points', 'priority_approvals',
                          'implementation_packs', 'kn_nodes', 'kn_evidence', 'kn_claims'];
  r text[]; p text; n bigint; problems text := '';
begin
  -- Report every existing row that points at another firm's row, before changing anything.
  foreach r slice 1 in array refs loop
    execute format('select count(*) from %I c join %I p on p.id = c.%I where p.org_id <> c.org_id', r[1], r[3], r[2]) into n;
    if n > 0 then problems := problems || format('%s.%s -> %s: %s row(s); ', r[1], r[2], r[3], n); end if;
  end loop;
  if problems <> '' then
    raise exception 'Rows that point at another firm''s data (nothing was changed): %', problems;
  end if;

  foreach p in array parents loop
    execute format('alter table %I add constraint %I unique (id, org_id)', p, p || '_id_org_key');
  end loop;
  foreach r slice 1 in array refs loop
    execute format('alter table %I add constraint %I foreign key (%I, org_id) references %I (id, org_id)',
                   r[1], left(r[1] || '_' || r[2] || '_same_firm', 63), r[2], r[3]);
  end loop;
end $$;
