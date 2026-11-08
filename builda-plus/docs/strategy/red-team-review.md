# builda+ — commercial and product red-team review

> **Outcome recorded in [decision-record](decision-record.md).** Two recommendations here were
> changed by the product owner:
> - deferring trusted session identity (K2) to firm 2 was **rejected** (D7);
> - case-study rights are **optional**, not a condition of discovery (D11).
>
> §3.7's claim that the runtime "holds no client names" is corrected by D6: content is processed
> transiently even though it isn't persisted.

Status: critical review of strategy revision 2 ("A opens, B proves, JADA builds") and the codebase
at commit `762608a`. **No application code, schema or migration has been changed.** This document
doesn't rewrite the strategy. Where it disagrees with an earlier strategy document, it says so and
lists the proposed change (§9).

Notation:
- **[CODE]** a fact verified in the repository, with the file;
- **[DOC]** what a strategy document currently says;
- **[VIEW]** a judgement or recommendation.

---

## 1. External intelligence (entry A): does it create real commercial value?

### 1.1 What public sources can reliably establish

For a 10–30 adviser UK brokerage:

| Fact | Source | Reliability |
|---|---|---|
| Authorisation type: directly authorised or appointed representative; principal/network; permissions (home finance, insurance distribution); trading names; status | FCA Register | High (regulatory record) |
| Legal entity, age, accounts category (small/micro filing signals size), officers' roles, group structure | Companies House | High, but thin for small companies |
| Services and case mix offered (purchase, remortgage, product transfer, BTL, later life, protection, commercial) | Firm website | Medium: marketing claims what's offered, not volumes |
| Acquisition channels (estate agents, new-build developers, introducers, direct) | Website, partner pages | Medium |
| Client-facing technology: online fact find, document upload, booking, client app/portal; **the portal's branding or subdomain sometimes reveals the CRM vendor** | Website | Medium; when visible, the most operationally useful public signal |
| Team composition by job title (if a team page exists); hiring for case managers or administrators | Website, careers page | Medium; stale pages are common |

### 1.2 What public sources cannot reasonably establish

- **Volumes, processing times, where time is lost, or who carries the admin load.** These are the
  things the business case is built on.
- Whether a CRM feature that's visible is actually used, or configured well.
- The internal division of work between advisers, case managers and administrators.
- Anything about compliance quality, complaints or conduct. **Never infer these**: it's
  defamatory in tone and outside scope.
- Client experience from reviews. Reviews are excluded ([DOC] first-commercial-mvp §3.2). [VIEW]
  Keep them excluded: they can't be attributed to operational causes, and they contain personal
  data.

### 1.3 Where A becomes generic or superficial

[VIEW] This is A's central weakness, and revision 2 underestimates it.

1. **Base-rate problem.** Almost every brokerage chases documents, updates introducers and re-keys
   data. A hypothesis that is true of 90% of firms tells the MD nothing they don't already know. It
   reads as mail-merge.
2. **The proposed success metric rewards this.** [DOC] first-commercial-mvp §1 and
   multi-source-discovery §9.4 track the **hit rate** (confirmed ÷ confirmed + not supported). Generic
   hypotheses will score the best hit rates. [VIEW] Measure **lift over base rate**: how much more
   often a hypothesis is confirmed when its signal is present than across all firms. Until there are
   enough firms to know base rates, hit rate shouldn't be used as evidence that A works.
3. **Fixed sentence templates protect accuracy but guarantee blandness.** [DOC] first-commercial-mvp
   §3.2 bans free LLM prose. That's correct for claims. The value can't come from wording, though: it
   has to come from **specific, SME-written card content** and from rules that only fire on
   *distinctive* signals.
4. **A substitute already exists inside the firm.** Many mortgage CRMs and client portals ship
   document request and reminder features. If the firm's portal is visible publicly, the honest
   hypothesis may be "*you may already own a document-chasing feature; is it configured?*". That's a
   *fix*, which is good for credibility but not a build (see §4.3).

### 1.4 What would make a mortgage firm take the next meeting

[VIEW] Roughly in order of strength:

