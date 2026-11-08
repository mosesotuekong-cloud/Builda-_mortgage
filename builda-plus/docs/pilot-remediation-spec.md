# Pilot remediation specification

Status: **specification only. Nothing here is implemented.** Each item needs approval before work starts,
and every database change is a new numbered migration in `db/` (none written yet).

Three blockers from the Phase 6 readiness report, plus one privacy defect found while preparing the demo
(P-1, section 4). The order matters: R1 (authentication) gives R2 a trustworthy identity to check, and R3
depends on both.

---

## R1. Production authentication and role management

### Existing implementation
- `src/http/auth.ts` defines two pluggable interfaces, `FirmLeadAuth` and `JadaAuth`. The only
  implementation is `DevCookieAuth`: a signed cookie set by a push-button sign-in page with no password.
- `DevCookieAuth` throws if `NODE_ENV=production` (tested), and `src/server.ts` constructs it
  unconditionally, so **the server cannot start in production at all** today. That is fail-safe, not a solution.
- In demo mode, `/dev/login?userId=…&orgId=…` and `/dev/jada-login?userId=…` set a session for any id given.
- Firm-lead authorisation: `org_members` (role `firm_lead`) is checked on every firm route (`lead()` in `app.ts`).
- JADA roles live in `jada_staff_roles` (`engineer`, `knowledge_editor`, `compliance_reviewer`). The app role
  cannot write them; today they are granted by `scripts/setup-demo.ts` run as a database administrator.
- Participants don't sign in. They use a single-use invitation link (32 random bytes, stored as a SHA-256 hash,
  30-day expiry) that sets a signed 14-day participant session. This stays as it is.

### Vulnerability or missing capability
1. No real identity provider for firm leads or JADA staff, and no passwords, MFA or account recovery.
2. Sessions are stateless signed cookies: they can't be revoked before expiry (8 hours for staff and firm
   leads, 14 days for participants), and signing out only clears the browser cookie.
3. No managed way to add or remove a firm lead or a JADA role. There's no audit of role grants, and leavers
   aren't removed.
4. The schema allows several firm leads per firm, but there's no way to add one or hand over (Organisation
   settings says so).
5. CSRF: session cookies are `HttpOnly; SameSite=Lax` and every state change is a JSON POST, but there is no
   explicit origin check.

### Minimum acceptable solution
- **OIDC sign-in** for both audiences, behind the existing interfaces (no route changes):
  - **JADA staff:** JADA's own identity provider (for example the JADA Microsoft Entra tenant), with MFA
    enforced by the provider. `JadaAuth` resolves the provider subject to a `app_users` row.
  - **Firm leads:** Builda's identity provider if it exists. Otherwise an OIDC provider chosen by JADA, with
    MFA required. Accounts are created **by invitation only** (a JADA administrator invites a firm lead's
    email); no self-registration.
- **Server-side sessions:** an opaque random session id in an `HttpOnly; Secure; SameSite=Lax` cookie,
  with the session row in the database (user, kind, created, last seen, expires, revoked). Idle timeout
  30 minutes, absolute 12 hours. Signing out revokes the row.
- **Role administration:** a minimal admin command (CLI first, page later), run by a named JADA
  administrator. It grants or revokes `firm_lead` membership and JADA roles. Every grant and revoke is
  written to `audit_log` with who, what, when and why. Revoking a role also revokes that user's sessions.
- **Production guard:** the push-button sign-in, `/dev/*` routes and `signin_directory()` are absent in
  production. Routes are already gated; the function goes in R2.
- **Origin check:** reject state-changing requests whose `Origin` doesn't match `APP_BASE_URL`.

### Database changes
- `user_identities (provider, subject, user_id, created_at)`, unique `(provider, subject)`.
- `sessions (id_hash, user_id, kind, created_at, last_seen_at, expires_at, revoked_at)`; the app stores
  only a hash of the session id.
- `role_grants` audit trail (or `audit_log` rows with `entity_type = 'role'`). The app role gets
  insert-only access through a definer function that checks the caller is a JADA administrator (new
  `jada_admin` role value).
- No change needed for several firm leads: `org_members` already has primary key `(org_id, user_id)`.

### API and UI changes
- `GET /auth/login?audience=firm|jada`, `GET /auth/callback`, `POST /auth/logout`. Production uses these
  instead of `/signin`.
- `FirmLeadAuth` and `JadaAuth` implementations reading the server-side session; `server.ts` picks the
  implementation by environment.
