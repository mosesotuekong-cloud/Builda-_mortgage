# builda+ — decision record

Status: **authoritative** for the decisions listed. Where any other strategy or architecture
document conflicts with this record, this record wins. Earlier documents keep their reasoning, and
banners point here where they've been superseded.

Date: 2026-11-05. Basis: [red-team-review](red-team-review.md) plus the product owner's response.

---

## 1. Decisions

| # | Decision | Status | Replaces |
|---|---|---|---|
| D1 | **A opens, B proves, JADA builds** remains the entry strategy | Keep | — |
| D2 | **External assessments are manual first.** One-page template, warm prospects only, JADA-reviewed. No external-assessment software (P2b) until **15–20 manual assessments have been tested** *and* **one paid implementation** exists | Keep | first-commercial-mvp §3.1–3.2 (assisted software in the MVP); implementation-backlog P2b / week 4 |
| D3 | **The first implementation is Outlook follow-up drafts**: thread-based, draft-only, the case manager sends | Prioritise | solution-engineering-engine §10.3–10.4 (Tier C standalone + approval queue) |
| D4 | **Tier C standalone tool:** dropped | Drop | solution-engineering-engine §10.3 |
| D5 | **One hosted instance per firm as the default:** dropped. A single multi-tenant runtime, separate from builda+, is the working assumption, confirmed before firm 2 | Drop | builda-product-direction §8 decision 5b; solution-engineering-engine §10.5 "Hosting" |
| D6 | **No send permission does not mean no personal data.** The runtime processes mailbox data transiently and needs a data protection assessment, least-privilege permissions, a stated transient-vs-persisted split, explicit mailbox scope, content-free audit logs and a deletion policy | Adopted | red-team-review §3.7 ("holds no client names…"), which described persistence only |
| D7 | **Security before pilot 1:** production authentication; **trusted session identity (K2)**; database functions never trust caller-supplied identity | Required | red-team-review §6.2 proposal to defer K2 (**rejected**) |
| D8 | **Security before firm 2:** organisation-scoped (composite) foreign keys; cross-organisation security tests. Pilot 1 must be genuinely isolated (only one firm organisation in the production database; no demo or seed data there) | Required | design-decisions K11 timing for these two items only |
| D9 | **Measurement:** three metrics, reported separately, plus adoption. (1) time from initial request to documents received; (2) time from a follow-up becoming due to being sent; (3) case-manager time spent chasing. (1) is the outcome; (2) and (3) show whether the solution contributed. Reduced turnaround is **not** the primary financial claim | Adopted | red-team-review §3.8 headline metric; solution-engineering-engine §10.9 |
| D10 | **If the firm's CRM already has a suitable chasing feature,** the recommendation is to fix or configure it, not to sell a replacement | Adopted | — (reinforces fix-first) |
| D11 | **First offer:** Operational Discovery + Document Follow-up Pilot. (1) a discounted, fixed-scope discovery; (2) a validated operational finding; (3) a fixed-price Outlook follow-up implementation; (4) four weeks of measurement; (5) a recurring support and optimisation agreement if the results justify it. **Case-study participation is optional, never a condition; anonymised results by default** | Adopted | red-team-review §7.3 (case-study rights as a condition) |
| D12 | **Four-week measured pilot** | Keep | — |
| D13 | **No further expansion of strategy documents.** Next work is implementation | Adopted | — |
| D14 | **Separation of roles:** builda+ understands the business, discovers opportunities and determines what should change. JADA engineers and implements. The customer validates the problem, retains operational control and measures the outcome | Principle | — |
| D15 | **Enrolled conversations only.** JADA works only on email conversations a case manager explicitly enrols. No continuous mailbox monitoring, no searching for potential cases, no reading unrelated conversations, no bodies, subjects or attachments, no autonomous sending, no client email content stored. Where a restriction is enforced by JADA's code rather than by Microsoft, it's described as such | Adopted (2026-11-06) | Outlook spec revision 1 (15-minute Sent Items polling, Entra-consented permission) |

### Outlook integration decisions (closed 2026-11-06; see [Outlook spec §12](../engineering/outlook-follow-up-drafts-spec.md#12-relationship-to-the-decision-record))

| # | Decision | Outcome |
|---|---|---|
| A1 | Category-based enrolment (Option A) for the first pilot | **Approved, conditional on successful Microsoft Graph testing** ([spike checklist](../engineering/outlook-spike-checklist.md)). If the critical enrolment tests fail, return with options |
| A2 | Microsoft-enforced boundary = named case-manager mailboxes (read/write, no send); "enrolled conversations only" = enforced by JADA's code | **Approved.** The limitation **must be disclosed in the DPIA and in the employee briefing** |
| A3 | A weaker fallback (Entra-consented mail permission + Application Access Policy) if mailbox scoping fails | **Not approved in advance.** If mailbox scoping fails, **stop** and return with alternatives for explicit approval |
| A4 | Daily checks of enrolled conversations | **Approved**, with a fresh reply-status check immediately before any draft is created |
| A5 | No additional case-manager notifications in v0 | **Approved.** Outlook categories and drafts are the interface |
| A6 | Workflow expiry | **Approved:** 30 working days from enrolment, or 10 working days after the final follow-up, **whichever occurs first** |

Rules carried from these decisions:
- **No Microsoft behaviour is treated as verified until it has been tested** in the spike, with
  evidence recorded.
- **The spike gates only the Outlook integration** (2026-11-06): the real Graph transport, the
  concrete Graph calls, the onboarding scripts and firm-tenant connection. The rest of the
  application build proceeds in parallel, including all builda+ work and the runtime's
  Microsoft-independent components against a fake Graph transport
  ([spec §11.1](../engineering/outlook-follow-up-drafts-spec.md#111-what-the-spike-gates-and-what-it-doesnt)).

## 2. Priorities (in order)

**P1. Make the existing product safe for pilot 1**
- Production authentication (OIDC adapter for `FirmLeadAuth` / `JadaAuth`, `src/http/auth.ts`;
  production path in `src/server.ts`; demo sign-in only behind an explicit flag).
- Trusted session identity (design-decisions K2): signed context verified on read by `app_user()`
  and `app_org()`.
- Database function security: `knowledge_candidates`, `jada_queue`, `jada_pick_up` take identity from
  the session, are owned by a non-superuser `NOLOGIN` role, and have a pinned `search_path`.
- Confidence and correction bugs:
  - stale pain points after merges;
  - persisted merges;
  - overridden figures carrying their own source and confidence wording (`src/analysis/service.ts`,
    `src/analysis/opportunities.ts`).
- Publish the first approved knowledge release (approved checks for all regulated stages).

**P2. Build the first implementation**
- The Outlook follow-up drafts runtime: [engineering spec](../engineering/outlook-follow-up-drafts-spec.md).

**P3. Validate commercially**
- One warm UK brokerage.
- Firm-assisted discovery.
- Check whether the CRM already solves document chasing.
- Validate the problem with case managers.
- Agree the baseline and success criteria.
- Agree implementation and measurement.

**P4. Revisit external intelligence**
- Only after the first paid implementation, and 15–20 manual assessments tested.

## 3. Before firm 2

- Composite organisation-scoped FKs and cross-organisation security tests (D8).
- Confirm the runtime hosting model (D5).
- Retention job, email sending, rate limiting (needed before scale, not before pilot 1).