1. **A warm introduction** (referral, network, peer). No document substitutes for it.
2. **A specific, correct observation about *them*** that shows homework, rather than a list of
   generic pains ("your site offers online document upload through your client portal, so the
   chasing work is probably in completeness checks rather than collection").
3. **A sharp question their team can answer and they can't.** "How many times does a typical case
   get chased, and by whom?" Most MDs don't know, and the brief's own research says so.
4. **A low-risk next step with a guaranteed output:** a 30-minute Snapshot that gives them something
   whether or not they continue.
5. **Proof from a similar firm.** **This doesn't exist yet.** The first pilots must be designed to
   produce it (§8).

The full list of generic pain points matters least of all.

### 1.5 Minimum viable external assessment

One page, four sections, produced **manually** by a JADA researcher in about 30–45 minutes from a
document template. **No software for the first 15–20.**

| Section | Content | Rule |
|---|---|---|
| What we can see | 4–6 verified public facts, each with source and date | Facts only; no adjectives |
| What that usually means | **At most 2** hypotheses, each triggered by a *distinctive* signal (not a universal one), with "why we think this applies to you" | Worded as "firms with X often…"; no figures; classification includes *fix* |
| What we can't see | An explicit list: volumes, time, who does the work, what's already automated | Always present |
| Three questions only your team can answer | Concrete, operational questions + the 30-minute Snapshot offer | The call to action |

[VIEW] This changes revision 2: **P2b (the assisted external-assessment software) should not be
built in the first 30 days.** Run A manually until the evidence in §4.4 exists. The existing code
already provides what A needs later: `generateStructured`, `quoteAppearsIn`, deterministic report
assembly ([CODE] `src/llm/provider.ts`, `src/interview/orchestrator.ts`, `src/report/model.ts`).

---

## 2. Evidence model: source vs confidence

### 2.1 The principle

[VIEW] Yes. **Industry knowledge, public record, firm-provided, employee-reported and
operationally measured are *sources* (provenance). Confidence is a separate, computed assessment**
of a specific statement (a pain point exists; its volume; its effort), from the sources that support
it. The brief already separates them: *Firm said / Playbook / Assumption* are source labels; *Low …
Very high* is a confidence ladder (brief §4 steps 5 and 7). "Assumption" is the exception: it's an
epistemic status, not a source.

### 2.2 Contradictions in the existing implementation

| # | Contradiction | Evidence | Consequence |
|---|---|---|---|
| E1 | **`assumption` is modelled as a source,** while assumptions are *also* recorded per record as `conversion_assumptions` on `firm_said` evidence | [CODE] `EvidenceSource` in `src/domain/schemas.ts:45`; `conversion_assumptions` in `db/001`; `normaliseEvidence` adds the 21-working-day assumption to `firm_said` records | Two ways to express the same thing; "assumption" means different things in different places |
| E2 | **Any `measured_baseline` record makes the whole pain point `very_high`**, regardless of what it measures, of disagreement, or of whether the figure used came from it | [CODE] `src/engine/confidence.ts:24` returns `very_high` before anything else is checked | A measured volume would certify an unmeasured effort estimate as very high. Dormant today (nothing produces `measured_baseline`), but it becomes live the moment case data is imported |
| E3 | **Firm-lead overrides change the figures but not the confidence.** `buildOpportunities` uses `overrides.monthlyVolume` / `minutesPerOccurrence` when present, but passes the participant-based `pp.confidence` unchanged | [CODE] `src/analysis/opportunities.ts` (override selection; `confidence: pp.confidence` at line 70) | The report can show "Medium confidence" next to a number no participant gave. The assumption text says "corrected by the firm lead", but the confidence label describes different evidence |
| E4 | **One confidence label per pain point**, computed from volume and minutes agreement only | [CODE] `assessConfidence` inputs are `monthlyVolume`, `minutesPerOccurrence`, `source`, `participantRef` | "Five people independently describe this problem" and "nobody gave a figure" collapse into the same label. Existence and quantification need separate confidence |
| E5 | **All interview evidence is `firm_said`,** whether from the firm lead or staff | [CODE] `normaliseEvidence` sets `source: 'firm_said'` | Fine as a firm-facing label, but blind-spot analysis depends on role (it uses `role`, which is correct), so source shouldn't be overloaded to carry it |

Contradictions in the strategy documents, written by me in earlier rounds:

| # | Contradiction | Where |
|---|---|---|
| E6 | The "evidence ladder" mixes sources and confidence in one table ("rung 3 … Low → Medium") | [DOC] multi-source-discovery §9.1 |
| E7 | "Very high = case data for volume **and** measured effort" disagrees with the code (E2) and is stricter than the brief ("directly measured operational baseline"). Neither says *which figure* is measured | [DOC] multi-source-discovery §5.2 vs [CODE] confidence.ts |
| E8 | *Public record* is added as a fourth firm-facing label, while the brief's labels are sources. That's consistent with the principle, but it should be described as a source, not as a confidence category | [DOC] multi-source-discovery §5.1 |

### 2.3 Recommendation (small, not a re-architecture)

[VIEW]
1. **Source** stays per evidence item: `industry_knowledge | public_record | firm_provided |
   employee_reported | measured`. The firm-facing labels are derived from it (*Firm said* = the last
   three). **`assumption` moves out of the source list** and becomes a flag on *figures*
   (conversions, template reductions, scenarios), which is how `conversion_assumptions` already
   works.
2. **Confidence is computed per statement, not per pain point:** `existence` (is the problem real
   here?), `volume`, and `effort`. Each uses the brief's ladder over the sources supporting *that*
   statement. The headline confidence on a business case is the **lowest** of the three it depends
   on.
3. **The figure actually used** carries its own source. A firm-lead override makes the figure's
   source `firm_provided (attested)`, and its confidence is reported as such ("figure set by the
   firm lead; staff estimates ranged 10–40").

Only point 3 (fixing E3) is needed before pilot 1, because it affects what the firm reads in the
report. Points 1–2 belong with multi-source ingestion (backlog P4), before any `measured` data can
be produced, which also defuses E2.

---

## 3. First commercial implementation: red-teaming document chasing

The revision-2 design: [DOC] solution-engineering-engine §10. The existing spec: [CODE]
`src/knowledge/templates.ts` (`document_chasing_v1`, `tested: false`, `expectedReductionPct: 0.5`,
"keeps only a case reference").

### 3.1 Tier C usability and manual data entry

- Tier C asks the case manager to enter case reference, client first name, email and checklist into
  a **new tool**. That's about 1–2 minutes per case, plus a daily approval queue in another screen.
  At the brief's illustrative 150 applications a month, that's **2.5–5 hours a month of new
  re-keying**, which partly offsets the saving, and it's exactly the "duplicate entry" problem type
  the product diagnoses elsewhere.
- **Typed email addresses are a breach risk.** Sending one client's outstanding-document list to the
  wrong recipient is a personal data breach. Tier C makes that more likely.
- Adoption risk: one more screen for busy case managers. [VIEW] Tier C as specified is the weakest
  part of revision 2.

### 3.2 Personal data

- [CODE] The spec's "keeps only a case reference" is impossible for a sender. Revision 2 already
  corrected it ([DOC] solution-engineering §10). Tier C still makes JADA's runtime hold client names
  and emails for every active case.
- [VIEW] The better design keeps client data where it already is: the firm's mailbox (§3.7).

### 3.3 Email permissions and mailbox security

- Sending on the firm's behalf (Microsoft Graph `Mail.Send`, application permission) is the
  most dangerous permission in the design. Even scoped to one mailbox, a compromised runtime can
  email any client as the firm.
- Many case managers chase from **personal mailboxes**, not a shared one. Covering them means
  scoping access to several mailboxes, or changing how the firm works first (itself a *fix*).
- Admin consent and mailbox scoping need the firm's Microsoft 365 administrator, **often an outsourced
  IT provider**. This is the most likely cause of delay in the two-week clock's prerequisites.
- Google Workspace domain-wide delegation is broad by design. [VIEW] Support **Microsoft 365 only**
  in v1, and verify with pilot firms that this matches their estate.

### 3.4 Human approval

- Revision 2: staff approve every send in a separate approval queue. That's correct in principle,
  but it creates a second inbox and approval fatigue ("approve all").
- [VIEW] The strongest form of human approval is **the case manager pressing Send in Outlook** on a
  prepared draft. Approval becomes intrinsic to the workflow, can't be bypassed by the runtime, and
  needs no `Mail.Send` permission.

### 3.5 Integration and operational failures

| Failure | Handling needed |
|---|---|
| Consent revoked, certificate expired, mailbox moved | Stop, alert JADA and the firm's named contact, daily health check |
| Client replies in a new thread, or by phone | Drafts keep being prepared. Acceptable *only* because a person reviews every draft before sending |
| Out-of-office / auto-replies | Detected (auto-reply headers) and not treated as a reply |
| Bounces | Pause the case; notify |
| Drafts pile up unsent | That's an **adoption signal**, measured and reported, not an error |
| Duplicate drafts on re-poll | Idempotent per thread and per scheduled step |
| Staff leave / mailbox renamed | Scoping list maintained as part of offboarding; the firm's contact is told |

### 3.6 Can it be delivered in two weeks?

- **Engineering per firm: yes**, if the product is built once and configured per firm.
- **Prerequisites: often no.** Admin consent through an IT provider, network approval of client
  communications for appointed representatives, the DPA, and baseline recording can each take more
  than two weeks. [CODE] Brief §7 and the code's gates already say the clock starts when the
  prerequisites are ready. [VIEW] Sell it as "**two weeks from access**", with a prerequisites
  checklist issued at the proposal, so the promise isn't broken by things JADA doesn't control.

### 3.7 Smallest implementation that can deliver a measurable result

[VIEW] **"Outlook follow-up drafts", a thread-based, drafts-only chaser for Microsoft 365:**

1. The case manager sends the initial document request exactly as today, and **tags it** (an Outlook
   category such as "Chase", or a BCC to a firm-owned tracking address).
2. On the firm's schedule (e.g. business days 3, 7, 10), the runtime **creates a reply draft in the
   same thread** in the case manager's mailbox. It uses firm-approved wording, quotes the original
   request, and asks for anything outstanding.
3. **The case manager reviews, edits (removing items received) and presses Send.** That's the
   approval.
4. If the client has replied in the thread (excluding auto-replies), no draft is created, and the
   thread is flagged for the case manager.
5. After the final step, the case manager gets a "call this client" task or flag.

| Property | Effect |
|---|---|
| Permissions | Read and create drafts in named mailboxes only. **No send permission** |
| Personal data held by JADA | Message and thread ids, timestamps, step state. **No names, addresses or document lists**: the content stays in the firm's mailbox |
| Re-keying | None |
| Human approval | Intrinsic: nothing leaves without a person pressing Send |
| Fits existing behaviour | Yes: initial requests already go by email in most firms (an assumption to validate) |
| Measurable by itself | Threads tagged, drafts created, drafts sent, days from request to last chase or reply, chases per thread. Before/after uses a one-week manual tally |

What it gives up compared with revision 2: no per-item checklist tracking, so the case manager edits
the draft instead. It saves less time per chase than full automation, but it **removes the tracking
and remembering work**, which is often the larger hidden cost. And it's safe enough to deploy quickly.

### 3.8 Do the outcome metrics show meaningful value?

The brief's own illustration: 150 applications × 20 minutes chasing = 50 hours a month; 60%
reduction = 30 hours. [VIEW] At an *illustrative* loaded cost of £25/hour, that's about **£750 a
month of capacity, not cash** (the code already says so: [CODE] `calculateImpact` caveats). Hours
alone are a **thin business case** for a build of any meaningful price.

The value a brokerage MD actually cares about, and that needs measuring:

1. **Elapsed time awaiting documents**, which feeds time to offer and completion, when procuration
   fees are received, and fall-through risk.
2. **Case-manager capacity:** cases handled per case manager without a new hire. Avoiding one hire
   is the real money.
3. **Fewer stalled cases** (the weekly stalled list).

[VIEW] Make **days from document request to all received** (or to last chase) the headline mechanism
metric. The drafts-only runtime measures it directly from thread timestamps. Keep hours recovered as
a secondary, honest figure. **Never present the template's 50% reduction as a forecast**: it stays
an assumption in [CODE] `templates.ts` until measured.

---

## 4. Commercial model: the full journey

### 4.1 Where prospects drop out

| Step | Drop-out risk | Main cause | Mitigation |
|---|---|---|---|
| External assessment → meeting | **High** (cold), medium (warm) | Generic content; unsolicited approach | Warm-first; distinctive signals only; one page |
| Meeting → Firm Snapshot | Medium | MD time; data-handling worry | 30 minutes; show the consent model and confidentiality up front |
| Snapshot → staff discovery | **High** | The MD must spend team time (3–5 × 25 min) and trust the confidentiality promise; busy season | A clear output promise; staff FAQ; reminders; the MD champions it |
| Staff discovery → validated opportunity | Medium | Too few interviews completed; findings too generic; top finding is *fix* | Completion tracking; follow-ups; a fix-sprint offer |
| Validated opportunity → proposal | Medium | No template fit; not on Microsoft 365; CRM already has the feature | Route selection; honest "fix: configure what you own" |
| Proposal → purchase | **High** | Value-to-price on hours alone (§3.8); competing priorities | Elapsed-time and capacity framing; fixed price; low-risk drafts-only design; pilot terms |
| Purchase → measured outcome | Medium | Prerequisite delays; low adoption; no baseline | "Two weeks from access"; baseline tally before go-live; adoption metric |

### 4.2 What makes the firm pay

[VIEW] In order:
1. a problem **in their own staff's words** that they recognise, with a figure they believe;
2. **low risk**: fixed price, quick, reversible, nothing sent without staff pressing Send;
3. relief of a **capacity crunch** (an avoided hire, or handling growth);
4. **proof from a similar firm** (none yet).

Software novelty and "AI" are not reasons to pay. The brief's fix-first principle is a
selling point in this market.

### 4.3 What makes it repeatable

- **One product configured per firm**, not one build per firm (this pushes against §5's
  single-tenant instances).
- A standard prerequisites checklist and a standard measurement plan.
- The same discovery script and knowledge release across firms.
- JADA hours per firm tracked from pilot 1.
- **Case studies with measured outcomes.** Repeatability in sales depends on them more than on any
  feature.

### 4.4 Minimum commercial evidence before investing further in A (software)

[VIEW] Build P2b only when **all** of these hold:
1. **≥ 15–20 manual external assessments** sent to warm prospects, with **0 factual errors**.
2. **≥ 25%** of those lead to a meeting, and **≥ 10%** to a started Firm Snapshot.
3. **B converts:** at least one pilot reaches a **paid** implementation. Otherwise A feeds a funnel
   that doesn't close.
4. **Researcher time per manual assessment is the bottleneck,** i.e. demand exceeds what one person
   can produce manually.
5. At least some hypotheses show **lift over base rate** (§1.3), meaning A says something B didn't
   already assume.

---

## 5. Delivery and operating model

### 5.1 One JADA-hosted instance per firm ([DOC] product direction decision 5b; solution-engineering §10.5)

| Concern | Per-firm instance | One multi-tenant runtime (isolated, separate from builda+) |
|---|---|---|
| Deployment | N deployments; N pipelines or one parameterised pipeline | One |
| Updates and security patching | N times; version drift between firms | Once |
| Monitoring | N health surfaces | One, per-tenant health views |
| Credentials | N certificates and secrets | One multi-tenant Entra app registration with **per-firm admin consent** (the standard Microsoft pattern), one certificate in a vault |
| Mailbox management | Per firm | Per firm (same) |
| Isolation | Strong (separate infrastructure) | Strong if done properly: tenant id on every row, RLS (the same pattern as builda+, [CODE] `db/001`), per-tenant encryption keys |
| Retention and deletion | Delete the instance | Per-tenant deletion job; consent-revocation runbook |
| Cost at 3 firms | Acceptable | Lower |
| Cost at 30 firms | High operational load for a small team | Low |

[VIEW] **Per-firm instances are the wrong default for a repeatable product.** For pilot 1 the
difference is irrelevant (one firm). Decide before firm 2. Recommended: **one multi-tenant runtime,
separate from builda+** (its own database, deployment and keys), with the drafts-only design keeping
the stored data tiny (thread ids and timestamps). Offer single-tenant hosting only as a paid option
if a firm or network requires it. This revises [DOC] product direction decision 5b.

### 5.2 Operational requirements, whichever model is chosen

- **Credentials:** certificate-based app-only authentication, a vault, rotation every 12 months, no
  client secrets in configuration.
- **Mailbox scoping:** each firm's IT applies scoping to the named mailboxes (Exchange role-based
  access for applications). JADA provides the script and a verification test that fails if any other
  mailbox is reachable.
- **Monitoring:** per-firm daily health (token valid, last poll, drafts created and sent), alerting to
  JADA, and a status visible to the firm.
- **Incidents:** processor breach notification to the firm without undue delay (the firm, as
  controller, decides on the 72-hour ICO notification); a runbook.
- **Retention and deletion:** thread state deleted 30 days after the sequence ends; on contract end,
  delete the tenant's data, ask the firm to revoke consent, and confirm in writing.
- **Change management:** template wording changes approved by the firm, versioned, and logged.

---

## 6. Prioritisation

### 6.1 Must be ready before pilot 1 (blocks a safe, credible, measurable pilot)

| # | Item | Why it blocks | Basis |
|---|---|---|---|
| 1 | **Production sign-in** (OIDC adapter for `FirmLeadAuth` / `JadaAuth`; demo sign-in only behind an explicit flag) | [CODE] `server.ts` always builds `DevCookieAuth`, which throws in production; push-button sign-in lets anyone use any account | Safety |
| 2 | **Definer functions:** identity from the session, not a parameter; non-superuser owners; pinned `search_path` | [CODE] `knowledge_candidates(p_caller)`, `jada_queue(p_user)`, `jada_pick_up(p_user, …)` in `db/005`, `db/006`, owned by the migration admin | Safety; small |
| 3 | **Approved knowledge release:** approved checks for the 4 regulated stages, their sources, and 10–15 reviewed cards | [CODE] in production `KnowledgeService.currentVersion()` throws `NoApprovedReleaseError`, and `createDiscovery` calls it, so **no discovery can be created**; `assembleRelease` blocks a release without regulated-stage checks | Hard blocker; brief §9.3 |
| 4 | **Consent configuration:** retention period, JADA contact, escalation response time, someone staffing escalations | [CODE] `assertConsentConfigReady` refuses production without them | Hard blocker |
| 5 | **Privacy framework, discovery DPIA, LLM provider terms and processing location** | Brief §10: "before live deployment" | Safety / legal |
| 6 | **Analysis correctness:** stale pain points after merges; persisted merges | [CODE] `analyse` upserts by key and never retires merged keys; `rescore` scores every row | Credibility (phantom findings in the report) |
| 7 | **E3 fix:** overridden figures carry their own source and confidence wording | [CODE] `opportunities.ts` keeps `pp.confidence` for overridden figures | Credibility |
| 8 | **Single-person-role decision**, implemented minimally (consent wording + playback warning, or quote suppression) | README known limit; strategy decision 2 | Participant trust |
| 9 | **Targeted security review** of auth, RLS context and definer changes, plus the existing RLS test ([CODE] `db/test_rls.sql`) passing in the production database | Safety | Safety |
| 10 | **Pilot agreement:** what the firm gets, measurement access, case-study rights, pricing or discount | Without it, pilot 1 can't produce the commercial evidence | Commercial |

### 6.2 Can be done during pilot 1 (doesn't prevent the first commercial result)

| Item | Deadline within the pilot |
|---|---|
| **Signed session context (K2) and composite tenant FKs** | **Before a second firm's data enters production.** With one tenant, cross-tenant exposure is nil apart from JADA staff, who already have assigned access. [VIEW] This relaxes the earlier "all Phase 0 before any real data" gate to "before tenant 2". **It needs your explicit agreement**, because it changes an approved decision (design-decisions K11) |
| Email sending (`Mailer`) | Links can be copied by the firm lead for one firm ([CODE] `mailer = null` works today) |
| Retention job | Before the first retention period expires (months away), but scheduled now |
| Rate limiting | Before wider use |
| Technology inventory | The profile already captures `systems` ([CODE] `src/firm/profile.ts`). The inventory adds the access method; needed before the proposal |
| Firm Snapshot *view* | Pilot 1 can do the Snapshot through the existing profile + firm-lead interview + playback |
| Engineering estimate → payback in the app | JADA can compute it by hand in the proposal for pilot 1 |
| Success measures + adoption criterion | Written into the proposal for pilot 1; in-app later |
| **Outlook follow-up drafts runtime: build and test** | **Before the proposal is presented** (about 3–4 weeks after pilot start) |
| Baseline tally (one week, case managers) | Before go-live of the build |
| Manual external assessments for 3–5 warm prospects | In parallel; feeds §4.4 evidence |
| `turn_index` persistence | Before the pilot 1 report, ideally |

### 6.3 Must wait (doesn't justify delaying commercial validation)

- **External assessment software (P2b), A→B linking, hit-rate and lift analytics** (until §4.4
  evidence exists).
- Knowledge structure (tasks, reference solutions as knowledge, route selection in code): P3.
- Document upload, case milestone CSV, source-aware confidence (E1, E2, E4 fixes go here): P4.
- Journey as data (firm-specific stages): P5.
- Operating model, claims layer, org-level problems, networks, snapshot privacy: P6 / design-decisions.
- Template checklist tracking, Tier B exports, CRM API adapters, standing approval, SMS.
- Background jobs table (analysis stays synchronous at pilot scale).
- Per-firm hosting option.

---

## 7. Final recommendation

### 7.1 Is the revised strategy commercially credible?

[VIEW] **Credible as productised consulting with proprietary software, with three corrections.** It
isn't yet credible as a software business, and it doesn't need to be for pilot 1.

- **B is strong and mostly built.** The interview, cross-role and evidence pipeline is a real
  differentiator, and the code's controls (quote verification, deterministic scoring, audited
  corrections) back up the credibility claims.
