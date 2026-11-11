# builda+ — consolidated product direction

> **Decisions since revision 2 are in [decision-record](decision-record.md)**, including manual
> external assessments (D2), Outlook follow-up drafts (D3), no per-firm instances (D5), the
> security timing (D7–D8), measurement (D9) and the first offer (D11).

Status: strategy proposal, **revision 2** (dual-entry discovery, a template-led commercial path,
and a revised MVP). No code, schema or migration has been changed.
Inputs: the original brief (`Builda - Mortgage.docx`), `docs/architecture/target-architecture.md`,
`docs/architecture/design-decisions.md`, and a full read of the codebase at commit `762608a`.

Companion documents in this folder:
[mortgage-business-intelligence](mortgage-business-intelligence.md) ·
[multi-source-discovery](multi-source-discovery.md) ·
[operational-intelligence-engine](operational-intelligence-engine.md) ·
[solution-engineering-engine](solution-engineering-engine.md) ·
[first-commercial-mvp](first-commercial-mvp.md) ·
[implementation-backlog](implementation-backlog.md)

---

## 1. North star

> builda+ helps mortgage firms understand how work actually happens, discover where operational
> value is being lost, determine what needs to change, and gives them a practical route to changing it.

We are not building an AI assistant for mortgage firms. We are building an operational intelligence
and transformation platform, and its first job is to produce **implementation work that JADA
delivers**.

---

## 2. What builda+ is today (verified against the code)

The codebase implements almost every item in the brief's MVP list (§15) as working software. It is
**not production-ready**, and the **knowledge content it depends on is almost entirely missing**.

