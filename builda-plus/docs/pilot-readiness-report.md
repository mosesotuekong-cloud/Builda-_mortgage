# builda+ pilot-readiness report (Phase 6)

Date: 6 November 2026. Scope: the whole application after Phases 1–6, on synthetic data only, against a local
throwaway PostgreSQL database. Nothing has been deployed or committed. **This report does not authorise a
live customer deployment.** Production authentication, database security, privacy and retention, approved
knowledge and the Outlook spike must each pass their own gate.

## 1. Verdict

builda+ works end to end as a **demonstration** of: mortgage firm → discovery → evidence → opportunity →
JADA engineering → implementation → measured impact. It is **not ready for a pilot with a real firm**. The
blockers are not missing features. They are four gates that are still open: production sign-in,
database-function identity, retention and deletion, and approved mortgage knowledge.

## 2. Defects found and fixed in Phase 6

| # | Defect | Fix | Regression test |
|---|---|---|---|
| 1 | A JADA engineer could pick up **any** discovery by id, including ones not waiting in the queue, gaining full access to that firm's data | Pick-up now only accepts discoveries in the engineer's queue (app layer); database layer listed as a blocker below | `P6: an engineer can only pick up…` |
| 2 | Engineering routes accepted any JADA role (e.g. a knowledge editor), relying only on assignment | Engineering routes require the `engineer` role (403 otherwise) | `P6: only JADA engineers…` |
| 3 | Starting a second discovery blanked the firm profile (profile is stored per discovery) | A new discovery starts from the firm's latest profile; the lead still confirms it | `P6: a new discovery starts from the latest firm profile…` |
| 4 | Queue said "implementation pack ready" for fix and overhaul submissions | App maps the database wording to "Approved opportunities sent for engineering review" | `P6: the pick-up queue describes…` |
| 5 | The two-week checklist could be recorded for fix/overhaul via the API (UI already hid it) | Server refuses it for non-automate submissions | `P6: the two-week checklist is refused…` |
| 6 | Hand-over snapshot in the append-only corrections table also stored interview quotes (an undeletable copy) | Snapshot no longer includes quotes; they live only in the submission row | `P6: the append-only hand-over record keeps no interview quotes` |
| 7 | Older submissions and unscored opportunities showed blank or "Not ranked" priority with no explanation | Flagged "Needs reassessment" with the reason; no value is invented | `P6: older submissions are flagged for reassessment…` |
| 8 | Some firm endpoints returned 200 with empty data for another firm's discovery (no leak, but inconsistent) | Progress, playback, implementation and engineering now return 404, like the rest | `P6 journey C…`, updated `http.integration` |
| 9 | Older `/firm` and `/firm/discoveries/:id` pages duplicated the workspace in the earlier visual style | Both routes now redirect to the workspace equivalents | updated `http`/`signin` tests |
| 10 | Implementation page still described "implementation packs"; items didn't link anywhere | Lists all engineering submissions with status, next step and a link to the opportunity | browser-verified |
| 11 | Impact page said measurement "isn't available yet", contradicting Phase 5 outcome tracking | Shows each plan's agreed measures, baseline, target, result and outcome status | browser-verified |
| 12 | Outcome form sent unmeasured measures and failed; error showed internal field paths | Only measured results are sent; plain-language validation messages | browser-verified |
| 13 | Outcome could read "met" with no measured baseline and no caveat | Page states the improvement can't be quantified without a baseline | browser-verified |
| 14 | Top bar showed the text "null" while pages loaded; same pattern in the firm's engineering panel | Null children filtered | browser-verified |
| 15 | Keep-human refusal message didn't explain how a supporting improvement is handled | Message explains it must be raised and evidenced as its own finding | covered by keep-human test |

The PDF encoding failure reported earlier was fixed in Phase 3 (`pdftotext -enc UTF-8`) and passes.

## 3. Tests

| Check | Result |
|---|---|
| Type checking (`tsc --noEmit`) — also the build check, since the server runs through `tsx` with no separate build | Pass |
| Front-end syntax check (`node --check` on every `public/*.js`) | Pass |
| Full suite (`vitest run`): unit, integration, database, auth, isolation, engineering, regression | **161 / 161 pass**, 16 files, none skipped |
| SQL row-level-security script (`db/test_rls.sql`) on a fresh throwaway database | Pass (each refusal is the expected error) |
| Browser: journeys A, B and C on the local server, desktop, 375 px mobile and dark mode | Pass, after the fixes above |

Tests changed rather than added: three older tests asserted behaviour that Phase 5/6 deliberately changed
(bulk approval without validation, engineer redirect, empty-200 for other firms). Each was made **stricter**,
not weaker.

## 4. Security review

**Verified:** row-level security on every firm table (application tests and SQL script); firm-lead
membership is checked on every firm route; JADA access is limited to assigned discoveries; audit log,
corrections and engineering events are append-only for the app role; participant tokens are 32 random bytes,
stored only as SHA-256 hashes; sessions are HMAC-signed with timing-safe comparison and expiry; 500 errors hide
internals; audit metadata contains no interview content; `.env` is git-ignored.

**Blockers (not fixed, need approval):**

1. **Production sign-in does not exist.** The only authentication is the demo push-button sign-in, which
   refuses to start in production (tested). Firm-lead and JADA SSO adapters must be built (decision record K2).
2. **Database functions trust a caller-supplied identity.** `jada_queue(p_user)`, `jada_pick_up(p_user, …)` and
   `knowledge_candidates(p_caller, …)` are `security definer` and take the user id as a parameter. Demonstrated
   on a throwaway database: as the app role with no session identity, `jada_pick_up` assigned an engineer to a
   discovery that was not in the queue. The application now blocks this path, but the database does not. Fix
   needs a migration: derive identity from `app_user()` and require queue state inside the function.
   **Not applied; needs your approval.**
