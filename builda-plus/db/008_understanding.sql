-- Knowledge layer for interviews (design: "BuildA+ knowledge-driven interviewing", decisions D1-D4).
-- Three layers: evidence (what was said), claims (interpretations of it), and facts (computed in code,
-- not stored). Kinds, roles, stages and predicates are text ids validated against the discovery's domain
-- pack, not database enums, so the model is not tied to mortgages. Additive only.

-- Organisation-specific instances (activities, roles, systems, information, decisions, controls, problems).
create table kn_nodes (
  id uuid primary key,
  org_id uuid not null references organisations(id),
  discovery_id uuid not null references discoveries(id),
  kind text not null check (kind in ('activity', 'role', 'system', 'information', 'decision', 'control', 'problem')),
  label text not null check (length(label) between 1 and 200),
  aliases text[] not null default '{}',
  stage_ref text,
  type_ref text,                 -- the domain-pack type this instance was classified as (a claim records why)
  type_version text,             -- the pack version that type came from
  part_of uuid references kn_nodes(id),
  merged_into uuid references kn_nodes(id),
  created_at timestamptz not null default now()
);
create index kn_nodes_discovery on kn_nodes (discovery_id, kind);

-- Layer 1: what was said. Written by code from the transcript; never edited.
create table kn_evidence (
  id uuid primary key,
  org_id uuid not null references organisations(id),
  discovery_id uuid not null references discoveries(id),
  session_id uuid references interview_sessions(id),
  turn_index int,
  participant_pseudonym text,
  participant_role_ref text,
  source evidence_source not null,
  quote text not null check (length(quote) between 3 and 2000),
  created_at timestamptz not null default now()
);
create index kn_evidence_discovery on kn_evidence (discovery_id);

-- Layer 2: interpretations of evidence. Appended; superseded or rejected, never edited in place.
create table kn_claims (
  id uuid primary key,
  org_id uuid not null references organisations(id),
  discovery_id uuid not null references discoveries(id),
  subject_id uuid not null references kn_nodes(id),
  predicate text not null,
  object_node_id uuid references kn_nodes(id),
  object_ref text,               -- a role, party or pack type id
  object_value jsonb,            -- a normalised measure, an impact or text
  scope text,                    -- the context the claim holds in ("buy-to-let", "some advisers"); variation, not conflict
  polarity text not null default 'asserted' check (polarity in ('asserted', 'negated')),
  stated boolean not null,       -- true: the words say it; false: an interpretation (inference_note says why)
  inference_note text,
  interpreted_by text not null,  -- 'ai:<model>:<prompt version>' | 'rule:<name>' | 'person:<user id>'
  status text not null default 'active' check (status in ('active', 'superseded', 'rejected')),
  superseded_by uuid references kn_claims(id),
  created_at timestamptz not null default now()
);
create index kn_claims_subject on kn_claims (discovery_id, subject_id, predicate);

create table kn_claim_evidence (
  claim_id uuid not null references kn_claims(id),
  evidence_id uuid not null references kn_evidence(id),
  org_id uuid not null references organisations(id),
  discovery_id uuid not null references discoveries(id),
  primary key (claim_id, evidence_id)
);

-- What the interviewer still wants to find out, per interview, so nothing is asked twice.
create table kn_gaps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id),
  discovery_id uuid not null references discoveries(id),
  session_id uuid not null references interview_sessions(id),
  subject_id uuid not null references kn_nodes(id),
  predicate text not null,
  status text not null check (status in ('open', 'asked', 'unsure', 'answered')),
  times_asked int not null default 0,
  updated_at timestamptz not null default now(),
  unique (session_id, subject_id, predicate)
);

-- The existing analysis keeps reading evidence_records; rows written by the new engine point at their node.
alter table evidence_records add column node_id uuid references kn_nodes(id), add column turn_index int;

-- Same isolation as every other firm table.
do $$
declare t text;
begin
  foreach t in array array['kn_nodes', 'kn_evidence', 'kn_claims', 'kn_claim_evidence', 'kn_gaps'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy firm_isolation on %I
       using (org_id = app_org() or app_jada_assigned(discovery_id))
       with check (org_id = app_org() or app_jada_assigned(discovery_id))$p$, t);
  end loop;
end $$;

-- Evidence and links are append-only for the app; claims change only their status; nodes only their aliases,
-- type and merge pointer; gaps are updated as questions are asked.
grant select, insert on kn_evidence, kn_claim_evidence to builda_app;
grant select, insert on kn_claims, kn_nodes to builda_app;
grant update (status, superseded_by) on kn_claims to builda_app;
grant update (aliases, type_ref, type_version, merged_into, part_of, stage_ref) on kn_nodes to builda_app;
grant select, insert, update on kn_gaps to builda_app;