- **A is overstated in revision 2.** It's a sales-personalisation aid with a base-rate problem, not
  yet a product. Run it by hand.
- **The first build's value is under-framed.** Hours recovered alone is thin. Elapsed time and
  capacity carry the case. And the first build design (Tier C with a separate approval queue and send
  permission) is heavier and riskier than it needs to be.

### 7.2 Five biggest remaining risks

1. **Value-to-price of the first build.** Hours recovered at brokerage scale may not justify a
   meaningful price, and the firm's CRM may already offer the feature.
2. **Content and compliance gate.** No approved knowledge release, and therefore [CODE] no
   production discovery, until a compliance reviewer approves checks for all regulated stages.
3. **Staff participation.** The Snapshot → staff interviews step is where small firms stall.
4. **Firm-side prerequisites** (Microsoft 365 admin consent through an IT provider, network
   approvals, DPA) delaying "two weeks from access".
5. **External assessment overreach or genericness** damaging first impressions, made worse if it's
   automated before it's proven.

### 7.3 Smallest credible first commercial offer

**"Operational Discovery + Document Follow-up Pilot"**, offered to a warm-introduced brokerage:

1. **Discovery** (about 3 weeks): Firm Snapshot (existing profile + firm-lead interview), 3–5 staff
   interviews, follow-ups, playback, report. Free or discounted for pilot 1, in exchange for
   measurement access and case-study rights.