- Account page: show the signed-in identity and active sessions, with "sign out everywhere".
- Landing-page "Sign in" link points at `/auth/login` in production.

### Tests needed
- Production start-up fails without OIDC configuration; succeeds with it; `/signin`, `/dev/login` and
  `/api/signin*` return 404 in production.
- Callback with an unknown subject is refused (no auto-provisioning); a subject with no `org_members` row
  can't reach firm routes (403).
- Revoked, expired and idle sessions are refused; logout revokes the session server-side.
- Revoking an engineer's role ends their access to `/api/jada/engineering` immediately.
- Cross-origin POST is refused.
- Role grants and revokes appear in the audit log.
- All existing isolation and engineering tests pass with the real adapters (test identity provider).

### Security and privacy implications
- Identity becomes trustworthy, which is the precondition for R2's database checks.
- Personal data is minimal: provider subject, display name and email for firm leads. Email is retained
  while the account is active, then deleted under R3's account rules.
- The identity provider becomes a dependency: document the provider outage procedure (no break-glass
  accounts in the app).

---

## R2. Database-level authorisation for engineering assignment and discovery access

### Existing implementation
- Row-level security on every firm table. Policies allow `org_id = app_org()` or
  `app_jada_assigned(discovery_id)`. `app_org()` and `app_user()` read `app.current_org_id` and
  `app.current_user_id`, which the application sets per transaction (`withFirmContext`, `withJadaContext`).
- Append-only tables (`audit_log`, `corrections`, `pack_reviews`, `reports`, `priority_approvals`): the
  app role has no update or delete. Verified by tests and `db/test_rls.sql`.
- `security definer` functions that bypass RLS: `jada_queue(p_user)`, `jada_pick_up(p_user, p_discovery)`,
  `knowledge_candidates(p_caller, p_known_keys)`, `signin_directory()`, `app_jada_assigned(d)`, `app_user()`.
- Phase 6 app-level mitigations: pick-up only accepts discoveries in the caller's queue; engineering routes
  require the `engineer` role.

### Vulnerability or missing capability
1. **Caller-supplied identity in definer functions.** `jada_queue`, `jada_pick_up` and
   `knowledge_candidates` take the user id as a parameter and trust it. Demonstrated on a throwaway
   database: as the app role, with no session identity set, `jada_pick_up(<any engineer>, <any discovery>)`
   assigned the engineer to a discovery that was not in the queue. That assignment grants full RLS
   access to that firm's discovery.
2. `jada_pick_up` checks only that the user is an engineer and the discovery exists, not that it is waiting
   (priorities approved, or an open escalation).
3. `signin_directory()` (all firms, users and roles) is executable by the app role in every environment.
4. Session identity is set by the application with `set_config`. The database trusts any value the app
   sets, so a SQL injection or app bug could set another firm's id. RLS alone can't prevent that.
5. Cross-tenant references aren't constrained: for example `implementation_packs.pain_point_id` references
   `pain_points(id)` without requiring the same `org_id`. This was flagged in the design decisions as
   "composite tenant FKs".
6. Assignments are never removed. An engineer keeps access to a discovery after the work ends.

### Minimum acceptable solution
- **Identity from the session, never from a parameter:** redefine the three functions with no user
  parameter; they use `app_user()`. Each function also refuses when `app_user()` is null.
- **`jada_pick_up(p_discovery)`** requires all of: the caller has the `engineer` role; the discovery is
  waiting (status `priorities_approved`, or an open escalation); it is not already assigned. It writes the
  audit row itself (it already does).
- **Session binding (with R1):** the session id is set as `app.session_id`, and the definer function
  `app_user()` resolves the user from the `sessions` table (not revoked, not expired), instead of trusting
  `app.current_user_id`. `app_org()` likewise derives the organisation from the session's membership.
  The application can then no longer simply assert an identity: it must hold a valid session id.
- **Remove `signin_directory()`** from production: move it to a demo-only migration that production never
  applies, or revoke execute in a production-only migration.
- **Composite tenant keys:** add `unique (id, org_id)` on parent tables and composite foreign keys
  `(pain_point_id, org_id)`, `(discovery_id, org_id)` and so on, on every child table, so a row can only
  point at the same firm's rows.
- **Assignment end:** `jada_release(p_discovery)` (the engineer themselves, or a JADA administrator), and
  automatic release when every submission for the discovery is completed, rejected or deferred and 30 days
  have passed. Audited.

