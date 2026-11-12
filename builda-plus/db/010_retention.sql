-- R3 (pilot remediation spec): retention, deletion and withdrawal.
--
-- The consent screen promises that interviews are deleted after the retention period. This migration
-- makes that true:
--   * a retention clock per discovery (closed by the firm lead, or 90 days after its last activity);
--   * purge_discovery_content(): at the end of retention, removes everything people said and who they
--     are, keeping only de-identified findings (titles, counts, figures, classifications), the firm's own
--     entries and decisions, and content-free audit metadata;
--   * withdraw_participant(): removes one person's interview and their words everywhere, including the
--     immutable report and pack snapshots;
--   * retention_events: a content-free record of every purge and withdrawal (what, when, how many);
--   * builda_retention: a separate database role for the daily job, allowed only these functions.
-- Redacting immutable snapshots is a deliberate, narrow exception to the append-only design: it happens
-- only inside these functions, only on the listed columns, and every run is logged.
-- Both consent versions get the same, strict treatment: all free text from interviews is removed, not
-- just quotes, because version 1 promised full deletion.

alter table discoveries add column closed_at timestamptz, add column content_purged_at timestamptz;
alter table participants add column withdrawn_at timestamptz;

create table retention_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  discovery_id uuid not null references discoveries(id),
  kind text not null check (kind in ('discovery_purged', 'participant_withdrawn')),
  requested_by text not null,          -- 'retention job', 'participant', or 'jada:<who took the request>'; never a reason
  counts jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (discovery_id, org_id) references discoveries (id, org_id)
);
alter table retention_events enable row level security; alter table retention_events force row level security;
create policy firm_isolation on retention_events using (org_id = app_org());
grant select on retention_events to builda_app;            -- the firm sees counts; only the functions write
grant update (closed_at) on discoveries to builda_app;

-- Words that must not survive: every key that carries what someone said or wrote.
create function retention_word_keys() returns text[] language sql immutable as $$
  select array['quote', 'quotes', 'voices', 'supportingQuote', 'supporting_quote', 'taskDescription', 'task_description',
               'reportedCause', 'reported_cause', 'potentialImprovement', 'potential_improvement', 'operationalImpact',
               'operational_impact', 'causes', 'improvements', 'question', 'detailsRedacted', 'inferenceNote']
$$;

