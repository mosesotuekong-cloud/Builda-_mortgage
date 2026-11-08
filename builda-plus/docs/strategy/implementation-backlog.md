# builda+ — implementation backlog

> **Near-term order superseded by [decision-record](decision-record.md) §2.** P2b (external-assessment
> software) is deferred (D2); the template track is now Outlook follow-up drafts (D3); trusted session
> identity is required before pilot 1 and composite FKs before firm 2 (D7–D8). The phase list below
> remains the longer-term reference.

Status: strategy proposal, **revision 2**. Adds the external intelligence pathway (entry A) and
the tested document-chasing template as a first-class track, and revises the 30-day plan. Part of
the [product direction](builda-product-direction.md).

Sizing is relative (S ≈ 1–3 days, M ≈ 1 week, L ≈ 2+ weeks for one engineer). Dates are planning
assumptions, not commitments.

Assumed team:
- **2 product engineers** (builda+);
- **1 JADA engineer, about full-time** on the document-chasing template (revision 2: raised from
  part-time, because the template is now the priority commercial deliverable);
- a **mortgage operations SME** (content and signal rules);
- a **compliance reviewer** on contract;
- a **data protection lead** (part-time);
- a **JADA researcher/salesperson** for external assessments (part-time).

---

## 1. Principles for sequencing

1. **The first commercial result first:** a signed implementation from a pilot firm
   ([first-commercial-mvp](first-commercial-mvp.md)).