| Brief MVP item | State in code | Evidence |
|---|---|---|
| Firm accounts and organisation management | **Partial.** Organisations and one `firm_lead` role exist; sign-in is push-button demo only. `server.ts` always builds `DevCookieAuth`, which throws in production, so there's no production start path. | `src/http/auth.ts`, `src/server.ts` |
| Participant invitations | **Partial.** Hashed, expiring invitation links and a UI to invite people. No email is sent (`mailer = null`); the firm lead copies links by hand. | `src/firm/service.ts`, `public/firm-home.js` |
| Firm profile questionnaire | **Done** (API and UI). All the brief §4 step 2 fields, plus an optional loaded hourly cost. | `src/firm/profile.ts` |
| Role-based interview agent | **Done.** A code-driven state machine. The LLM interprets answers and words questions; code chooses the topic. Roles are set at invitation; stages are confirmed in the interview. | `src/interview/orchestrator.ts` |
| Pause and resume | **Done** | `interview/service.ts` |
| Consent and onboarding | **Done.** Versioned consent text; retention period and JADA contact required in production. | `src/participant/consent.ts` |
| Mortgage knowledge base | **Tooling done, content missing.** Cards, checks and sources have four-eyes review and immutable releases. Content: **3 draft cards** (brief target 30–50), owner "UNASSIGNED", **0 regulatory checks, 0 sources**. | `src/knowledge/*`, `db/005` |
| Trusted source library | **Tooling only, empty** | as above |
| Structured evidence extraction | **Done**, with verbatim-quote verification and code-side unit conversion. `turnIndex` is computed but not persisted. | `orchestrator.ts`, `db/001` |
| Cross-role comparison | **Done.** Medians per participant, disagreements by role, blind spots, unreported stages, missing measurements. | `src/analysis/consolidate.ts` |
| Follow-up questioning | **Done.** Code-written questions, sent as follow-up sessions. | `planFollowUps`, `sendFollowUps` |
| Evidence confidence | **Done** for the brief's ladder. `operational_record` and `measured_baseline` exist in the enum but **nothing can produce them**. | `src/engine/confidence.ts` |
| Four classifications | **Done.** The AI proposes; the proposal must cite verified quotes or it falls back to the playbook or the firm lead. The firm lead's choice always wins. | `src/analysis/classify.ts` |
| Deterministic scoring | **Done.** Six dimensions, versioned weights, rank explanations. Weights are code constants; the stored config version is ignored on rescore. | `src/engine/scoring.ts` |
| Financial business cases | **Partial.** Hours spent and recovered, and capacity value (with a firm-supplied cost). **Payback is never computed**, because implementation cost is always passed as `null`. `peopleInvolved` is captured but unused. Cash savings and revenue impact aren't modelled (correctly not invented). | `src/engine/impact.ts`, `src/analysis/opportunities.ts` |
| Firm playback and correction | **Done**, with an audit trail (append-only `corrections`). | `public/firm.js`, `analysis/service.ts#correct` |
| Two-week feasibility validation | **Done** as deterministic gates. **No template is tested** (`document_chasing_v1.tested = false`), so every recommendation is currently "blocked". | `src/engine/feasibility.ts`, `src/knowledge/templates.ts` |
| Firm discovery report | **Done.** Immutable snapshots plus PDF, with no AI in assembly. | `src/report/*` |
| JADA implementation pack | **Done.** Template plus evidence, assembled deterministically; Markdown export. | `src/implementation/pack.ts` |
| JADA review interface | **Done.** Queue, pick-up, review checks, escalations. | `public/jada.js`, `implementation/service.ts` |
| UK regulatory checks | **Tooling done, content missing** (no approved checks, so releases can't publish: `assembleRelease` blocks them). | `src/knowledge/model.ts` |
| Audit logging and data isolation | **Done**, with RLS and an append-only audit log. Known gaps are listed in design-decisions §10.E/K: definer functions trust identity parameters and run as superuser, and FKs aren't tenant-scoped. | `db/*`, `src/db/pool.ts` |
| Human escalation (brief §11) | **Mostly done.** Client data, complaints, employment, advice and out-of-scope all escalate. **`insufficient_evidence` is defined but never triggered.** Client-data detection runs on submit, not "as participants type". | `src/guards/*` |
| Retention and deletion | **Not implemented.** The consent text promises deletion after N months, but no job deletes anything. | `consent.ts` |
| Historical performance record | **Baseline only** (report snapshots). No outcome data. Correctly out of MVP scope. | `db/004` |

**Summary:** builda+ today is a working, well-controlled **interview-based discovery pipeline**, from
invitation to implementation pack. Its gaps before a paid pilot are production identity, email,
retention, a handful of security fixes, and, above all, **reviewed mortgage knowledge content and
one tested JADA template.** These gaps are operational and content gaps. They are not
architectural.

---

## 3. Original principles that must remain unchanged

These come from the brief and are kept word for word in intent. The evolved direction is checked
against each.

1. **Autonomous, role-based discovery.** No facilitator; independent interviews; questions limited
   to processes the participant understands.
2. **Cross-role operational intelligence.** Disagreements are preserved and never treated as errors
   or misconduct; blind spots are surfaced.
3. **Fix the work before automating it.** Exactly one of `overhaul | fix | automate | keep_human`
   per problem. AI is never recommended because it's possible.
4. **Evidence before recommendations.** *Firm said / Playbook / Assumption*, a confidence level on
   every recommendation, and no invented measurements.
5. **Human accountability.** No advice, no suitability or lending decisions; regulated judgement
   stays with qualified people. JADA engineering review is a human gate.
6. **Controlled AI.** The LLM interprets and words. Code calculates, scores, checks eligibility and
   enforces rules.
7. **Trust and confidentiality.** Participant names never reach the AI, findings are reported by
   role, and the product is never a performance-evaluation tool. Client files and client data are
   never processed.
8. **Discovery is the entry point; implementation is the commercial opportunity.** The two-week
   model is the primary offering, subject to engineering feasibility.
9. **Mortgage-exclusive.** The MVP must not try to serve other industries.

---

## 4. The evolved direction, assessed

### 4.1 What changes

| Evolved idea | Assessment | Recommendation |
|---|---|---|
| **Multiple discovery inputs** (interviews, documents, spreadsheets, tech inventories, process maps, approved knowledge, public information) | Right in principle. Each source has a very different value and cost. Interviews remain the only source that reveals **actual work and hidden admin effort**, which is the brief's core insight. | Adopt in order of value per unit of effort: technology inventory → case milestone data → SOPs/process maps → public information. See [multi-source-discovery](multi-source-discovery.md). |
| **Six provenance categories** (industry, public, firm-provided, employee-reported, measured, AI hypothesis) | Right. It refines the brief's three labels without replacing them. | Keep the brief's three labels as the firm-facing vocabulary, add **Public record** as a fourth, and keep the six categories as sub-labels. See [multi-source-discovery §5](multi-source-discovery.md#5-source-attribution-and-confidence). |
| **Five capabilities** (Mortgage BI, Multi-source Discovery, Operational Intelligence, Solution Engineering, Implementation & Outcome) | A useful product map. **Risky as an engineering plan** if read as five engines to build. Four of the five already exist as modules. | Treat them as *product capabilities over the existing modular monolith*, not as new services or rewrites. |
| **Assessment without firm participation** (revision 2: an external intelligence pathway) | Valuable as a **door-opener** and for repeatability. It can't verify anything about internal operations, and the brief's own research says even the firm lead's view is incomplete. | **Dual entry** (§4.5): an **External Opportunity Assessment** from public information and approved knowledge, reviewed by JADA and presented as hypotheses, never findings. Then a **Firm Snapshot** and interviews to verify. See [first-commercial-mvp](first-commercial-mvp.md). |
| **Solution engineering: architecture and technology recommendations** | A generic, LLM-written "AI architecture" is exactly the deliverable the brief warns against. | Make solutions **template-driven**: a JADA-owned reference solution plus firm-specific evidence, assembled by code. Unmatched opportunities get a *solution brief* for an engineer. LLM-authored bespoke architectures are out of scope. See [solution-engineering-engine](solution-engineering-engine.md). |
| **Outcome measurement** | The brief excludes it from the MVP (§12.3). The code captures a baseline. | Keep it out of the MVP, but pre-register success measures at approval (cheap, and it protects credibility). |

### 4.2 Where the brief and the evolved direction differ

Each difference is stated, with a recommendation. Nothing from the brief is silently removed.

| # | Brief says | Evolved direction says | Recommendation |
|---|---|---|---|
| D1 | Evidence labels: *Firm said / Playbook / Assumption* | Six provenance categories | **Keep the three labels and add *Public record*.** Firm-facing labels stay simple; sub-labels carry the detail. |
| D2 | Confidence: Low = one estimate … High = accounts **plus operational records** … Very high = measured baseline | Documents and spreadsheets become sources | **SOPs and process maps are not "operational records".** They describe *intended* process. They can corroborate *structure* (who does what) but never volume or time. Only case-level data counts toward High or Very high. |
| D3 | "Direct integration with mortgage firm systems" is excluded from the MVP | "Operational spreadsheets and structured business information" | **No integrations. A firm-supplied CSV in a fixed template is in scope after the MVP** (it's an upload, not an integration). |
| D4 | Step 7: every opportunity needs supporting **participant** responses | An initial assessment without employee participation | **Firm-lead responses are participant responses.** A snapshot-only finding is valid but rated *Low* and labelled as one perspective. Industry-only items are never findings (§4.3). |
| D5 | "Automatic implementation generation" is excluded | "Generate a detailed engineering pack … what architecture and technology are suitable" | **The pack stays deterministic and template-driven** (as built). The engineer authors anything bespoke. No generated code or architectures. |
| D6 | Historical performance record is a future capability | Before-and-after comparisons in capability E | **Future, as the brief says**, except declaring success measures at approval, which is MVP-cheap. |
| D7 | Public information isn't mentioned; the workflow starts with the firm lead creating a discovery (§4 step 1) | Public information is a discovery input, and discovery shouldn't depend on firm participation | **Adopt as a separate entry point**, the External Opportunity Assessment. Public signals are **context**: they generate *hypotheses* but never create, support or rank a firm finding. MVP collection is **assisted** (a JADA researcher supplies sources; builda+ extracts and verifies); automated collection comes in Release 2. The brief's step 1 still starts every *verified* discovery. |
| D8 | Firms may rename, merge or add stages (§5.1) | Ontology adaptable per firm | **Not implemented today** (stages are code constants and Postgres enums). It needs "journey as data" with a firm-specific variant. Required, but after the first pilots. |

### 4.3 The single most important rule of the evolved direction

> **An industry-level opportunity is never presented as a verified problem inside a firm.**

The existing code already enforces this, and the rule must be kept. `assessConfidence` returns
`insufficient` when no participant has given an account (playbook or assumption only), and
`rankOpportunities` excludes `insufficient` items from ranking. The evolved product extends this rule
to every new source. Public, industry and AI-hypothesis evidence can never move a problem above
`insufficient`. Such items appear only in a separate section ("Common in firms like yours: not yet
observed at your firm"), together with **what evidence would confirm them**.

### 4.4 Relationship to the architecture documents

`docs/architecture/target-architecture.md` and `design-decisions.md` describe a long-term platform:
an operating model, a claims layer, org-level problems, networks, bitemporal versioning and snapshot
privacy. **Two of their premises conflict with this direction**, so this document proposes amending
them (they haven't been edited):

| Architecture document | Conflict | Proposed amendment |
|---|---|---|
| target-architecture §2.1 / Phase 1 "industry-agnostic core, domain packs for other industries" | The market is mortgage-exclusive | Rename Phase 1 to **"mortgage journey as data"**: stages, roles, tasks and segments come from the knowledge release, with a firm-specific journey variant (brief §5.1). Drop multi-industry pack mechanics. |
| design-decisions §6 / §10.F / K10 networks, org relationships, snapshot disclosure audit | Not needed for 10–30 adviser brokerages in the MVP | Keep the **RLS function shape** (cheap, future-proof). **Defer** network relationships, aggregates and the disclosure audit until a network is a customer. |
| design-decisions §10.J phase order (operating model → claims → problems → decisions before ingestion) | Puts about five phases of re-architecture before the first commercial result | **Re-sequence**: Phase 0 security (unchanged, blocking), then pilot readiness and the Firm Snapshot, then *minimal* source attribution for new inputs. Do the claims and org-level problem re-architecture **after** pilots prove the method. See [implementation-backlog](implementation-backlog.md). |
| design-decisions §9 #5 / §10.F k=3 for role-level outputs | A 10–30 adviser firm often has **one to three case managers**, so k=3 would suppress the very role the brief says matters most | Needs a decision (see §8): k=3 for **verbatim quotes**, and below k a consented "identifiable-by-role" opt-in per participant, with themes and figures aggregated at org level otherwise. |

Everything else in design-decisions (R1/R2, K1–K9 security and integrity, the §12 acceptance
checklist) remains valid. It's sequenced in the backlog by when it's needed.

### 4.5 Recommended entry strategy: dual entry (revision 2)

Discovery has **two entry points that share one evidence model**:

| | **A. External intelligence discovery** | **B. Firm-assisted operational discovery** |
|---|---|---|
| Needs the firm? | No | Yes |
| Inputs | Public information (FCA register, Companies House, the firm's website and careers pages) + the approved knowledge release | Profile, technology inventory, firm lead's interview (the Firm Snapshot), staff interviews; later documents and case data |
| Output | **External Opportunity Assessment**: sourced observations + opportunity *hypotheses* + what would confirm each one | Validated findings, confidence, classifications, business cases, implementation pack |
| Status of its claims | Hypotheses. Never findings, never ranked, never quantified | Findings with evidence confidence |
| Gate | JADA review before anyone outside JADA sees it | Firm-lead validation; JADA engineering review |
| Commercial job | Earn a 30-minute Firm Snapshot; build a repeatable pipeline | Produce a confirmed, quotable implementation |

**Recommendation: "A opens, B proves, JADA builds."** A is an accelerator, not a prerequisite. Warm
referrals start at B. The first pilots should start at B while A is built and calibrated alongside.
The full comparison is in [first-commercial-mvp §2](first-commercial-mvp.md#2-the-two-entry-experiences).

**How A fits the existing architecture:**
- the knowledge release (adds signal types and relevance rules);
- LLM structured extraction with verbatim-excerpt verification (`generateStructured` +
  `quoteAppearsIn`);
- deterministic report assembly and PDF;
- invitation-style hashed share links;
- RLS. Assessments live in a **JADA-internal prospecting organisation**, because they're JADA's
  research, not the firm's data. They're copied into the firm's own workspace with provenance only
  when the firm signs up.

Details: [multi-source-discovery §8](multi-source-discovery.md#8-external-intelligence-discovery).

**The relationship between external intelligence and firm-verified evidence** is one ladder:
industry knowledge → public record → firm-provided → employee-reported → measured. Only the last
three can support a firm-specific finding. Each external hypothesis carries an id into the firm's
discovery and is marked by code as *confirmed*, *not supported*, *corrected* or *untested*. A
confirmed hypothesis becomes a finding **because of the firm's evidence**, and the public signal
adds nothing to its confidence, score or figures. Tracking the hit rate per relevance rule is what
makes A more accurate with every firm.
Details: [multi-source-discovery §9](multi-source-discovery.md#9-relationship-between-external-intelligence-and-firm-verified-evidence).

---

## 5. Product positioning

**For** owners and managing directors of UK mortgage brokerages with 10–30 advisers
**who** know their firm is losing time to admin but can't see where, and have no transformation
team,
**builda+** is an operational intelligence and transformation service, powered by software,
**that** interviews their staff independently, combines what they say with the firm's own
information, shows where time is lost with evidence and honest confidence, decides what to fix,
automate or leave with people, and hands JADA an implementation-ready plan for the first change.
**Unlike** generic AI consultancies or CRM add-ons, builda+ doesn't start from "where can we add
AI". It starts from evidence about how work actually happens, and says *fix* or *keep human* when
that's the right answer.

What builda+ is **not**: a mortgage advice tool, a CRM, a workflow automation product, a staff
monitoring tool, or a generic AI assistant.

---

## 6. Target customer and commercial proposition

### Customer

- **Firm:** UK mortgage brokerage, 10–30 advisers, directly authorised or an appointed representative
  of a network, typically 50–300 applications a month, with separate case-manager/administrator
  roles, no internal automation team.
- **Buyer and primary user:** firm owner or MD.
- **Participants:** 2–3 senior advisers, at least one case manager or administrator, other
  operational staff where relevant.
- **Out of scope:** lenders, networks as customers (for now), very small brokers (1–5 advisers,
  too little role separation), non-mortgage firms.

### Commercial layers (unchanged from the brief)

1. **Discovery.** An operational assessment and opportunity identification, delivered by the
   platform with light JADA oversight.
2. **Implementation.** JADA builds the recommended change. The two-week build is the lead offer when
   the feasibility gates pass. The *fix* and *overhaul* findings should also have a commercial route
   (see the conflict of interest below).
3. **Ongoing optimisation.** A future offering: reassessment through pulse interviews and repeat
   data uploads.

### The proposition, staged

| Stage | Firm effort | What the firm gets | What JADA gets |
|---|---|---|---|
| External Opportunity Assessment (optional entry) | **None** | Sourced observations about its public operating environment, and hypotheses about where firms like it commonly lose time, each with what would confirm it. No figures | A personalised, honest reason to start; hit-rate data per rule |
| Firm Snapshot | Firm lead: about 30 minutes (profile, technology inventory, own interview) | Confirms or corrects the external hypotheses; adds what *their own answers* indicate; says exactly which staff to interview | A qualified lead and a discovery scope |
| Rapid Discovery | 3–5 staff × 25 minutes, plus follow-ups, over about 5–10 working days | Validated findings, cross-role picture, classifications, top-three business cases, report | Evidence-backed opportunities and an implementation pack |
| Two-week build | Access and test data | A working change with human approval built in, and a baseline | Revenue, and a reusable pattern |
| Run and support (optional) | — | Hosting, monitoring, template changes for the live automation | Recurring revenue; the seed of "ongoing optimisation" |

**The first commercial deliverable is a tested document-chasing template** (Tiers C and B: standalone
and export-driven, so it works with any CRM). Without it, no discovery can end in a two-week build.
Full specification: [solution-engineering-engine §10](solution-engineering-engine.md#10-first-template-document-chasing-priority-commercial-deliverable).
Opportunities without a template take one of three routes, chosen deterministically:
- **tested template**: a two-week build;
- **reference solution**: a scoped build that can fund a new template;
- **bespoke engineering**: an engineering brief for an engineer to design from.

See [solution-engineering-engine §5.0](solution-engineering-engine.md#50-templates-reference-solutions-and-bespoke-engineering).

### A conflict of interest to manage deliberately

The product's integrity rests on "fix before automate", but the commercial model earns money from
automation builds. If the platform's top finding is a *fix*, the firm should hear that, and JADA
should have a way to be paid for helping (for example a fixed-price "process fix sprint"). Otherwise
there's a quiet commercial pressure on scoring and classification. Two safeguards are recommended:

1. The value ranking (top three) is separate from the "recommended first build" (two-week
   eligible). The report already models these separately, so keep it that way.
2. The feasibility score dimension (where a tested template scores 5) is disclosed in the rank
   explanation. Weight changes are versioned and reviewed, never tuned per deal.

---

## 7. Product capabilities (summary)

| Capability | Purpose | Exists today | Document |
|---|---|---|---|
| A. Mortgage Business Intelligence | A reviewed, versioned model of how mortgage firms work | Knowledge tooling; 3 draft cards | [mortgage-business-intelligence](mortgage-business-intelligence.md) |
| B. Multi-source Discovery | Gather firm-specific evidence from several sources with attribution | Interviews, profile, consent, guards | [multi-source-discovery](multi-source-discovery.md) |
| C. Operational Intelligence | Turn evidence into findings, confidence, classifications and quantified opportunities | Consolidation, confidence, impact, scoring, playback | [operational-intelligence-engine](operational-intelligence-engine.md) |
| D. Solution Engineering | Turn validated opportunities into the right type of solution and an engineering pack | Pack builder, feasibility gates, one untested template | [solution-engineering-engine](solution-engineering-engine.md) |
| E. Implementation and Outcome Measurement | Engineering review, delivery handover, before/after measurement | JADA review; baseline snapshot | [solution-engineering-engine §7–8](solution-engineering-engine.md) |

How they connect:

```
A (knowledge release, pinned per discovery)
   │ questions, cards, checks, templates, metric definitions
   ▼
B (sources → attributed evidence)  ──►  C (consolidate → confidence → classify → score)
                                          │ validated, approved opportunities
                                          ▼
                                       D (approach decision → template → pack)
                                          │ human engineering review (gate)
                                          ▼
                                       E (build by JADA → baseline vs after)
                                          │ outcomes and corrections (reviewed)
                                          └──► back into A and into the firm's next discovery
```

---

## 8. Biggest risks and unresolved decisions

### Risks (ranked by threat to the first commercial result)

1. **No reviewed content.** 3 draft cards, 0 checks, 0 sources, 0 tested templates. Interviews work
   without approved cards, but production releases can't publish, regulated-stage findings have no
   checks, and no recommendation can qualify for the two-week build. *This is the critical path, and
   it's owned by people, not engineers.*
2. **No tested JADA template**, so the primary commercial offer can't be confirmed in any pilot.
3. **Not deployable to production** (auth, email, retention, definer and FK fixes).
4. **Over-architecture.** Starting the claims, operating-model and network re-architecture before
   pilots would delay the first commercial result by months without improving it.
5. **Firm Snapshot credibility.** If the snapshot reads like findings, one wrong claim loses the firm.
6. **Small-firm confidentiality.** One case manager means role reporting is identifying.
7. **Participation.** Busy staff in small firms may not complete interviews. The product needs
   reminders and a visible "under 25 minutes" promise, and the firm lead must champion it.
8. **Fix-versus-automate conflict of interest** (§6).
9. **External assessment overreach** (revision 2). An unsolicited document about a named firm that
   gets one fact wrong, or reads like a diagnosis, damages trust before the first conversation.
   Mitigations: fixed sentence templates (no free LLM prose), verified excerpts with sources and dates,
   JADA approval of every assessment, and no figures.
10. **Generic external output.** If every brokerage gets "document chasing", A has no value. The
    relevance rules must discriminate, and hit rates show whether they do.
11. **Public-data and outreach compliance.** UK GDPR applies to individuals named on registers and team
    pages (store none; documented legitimate-interests assessment); website terms; PECR consent rules
    for email to sole traders and partnerships.
12. **Template data handling.** The document-chasing runtime processes client contact details (as
    the firm's processor). This needs a DPA, the firm's DPIA, and a runtime kept separate from builda+.
13. **LLM data processing.** The provider is OpenAI via an abstraction. The data processing terms,
   UK/EU processing location and retention settings must be settled before live use (brief §10:
   "approved privacy and data protection framework before live deployment").

### Decisions needed from the business

| # | Decision | Recommendation |
|---|---|---|
| 1 | Who owns card, check and source content, and who is the compliance reviewer (brief §9.3)? | A named mortgage operations SME, plus a qualified compliance reviewer on contract, both before pilot 1 |
| 2 | Small-firm confidentiality: k=3 suppression vs consented role disclosure | Quotes need k=3 or individual opt-in; figures and themes aggregate to firm level below k |
| 3 | Is the Firm Snapshot free, part of discovery, or a paid entry product? | Part of discovery (a conversion tool), not standalone |
| 4 | Commercial route for *fix* and *overhaul* findings | A fixed-price process-fix sprint alongside the two-week build |
| 5 | Is external research manual, assisted or automated? | **Assisted** for the MVP (researcher picks sources; builda+ extracts, verifies and assembles; JADA approves). Automated collection in Release 2. JADA review stays until hit rates are known (≥ 20 assessments) |
| 5a | Is the External Opportunity Assessment sent unsolicited, or only to warm prospects? | Warm prospects first (referrals, events, network introductions); cold outreach only after the tone and accuracy are proven and the PECR rules are agreed |
| 5b | Where does the template runtime run? | JADA-hosted single-tenant instance per firm, UK/EU, JADA as processor. Never inside builda+ |
| 6 | Retention period and JADA contact (both required by the consent screen) | Set before pilot 1 |
| 7 | Pilot pricing | Outside engineering scope, but needed before pilot 1 |