-- Removes listed keys and any string equal to one of the targets. An object whose "quote" is a target is
-- dropped from its array entirely, so a withdrawn person's quote leaves no empty card behind.
create function redact_jsonb(j jsonb, targets text[], drop_keys text[]) returns jsonb
language plpgsql immutable set search_path = public as $$
declare k text; v jsonb; out jsonb;
begin
  if j is null then return null; end if;
  case jsonb_typeof(j)
    when 'object' then
      if j ? 'quote' and (j->>'quote') = any(targets) then return null; end if;
      out := '{}'::jsonb;
      for k, v in select * from jsonb_each(j) loop
        if k = any(drop_keys) then continue; end if;
        out := out || jsonb_build_object(k, coalesce(redact_jsonb(v, targets, drop_keys), 'null'::jsonb));
      end loop;
      return out;
    when 'array' then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into out
        from (select redact_jsonb(e, targets, drop_keys) as x from jsonb_array_elements(j) e) s where x is not null;
      return out;
    when 'string' then
      if (j #>> '{}') = any(targets) then return to_jsonb('[removed]'::text); end if;
      return j;
    else return j;
  end case;
end $$;

-- Discoveries whose retention has ended and whose content hasn't been removed yet.
create function retention_due(p_months int)
returns table (discovery_id uuid, org_id uuid, retention_from timestamptz)
language sql stable security definer set search_path = public as $$
  select d.id, d.org_id, x.since
    from discoveries d
    cross join lateral (select coalesce(d.closed_at,
        greatest(d.created_at, (select max(l.created_at) from audit_log l where l.discovery_id = d.id)) + interval '90 days') as since) x
   where p_months > 0 and d.content_purged_at is null
     and x.since + make_interval(months => p_months) <= now()
   order by x.since
$$;

-- Shared by both purges: removes the words of the given sessions/pseudonyms everywhere in one discovery.
-- p_all = true for the end of retention (everything), false for one person's withdrawal.
create function retention_scrub(p_discovery uuid, p_pseudonyms text[], p_all boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  targets text[]; keys text[] := case when p_all then retention_word_keys() else '{}'::text[] end;
  n_evidence int; n_kn int; n_sessions int; n_snapshots int := 0; n int;
begin
  -- Everything these people said, as verbatim strings, so copies in snapshots can be found.
  select coalesce(array_agg(t), '{}') into targets from (
      select unnest(array[supporting_quote, task_description, reported_cause, potential_improvement, operational_impact]) as t
        from evidence_records where discovery_id = p_discovery and (p_all or participant_pseudonym = any(p_pseudonyms))
      union select quote from kn_evidence where discovery_id = p_discovery and (p_all or participant_pseudonym = any(p_pseudonyms))
      union select display_name from participants where discovery_id = p_discovery and (p_all or pseudonym = any(p_pseudonyms))
      union select email from participants where discovery_id = p_discovery and (p_all or pseudonym = any(p_pseudonyms))
    ) s where t is not null and length(t) >= 3;

  if p_all then
    update evidence_records set supporting_quote = '[removed]', task_description = '[removed]', reported_cause = null,
           potential_improvement = null, operational_impact = null
     where discovery_id = p_discovery;
    get diagnostics n_evidence = row_count;
    update kn_evidence set quote = '[removed]' where discovery_id = p_discovery;
    get diagnostics n_kn = row_count;
    update kn_claims set inference_note = null, scope = null, object_value = redact_jsonb(object_value, targets, keys)
     where discovery_id = p_discovery;
  else
    -- One person: their evidence goes completely, so the next analysis no longer counts them.
    delete from evidence_records where discovery_id = p_discovery and participant_pseudonym = any(p_pseudonyms);
    get diagnostics n_evidence = row_count;
    delete from kn_claim_evidence where evidence_id in
      (select id from kn_evidence where discovery_id = p_discovery and participant_pseudonym = any(p_pseudonyms));
    delete from kn_evidence where discovery_id = p_discovery and participant_pseudonym = any(p_pseudonyms);
    get diagnostics n_kn = row_count;
    update kn_claims set object_value = redact_jsonb(object_value, targets, keys) where discovery_id = p_discovery;
  end if;

  update interview_sessions s set state = '{}'::jsonb
    from participants p
   where s.participant_id = p.id and s.discovery_id = p_discovery and (p_all or p.pseudonym = any(p_pseudonyms));
  get diagnostics n_sessions = row_count;
  delete from kn_gaps g using interview_sessions s, participants p
   where g.session_id = s.id and s.participant_id = p.id and s.discovery_id = p_discovery and (p_all or p.pseudonym = any(p_pseudonyms));
  update follow_ups f set question = '[removed]' from participants p
   where f.participant_id = p.id and f.discovery_id = p_discovery and (p_all or p.pseudonym = any(p_pseudonyms));
  update escalations e set details_redacted = null
   where e.discovery_id = p_discovery and (p_all or e.session_id in
     (select s.id from interview_sessions s join participants p on p.id = s.participant_id where p.pseudonym = any(p_pseudonyms) and s.discovery_id = p_discovery));
  delete from invitations i using participants p
   where i.participant_id = p.id and i.discovery_id = p_discovery and (p_all or p.pseudonym = any(p_pseudonyms));
  update participants set display_name = pseudonym, email = null
   where discovery_id = p_discovery and (p_all or pseudonym = any(p_pseudonyms));

  -- Snapshots, including the append-only ones.
  update analysis_runs set findings = redact_jsonb(findings, targets, keys) where discovery_id = p_discovery;
  get diagnostics n = row_count; n_snapshots := n_snapshots + n;
  update pain_points set evidence_summary = redact_jsonb(evidence_summary, targets, keys) where discovery_id = p_discovery;
  update reports set model = redact_jsonb(model, targets, keys) where discovery_id = p_discovery;
  get diagnostics n = row_count; n_snapshots := n_snapshots + n;
  update implementation_packs set content = redact_jsonb(content, targets, keys) where discovery_id = p_discovery;
  get diagnostics n = row_count; n_snapshots := n_snapshots + n;
  update corrections set new_value = redact_jsonb(new_value, targets, keys), old_value = redact_jsonb(old_value, targets, keys)
   where discovery_id = p_discovery;

  return jsonb_build_object('evidence', n_evidence, 'understandingEvidence', n_kn, 'interviews', n_sessions, 'snapshots', n_snapshots);
end $$;

create function purge_discovery_content(p_discovery uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; counts jsonb;
begin
  select org_id into v_org from discoveries where id = p_discovery and content_purged_at is null for update;
  if v_org is null then return null; end if;
  counts := retention_scrub(p_discovery, '{}', true);
  update discoveries set content_purged_at = now() where id = p_discovery;
  insert into retention_events (org_id, discovery_id, kind, requested_by, counts) values (v_org, p_discovery, 'discovery_purged', 'retention job', counts);
  insert into audit_log (org_id, discovery_id, actor, action, entity_type, entity_id, metadata)
    values (v_org, p_discovery, 'system:retention', 'retention.purged', 'discovery', p_discovery::text, counts);
  return counts;
end $$;

-- Withdraws one person. The web app may call it only for a participant of the firm in its context
-- (the participant's own link sets that); the retention role may call it for a request JADA took.
create function withdraw_participant(p_participant uuid, p_requested_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_disc uuid; v_pseudo text; counts jsonb;
begin
  if p_requested_by is null or not (p_requested_by = 'participant' or p_requested_by like 'jada:_%') then
    raise exception 'requested_by must be ''participant'' or ''jada:<name>''';
  end if;
  select org_id, discovery_id, pseudonym into v_org, v_disc, v_pseudo from participants where id = p_participant and withdrawn_at is null for update;
  if v_org is null then return null; end if;
  if session_user <> 'builda_retention' and v_org is distinct from app_org() then return null; end if;
  counts := retention_scrub(v_disc, array[v_pseudo], false);
  update participants set withdrawn_at = now() where id = p_participant;
  insert into retention_events (org_id, discovery_id, kind, requested_by, counts) values (v_org, v_disc, 'participant_withdrawn', p_requested_by, counts);
  insert into audit_log (org_id, discovery_id, actor, action, entity_type, entity_id, metadata)
    values (v_org, v_disc, case when p_requested_by = 'participant' then 'participant:' || v_pseudo else 'system:retention' end,
            'participant.withdrawn', 'participant', p_participant::text, counts);
  return counts;
end $$;

do $$ begin
  if not exists (select from pg_roles where rolname = 'builda_retention') then create role builda_retention login; end if;
end $$;
grant usage on schema public to builda_retention;
revoke all on function redact_jsonb(jsonb, text[], text[]), retention_word_keys(), retention_due(int), retention_scrub(uuid, text[], boolean),
  purge_discovery_content(uuid), withdraw_participant(uuid, text) from public;
grant execute on function retention_due(int), purge_discovery_content(uuid), withdraw_participant(uuid, text) to builda_retention;
grant execute on function withdraw_participant(uuid, text) to builda_app;