2. **Two tracks to revenue run in parallel:** the **builda+ platform** (it finds and proves the
   opportunity) and the **document-chasing template** (it's what gets sold). Either one alone earns
   nothing.
3. **Security gates block data, not work** (design-decisions K11). No real firm data, and no
   prospect research data, enter production until the Phase 0 checks pass in production.
4. **Content runs from day 1.** It's on the critical path.
5. **Extend existing modules; don't rebuild them.** No new infrastructure: Postgres, Fastify, a
   Postgres job table.
6. **Pilots start at entry B** (warm prospects). Entry A is built and calibrated alongside them, so
   it never delays a pilot.

---

## 2. Phases

| Phase | Goal | Contents | Depends on | Gate |
|---|---|---|---|---|
| **P0. Security and production readiness** | Safe to hold real firm data | OIDC identity and memberships; demo sign-in behind a flag; signed session context (K2); definer function rewrites; composite tenant FKs on existing tables; RLS via `app_can_read` / `app_can_write`; rate limiting; security tests S1–S12; CI catalogue checks A1–A8 | — | All P0 checks pass in production |
| **P1. Pilot readiness** | A firm can run a discovery end to end without hand-holding | Email (invitations, reminders, follow-ups); retention job; minimum-group-size handling; persist `turn_index`; stale-pain-point fix, persisted merges; scoring config by pinned version; as-you-type client-data warning; `insufficient_evidence` escalation | P0 (data) | Internal dry run; B1 golden regression unchanged |
| **P2a. Firm Snapshot and business case** | Faster start and a complete business case | Technology inventory; Firm Snapshot (three sections); role recommendations; engineering estimate → payback; success measures + adoption criterion at approval; "top three" separated from "recommended first build" in playback | P1; content C1 | SME review: zero unsupported claims |
| **P2b. External Opportunity Assessment (assisted)** | Entry A | JADA prospecting org and role; prospect record (FCA FRN, company number); sources (URL, retrieved date, content hash, or researcher-entered fact + URL); bounded page fetch (named URLs only, robots.txt respected) or paste; LLM signal extraction + excerpt verification; signal types and relevance rules as knowledge kinds; deterministic assembly from sentence templates; JADA approve/withdraw (audited); hashed share link + PDF; "correct a fact" form; prospect retention job | P0 (data), P1; content C1b | Accuracy review of 10 internal test assessments: **0 unsourced or wrong public facts; 0 hypotheses worded as findings** |
| **P2c. Linking A to B** | Hypotheses carried into verified discovery | Copying the assessment into a new firm workspace with provenance; hypothesis lifecycle (`untested / confirmed / not_supported / corrected`) computed by code; hypothesis section in Snapshot and playback; aggregate hit rate per rule | P2a, P2b | Lifecycle tests; the hit-rate aggregate contains no firm identifiers |
| **P3. Knowledge structure** | Tasks, stable identity, templates as knowledge | New knowledge kinds (task, system category, external party, metric with `measure_kind`, pattern, **reference solution**, template, problem type, segment dimension); templates moved out of code with `tested` **per tier**, set only by the engineering lead; extraction gains `taskId`; (task, problem type) keying; route selection (template / reference solution / bespoke) and the fix, redesign and engineering-brief outputs | P1 | Pilot discoveries re-run: findings equivalent or better (SME review) |
| **— Pilots 1–3 —** | Prove method and conversion | Warm prospects at entry B; A shown where available | P0–P2a; template T1 | MVP measures (first-commercial-mvp §1) |
| **P4. Multi-source evidence (Release 2)** | Raise confidence; reduce interview load | Document upload pipeline; case milestone CSV; source-aware confidence; intended-vs-reported; elapsed vs effort vs waiting; **automated public-source collection** (FCA register and Companies House APIs) | P3; pilot learnings | Evidence-trail tests; suppression tests |
| **P5. Journey as data** | Firm-specific stages | Stages and roles from the release; per-discovery journey variant; regulated flags can't be removed | P3 | B1 regression; regulated-flag tests |
| **P6. Long-term architecture (as needed)** | Org-level memory and outcomes | design-decisions phases 2–5 | Pilots, P4 | design-decisions §12 per phase |
| **Deferred** | — | Networks; CRM API adapters except for a named customer; review-site or social-media signals; outcome dashboards | Demand | — |

### Template track (JADA engineering, outside the builda+ codebase)

| Step | Deliverable | Gate |
|---|---|---|
| T0 | Architecture of the runtime: single-tenant per firm, UK/EU hosting, mailbox scoping on Microsoft 365 / Google Workspace, data model limited to the §10.5 list, audit log, kill switch | JADA engineering lead sign-off |
| T1 | **Tier C (standalone)** built; full functional, security and operational test groups passing in a sandbox → `tested (Tier C)` | Engineering lead sets `tested`; dependency scan clean |
| T2 | **Tier B (export-driven)** on the same build; tier tests → `tested (Tier B)` | As T1 |
| T3 | Delivery kit: two-week plan, prerequisite checklist, template DPA and DPIA pack, Consumer Duty template checklist, handover note, measurement plan (chase tally) | DP lead + compliance reviewer |
| T4 | First live implementation (pilot firm) → acceptance tests → measured outcome | Definition of done (solution-engineering §10.8) |
| T5 | Second measured implementation → `field_proven`; the reduction basis changes from Assumption to measured | Engineering lead |

### Parallel non-engineering tracks (start day 1)

| Track | Deliverable | Owner | Needed by |
|---|---|---|---|
| C1 Content | 15–20 reviewed cards (+ tasks, metrics); first production knowledge release | SME + compliance reviewer | Pilot 1 |
| C1b External signals | 20–30 public signal types and relevance rules (reviewed knowledge items) | SME + JADA | P2b |
| C2 Regulatory | Approved checks for all regulated stages + general data protection + Consumer Duty communications; 6–10 sources | Compliance reviewer | Pilot 1 (release can't publish without it) |
| C4 Data protection | Discovery DPIA; **legitimate-interests assessment for external research**; LLM provider terms; retention periods | DP lead | P0 gate / P2b |
| C5 Implementation DP | Template DPA, DPIA pack and records-of-processing template | DP lead + JADA | First build |
| C6 Commercial | Pilot offer; fix-sprint offer; build and run pricing; outreach rules (PECR); JADA contact and escalation time | Business | Pilot 1 |

---

## 3. Reusable existing components

| Component | Reuse for | Change |
|---|---|---|
| `interview/*` | Entry B | Persist turn index; later `taskId` |
| `guards/*` | Entry B; documents later | Client-side mirror |
| `analysis/*`, `engine/*` | Capability C | Fixes (P1); estimate → payback; source-aware confidence (P4) |
| `knowledge/*` | Cards, checks, sources, **signal types, relevance rules, reference solutions, templates** | New kinds |
| `llm/provider.ts`, `budget.ts` | Interview, classification, **public-signal extraction** | Metering by purpose (prospecting has no discovery id: use a prospect-scoped budget) |
| `orchestrator.quoteAppearsIn` | Interview evidence, classification, **public excerpt verification** | — |
| `report/model.ts`, `pdf.ts` | Discovery report, **external assessment**, Firm Snapshot | New models in the same deterministic style |
| `http/tokens.ts` | Invitations, **assessment share links** | — |
| `implementation/*` | Packs, review, estimate | Route selection; reference-solution pack; engineering brief |
| RLS, `audit_log` | Everything, **including the prospecting org** | — |

## 4. New components

| Component | Phase |
|---|---|
| OIDC adapter, `users`, `memberships`; `builda_security` schema and signed context; migration `007_security.sql`; `db/tests` security suite | P0 |
| Mailer; retention job; jobs table | P1 |
| Technology inventory; Firm Snapshot; estimate; success measures | P2a |
| Prospecting org and role; `prospects`, `prospect_sources`, `public_signals`, `external_assessments` (versioned, approved), `assessment_share_links`; bounded fetcher; assessment model and PDF; prospect retention job | P2b |
| `external_hypotheses` with lifecycle status (in the firm's tenant after copying); hit-rate aggregate (definer function, counts only) | P2c |
| Knowledge kinds and route selection | P3 |

All new tables follow R1/R2 (no FK arrays, composite tenant FKs) and pass the §12 catalogue checks.

---

## 5. Security and testing requirements

| Requirement | Phase |
|---|---|
| Catalogue checks A1–A8; security tests S1–S12 (incl. S9 context forgery, S12 cross-tenant FKs) | P0, then every migration |
| B1 golden regression of playback and report | P1 onward |
| Guard tests (interview; later documents) | P1 / P4 |
| No-invention tests: missing inputs → unknowns; playbook-only and **external** items never ranked or quantified; the Snapshot and the external assessment show no figures not supplied by the firm | P2a/P2b |
| **External assessment tests:** every observation has a verified excerpt or a researcher-entered source URL and date; unknown signal types rejected; sentence templates only (no free LLM text in firm-facing output); unapproved assessments not reachable by share link; share links expire; no personal names stored (test on fixtures with team pages) | P2b |
| **Prospect isolation:** prospecting data is visible only to JADA prospecting roles; firm users can't see other prospects; copying into a firm creates provenance rows, not cross-tenant references | P2b/P2c |
| Hypothesis lifecycle tests (`not_supported` needs ≥ 2 role-matched participants covering the stage) | P2c |
| Minimum-group-size tests | P1 |
| Retention tests (firm data and prospect data) | P1 / P2b |
| Third-party penetration test of builda+ | Before pilot 1 |
| Template test groups (functional, tier, security, operational, acceptance), plus a pen test of the template runtime | T1–T4 |

---

## 6. Revised first 30 days

Day 1 starts all tracks.

| Week | Engineer A | Engineer B | JADA engineer (template) | Content / DP / commercial |
|---|---|---|---|---|
| **1** | OIDC identity, memberships, production start path; demo sign-in behind a flag | Migration `007` part 1: definer function rewrites, owner roles, pinned `search_path`, `PUBLIC` revoked | T0 runtime architecture; sandbox; mailbox scoping proven on a test tenant | SME: 8 cards + first 10 signal types. DP: discovery DPIA, LIA for external research, provider terms. Business: pilot and fix-sprint offers |
| **2** | Signed session context (K2) + S9 tests | Migration `007` part 2: composite FKs, RLS functions; A1–A8 and S1–S8, S12 in CI | T1 Tier C: case entry, checklist, schedule, approval queue, send via scoped mailbox, pause, kill switch, audit log | Compliance: checks for the 4 regulated stages. SME: 15 cards drafted; 20 signal types + relevance rules drafted |
| **3** | Email (invitations, reminders); retention job; rate limiting; as-you-type warning | Analysis fixes (stale rows, persisted merges, config by version, `turn_index`, insufficient-evidence escalation); minimum-group-size handling | T1 test groups (functional, security, operational) → **`tested (Tier C)`** at the end of the week, if green | Cards: 8+ approved. Signal rules in review. T3 delivery kit drafting (DPA, DPIA pack, Consumer Duty checklist) |
| **4** | **P2b: External Opportunity Assessment (assisted)**: prospecting org, sources, fetch/paste, signal extraction + verification, relevance rules, sentence-template assembly, approve, share link, PDF | **P2a: Firm Snapshot** + technology inventory + estimate → payback; playback separates "top three" and "recommended first build" | T2 Tier B on the same build; tier tests; demo environment for sales | First production knowledge release published. 10 internal test assessments reviewed (accuracy gate). Warm pilot prospects lined up |

**Moved out of the 30 days** (compared with revision 1), to make room for entry A and stay
realistic:
- the background jobs table, because analysis stays synchronous for pilot-sized discoveries;
- role recommendations in the Snapshot (week 5);
- success measures and adoption criteria at approval (week 5–6, still before the first build
  proposal);
- linking external hypotheses into a firm discovery (P2c, weeks 5–6).

**Go/no-go for pilot 1 (end of week 4):**
- P0 checks green **in production**; pen test findings triaged;
- a production knowledge release published (approved regulatory checks for all regulated stages);
- **document-chasing template `tested` for Tier C**, with the delivery kit drafted;
- discovery DPIA and LLM provider terms approved; retention period and JADA contact set;
- the external assessment is **not** a pilot-1 dependency. It's used only after its accuracy gate
  passes.

**Weeks 5–8 (outline):**
- P2c linking and the hit rate;
- success measures;
- role recommendations;
- T3 delivery kit final;
- pilots 1–3 at entry B, with external assessments for two or three further warm prospects;
- the first build proposal;
- T4 the first live implementation.

### Main schedule risks

| Risk | Mitigation |
|---|---|
| Compliance review slower than engineering | Start week 1; scope to the regulated stages + 2 general checks |
| Template not `tested` by week 3–4 | Pilot 1 still runs; its proposal becomes a fix sprint or a scheduled build once T1 passes. The template track has a full-time owner |
| External assessments read as diagnoses | Sentence templates only; JADA approval; accuracy gate on 10 internal tests before any external use |
| P0 overruns | P0 gates real data; P2b and P2a slip before P0 does |
| Signal rules don't discriminate (every firm gets the same hypotheses) | Rules reviewed for specificity; hit rates tracked from the first pilots; retire weak rules |
