# builda+ — design decisions on identity, provenance, time, impact and ownership

Status: **approved direction; implementation authority** once §10.K is accepted. Companion to
[target-architecture.md](target-architecture.md), which now serves as the explanation of the
intended system, not as executable SQL. Implementation is accepted against §12.
This document:

1. adopts the agreed framing and product principles;
2. answers the five questions that need resolving before implementation;
3. lists the **weak points in target-architecture.md** — where its schema would get complicated or
   fail — and the amendments that fix them. **Read §8 before you review the main document's schema.**

Where this document and `target-architecture.md` disagree, this one wins.

---

## 1. Framing adopted

### The builda+ intelligence loop

1. **Sources** — interviews, documents, CSVs, business systems.
2. **Evidence and claims** — what was observed, stated, measured or inferred.
3. **Operational intelligence** — problems, processes, dependencies, root causes.
4. **Opportunities and decisions** — prioritisation, business cases, approvals.
5. **Execution and outcomes** — initiatives, implementations, measured impact.

New evidence from step 5 feeds step 1 of the next cycle. The operating model runs across the whole
loop as shared context.

### Product capabilities: Understand, Discover, Improve

Agreed, with one caveat about **where investment goes**. "Understand" should never be sold or built
as a capability of its own. If it is, customers judge it by completeness ("you've missed the
remortgage team"), and we're back to maintaining a map. Understanding should be judged by whether it
supports a *Discover* or *Improve* decision. Investment order: **Improve ≥ Discover > Understand.**

Improve should stay lightweight on execution. builda+ tracks initiatives, success measures and
outcomes. It should not become a project-management tool. Task-level delivery belongs in the
customer's or the delivery partner's own tools; builda+ links to them.

### Product principles (formal)

| # | Principle | How the design enforces it |
|---|---|---|
| P1 | **Traceability.** Every important conclusion traces to evidence. Every opportunity traces to a *driver*. Every implemented solution has a measurement plan. | FKs from assessments to claims to evidence spans. An opportunity can't be approved without a driver link. An initiative can't go live without pre-registered measures or a recorded "not measurable" decision. |
| P2 | **Work, not workers.** builda+ models organisational work and must never become a way to monitor individual employees' performance. | Activities are performed by roles. Person identifiers are dropped or role-mapped at import. Minimum group size on every role-level output. There are no person-level metrics tables. |
| P3 | **AI proposes, code and people dispose.** | AI output lands as `proposed`. Status changes happen only through deterministic rules or attributed human decisions. |
| P4 | **History is never overwritten.** | Append-only claims, assessments, decisions and identity events. Model versions are closed, not updated. |
| P5 | **Smallest model that serves a decision.** | Elements are created when evidence or a decision needs somewhere to attach. There is no "completeness" metric. |

**Two amendments to your non-negotiable principle:**

- **"Every opportunity must connect to an identifiable operational problem"** is slightly too
  narrow. Some legitimate opportunities aren't problems: a regulatory change that must be absorbed
  (Consumer Duty-style obligations), a growth goal ("handle 30% more cases without hiring"), or a new
  capability. I propose a **driver**, which is one of `problem | goal | obligation`, each with its
  own evidence. Problems stay by far the most common driver, but the rule becomes "every opportunity
  connects to an identifiable driver".
- **"Every implemented solution should have a way to measure its impact"**: yes. But some impacts
  can't be measured numerically at a small firm (for example, reduced compliance risk). The rule
  should be *measured, or explicitly recorded as not numerically measurable, with a reason and a
  qualitative review.* Being explicit about this is better than inventing a proxy metric.

---

## 2. Identity: what makes a problem the same problem across two discoveries?

### The flaw in the current proposal

`target-architecture.md` makes a problem unique by `(org_id, key)`, where `key` is a slug coming from
the pack or the AI. That is **identity by naming**, which is how the current code ends up with
unstable pain points (C5). Two discoveries will word the same problem differently, and one wording
can cover two problems.

### Decision

A problem's identity is a **UUID that is assigned once and is only ever changed by recorded identity
events.** A separate **signature** is used to find candidate matches, but it never *defines* identity:

```
signature = (anchor element, problem type, qualifier?)
  anchor element  — the activity (or process) where the problem shows up
  problem type    — from a small, pack-extensible taxonomy (below)
  qualifier       — optional: the external party or system involved
```

Problem-type taxonomy (core, industry-agnostic; packs may add to it):
`waiting` · `rework_or_return` · `duplicate_entry` · `chasing` · `manual_status_communication` ·
`error_or_omission` · `capacity_constraint` · `single_point_of_dependency` · `unclear_ownership` ·
`compliance_friction` · `tool_gap`.

Example: "documents chased manually by case managers" →
`(activity: collect documents, chasing, external party: client)`.

### Matching new evidence to existing problems

When an engagement's consolidation produces a cluster of pain claims:

| Case | Rule | Who decides |
|---|---|---|
| Same signature as one existing problem (any status, including `resolved`) | Link automatically | Deterministic rule, recorded as `linked_by = 'rule:signature'`, and reversible |
| Same anchor, different type; or same type, neighbouring anchor; or AI judges the descriptions similar | Propose a link, with the AI's reason | Human, in the playback review |
| Same signature matches **several** existing problems | Never auto-link; propose | Human |
| No candidate | New problem, status `open` (or `hypothesis` if support is only `inferred`) | Deterministic |

A problem that was `resolved` and gets new matching evidence keeps its identity and moves to
`recurred`. This is the case where stable identity matters most.

### Merges, splits and root causes

- **Merge.** The surviving problem keeps its id. The merged problem gets `merged_into` and is never
  deleted, so every FK still resolves. A `problem_identity_events` row records who, why and which
  evidence.
- **Split.** This is common: "chasing" turns out to be two things for purchase versus remortgage
  cases. New ids are created for the parts, and the split is recorded as an identity event with the
  original on the `from` side and the parts on the `to` side (10.D, K6). There's no `split_into`
  column. Claims are re-linked through the event, so old assessments still point at the original.
- **Root causes are not automatically problems.** A cause is a claim (`cause`) on a problem. It
  becomes a problem of its own, linked by `problem_relations(kind = 'causes')`, only when it can be
  addressed on its own ("lender document requirements are unclear" can be; "people are busy" can't).
  This stops the problem list from turning into a causal graph nobody can act on.

### What this changes

- `problems.key` becomes a display slug with no uniqueness guarantee. Uniqueness lives in identity,
  and signature matching runs in code.
- Add `problem_type`, `anchor_element_id`, `qualifier_element_id`, `merged_into` (composite
  self-FK). Split history lives only in identity-event child tables (K6).
- Replace `problem_merges` with the more general `problem_identity_events`.
- Today's `pain_points.key` values map to a signature during backfill. The three seed cards map
  cleanly: `document_chasing → (documents, chasing, client)`,
  `case_status_updates → (offer, manual_status_communication)`,
  `application_rekeying → (full_application, duplicate_entry, lender system)`.

---

## 3. Provenance: how do we know a claim is reliable, and what happens on contradiction?

### Reliability is computed, never asserted

A claim's **standing** is computed by versioned rules from five inputs. This generalises
`assessConfidence`, which already does the first three for volumes and durations:

1. **Basis**: `measured` > `documented` ≈ `attested` > `stated` > `inferred` > `default`.
   `inferred` and `default` are capped at `low`.
2. **Independence**: support is counted by *independent source groups*, not by rows. A person is one
   group, however many times they repeat themselves. A document written by the same team that gave
   interviews is weak corroboration. Each dataset import is one group.
3. **Consistency**: numeric claims are compared with `CONSISTENCY_RATIO`; categorical claims are
   compared for divergence.
4. **Recency**: standing decays once a claim is past the claim type's freshness window, but only if
   something depends on the claim (see §4).
5. **Specificity**: a stated figure ranks above "loads", and a measured value with n=12 ranks below
   one with n=400.

Output: `standing ∈ {insufficient, low, medium, high, very_high}` plus human-readable reasons. This
is stored in an append-only assessment with `rules_version` and an `inputs_hash`.

**Measured doesn't mean true either.** Measured claims carry the connector run and the
mapping version. If a mapping turns out to be wrong (for example, "Awaiting docs" was mapped to the
wrong activity), every claim derived from that mapping version is marked `stale` in one step. This is
the practical payoff of tracing to the run.

### Contradiction

**First, most "contradictions" are unmodelled variation.** In discovery data, two people giving
different figures are usually both right about different cases (purchase versus remortgage, broker
versus direct, complex versus simple). So the first response to a divergence is to *ask what differs*,
not to pick a winner. The existing follow-up wording already does this ("walk me through a typical
case, so we can understand what makes it quicker or slower"). Keep that.

Mechanics:

| Step | What happens | Who/what |
|---|---|---|
| Detect | Same claim type, same subject, overlapping period, inconsistent values → `claim_links(kind = 'diverges')`. Categorical divergence (a different performer or system) is also `diverges`, because shared work is common and isn't a contradiction. | Deterministic |
| Show | Both claims are kept. The derived value shows a range and its sources by role (subject to minimum group size). Standing drops. | Deterministic (existing behaviour) |
| Investigate | The planner creates `discovery_tasks`: follow-ups to both sides, or a data request | Deterministic; AI only words the question |
| Resolve, option A | **Variation found**: claims are re-scoped with a `segment` (for example `case_type = remortgage`). Both stay accepted and the divergence closes. | Human decision, or a rule when participants state the segment |
| Resolve, option B | **Measured evidence arrives**: for numeric claims, `measured` supersedes `stated` automatically for the overlapping period. Stated claims are kept, marked `superseded_by`. | Deterministic rule, recorded |
| Resolve, option C | **Genuine conflict**: a human picks one and must cite evidence. The other becomes `rejected` with the decision id. | Human decision |
| Never | AI resolves a contradiction, or anything is deleted | — |

The AI may *suggest* a likely explanation ("the figures may differ by case type"). That suggestion is
an `inferred` claim like any other.

### What this changes

- Add a `claim_links` table (`supports | diverges | supersedes | refines`) between claims. In the
  main document, contradiction was modelled only as claim↔evidence, which is the wrong level.
- Add a `segment jsonb` to claims, with segment dimensions defined by the domain pack (mortgage:
  `case_type`, `channel`, `lender_type`).
- Replace the generic `value jsonb` with typed columns for measurements (see §8, W2).

---

## 4. Time: what was true then, versus what we know now

### Three clocks, not two

| Clock | Question | Where it lives |
|---|---|---|
| **Valid time** | When was this true in the organisation? | `valid_from/valid_to` on model versions; `about_period` on claims and observations |
| **Record time** | When did builda+ learn it? | `recorded_at` on append-only rows |
| **Decision time** | What did we know when we decided? | A decision row stores the ids of the exact assessments and claim set it was made from |

### Simplification: full bitemporality only where it pays

The main document implied bitemporality everywhere. That would make every query harder for little
gain. Decision:

- **Model element and relation versions** get *both* valid time and record time. This is the only
  place retroactive changes are common ("we learned in June that chasing moved to case managers in
  April").
- **Claims, metric observations, assessments, decisions and identity events** are append-only rows
  with `recorded_at`, plus an optional `about_period`. "What did we know at time T" is "latest row
  per id with `recorded_at ≤ T`". There's no `valid_to` to maintain.
- **"What did we know when we approved X"**, the question that matters most in practice, isn't
  reconstructed through temporal queries at all. The decision stores pointers to the immutable
  assessments it was based on (`decisions.basis_assessment_ids`). Replay is a join.

### Guardrails

- `exclude using gist (element_id with =, daterange(valid_from, valid_to) with &&)` (needs
  `btree_gist`), so two versions of the same element can never be valid at the same time.
- `current_elements` / `current_relations` views. Nearly all application code reads "now", and only
  history and audit screens use temporal queries.
- Date granularity for valid time. Nobody knows *when on 3 April* a responsibility moved.

### Worked example

1. *Jan, discovery 1*: case managers and administrators both chase documents. Relations
   `performs(admin, collect_docs)` and `performs(cm, collect_docs)`, valid from Jan.
2. *Apr*: the firm moves chasing to administrators only. Nobody tells builda+.
3. *Jun, pulse*: an administrator says "since April we do all the chasing".
   → stated claim, `about_period = [Apr, ∞)` → change-set proposal: close
   `performs(cm, collect_docs)` with `valid_to = Apr 1`, recorded in Jun.
4. Accepted. The January report and the March decision still show what was known then. A "process as
   of May" view now shows the corrected structure, and is labelled "learned in June".

---

## 5. Impact: connecting an implemented opportunity to measurable outcomes

### The chain

```
driver → opportunity (expected impact, from assessment)
       → decision: approve, WITH pre-registered success measures
       → initiative → adoption check → baseline frozen → go-live
       → measurement window → outcome computed (code) → outcome review (human)
       → driver status updated (problem resolved / persists / recurred)
```

### Decisions

1. **Pre-registration.** Success measures (metric, direction, expected size, measurement window,
   comparison method) are declared *at approval, before go-live*. Changing them afterwards needs a
   decision with a reason, and the outcome report shows the change. This is the single cheapest
   thing that makes builda+'s impact claims credible, because it stops anyone cherry-picking a
   flattering metric afterwards.
2. **The method is stated, ranked and shown on every outcome.**

   | Method | Strength | Typical source |
   |---|---|---|
   | `reported_before_after` | weakest | pulse interviews |
   | `attested` | weak | manager review |
   | `measured_before_after` | moderate | CSV / connector |
   | `measured_with_comparison` | strongest available | pilot versus non-pilot cases, or staggered rollout |

   The document-chasing template's definition of done already says "one week live on a pilot group
   of cases". That pilot group is a ready-made comparison group if the event log tags which cases
   were in it. Make that standard.
3. **Adoption before outcome.** Many changes fail because nobody uses them, not because they don't
   work. Each initiative declares one **adoption metric** (for example, the share of reminders sent
   through the new flow). An outcome review is "inconclusive: not adopted" when adoption is below a
   threshold, instead of reporting "no impact".
4. **Wording follows method.** Reports say "associated with a 40% fall in chasing time
   (measured before/after, n=180 cases)". They say "caused" only with a comparison group, and even
   then carefully. Hours become £ only with a firm-supplied cost (existing rule).
5. **Not numerically measurable** is a valid, explicit plan, recorded as a decision with a reason and
   followed by a qualitative outcome review. It is never filled with an estimated number.

### What this changes

- Add `success_measures` (pre-registered, linked to the approval decision) and
  `adoption_metric_id` on initiatives.
- `outcome_reviews` gains `method`, `adoption_met`, and `measure_ids`.
- Approval UI: an opportunity can't be approved for delivery until measures are declared or the "not
  measurable" decision is recorded. This enforces P1.

---

## 6. Ownership and tenancy: firm, network or group?

This needs a commercial decision, but the architecture can be set up now so that any answer is cheap
to implement later.

### The real structures

- **Directly authorised firm.** Owns its data. Today's model.
- **Network with appointed representatives (ARs).** The network principal is regulatorily
  responsible for its ARs, but ARs are independent businesses, and **they switch networks**. The
  current firm profile already captures `network_appointed_representative`.
- **Group with owned subsidiaries.** One owner, several legal entities, often shared operations.

### Options

| Option | Tenant | Pros | Cons |
|---|---|---|---|
| A. Firm-only | Firm | Simple; matches today | No network product |
| B. Network-as-tenant | Network; firms become org units | Simple network views | ARs can't take their data when they leave; network sees staff-level detail of independent firms, which undermines interview candour and is a controller/processor tangle |
| **C. Firm-as-tenant + organisation relationships** (recommended) | Firm | Data travels with the firm; networks and groups get scoped, consented access; benchmarking across member firms becomes a product | Slightly more complex access rules |

### Recommendation

- **The firm is always the tenant and owns its data.** builda+ is the processor and the firm is the
  controller. Who pays doesn't change who owns: a network can pay for its ARs' licences.
- **Organisation relationships** (`network_member`, `group_subsidiary`) carry a **grant level** that
  the member firm consents to:
  - `aggregate` (default for networks): cross-firm aggregates only, problem types and counts,
    benchmark metrics, with a minimum of k firms. Delivered through `security definer` functions,
    the same pattern as `knowledge_candidates`.
  - `findings`: firm-level problems, opportunities and outcomes, but no evidence text or quotes.
  - `full`: everything, for wholly owned group subsidiaries only.
- Grants are revocable by the member firm and audited. When a firm leaves a network, its data stays
  with it and the network keeps only aggregates computed while the relationship was active.

### Do this now (Phase 0), whatever the commercial answer

Change the RLS policy shape from `org_id = app_org()` to **functions**:

```sql
-- read: own org, or an org this session has been granted (partner or relationship)
create function app_can_read(o uuid) returns boolean ...;
-- write: own org only (plus narrowly scoped partner writes)
create function app_can_write(o uuid) returns boolean ...;

create policy tenant_read  on <t> for select using (app_can_read(org_id));
create policy tenant_write on <t> for insert with check (app_can_write(org_id));
-- update/delete policies likewise use app_can_write
```

Today both functions reduce to `org_id = app_org()` (plus the existing partner assignment rule).
Adding networks or groups later then changes two functions instead of ~40 policies, and keeps the
read/write asymmetry explicit. Users get **memberships in several orgs** from the start (consultants,
network staff, group finance), with the active org chosen per session.

**Decision needed from you:** whether a network can ever see firm-level `findings` without the
firm's explicit opt-in. I recommend not.

---

## 7. CSV event logs: caveats to design for

Agreed on the value. These are the traps to build around, because they decide whether event-log
analytics are trusted:

1. **Status history isn't activity history.** Most broker CRMs record status changes ("Submitted",
   "Offer issued"), not work. Time-in-status combines waiting and working. Label it as **elapsed
   time in stage**, never "effort", and keep interview-based minutes per occurrence as the effort
   measure.
2. **External waiting dominates.** Much elapsed time is lenders, valuers, solicitors and clients.
   Mapping should mark which statuses wait on an external party, so the firm sees what it can
   control and what it can't.
3. **Returns can be invisible.** "Returned for missing information" may show up only as a status
   going backwards, or not at all. Detect backwards transitions deterministically and ask about the
   gaps in a pulse interview.
4. **Small numbers.** A 5-adviser firm produces maybe 50–150 cases a month. Show n, ranges and
   medians. Suppress percentiles and trends below a minimum n. Don't present a 3-case week as a
   regression.
5. **People in the data.** Adviser and case-handler ids in exports are exactly the P2 risk. At
   import, map them to **roles** (or hash and drop them). Never store or show per-person cycle
   times.
6. **Client data.** Case ids are HMAC-hashed with a per-tenant key. Free-text columns are dropped
   unless explicitly mapped and scanned by the client-data guard.
7. **Mechanics.** Business days versus calendar days, bank holidays, reopened and withdrawn cases,
   duplicate rows on re-export (dedupe by hashed case id + status + timestamp).

---

## 8. Weak points in target-architecture.md, and amendments

These are the places where I expect the proposal to get complicated or break. Review them first.

| # | Weak point | Why it's a problem | Amendment |
|---|---|---|---|
| W1 | `problems unique (org_id, key)` | Identity by naming, the same flaw as today's pain points | §2: UUID identity, signature matching, `problem_identity_events`, merge/split pointers |
| W2 | `claims.value jsonb` + `claim_type text` | Becomes an entity–attribute–value store: hard to aggregate in SQL, easy to make inconsistent | Closed set of ~10 claim types, each with a core zod schema (packs can't add types, only segments). Typed columns for measurements: `quantity numeric`, `unit text`, `per text`, `n int`. `jsonb` only for the non-numeric remainder. |
| W3 | Contradiction modelled as claim↔evidence (`claim_evidence.relation = 'contradicts'`) | Contradictions are between claims | §3: `claim_links` between claims; `claim_evidence` keeps `supports` only |
| W4 | Bitemporality implied everywhere | Hard queries everywhere, little benefit | §4: bitemporal only for model versions; append-only plus `about_period` elsewhere; `current_*` views; GiST exclusion constraint |
| W5 | Change-set for every model change | **Review fatigue**: one interview could produce 30 items, and people will rubber-stamp them, which is worse than no review | Batch per engagement and review it in the playback. Auto-accept rules (each versioned): (a) pack template instantiation; (b) aliases resolved by exact match; (c) attributes backed by `measured` claims. Structural changes (new process, new role, a merge, ending a relation) always need a human. |
| W6 | Element merges | Relations and claims still point at the merged element; rewriting them destroys history | `model_elements.merged_into`; a resolver function `resolve_element(id)` used by `current_*` views; old rows are never rewritten |
| W7 | `decisions.subject_type` + `subject_id` (polymorphic FK) | No referential integrity; orphaned decisions go unnoticed | Nullable typed FKs (`opportunity_id`, `problem_id`, `change_set_id`, `claim_id`, `initiative_id`) with `check (num_nonnulls(...) = 1)` |
| W8 | RLS written as `org_id = app_org()` everywhere | Every policy has to be rewritten if networks or groups arrive | §6: `app_can_read` / `app_can_write` functions from Phase 0 |
| W9 | Opportunities link only to problems | Excludes obligations and goals | §1: `drivers` (`problem` / `goal` / `obligation`); `opportunity_drivers` |
| W10 | `pain_points` and `problems` run side by side open-endedly | Long dual-write periods are where inconsistency creeps in | Each compatibility view gets a removal milestone in the phase plan. Dual-write lasts at most one phase. |
| W11 | No pre-registration of success measures | Outcomes can be cherry-picked afterwards | §5 |
| W12 | Phase durations | Estimates are guesses without team size | Treat them as relative sizing only |

### Schema deltas (against target-architecture.md §3.3)

```sql
-- §2 identity
alter table problems drop constraint problems_org_id_key_key;          -- key becomes a label
alter table problems add column problem_type text not null;            -- validated against core+pack taxonomy
alter table problems add column anchor_element_id uuid not null references model_elements(id);
alter table problems add column qualifier_element_id uuid references model_elements(id);
alter table problems add column merged_into uuid references problems(id);
create index problems_signature on problems (org_id, anchor_element_id, problem_type, qualifier_element_id)
  where merged_into is null;
alter table problem_claims add column linked_by text not null;         -- 'rule:signature' | 'user:<id>'
create table problem_identity_events (                                 -- replaces problem_merges; append-only
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  kind text not null check (kind in ('merge','split','relink_claims','unlink')),
  from_ids uuid[] not null, to_ids uuid[] not null,
  claim_ids uuid[] not null default '{}',
  decided_by text not null, reason text not null,
  created_at timestamptz not null default now()
);
create table problem_relations (problem_id uuid not null references problems(id),
  related_id uuid not null references problems(id),
  kind text not null check (kind in ('causes','contributes_to')),
  decision_id uuid, primary key (problem_id, related_id, kind));

-- §1 drivers
create table drivers (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  kind text not null check (kind in ('problem','goal','obligation')),
  problem_id uuid references problems(id),
  title text not null, evidence_claim_ids uuid[] not null default '{}',
  check ((kind = 'problem') = (problem_id is not null))
);
create table opportunity_drivers (opportunity_id uuid references opportunities(id),
  driver_id uuid references drivers(id), primary key (opportunity_id, driver_id));
-- opportunity_problems is dropped in favour of opportunity_drivers

-- §3 provenance (W2, W3)
alter table claims add column quantity numeric, add column unit text, add column per text,
                   add column sample_n int, add column segment jsonb not null default '{}',
                   add column about_period daterange;
alter table claims drop column valid_during;                            -- replaced by about_period
create table claim_links (
  from_claim uuid not null references claims(id), to_claim uuid not null references claims(id),
  kind text not null check (kind in ('supports','diverges','supersedes','refines')),
  created_by text not null, decision_id uuid, created_at timestamptz not null default now(),
  primary key (from_claim, to_claim, kind));
-- claim_evidence.relation restricted to 'supports'
create table claim_assessments (                                        -- append-only standing
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  claim_id uuid not null references claims(id),
  standing text not null, reasons text[] not null,
  rules_version text not null, inputs_hash text not null,
  computed_at timestamptz not null default now());

-- §4 time (W4, W6)
create extension if not exists btree_gist;
alter table model_element_versions add constraint no_overlapping_versions
  exclude using gist (element_id with =, daterange(valid_from, valid_to) with &&);
alter table model_elements add column merged_into uuid references model_elements(id);
alter table decisions add column basis_assessment_ids uuid[] not null default '{}';

-- §5 impact (W11)
create table success_measures (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  approval_decision_id uuid not null references decisions(id),
  metric_id uuid references metrics(id),                               -- null when not numerically measurable
  direction text check (direction in ('decrease','increase')),
  expected_change numeric, window_days int,
  method text not null check (method in ('reported_before_after','attested',
                                         'measured_before_after','measured_with_comparison','not_measurable')),
  not_measurable_reason text,
  superseded_by uuid references success_measures(id),
  created_at timestamptz not null default now(),
  check ((method = 'not_measurable') = (metric_id is null and not_measurable_reason is not null)));
alter table initiatives add column adoption_metric_id uuid references metrics(id);
alter table outcome_reviews add column method text not null, add column adoption_met boolean,
                            add column measure_ids uuid[] not null default '{}';

-- §6 ownership (W8)
create table org_relationships (
  id uuid primary key default gen_random_uuid(),
  parent_org_id uuid not null references organisations(id),
  member_org_id uuid not null references organisations(id),
  kind text not null check (kind in ('network_member','group_subsidiary')),
  grant_level text not null check (grant_level in ('aggregate','findings','full')),
  consented_by uuid not null references users(id),                     -- a user of the MEMBER org
  valid_from timestamptz not null default now(), revoked_at timestamptz);

-- W7 decisions
alter table decisions drop column subject_type, drop column subject_id,
  add column opportunity_id uuid references opportunities(id),
  add column problem_id uuid references problems(id),
  add column change_set_id uuid references change_sets(id),
  add column claim_id uuid references claims(id),
  add column initiative_id uuid references initiatives(id),
  add constraint one_subject check (num_nonnulls(opportunity_id, problem_id, change_set_id, claim_id, initiative_id) = 1);
```

### Changes to the migration sequence

| Phase | Addition |
|---|---|
| 0 | RLS policies rewritten to `app_can_read` / `app_can_write`; multi-org memberships. **Ownership decision (§6) needed before the identity work in this phase is finished.** |
| 1 | The domain pack also carries the problem-type extensions, claim segment dimensions and event-log mapping presets |
| 2 | `model_elements.merged_into` and the GiST exclusion constraint from the start; batched change-set review in playback |
| 3 | `claim_links`, `claim_assessments`, typed measurement columns. Each backfilled pain point gets a signature. |
| 4 | Signature matching and identity events replace key-based upserts. **`pain_points` compatibility view removed at the end of this phase.** |
| 5 | Drivers, success measures, adoption metrics; approval is blocked without measures or a "not measurable" decision |
| 6 | Event-log import implements the §7 caveats as acceptance criteria |

---

## 9. Decisions (resolved after review)

| # | Decision | Resolution |
|---|---|---|
| 1 | Ownership | **Firm-as-tenant.** No firm-level findings reach a network without explicit opt-in. Consent is granular (per grant level), attributable (a named owner/admin of the member firm), revocable and audited. **Paying for a firm's subscription never grants data access.** |
| 2 | Drivers | **Adopted:** `problem | goal | obligation`. |
| 3 | Problem taxonomy | **Starting vocabulary, not exhaustive.** Packs may only *extend* a core type (each extension names its core parent); they can't add top-level types. Taxonomy versions change only with a mapping from old to new (§10.G). |
| 4 | Pre-registration | **Blocking by default.** No initiative goes live without declared success measures or a `not_measurable` decision. That decision needs a reason and a second approver, and is visible in reports (§10.D). |
| 5 | Minimum group sizes | **k=3 for role outputs, k=5 firms for network aggregates**, treated as minimums, not anonymity guarantees. Plus complementary suppression and differencing protections (§10.F). |

---

## 10. Refinements after review

These make §2–§8 precise. Where they conflict with earlier sections, this section wins.

### 10.0 Two cross-cutting rules (they explain most of the fixes below)

**R1 — No foreign keys inside arrays.** Postgres can't enforce an FK on elements of a `uuid[]`.
Every reference that matters for history or provenance becomes a join table with real FKs. Arrays
are allowed only for values (labels, reasons), never for references. This applies to arrays in
both documents *and* in existing migrations (§11 lists them).

**R2 — Tenant-consistent foreign keys.** Postgres **does not apply RLS to foreign-key checks**, so a
plain `references claims(id)` lets a row in Firm A point at a row in Firm B if the id is known. RLS
`with check` constrains the inserted row's own `org_id`, not what it references. Every tenant table
therefore gets `unique (org_id, id)`, and every intra-tenant FK is composite:

```sql
alter table claims add constraint claims_org_id_id unique (org_id, id);
-- then, everywhere:
foreign key (org_id, claim_id) references claims (org_id, id)
```

This also covers `claim_links` tenant consistency (§10.D). The existing migrations have the same
gap (for example `evidence_records.session_id`, `opportunities.pain_point_id`). The risk is low
today because ids are random UUIDs that are never exposed across tenants, but it's fixed in the
Phase 0 migration.

### 10.A Problem signatures and segments

Agreed: segments must be able to take part in identity, but must not do so automatically.

- A problem may declare **identity segments**: zero or more `(dimension, value)` pairs drawn from the
  pack's segment dimensions (`case_type = purchase`). They're stored in a child table
  (`problem_identity_segments`), not jsonb, so matching is a join.
- Default: **no identity segments.** A problem gains one only through an identity event: a split
  decided by a human, or a pack rule that marks a dimension as identity-relevant for a problem type.
- Claims carry *observed* segments. **Matching rules:**

| Situation | Outcome |
|---|---|
| Exactly one candidate with the same anchor/type/qualifier, and the claim's segments are *compatible* with it | Auto-link (rule-recorded, reversible) |
| One candidate, but the claim has a value for one of its identity dimensions that differs (`remortgage` vs `purchase`) | Never auto-link; propose: link, new sibling problem, or widen |
| Several candidates (for example purchase and remortgage siblings) and the claim gives no value for the distinguishing dimension | Never auto-link; queue for review (and possibly a follow-up question) |
| No candidates | New problem with no identity segments |

"Compatible" means: for each identity dimension of the candidate, the claim has either the same
value or no value. Segments that aren't identity-relevant are kept on claims for analysis and never
split problems. This stops minor variation from multiplying problems.

### 10.B Append-only, stated precisely

The earlier text was inconsistent: it said versions are append-only, yet "closed by setting
`valid_to`". The guarantee becomes:

> **Model element and relation versions are immutable in content. Their validity may be closed
> exactly once**, by the change-set that supersedes them, in the same transaction that inserts the
> successor.

I chose a one-time closure over fully derived validity because closure keeps the GiST
non-overlap constraint enforceable. A derived `valid_to` (via a window function) can't be
constrained. The rule is enforced three ways:

1. **Privileges:** `grant update (valid_to, closed_by_change_set) on model_element_versions to builda_app`
   and nothing else. Postgres column-level privileges make every other column unwritable.
2. **Trigger:** rejects the update unless `old.valid_to is null`, the new `valid_to ≥ valid_from`,
   and `closed_by_change_set` references an *accepted* change-set that also inserted the successor.
3. **Closure is an event:** `closed_by_change_set` makes the closure as attributable as the
   insert.

**Claim status follows the event model fully.** The `claims.status` column is removed.
`claim_status_events` is the only record. Current status comes from the view
`claim_current_status` (latest event per claim). Transitions are validated by a trigger against an
allowed-transitions table (`proposed → accepted | disputed | rejected`, `accepted → superseded |
stale | disputed`, …). The same pattern applies to `problems.status`, `opportunities.status` and
`initiatives.status`: status columns become views over `*_status_events`. That's more joins, but
at this data size it costs nothing, and every transition is attributable by construction.

### 10.C Decision basis as a join table

Adopted, with one correction. A single `assessment_id` column would reintroduce polymorphism,
because assessments live in three tables (claim, problem and opportunity assessments). So:

```sql
create table decision_basis (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  decision_id uuid not null,
  claim_assessment_id uuid,
  problem_assessment_id uuid,
  opportunity_assessment_id uuid,
  claim_id uuid,
  basis_role text not null check (basis_role in ('supporting','contradicting','contextual')),
  foreign key (org_id, decision_id)               references decisions (org_id, id),
  foreign key (org_id, claim_assessment_id)       references claim_assessments (org_id, id),
  foreign key (org_id, problem_assessment_id)     references problem_assessments (org_id, id),
  foreign key (org_id, opportunity_assessment_id) references opportunity_assessments (org_id, id),
  foreign key (org_id, claim_id)                  references claims (org_id, id),
  check (num_nonnulls(claim_assessment_id, problem_assessment_id, opportunity_assessment_id, claim_id) = 1)
);
-- append-only; rows are written in the same transaction as the decision
revoke update, delete on decision_basis from builda_app;
```

`decisions.basis_assessment_ids` is removed. Because assessments are append-only and are never
recomputed in place, the basis can't drift after the decision is made.

### 10.D Constraint corrections

**`success_measures`.** The earlier check was wrong: a numerical method with no metric and no
reason passed it. Replacement:

```sql
check (
  (method = 'not_measurable'
     and metric_id is null and direction is null and expected_change is null
     and not_measurable_reason is not null and length(trim(not_measurable_reason)) >= 20)
  or
  (method <> 'not_measurable'
     and metric_id is not null and direction is not null and window_days is not null
     and not_measurable_reason is null)
)
```

Plus: a `not_measurable` measure takes effect only with a `decisions` row approving it by someone
other than the proposer. This is enforced by a trigger on the initiative's go-live transition. The
report shows the count of not-measurable initiatives, so the exception stays visible.

**`problem_identity_events`.** Arrays are replaced by child tables:

```sql
create table problem_identity_events (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  kind text not null check (kind in ('merge','split','relink_claims','unlink','add_identity_segment')),
  decision_id uuid,                              -- null only for rule-made links
  rule_ref text,                                 -- e.g. 'rule:signature@v1'
  reason text not null, created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, decision_id) references decisions (org_id, id),
  check (num_nonnulls(decision_id, rule_ref) = 1),
  check (kind in ('relink_claims') or decision_id is not null)   -- merges/splits always human
);
create table problem_identity_event_problems (
  event_id uuid not null, org_id uuid not null, problem_id uuid not null,
  side text not null check (side in ('from','to')),
  primary key (event_id, problem_id, side),
  foreign key (org_id, event_id)   references problem_identity_events (org_id, id),
  foreign key (org_id, problem_id) references problems (org_id, id)
);
create table problem_identity_event_claims (
  event_id uuid not null, org_id uuid not null, claim_id uuid not null,
  primary key (event_id, claim_id),
  foreign key (org_id, event_id) references problem_identity_events (org_id, id),
  foreign key (org_id, claim_id) references claims (org_id, id)
);
```

**`problem_relations.decision_id`** becomes `not null` with a composite FK to `decisions`.

**`claim_links`** uses composite FKs on both ends (R2), plus `check (from_claim <> to_claim)`.

**`drivers.evidence_claim_ids`**, **`outcome_reviews.measure_ids`** and
**`change_set_items.supporting_claims`** become join tables (`driver_claims`,
`outcome_review_measures`, `change_set_item_claims`).

### 10.E Access-control security contract

**Principle:** the session setting *selects* which org you are acting in. The database
*verifies* that you're allowed to. Changing the setting never grants anything by itself.

| Concern | Contract |
|---|---|
| Identity | The server authenticates (OIDC) and sets `app.current_user_id` per transaction. The value comes only from the verified token, never from request input. |
| Active org | The server sets `app.current_org_id` from the user's choice. `app_can_read` / `app_can_write` **re-verify** it against `memberships` on every check, so a forged or stale setting returns nothing. |
| Membership | `app_can_write(o) := exists (membership(o, app_user()) with role ∈ writer roles) and o = app_org()`. You can write only to the org you are actively in *and* belong to. |
| Data classes | Reads are checked per data class: `app_can_read(o, class)`, where class ∈ `evidence` (sources, segments, spans, claims, transcripts), `findings` (problems, opportunities, decisions, initiatives, outcomes), `model`. Each table's policy passes its class. |
| Network / group | Row access exists **only** at grant level `findings` (findings class only) or `full` (all classes), and only while `revoked_at is null`. The `aggregate` level gives **no row access at all**; it only allows calling the fixed aggregate functions (10.F). |
| Same-network isolation | Membership of a network org confers nothing about Firm B unless `org_relationships(parent = network, member = B)` has an active grant. Even then it's read-only, and never `evidence` unless the level is `full`. |
| Revocation | No caching: grants are evaluated per statement. Revocation takes effect at the next transaction. Aggregates already published before revocation stay (see 10.F), and nothing new includes the firm. |
| Partner vs network | Partner grants (`partner_grants`) are per-person, time-boxed (`expires_at` mandatory), scoped to an engagement or initiative, and allow writes **only** to delivery tables (initiative plans, delivery reviews, escalation resolution). Network grants are per-org, open-ended until revoked, and read-only. |
| Consent | `org_relationships` changes are only possible through a `security definer` function that checks the caller is an owner/admin of the **member** org, and writes an audit row in the member org. |

**`SECURITY DEFINER` hygiene** (this also fixes existing code):

- **Existing issue:** `knowledge_candidates(p_caller)`, `jada_queue(p_user)` and
  `jada_pick_up(p_user, …)` take the caller's identity **as a parameter**. Any code path that can run
  SQL as `builda_app` can pass another user's id. And because `npm run migrate` uses the admin
  connection, these functions are **owned by the administrator (superuser) role**, so they run with
  full privileges, bypassing RLS entirely.
- **Rule:** definer functions take identity from `app_user()` only, never from a parameter.
- **Rule:** each is owned by a dedicated `NOLOGIN` role (`builda_definer_aggregates`,
  `builda_definer_identity`) granted only the `SELECT`s it needs. Never superuser.
- **Rule:** `set search_path = pg_catalog, public` (pinned), `revoke all … from public`,
  `grant execute` to `builda_app` only.
- **Tests (Phase 0 exit criteria)**, in the style of `test_rls.sql`:
  1. A user in Firm A and Network N sets `app.current_org_id = B`, where B is in N with an `aggregate`
     grant → sees zero rows in every table.
  2. Same, with a `findings` grant → sees B's findings tables, zero `evidence` rows, and can't write.
  3. Revoke the grant → the next transaction sees nothing.
  4. A forged `app.current_org_id` for an org with no membership → zero rows, inserts fail.
  5. A composite FK prevents a Firm A row referencing a Firm B claim, even with the id known.
  6. Every definer function: called with a non-staff `app.current_user_id` → no rows / false.
  7. An expired partner grant → no access. A partner write to a non-delivery table → rejected.
  8. A catalogue check: no `security definer` function is owned by a superuser or lacks a pinned
     `search_path`.

### 10.F Inference protection beyond k

The simplest robust defence is to **not offer ad-hoc queries** to networks at all:

1. **Fixed, published aggregates only.** Network aggregates are computed as **period snapshots**
   (calendar quarters) by a job, stored, and served as-is. There are no filters, no custom date
   ranges and no drill-down. This removes most differencing attacks at the source.
2. **Frozen cohorts.** A snapshot's cohort is the set of firms with an active grant at the period
   start *and* end. Firms joining or leaving mid-period are excluded from that period. Membership
   changes therefore show up only at boundaries, and a snapshot is never recomputed after
   publication.
3. **Thresholds.** A cell is published only if it has ≥5 firms **and** no single firm contributes more
   than 50% of the cell's underlying volume (a dominance rule, because k firms where one dominates is
   still disclosive).
4. **Complementary suppression.** If a cell is suppressed and its total and siblings are published,
   the next-smallest sibling is also suppressed, so the hidden value can't be subtracted out.
5. **Consecutive-period differencing.** If the cohort changed by ≤2 firms between consecutive
   periods, cells whose difference would isolate those firms aren't published for the later period.
6. **Role level inside a firm.** k=3 applies to quotes, figures and disagreements. Below k, results
   roll up to the org unit, or are shown as "a team member" without a role. The same complementary
   rule applies, so a roll-up can't be subtracted from a visible sibling.
7. **No person-level analytics** anywhere (P2), including in exports.
8. **Exports** are generated from the same suppressed views (never raw tables), watermarked with the
   requester and time, and audited. Bulk evidence export is restricted to owner/admin of the owning
   firm.

Formal differential privacy is **[LATER]**. It's only worth it if networks one day need ad-hoc
querying, which this design deliberately avoids.

### 10.G Taxonomy governance

- `problem_types` is a versioned pack table: `(release, key, parent_core_key, status)`. Core keys are
  global and change only through a platform release.
- A pack extension must name a `parent_core_key`. Network benchmarks always aggregate at core level.
- A new taxonomy release that renames, merges or retires a type must ship a **mapping**
  `(from_release, from_key) → (to_release, to_key)`, and a release that lacks one fails publication
  (same mechanism as today's `assembleRelease` errors).
- Problems keep their `problem_type` as recorded. Adopting a new release applies the mapping through
  identity events, so the history shows the reclassification.

### 10.H Elapsed time, active effort, external waiting

Adopted as a first-class distinction, enforced in the metric model:

| Measure | Source | Never derived from |
|---|---|---|
| **Elapsed time** in a stage | Event-log timestamps | — |
| **Active effort** per occurrence | Interviews, attestation, time studies (later, task-level systems) | Elapsed time |
| **External waiting** | Event-log stages mapped as waiting on an external party (client, lender, valuer, solicitor) | Interviews alone (those give estimates, labelled as such) |

`metrics.measure_kind ∈ ('elapsed','effort','external_wait','volume','rate','quality')` is
required, and the impact calculation (`calculateImpact`) only accepts `effort` as minutes per
occurrence. The type system prevents the elapsed-equals-effort mistake rather than leaving it to
documentation. Reports show the three side by side for each stage. That view ("12 days elapsed, of
which 9 waiting on the client, 25 minutes of work") is a strong product moment.

### 10.I Adoption ladder

Initiative progress is a ladder of **separately evidenced** milestones, not one status:

| Rung | Meaning | Evidence |
|---|---|---|
| 1. Implemented | Built and tested | Delivery review (today's `pack_reviews`) |
| 2. Available | Switched on for the intended users/cases | Attestation, or a config/event |
| 3. Adopted | Used at or above the declared adoption threshold | Adoption metric |
| 4. Operational change observed | The intended mechanism changed (for example, chases per case fell) | Success measure, mechanism metric |
| 5. Business outcome achieved | The declared business measure moved | Success measure, outcome metric |

`initiative_milestones(initiative_id, rung, reached_at, evidence: decision or observation FK)`,
append-only. An outcome review reports **the highest rung reached and why the next one wasn't**, so
"no impact" becomes "available but not adopted: 22% of reminders sent through the new flow against a
70% threshold". Success measures gain a `level ∈ ('mechanism','outcome')`, and each initiative
declares at least one of each, or uses the not-measurable route for the outcome level.

### 10.J Priority order (adopted)

1. Production identity, tenancy, access-control functions and security tests (10.E, R2,
   definer fixes)
2. Domain packs; mortgage assumptions removed from the core
3. Operating model, versioning (10.B), reviewed change-sets
4. Immutable sources, evidence spans, claims, claim links, status events
5. Persistent problems (10.A), drivers, stable opportunity identities
6. Decisions + basis (10.C), initiatives, adoption ladder (10.I), outcomes
7. CSV ingestion and operational analytics (§7, 10.H)

Out of scope until there is a demonstrated need: connectors, a graph database, a separate AI memory
store.

---

### 10.K Final amendments before implementation

These resolve the remaining security, versioning, reference and measurement issues raised in the
review. Each one is backed by an acceptance check in §12.

#### K1. Three independent layers of tenant isolation

| Layer | Controls | Enforced by |
|---|---|---|
| 1. Row-level security | Which rows a session can see or write | Postgres policies over `app_can_read(o, class)` / `app_can_write(o)` |
| 2. Tenant-consistent relationships | That no relationship crosses a tenant boundary | Composite `(org_id, id)` foreign keys (R2) |
| 3. Application authorisation | What an authenticated user may *do* (role, workflow state, approvals) | Service-layer checks (e.g. today's `lead()` guard, four-eyes rules) |

None of these replaces the others. A test suite that passes on one layer says nothing about the
other two.

#### K2. A trusted database identity (resolves the session-impersonation gap)

**Problem.** Custom settings such as `app.current_user_id` are writable by the role that owns the
session. If an attacker can run arbitrary SQL as `builda_app` (for example through SQL injection),
they can set *both* user and org to a legitimate pair. The membership check in §10.E would then
succeed. Checking membership is not the same as checking that the identity belongs to the request.

**Threat model.**

| Threat | In scope for the database layer? | Mitigation |
|---|---|---|
| T1. Arbitrary SQL as `builda_app` with no access to application secrets (SQL injection, a compromised query path) | **Yes** | Signed context, verified on every read (below) |
| T2. A bug passes the wrong user/org into the context | **Yes** | The context is built only from the verified session in one function; tests 1–9 |
| T3. Full compromise of the application server (code execution, access to its secrets) | **No.** No DB-side mechanism can stop a server that holds the signing key from minting contexts | Infrastructure: secret manager, least privilege, audit, alerting. Revisit with a separate token signer if enterprise customers require it |

T3 is stated explicitly so nobody assumes the database protects against it.

**Mechanism: signed context, verified on read.**

1. Per transaction, the server sets exactly one setting, `app.context`. It's a token
   `key_id.payload.signature`, where the payload is `{u | p, o, exp, rid}`: user id *or* participant
   id, active org, expiry (≤ 120 s), request id. The signature is HMAC-SHA256.
2. Signing keys live in `builda_security.context_keys`, a schema on which `builda_app` has **no**
   privileges. Keys are rotated by `key_id` with validity windows.
3. `app_user()`, `app_participant()` and `app_org()` become `SECURITY DEFINER` functions owned by
   `builda_definer_identity`. **On every call** they read `app.context`, verify the signature with the
   key, check `exp`, and return the ids, or `NULL` if anything fails. They never read any other
   setting.
4. **Why verify on read rather than once:** any "verified" flag stored in a setting would itself be
   writable. Re-verifying costs one HMAC per statement, because policies call `(select app_org())`,
   which Postgres evaluates once per statement as an initplan.
5. `app_can_read` / `app_can_write` then check the verified identity against `memberships` and grants
   (§10.E), unchanged.
6. Background jobs get a context with `u = 'system:<job kind>'`, signed by the worker and scoped to
   one org. That identity is permitted only the operations its job kind needs (application layer,
   K1 level 3).
7. Under T1, an attacker can read the *current* request's token, but that only grants the identity
   they're already running as. Tokens are never stored: they're excluded from `audit_log`, from logs,
   and from `pg_stat_statements` (the token is a bound parameter).

Sketch (illustrative, not final):

```sql
create schema builda_security;
revoke all on schema builda_security from public;
create table builda_security.context_keys (
  key_id text primary key, secret bytea not null,
  valid_from timestamptz not null, valid_to timestamptz);
alter table builda_security.context_keys owner to builda_definer_identity;

create function builda.app_context() returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp as $$
declare tok text := current_setting('app.context', true);
        p text[]; k bytea; body jsonb;
begin
  if tok is null or tok = '' then return null; end if;
  p := string_to_array(tok, '.');
  if array_length(p, 1) <> 3 then return null; end if;
  select secret into k from builda_security.context_keys
   where key_id = p[1] and now() >= valid_from and (valid_to is null or now() < valid_to);
  if k is null then return null; end if;
  if extensions.hmac(convert_to(p[1] || '.' || p[2], 'UTF8'), k, 'sha256')
       <> decode(p[3], 'base64') then return null; end if;
  body := convert_from(decode(p[2], 'base64'), 'UTF8')::jsonb;
  if (body->>'exp')::bigint < extract(epoch from now()) then return null; end if;
  return body;
end $$;
-- app_user()/app_org()/app_participant() read fields from app_context()
```

(Base64url handling and the pgcrypto schema location get settled at implementation. Pin
`pgcrypto` in an `extensions` schema so `hmac` is referenced by qualified name.)

**Test 9 (added to §10.E):** using the `builda_app` role directly, (a) set `app.context` to a token
signed with a wrong key, (b) re-sign an altered payload, (c) replay an expired token, (d) set the
legacy `app.current_user_id` / `app.current_org_id` settings → every case yields zero rows, failed
inserts, and `app_user() is null`. Variant: a valid token for user X in Firm A cannot be turned into
user Y of Firm A.

#### K3. `SECURITY DEFINER`: owners, privileges and RLS

**A correction to the requirement set.** Function owners must not have `BYPASSRLS` and must not own
tenant tables, so `FORCE ROW LEVEL SECURITY` applies to them. A cross-tenant aggregate function
running without org context would therefore see **nothing**. The access has to be granted
explicitly. Each definer role gets **role-scoped policies on exactly the tables and operations it
needs**:

```sql
create policy aggregates_read on problems for select to builda_definer_aggregates using (true);
```

This is more explicit than `BYPASSRLS`. It's per table and per operation, it's visible in the catalogue,
and adding a table doesn't silently widen access.

**Privilege profiles:**

| Owner role | Functions | Privileges (and matching role-scoped policies) |
|---|---|---|
| `builda_definer_identity` | `app_context`, `app_user`, `app_org`, `app_participant`, `app_can_read`, `app_can_write` | `SELECT` on `builda_security.context_keys`, `memberships`, `partner_grants`, `org_relationships` |
| `builda_definer_aggregates` | `knowledge_candidates`, network snapshot builders | `SELECT` on the specific source tables and columns; `INSERT` on snapshot tables only |
| `builda_definer_queue` | `jada_queue` / `partner_queue` | `SELECT` on `discoveries` (id, status, created_at, org_id), `organisations` (id, name), `escalations` (discovery_id, status), staff roles |
| `builda_definer_pickup` | `jada_pick_up` / `partner_pick_up` | Everything in the queue profile, plus `INSERT` on `partner_grants` (or `jada_assignments` before migration) and `INSERT` on `audit_log`. **No `UPDATE` or `DELETE` anywhere.** |
| `builda_definer_consent` | `grant_relationship`, `revoke_relationship` | `INSERT` on `org_relationships`; `UPDATE (revoked_at)` only; `INSERT` on `audit_log` |

**Requirements for every definer function** (all checked mechanically in §12):

- The owner is `NOLOGIN`, not a superuser, has no `BYPASSRLS`, and owns no tenant table.
- `EXECUTE` is revoked from `PUBLIC` and granted only to `builda_app`.
- `SET search_path = pg_catalog, pg_temp`. Trusted schemas only, `pg_temp` last. Every
  object reference in the body is schema-qualified (`builda.problems`, `extensions.hmac`), so nothing
  is resolved through the path anyway.
- Caller identity comes from `app_user()` / `app_participant()` (K2), never from a parameter.
- Tenant tables move to a `builda` schema with `CREATE` granted to no runtime role. `public` has
  `CREATE` revoked from `PUBLIC`, which is the default since Postgres 15 but is still asserted.
- Each function has a unit test that calls it with no context, a participant context and a non-staff
  context, and asserts no rows or `false`.

#### K4. Model version closure: retirement, voiding, strict intervals

The closure rule in §10.B becomes:

> A version is closed **at most once**, by an **accepted** change-set containing a change-set item
> that targets that version and is one of: `update_element` / `update_relation` (which must insert the
> successor version in the same transaction), `retire_element`, `end_relation`, or `merge_elements`.

- The trigger checks the **specific change-set item** (`change_set_item_id` is stored on closure),
  not merely that another version exists.
- `check (valid_to is null or valid_to > valid_from)`. Empty intervals are rejected.
- **Voiding** covers versions recorded in error, which were never true. Closing them would falsely
  assert they were true until the closure date. Add `voided_by_change_set_item uuid` (also
  set at most once, by an accepted change-set item of op `void_version`). Voided versions are
  excluded from `current_*` and as-of views, and from the non-overlap constraint:
  `exclude using gist (element_id with =, daterange(valid_from, valid_to) with &&) where (voided_by_change_set_item is null)`.
- Column privileges: `builda_app` may update only `valid_to`, `closed_by_change_set_item` and
  `voided_by_change_set_item`, and the trigger allows each to change once, from `NULL`.

#### K5. Stable relation identity

Relations get the same identity/version split as elements:

```sql
create table builda.model_relations (            -- logical relationship, stable across time
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  kind text not null references builda.relation_kinds(kind),        -- global reference
  from_element_id uuid not null,
  to_element_id uuid not null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, kind, from_element_id, to_element_id),
  foreign key (org_id, from_element_id) references builda.model_elements (org_id, id),
  foreign key (org_id, to_element_id)   references builda.model_elements (org_id, id),
  check (from_element_id <> to_element_id)
);
create table builda.model_relation_versions (    -- immutable content, one-time closure/void (K4)
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  relation_id uuid not null,
  attrs jsonb not null default '{}',
  valid_from date not null, valid_to date,
  created_by_change_set_item uuid not null,
  closed_by_change_set_item uuid, voided_by_change_set_item uuid,
  recorded_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, relation_id) references builda.model_relations (org_id, id),
  foreign key (org_id, created_by_change_set_item) references builda.change_set_items (org_id, id),
  check (valid_to is null or valid_to > valid_from),
  exclude using gist (relation_id with =, daterange(valid_from, valid_to) with &&)
    where (voided_by_change_set_item is null)
);
```

The `relation_kinds` endpoint-kind rule (`from_kind`, `to_kind`) is checked by trigger, since it
needs a lookup. A relationship that ends and later resumes keeps its `id` and gains a new version
after the gap. Changing an endpoint creates a **different** relation. After an element merge,
relations keep pointing at the merged element, and `resolve_element()` maps them in views (W6).

#### K6. Reference audit: no polymorphism, every tenant FK composite

**Rule.** Every reference column is classified as either:

- **tenant-scoped**: a composite FK `(org_id, x_id)`. That's the default.
- **global**: an FK to a platform table (`users`, `relation_kinds`, pack/taxonomy tables,
  `knowledge_*`). It's listed in an allowlist used by the §12 catalogue check.
- **non-referential by design**: only `audit_log.entity_id`. An audit log must be able to record
  deletes, failures and entities in other systems, so it stays `text` and is documented as the sole
  exception.

**Specific resolutions:**

| Location | Resolution |
|---|---|
| `partner_grants.scope_id` | Replaced by `engagement_id`, `initiative_id` (typed, composite FKs). `check` by scope: `org_read` → both null; `engagement` → only `engagement_id`; `initiative` → only `initiative_id`. `partner_user_id` and `granted_by` are global FKs to `users`. |
| `discovery_tasks` targets | **Exactly one primary target**: typed nullable `problem_id`, `claim_id`, `element_id`, `initiative_id`, with `num_nonnulls(...) = 1`. Additional context (for example the two diverging claims behind a disagreement task) goes in `discovery_task_context(task_id, claim_id)`. A task about several problems becomes several tasks. |
| `initiative_milestones.evidence` | Typed `decision_id`, `metric_observation_id`, `delivery_review_id` with `num_nonnulls(...) = 1`, all composite FKs. |
| `claim_links.decision_id` | Composite FK to `decisions`. Required when `created_by` is a user, null when a rule made the link, with a `check` tying the two together. |
| `sources` | `engagement_id`, `interview_session_id`, `connector_run_id` are typed composite FKs, with a `check` per `kind`: `interview` → `interview_session_id` required; `data_extract` → `connector_run_id` required; others → both null. |
| `claim_evidence`, `problem_claims`, `problem_anchors`, `opportunity_drivers`, `driver_claims`, `role_assignments`, `metric_observations`, `baselines` / `baseline_observations`, `change_set_item_claims`, `outcome_review_measures`, `decision_basis`, `engagement_scope`, every `*_status_events` table | All carry `org_id`; every reference is a composite FK. |
| `model_elements.merged_into`, `problems.merged_into` | Self-referencing composite FKs `(org_id, merged_into) → (org_id, id)`. |
| `problems.split_into[]` | **Removed** (it was an array, against R1). Split history lives only in `problem_identity_event_problems`. |

#### K7. Decision basis: the subject's provenance, ordering, immutability

**Subject consistency.** A requirement that "the assessment must assess the decision's subject"
would be too strict. Deciding on an opportunity legitimately cites assessments of the *problem* that
drives it, and of the claims behind that problem. The rule is a **provenance closure**:

| `basis_role` | Allowed targets |
|---|---|
| `supporting`, `contradicting` | The subject itself, or anything reachable from it through the evidence chain: opportunity → drivers → problems → claims; problem → claims; change-set → items → claims; initiative → opportunity → … |
| `contextual` | Any same-org item (composite FK already guarantees same org). Used, for example, for the ranked list a priority decision was made from, which is mostly *other* opportunities. |

This is enforced by a **deferred constraint trigger** (`deferrable initially deferred`), because
the decision and its basis rows are inserted in one transaction, and the closure must be checked once
both exist. The closure function walks typed join tables, so it's a handful of indexed lookups.

**Ordering.** `decision_basis.ordinal int` (nullable, `unique (decision_id, ordinal)`). The backfill
of `priority_approvals.priorities` writes one `contextual` row per pain point with `ordinal` = array
position, and §12 checks that the order round-trips.

**Immutability.** `decision_basis` is insert-only, and only within the deciding transaction: the
trigger rejects inserts whose decision was committed in an earlier transaction (compare
`decisions.xmin` with `txid_current()`, or set a `sealed` flag at commit through the deferred trigger).

#### K8. Status events: deterministic ordering and serialised transitions

For each `*_status_events` table (claims, problems, opportunities, initiatives):

```sql
create table builda.claim_status_events (
  org_id uuid not null,
  claim_id uuid not null,
  seq int not null,                                    -- per-entity, gap-free, starts at 1
  from_status text,                                    -- null only when seq = 1
  to_status text not null,
  actor text not null, decision_id uuid, rule_ref text, reason text,
  created_at timestamptz not null default now(),
  primary key (org_id, claim_id, seq),
  foreign key (org_id, claim_id) references builda.claims (org_id, id),
  foreign key (org_id, decision_id) references builda.decisions (org_id, id),
  check ((seq = 1) = (from_status is null)),
  check (num_nonnulls(decision_id, rule_ref) >= 1 or actor like 'system:%')
);
```

- **Ordering** is by `seq`, never by `created_at`. Current status is the row with max `seq`.
- **Serialisation.** Transitions go through one function, `transition_claim(id, expected_from, to,
  …)`. It takes `SELECT … FOR UPDATE` on the entity's identity row, reads the current `(seq,
  status)`, rejects the call if the status ≠ `expected_from` (compare-and-set), validates the pair
  against the allowed-transitions table, and inserts `seq + 1`. Two concurrent conflicting
  transitions can't both succeed: the second waits on the lock, then fails the compare. As a
  backstop, the primary key also rejects a duplicate `seq`.
- A trigger rejects direct inserts that don't continue the sequence or don't match the current
  status, so the function is the only path in practice.

#### K9. Measurement: success measures and adoption criteria

**Success measures.** Pre-registration means declaring what change counts as success, so a
magnitude is required. The column is renamed to make that clear:

```sql
-- replaces the 10.D check
alter table builda.success_measures
  add column level text not null check (level in ('mechanism','outcome')),
  add column minimum_meaningful_change numeric,        -- in the metric's unit; replaces expected_change
  add column change_type text check (change_type in ('absolute','relative')),
  add column baseline_window_days int,
  add column settling_days int,                          -- gap between go-live and measurement start
  add column comparison_group text,                      -- definition, required for measured_with_comparison
  add constraint measure_shape check (
    (method = 'not_measurable'
       and metric_id is null and direction is null and minimum_meaningful_change is null
       and window_days is null and not_measurable_reason is not null
       and length(trim(not_measurable_reason)) >= 20)
    or
    (method <> 'not_measurable'
       and metric_id is not null and direction is not null
       and minimum_meaningful_change is not null and minimum_meaningful_change > 0
       and change_type is not null
       and window_days > 0 and baseline_window_days > 0 and settling_days >= 0
       and not_measurable_reason is null
       and ((method = 'measured_with_comparison') = (comparison_group is not null)))
  );
```

The measurement periods are fully defined: baseline = `[go_live − baseline_window_days, go_live)`,
measurement = `[go_live + settling_days, go_live + settling_days + window_days)`.

**Responsibilities split:** the database checks structure (above). The approval workflow checks the
business decision: a `not_measurable` measure needs a `decisions` row by an approver who is not the
proposer, enforced by trigger on the initiative's transition to go-live (K8 path). Reports list every
not-measurable initiative with its reason and approver.

**Adoption criteria** replace `initiatives.adoption_metric_id`:

```sql
create table builda.adoption_criteria (
  id uuid primary key default gen_random_uuid(), org_id uuid not null,
  initiative_id uuid not null, metric_id uuid not null,
  comparator text not null check (comparator in ('>=','<=')),
  threshold numeric not null,
  population text not null,                    -- what is counted: "documents-awaiting cases in pilot group"
  window_days int not null check (window_days > 0),
  starts_after_days int not null default 0 check (starts_after_days >= 0),
  declared_by_decision uuid not null,
  unique (org_id, id),
  foreign key (org_id, initiative_id) references builda.initiatives (org_id, id),
  foreign key (org_id, metric_id) references builda.metrics (org_id, id),
  foreign key (org_id, declared_by_decision) references builda.decisions (org_id, id)
);
```

Rung 3 ("adopted") of the ladder (10.I) is reached only by an evaluation of these criteria over
their window, recorded as an `initiative_milestones` row whose evidence is the observation set.
Initiatives can't go live without at least one adoption criterion.

#### K10. Network snapshot publication contract

A snapshot is published only if all of these hold. They're checked by a **disclosure audit** that
runs on the actual snapshot data before publication and blocks it on failure:

1. **Immutability.** Published snapshots are insert-only (`REVOKE UPDATE, DELETE`). A correction is a
   new snapshot marked `corrects = <id>` with a reason, and both stay visible.
2. **Cohort secrecy.** Network users see the cohort **size** only, never the member list (they may know
   it from elsewhere; the audit below assumes they do).
3. **k within each cell.** A cell needs ≥5 contributing firms. **When member firms can see benchmarks
   they contributed to, k counts firms other than the viewer,** because a viewer can subtract its own
   contribution. So a cell shown to contributors needs ≥ k + 1 contributors.
4. **Dominance, per metric type.** The dominance check applies to the additive quantity behind the
   published value:

   | Published value | Dominance check |
   |---|---|
   | Count or sum | Largest firm's share of the total ≤ 50% |
   | Rate (x/y) | Largest firm's share of the denominator y ≤ 50%, and of the numerator x ≤ 50% |
   | Volume-weighted mean | Largest firm's share of the weight ≤ 50% |
   | Unweighted median of firm-level values | No dominance rule; needs ≥ k values and is published rounded |
   | Distribution / percentile bands | Only for ≥ 2k firms; band edges rounded |

5. **Complementary suppression.** Within a snapshot, any hidden cell must not be derivable from
   published totals and siblings. The audit solves for each hidden cell given the published ones
   (row and column totals), and suppresses more until none is determinable.
6. **Differencing across all prior publications.** For every new cell and **every** previously
   published cell with the same definition, not just the previous period: if the symmetric
   difference of the two cohorts is non-empty and has fewer than k firms, the new cell is suppressed.
   The difference between two published values reveals the aggregate of exactly those firms.
7. **Assumed adversary knowledge.** The audit assumes the network knows the full membership history,
   which firms joined or left and when, and the exact values of any one colluding member firm. Each
   rule above must hold under that assumption.
8. **Consistency.** Periods are fixed calendar quarters. Definitions are versioned, and a changed
   definition starts a new series, which is never compared or differenced with the old one in the UI.
   That removes a back door for differencing through redefinition.
9. **Rounding.** Counts are published to the nearest 5, and other values to a declared precision. This
   isn't a privacy guarantee on its own, but it removes exact-arithmetic attacks on the residue.

The audit has its own test suite with crafted cohorts covering each rule (§12).

#### K11. Phasing: explore in parallel, gate the data

The §10.J order stands. Phases aren't isolated releases: design and build for a later phase (for
example domain packs) may proceed while an earlier phase's migrations are under test. **The gate is
on data, not on work:** no production tenant data is migrated into, or written by, any new structure
until the Phase 0 acceptance checks (§12) pass in the production environment. Every later phase has
its own acceptance gate before production data moves into it.

---

## 11. Known conflicts with target-architecture.md

For the cross-document review. Everything here is superseded by this document. Listing it saves
rediscovering it. Being listed here isn't evidence that a replacement was built: §12 is the
acceptance checklist that proves it.

| target-architecture.md | Conflict | Superseded by |
|---|---|---|
| §3.1 Q6, §3.3 versions: "closes the previous one (`valid_to`)" while calling versions append-only | Imprecise guarantee | 10.B |
| §3.3 `claims.status` column; `problems.status`, `opportunities.status`, `initiatives.status` columns | Mutable status | 10.B (status event tables + views) |
| §3.3 `problems unique (org_id, key)`; `problem_merges` | Identity by naming; no splits | §2, 10.A, 10.D |
| §3.3 `claims.value jsonb`, `valid_during`; `claim_evidence.relation 'contradicts'` | EAV risk; wrong level for contradiction | §3, W2, W3 |
| §3.3 `change_set_items.supporting_claims uuid[]` | FK in array | R1 → `change_set_item_claims` |
| §3.3 `baselines.observation_ids uuid[]` | FK in array | R1 → `baseline_observations` |
| §3.3 `discoveries.scope_element_ids uuid[]` | FK in array | R1 → `engagement_scope` |
| §3.3 `decisions.subject_type/subject_id` | Polymorphic FK | W7 (typed nullable FKs) |
| §3.3 `opportunity_problems` | Problems only | §1 drivers → `opportunity_drivers` |
| §3.3 all plain `references x(id)` between tenant tables | Cross-tenant references possible | R2 (composite FKs) |
| §3.3 RLS "`org_id = app_org() or app_partner_can_access(...)`" | Pre-contract shape | 10.E (`app_can_read(o, class)` / `app_can_write(o)`) |
| §3.3 `metrics` without kind | Elapsed/effort confusion possible | 10.H |
| §3.3 initiative `status` only | No adoption ladder | 10.I |
| §3.3 table order (`change_sets` referenced before creation) | Non-executable as written | Real migrations order correctly |
| §4.2(4), §4.3 role-level k only | No differencing protection | 10.F |
| §5.2 event pipeline, metrics computed "volume, cycle time, waits" | Doesn't separate effort | 10.H |
| §6 Phase 0 list | Missing composite FKs, definer fixes, security tests, RLS function rewrite | 10.E, 10.J |
| §6 Phase 5 "`priority_approvals` → decisions (backfill)" | `priority_approvals.priorities uuid[]` must expand into `decision_basis`/subject rows, preserving order | R1; order kept as `basis_role = 'contextual'` + ordinal (add `ordinal int` to `decision_basis` for this backfill) |
| Existing `db/005` `knowledge_releases.item_ids uuid[]` | FK in array (global, not tenant) | R1, lower priority: `knowledge_release_items` in Phase 1 |
| Existing `db/005`, `db/006` definer functions | Identity as parameter; superuser-owned | 10.E, Phase 0 |

---

## 12. Migration acceptance checklist

§11 says what is superseded. This section says **how we prove the replacement was built.** Each
guarantee is an automated check that runs in CI against a freshly migrated database, and again
against the production environment before production data moves (K11). A phase's gate is that every
check tagged with that phase or earlier passes. Writing "superseded" in a document proves nothing on
its own.

### Catalogue checks (queries over `pg_catalog`; zero rows = pass)

| ID | Guarantee | Check | Phase |
|---|---|---|---|
| A1 | Every tenant table has RLS enabled **and forced** | Tables in schema `builda` with an `org_id` column where `relrowsecurity` or `relforcerowsecurity` is false | 0 |
| A2 | Every tenant→tenant FK includes `org_id` (R2) | `pg_constraint` FKs from tenant tables to tenant tables whose key columns don't include `org_id` in both sides | 0 |
| A3 | No references in arrays (R1) | Columns of type `uuid[]` in schema `builda`, minus an allowlist that starts empty | 0 (existing tables), each phase (new ones) |
| A4 | Only allowlisted global references | FKs from tenant tables to non-tenant tables whose target isn't in the global allowlist (K6) | 0 |
| A5 | Append-only tables really are | For each table on the append-only list: `has_table_privilege('builda_app', t, 'UPDATE')` or `'DELETE'` is true | 0 |
| A6 | Version tables are content-immutable | `builda_app` holds `UPDATE` on any column of `model_element_versions` / `model_relation_versions` other than the closure/void columns (K4) | 2 |
| A7 | Definer-function hygiene (K3) | `prosecdef` functions where the owner is a superuser, has `rolbypassrls`, can log in, or owns a tenant table; or `proconfig` lacks the pinned `search_path`; or `PUBLIC` has `EXECUTE` | 0 |
| A8 | No writable runtime schemas | Any runtime role with `CREATE` on `builda`, `public` or `builda_security` | 0 |
| A9 | No mutable status columns | Columns named `status` on `claims`, `problems`, `opportunities`, `initiatives` | 3–5 |
| A10 | Every exactly-one reference has its check | For each table on the polymorphism list (K6), a `num_nonnulls(...) = 1` check constraint exists | per phase |
| A11 | Non-overlap constraints exist | GiST exclusion constraints on both version tables, with the void predicate | 2 |

### Security tests (in the style of `db/test_rls.sql`, run as `builda_app`)

| ID | Test | Phase |
|---|---|---|
| S1–S8 | The eight tests in §10.E | 0 |
| S9 | Signed context cannot be forged, altered, replayed after expiry, or bypassed with the legacy settings; user X's token cannot act as user Y in the same org (K2) | 0 |
| S10 | Each definer function returns nothing or `false` with no context, a participant context or a non-staff context (K3) | 0 |
| S11 | The pickup function cannot update or delete anything; the queue function cannot write | 0 |
| S12 | A composite FK rejects a cross-tenant reference for every tenant FK (generated from the A2 catalogue, one insert attempt per FK) | 0, and regenerated per phase |
| S13 | Revoking an `org_relationships` grant removes access in the next transaction, and the next quarterly snapshot excludes the firm | 0 (grant), 6+ (snapshot) |

### Integrity and behaviour tests

| ID | Test | Phase |
|---|---|---|
| I1 | Closure happens at most once, only via a matching accepted change-set item; retire/end/merge close without a successor; empty intervals are rejected; voided versions are excluded from views and from non-overlap (K4) | 2 |
| I2 | Two concurrent conflicting status transitions: exactly one succeeds; `seq` is gap-free (K8) | 3 |
| I3 | Decision-basis closure: a `supporting` row pointing outside the subject's provenance fails at commit; `contextual` is allowed; basis rows can't be added after the deciding transaction (K7) | 5 |
| I4 | Success-measure shape: each invalid combination is rejected; `not_measurable` without a second approver blocks go-live; go-live without adoption criteria is blocked (K9) | 5 |
| I5 | Problem matching: exact single compatible candidate → auto-link; incompatible identity segment → proposal; several candidates → review queue (10.A) | 4 |
| I6 | Identity events: a merge redirects reads, a split preserves old assessments, nothing is deleted (§2) | 4 |
| I7 | Elapsed/effort separation: `calculateImpact` rejects a metric whose `measure_kind` isn't `effort` (10.H) | 6 |
| I8 | Disclosure audit: crafted cohorts trigger each K10 rule (k with self-subtraction, each dominance type, complementary suppression, differencing against non-consecutive periods, redefinition) | 6+ |

### Backfill and regression checks

| ID | Check | Phase |
|---|---|---|
| B1 | **Behaviour preserved:** the existing test suite plus golden playback/report fixtures from today's code produce identical output after each phase | 1–5 |
| B2 | Every `evidence_records` row maps to exactly one evidence span and ≥1 claim; every transcript turn maps to a segment; `turn_index` matches | 3 |
| B3 | Every `corrections` row maps to a superseding `attested` claim or an identity event | 3–4 |
| B4 | Every `pain_points` row maps to exactly one problem; counts reconcile per discovery; firm-lead overrides survive | 4 |
| B5 | `priority_approvals.priorities` order round-trips through `decision_basis.ordinal` | 5 |
| B6 | Each compatibility view is dropped by the end of its phase (W10): its existence after the phase's gate fails the check | 3–4 |