### Database changes
One migration (`007_function_identity.sql`): drop and recreate the three functions with new signatures;
add `jada_release`; revoke `signin_directory` in production; add `sessions`-based `app_user()` and
`app_org()` (depends on R1's `sessions` table); add composite unique keys and foreign keys (validate on
existing data first, with a report of any rows that fail).

### API and UI changes
- `JadaService.queue`, `pickUp` and `KnowledgeService.candidates` call the new signatures inside
  `withJadaContext` (identity comes from the session context).
- The Phase 6 app-level queue check stays as defence in depth.
- Engineering queue: a "Release" control on discoveries with nothing open.

### Tests needed
SQL tests (extend `db/test_rls.sql`, run in CI against a fresh database):
- With no session set, every definer function returns nothing or refuses.
- `jada_pick_up` refuses a non-engineer, a discovery that isn't waiting, and an already-assigned discovery.
- `app.current_user_id` set directly (without a valid session) grants nothing.
- A child row referencing another firm's parent row fails with a foreign-key error.
- `signin_directory()` isn't executable by the app role in production.

Integration tests:
- Release removes access immediately.
- The pick-up and isolation tests from Phase 6 still pass.

### Security and privacy implications
- Closes the demonstrated privilege path at the layer that actually enforces isolation.
- Composite keys may surface existing bad rows; the migration must report them, not silently fix them.
- Session-derived identity makes every database call depend on a live session. Background jobs (R3)
  need their own dedicated role, not a borrowed user session.

---

## R3. Retention, deletion and consent withdrawal

### Existing implementation
- **Consent:** versioned (`consent-2026-11-v1`), recorded per participant (`consented_at`,
  `consent_version`) and audited.
- **The consent text promises deletion:** “Your interview is kept for N months after the discovery
  finishes and then deleted.” `RETENTION_MONTHS` must be set in production (start-up refuses otherwise).
  **No code deletes anything.**
- **Where participant content lives** (all keyed by `discovery_id`):

| Table | Participant content |
|---|---|
| `participants` | Display name, email, pseudonym, role |
| `invitations` | Token hash, used and expiry dates |
| `interview_sessions.state` | Interview state and redacted transcript |
| `evidence_records` | Task descriptions, causes, improvements, `supporting_quote`, linked by pseudonym |
| `analysis_runs.findings`, `pain_points.evidence_summary` | Consolidated findings, including quotes by role |
| `follow_ups` | Questions addressed to a participant |
| `escalations.details_redacted` | Redacted detail of what was raised |
| `reports.model` | Report snapshots, including permitted quotes (immutable) |
| `implementation_packs.content` | Submission `voices` (quotes) and the pack's `currentProcess.quotes` |
| `corrections` | Firm-entered values and reasons; hand-over snapshots from before Phase 6 may contain quotes |
| `pack_reviews` | Firm answers to JADA questions (firm content, not participant content) |
| `audit_log`, `ai_usage` | Metadata only, verified content-free |

- `audit_log`, `corrections`, `pack_reviews` and `reports` are append-only for the app role, by design.
  **The app role cannot delete them.**
- `discoveries` has no "finished" date to count retention from.

### Vulnerability or missing capability
1. A deletion promise with nothing behind it. This is a consent and data-protection problem (UK GDPR
   storage limitation and transparency).
2. Participants have no way to withdraw, and no way to ask for their contribution to be removed.
3. Copies of quotes sit in immutable snapshots (reports, packs and older corrections) that a simple
   delete wouldn't reach.
4. No record of what was deleted, when, and why (needed as evidence for the DPIA).

### Minimum acceptable solution
**Retention clock:** add `discoveries.closed_at`. It is set when the firm lead closes the discovery (new
explicit action), or automatically 90 days after the last engineering or report activity. Retention ends
at `closed_at + RETENTION_MONTHS`.

**What is deleted at the end of retention** (participant-attributable content):
- Participant names and emails replaced by the pseudonym.
- Invitations deleted.
- Interview session `state` replaced with `{}`.
- `evidence_records`: `supporting_quote`, `task_description`, `reported_cause` and `potential_improvement`
  replaced with a fixed marker.
- Quotes removed from `analysis_runs.findings`, `pain_points.evidence_summary`, `reports.model`,
  `implementation_packs.content` and any `corrections.new_value` containing a `voices` or `quotes` key.
- `follow_ups.question` and `escalations.details_redacted` cleared.

**What is kept,** stated in a new consent version: de-identified findings by role (titles, counts,
figures, classifications), engineering decisions and the firm's own entries, and audit metadata. The firm
keeps its record of what was found and decided; no one's words remain.