2. **If document chasing is validated** (and the CRM doesn't already solve it), a **fixed-price
   build of Outlook follow-up drafts** for the case-manager team, delivered **two weeks from
   access**. A one-week baseline tally comes first.
3. **Four-week measured pilot:** adoption (threads tagged, drafts sent), days from request to last
   chase or reply, chases per case, hours (secondary). Then a short outcome review.
4. **If validated:** a monthly run-and-support fee.
5. **If the top finding is a fix** (for example, configure the CRM's existing reminders), a fixed-price
   fix sprint instead.

### 7.4 Exact engineering work to begin next

Platform engineers (builda+):
1. **OIDC adapter** implementing the existing `FirmLeadAuth` / `JadaAuth` interfaces
   ([CODE] `src/http/auth.ts`); `users` + `memberships` migration; production path in
   `src/server.ts`; `DevCookieAuth` and push-button sign-in only behind an explicit demo flag.
2. **Definer function rewrite migration:** `knowledge_candidates`, `jada_queue`, `jada_pick_up` read
   identity from `app_user()`; owned by a `NOLOGIN` non-superuser role; pinned `search_path`;
   `EXECUTE` revoked from `PUBLIC`.
3. **Analysis correctness:** retire merged-away pain points and skip them in `rescore`; persist
   accepted merges and re-apply them ([CODE] `src/analysis/service.ts`). Fix E3 in
   `src/analysis/opportunities.ts` and the report wording.
4. **Production deployment basics:** environment, secrets, backups, logging; publish the first
   approved knowledge release through the existing release flow.

JADA engineer (separate runtime, not in this repository):

5. **Outlook follow-up drafts v0**:
   - multi-tenant Entra app;
   - read and create drafts only, no send permission;
   - category-tagged threads;
   - schedule in business days;
   - reply and auto-reply detection;
   - kill switch, health checks, audit log;
   - mailbox-scoping verification script;
   - the test groups in [DOC] solution-engineering §10.6, adapted to drafts-only.

Explicitly **not** next: P2b, Tier C, approval-queue UI, K2 and composite FKs (until before tenant 2,
subject to your agreement), multi-source ingestion.

### 7.5 Assumptions to validate with the first pilot firm

| # | Assumption | How we'll know |
|---|---|---|
| 1 | Staff complete 25-minute AI interviews unaided | Completion ≥ 80% |
| 2 | Cross-role discovery surfaces admin work the MD didn't know about | Blind spots in playback that the MD confirms |
| 3 | Document chasing is a top-3, quantifiable problem *at this firm* | Validated finding with ≥ Medium confidence on existence |
| 4 | Initial document requests are sent by email, and chasing happens in Outlook | Interviews + technology inventory |
| 5 | The CRM's own chasing features are absent, unused or inadequate | Inventory + case-manager interview |
| 6 | The firm runs Microsoft 365 and can give admin consent within a week | Prerequisites checklist timing |
| 7 | Case managers chase from mailboxes we can scope (shared or a small named set) | Setup |
| 8 | The firm will record a one-week baseline tally | Tally completed |
| 9 | The MD values elapsed time and capacity more than hours | Proposal conversation; what they ask to see |
| 10 | The price the firm will pay for the build and the run fee | Signed proposal (or a clear "no" with the reason) |
| 11 | JADA effort per discovery ≤ 4 hours | Time log |
| 12 | Appointed-representative constraints (network approval of client wording) are manageable | Setup timing |

### 7.6 Go / no-go

| Decision | Recommendation |
|---|---|
| **Pilot 1, entry B, warm prospect** | **GO**, conditional on all ten items in §6.1 |
| **Outlook follow-up drafts v0** as the first build | **GO**: start now, in parallel with platform work |
| Tier C standalone with approval queue and send permission | **NO-GO** (replaced by drafts-only) |
| **Engineering investment in external-assessment software (P2b)** | **NO-GO** until the §4.4 evidence exists; run A manually |
| Per-firm hosted instances as the default | **NO-GO**; decide multi-tenant vs single-tenant before firm 2 (recommend multi-tenant, separate from builda+) |
| Relaxing K2 and composite FKs to "before tenant 2" | **Your decision.** Recommended, but it changes an approved gate |
| Further architecture work (P3–P6) | **NO-GO** until after pilot results |

---

## 8. What pilot 1 must produce (so the next decision is evidence-based)

1. A measured before/after on document follow-up (or a documented reason it didn't happen).
2. A conversion record at each step of §4.1, with the reasons for any stall.
3. JADA hours per step.
4. The firm's own words on what made it worth paying for, or not.
5. Results of 3–5 manual external assessments to warm prospects (meetings, Snapshots, factual errors).

---

## 9. Proposed changes to earlier strategy documents (not applied)

| Document | Section | Proposed change |
|---|---|---|
| first-commercial-mvp | §3.1–3.2, §4 item 6 | External assessment: manual one-page template; P2b moves to "must wait" until §4.4 evidence exists |
| first-commercial-mvp | §1 measures | Replace "hit rate" as a success signal with lift over base rate; add §8's pilot outputs |
| multi-source-discovery | §5.1, §5.2, §9.1 | Separate source from confidence (§2.3); remove "assumption" from the source list; per-statement confidence; fix the ladder table (E6–E8) |
| solution-engineering-engine | §10.3–10.5 | Replace Tier C plus the approval queue with Outlook follow-up drafts v0 (drafts-only, no send permission, thread-based); Tier C and B become later options |
| solution-engineering-engine | §10.9 | Headline metric: days from document request to all received or last chase; hours secondary |
| builda-product-direction | §8 decision 5b | Multi-tenant runtime separate from builda+ (decide before firm 2) instead of per-firm instances |
| implementation-backlog | §6 | The 30-day plan follows §6.1 / §7.4: P2b removed; template track becomes drafts-only v0; K2 and composite FKs scheduled before tenant 2 (if agreed) |