3. **Session identity is set by the application** (`set_config`), so the database trusts the app completely
   (design §10.K 3.1). Acceptable only with trusted session identity from real auth (blocker 1).
4. `signin_directory()` is executable by the app role in every environment, though only routed in demo mode.
   Revoke or drop it in production (same migration).
5. Composite tenant foreign keys and cross-org constraint tests are required before a second firm (decision record).

## 5. Privacy, retention and data handling

| Commitment | Status |
|---|---|
| Consent recorded with version per participant | Implemented and audited |
| Names never sent to the AI; findings by role | Implemented |
| Quotes only for roles with ≥3 contributors (or the firm lead) | Implemented in workspace, playback, report and engineering brief |
| Client data guard during interviews | Pattern-based redaction and pause; free-text descriptions of a client are not reliably caught (README) |
| **Deletion after the retention period** | **Not implemented. Pilot blocker.** The consent screen promises deletion when `RETENTION_MONTHS` is set, and production refuses to start without it, so the promise would be made with nothing behind it. A deletion job is needed, and it must handle the append-only tables (audit log, corrections, engineering events), which the app role cannot delete from by design |
| Withdrawal / deletion on request | Not implemented. Pilot blocker (DPIA) |
| Participant email (for invitations) | Stored; no mailer; covered by the retention gap above |
| Audit history without sensitive content | Metadata verified content-free; corrections hold firm-entered reasons and answers to JADA questions |

## 6. Outlook integration status

Verified: no Microsoft Graph client and no Microsoft auth library in builda+ (tested); no `Mail.Send` scope
anywhere in source (tested); the revision 2.1 template keeps category enrolment, no continuous scanning,
separate discovery and processing jobs, Exchange RBAC scoping, no unscoped Entra permission, no send
permission and human sending (tested); spike gate status `not_run`; the workflow refuses to activate live
access or complete a gated implementation until it passes (tested). **The spike itself has not run.**

## 7. Knowledge and template readiness

| Item | Content complete | Reviewed | Technical design validated | Regulatory review | Tests done | Production-approved |
|---|---|---|---|---|---|---|
| Seed playbook 0.1.0-draft (3 cards: document chasing, case status updates, application re-keying) | Partial: 3 cards, **0 regulatory checks, 0 sources** | No | n/a | No | n/a | No |
| Approved knowledge release | **None exists** | — | — | — | — | No (production refuses to start a discovery without one, tested) |
| `document_chasing_v1` template | Yes (process, access, controls, tests, done criteria) | No recorded design review | No | No | Test cases written, not run | No |
| `outlook_follow_up_drafts_r2_1` template | Yes (from spec rev 2.1) | Yes (decision record A1–A6) | No: spike not run | DPIA/A2 disclosure required, not done | Spike checklist not run | No |

No regulatory citations exist in the content, and none have been invented. Missing: reviewed cards for the
stages the pilot will cover, at least one approved regulatory check per regulated stage, and source records.

## 8. Readiness assessment

| Area | Ready | Ready with conditions | Not ready |
|---|---|---|---|
| Production authentication | | | ✗ Demo sign-in only |
| Database security | | RLS verified; app blocks the pick-up path | ✗ Definer functions trust caller identity (migration needed) |
| Organisation isolation | ✓ Verified via API, browser and SQL | | |
| Discovery and evidence quality | | ✓ Works; relies on unreviewed seed knowledge and AI classification with fallback | |
| Approved mortgage knowledge | | | ✗ No approved release, no regulatory checks |
| Privacy and retention | | Consent, minimisation, quote rule ✓ | ✗ Deletion and withdrawal not implemented |
| Opportunity assessment | ✓ Deterministic, gated, explained | Scoring weights need an owner decision (scoring-review.md) | |
| Engineering workflow | ✓ All classifications, approvals, plan, outcome | Older JADA escalations page still in earlier style | |
| Tested solution templates | | | ✗ None tested or production-approved |
| Outlook technical spike | | | ✗ Not run (gates only the Outlook integration) |
| Reporting and impact measurement | ✓ Baseline, targets, results, "not yet measured" | Results depend on JADA entering measured data | |

## 9. Outstanding limitations (non-blocking)

- Participant interview page, the knowledge-base page and the older JADA escalations page still use the
  earlier stylesheet. They work, but they aren't in the new visual language.
- The firm profile is a snapshot per discovery; a firm-level profile table would need a migration.
- There's no way to add a finding by hand; supporting improvements for keep-human work arrive through
  follow-up interviews.
- The assigned reviewer is shown as "You": the database only exposes each engineer's own assignments.
- Templates are maintained in code through code review; there is no in-app editor.

## 10. Recommended first pilot scope (once the gates pass)

One firm (10–30 advisers), directly authorised, one discovery, 6–10 participants across advisers, case managers
and administrators, covering enquiry → documents → application (non-regulated stages first). Measure document
chasing and case progression. Engineering limited to **fix and overhaul** outcomes plus document chasing via the
conventional template only after it is tested; no Outlook connection until the spike passes. Before the firm
is onboarded: real sign-in, the database-function migration, a retention/deletion job and DPIA, an approved
knowledge release covering those stages, and a named JADA reviewer for scoring weights.

## 11. Proposed next step

A recorded demonstration of the full journey on synthetic data, then a go/no-go meeting against the gates in
section 8. Separately, approve (or reject) the database-function migration in section 4, blocker 2.