**Withdrawal** (participant, via their own link, or a request handled by JADA):
- *Before analysis:* delete that participant's session and evidence; mark `participants.withdrawn_at`.
- *After analysis:* the same, plus rerun analysis without their evidence, and apply the same quote removal
  to snapshots for their pseudonym. Findings that drop below the evidence gates update accordingly.
- *After a report is issued:* the report is redacted in place; its version history records
  "redacted under withdrawal" (no content).

**Mechanics:**
- A dedicated database role `builda_retention`, used only by the retention job (not the web app). It works
  through definer functions `purge_discovery_content(discovery_id)` and
  `withdraw_participant(participant_id)`, each with an explicit list of the columns it may change.
- Every run writes a content-free row to a new `retention_events` table: what, when, counts, reason.
- The job runs daily. It refuses to run if `RETENTION_MONTHS` isn't set.

**Consent text:** a new version (`consent-…-v2`) says exactly what is deleted and what de-identified
information is kept, and how to withdraw. Existing participants keep v1 terms, which promise more (full
deletion), so v1 discoveries get the stricter treatment: findings are also cleared of free text.

### Database changes
- `discoveries.closed_at`, `participants.withdrawn_at`.
- `retention_events (id, org_id, discovery_id, kind, counts jsonb, created_at)`, insert-only.
- Role `builda_retention` with execute on the two purge functions only.
- The two definer functions, with explicit column lists and with immutability triggers bypassed only
  inside them.

### API and UI changes
- **Firm lead:** a "Close discovery" action (with the retention date shown), and a discovery-settings
  panel showing the retention end date and any withdrawals (counts only).
- **Participant link:** a "Withdraw my interview" page with confirmation, then a confirmation screen.
- **JADA:** a withdrawal request form for requests made by email or phone (records who asked and when;
  no reason stored).
- **Retention job:** a CLI or scheduled worker (`scripts/retention.ts`) running as `builda_retention`.

### Tests needed
- After the retention date, no table in the content table above contains a participant name, email or
  quote. Checked by a test that scans every text and jsonb column for seeded marker strings.
- Withdrawal before and after analysis removes that participant's evidence and quotes everywhere,
  including reports and packs, and leaves other participants' content intact.
- After withdrawal, confidence and gates recompute (for example a finding drops to `single_account`).
- The app role still cannot delete or update append-only tables; only the purge functions can change
  the listed columns.
- `retention_events` records each run with counts and no content.
- Production refuses to start without `RETENTION_MONTHS`, and the job refuses to run without it.
- A v1-consented discovery gets the stricter purge.

### Security and privacy implications
- Makes the consent promise true and gives evidence for the DPIA.
- Redacting immutable snapshots is a deliberate, narrow exception to append-only design. It is limited
  to listed columns, done by a separate role, and logged.
- Withdrawal can change findings the firm has already acted on. Engineering submissions keep their
  decisions, and the brief shows "evidence withdrawn after submission".
- The DPIA must name JADA and the firm's roles (controller and processor), the retention period, and the
  withdrawal route. That is legal work outside this spec.

---

## 4. Additional defect found during demo preparation

### P-1. Non-participant records count towards the quote-privacy threshold
- **Existing:** quotes are shown only for roles with at least 3 contributors
  (`QUOTE_MIN_GROUP`, `src/analysis/service.ts`). Contributors are counted from every evidence item's
  participant reference, **including record evidence** (`operational_record`, `measured_baseline`) that
  carries a role.
- **Effect:** a role with 2 people plus 1 record attributed to that role reaches 3 "contributors", and the
  2 people's quotes are shown. Seen in the first demo seed (administrators). **Latent today:** no
  production path creates record evidence yet. It becomes live as soon as records are imported.
- **Minimum fix:** count only `firm_said` evidence from distinct participants toward the threshold, in
  both places it is computed (playback and workspace).
- **Database changes:** none.
- **Tests:** 2 participants plus 1 record in one role → quotes withheld; 3 participants → shown.
- **Interim:** the demo seed attributes its record to the firm lead, who is always quotable.

## 5. Order of work and rough size

| Order | Item | Depends on | Rough size (one engineer, not validated) |
|---|---|---|---|
| 1 | P-1 quote threshold | — | under a day |
| 2 | R1 authentication and roles | Identity-provider decision | 1½–2 weeks |
| 3 | R2 database authorisation | R1 sessions | 1 week |
| 4 | R3 retention and withdrawal | R1, R2, DPIA wording | 1½–2 weeks |

Estimates are planning guesses for sequencing, not commitments.
