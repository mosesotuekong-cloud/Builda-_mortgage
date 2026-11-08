# Capability A — Mortgage Business Intelligence

Status: strategy proposal. Part of the [product direction](builda-product-direction.md).

The mortgage knowledge model is a core product asset (brief §5). It has to make interviews better
informed, findings comparable across firms, classifications consistent, and implementation packs
specific. It must also never pass itself off as evidence about a particular firm.

---

## 1. What exists today

| Element | Implementation | Limitation |
|---|---|---|
| Journey stages (14, incl. protection) with a `regulatedJudgement` flag | TypeScript constants in `src/domain/journey.ts`; `stage_id` stored as text | Not data: firms can't rename, merge or add stages (brief §5.1) |
| Roles (5) and default stage scope per role | Constants, plus a **Postgres enum** `participant_role` | Changing roles needs a migration |
| Classifications (4) | Constants plus a Postgres enum | Fine: the brief fixes these four |
| Pain-point cards | `knowledge_items(kind='card')`, versioned, four-eyes review, immutable releases | **3 draft cards**, owner unassigned; no task, system or metric entities |
| Regulatory checks | `kind='check'`, must cite a source; release blocked unless every regulated stage is covered | **None approved**, so no production release can publish |
| Sources | `kind='source'` with title, reference, publisher, update date, sections, owner | **None** |
| Automation templates | Hard-coded `src/knowledge/templates.ts`, 1 template, `tested: false` | Not versioned or reviewed like other knowledge; not editable by JADA without a deploy |
| Cross-firm learning | `knowledge_candidates()`: keys seen in ≥ 2 firms and missing from the playbook | Exposes free-text titles; threshold too low; identity passed as a parameter (design-decisions K3) |
| Release pinning | Each discovery pins `playbook_version`; reports record it | Good, keep it |

The **mechanism is sound and should be kept**: versioned items, compliance-reviewer four-eyes,
immutable releases, discovery pinning, and citation requirements for checks. What's missing is
*structure* (tasks, systems, metrics) and *content*.

---

## 2. Mortgage domain ontology

Deliberately small. Every entity must earn its place by improving interviews, analysis, scoring or
packs.

### 2.1 Entities

| Entity | Meaning | Example | Exists? |
|---|---|---|---|
| **Stage** | A step of the mortgage journey; may be flagged as regulated judgement | Documents; Recommendation (regulated) | Yes (code constant) |
| **Role** | An operational role in a brokerage | Adviser, case manager, administrator, firm lead, protection adviser, paraplanner/assistant | Yes (5); extend |
| **Task** | A unit of work within a stage, performed by a role | "Request and track outstanding documents" | **New, the key addition** |
| **System category** | A type of application used in brokerages | Mortgage CRM/case management, sourcing, lender portals, e-ID/AML check, document portal, e-signature, email/telephony, spreadsheets | **New** |
| **External party** | Someone outside the firm whose actions cause waiting | Client, lender, valuer, solicitor/conveyancer, introducer, network | **New** |
| **Pain-point card** | A known recurring problem, with signs, questions and likely classification | Document chasing | Yes; link to tasks |
| **Problem type** | A small core vocabulary for comparing problems | waiting, rework/return, duplicate entry, chasing, manual status communication, error/omission, capacity constraint, single point of dependency, unclear ownership, compliance friction, tool gap (design-decisions §2) | **New** |
| **Metric definition** | A measurable quantity with a unit and **measure kind** | Active chasing minutes per application (`effort`); days in "awaiting documents" (`elapsed`) | **New** (cards only have free-text metrics) |
| **Automation / improvement pattern** | A reusable kind of solution, including non-automation patterns | Staff-approved reminder sequence; single intake checklist (fix); remove a duplicate data-entry step (overhaul) | Partly (free text on cards) |
| **Regulatory boundary (check)** | What must hold before changing work at a stage, with citations | "Automation may prepare, not decide, suitability" | Yes |
| **Implementation template** | A JADA-owned, tested solution with a spec | `document_chasing_v1` | Yes (code); move into knowledge |
| **Source** | An approved external reference | FCA Handbook MCOB; Consumer Duty guidance; ICO guidance | Yes |
| **Segment dimension** | A variation that changes how work happens | Case type: purchase / remortgage / product transfer / buy-to-let / further advance; protection attached or not; channel: direct / introducer | **New** |

### 2.2 Relationships

```
Stage ──contains──► Task ──performed_by──► Role
                      │ ──uses──► System category
                      │ ──waits_on──► External party
                      │ ──measured_by──► Metric definition
                      ▼
               Pain-point card ──has_type──► Problem type
                      │ ──likely──► Classification (one of four)
                      │ ──addressed_by──► Pattern ──implemented_by──► Implementation template
                      │ ──bounded_by──► Regulatory check ──cites──► Source
                      ▼
               Segment dimensions that commonly change it (e.g. remortgage vs purchase)
```

The brief's worked example maps one-to-one:

| Brief §5.2 example | Ontology |
|---|---|
| Stage: Document collection | Stage `documents` |
| Role: Case manager | Role `case_manager` |
| Task: Request and track outstanding documents | Task `request_track_documents` |
| System: Firm CRM or case management | System category `crm_case_management` |
| Metric: Active chasing time per application | Metric `chasing_minutes_per_application` (effort) |
| Pain point: Repeated manual follow-ups | Card `document_chasing`, problem type `chasing`, external party `client` |
| Potential outcome: Automated reminders with human approval | Pattern `approved_reminder_sequence` → template `document_chasing_v1` |
| Boundary: No automated professional judgement | Check on `documents`: document adequacy is a human judgement |

### 2.3 Why tasks are the critical addition

Today everything anchors to **stages**, which are too coarse. "Documents" contains requesting,
chasing, checking adequacy, indexing and uploading. Each has a different classification (chasing:
automate; adequacy: keep human). Without tasks, a single "documents" pain point can't be classified
correctly, and the engineering pack can't say exactly what's in scope. Tasks give:

- better interview questions (asked per task, not per stage);
- correct classification boundaries ("automate the chase, keep the adequacy check human");
- an exact pack scope (the pack's workflow is a sequence of tasks);
- a role-task matrix for the operational profile.

Target: about 5–10 tasks per stage, roughly 80–120 tasks in total, authored with the cards.

### 2.4 What the ontology must not contain

- Anything about individual clients or cases.
- Lender-specific criteria or product data (this drifts toward advice and goes stale quickly).
- Suitability logic of any kind.
- Benchmark figures without an approved, cited source. Unsourced "typical minutes per task" values
  would become invented measurements the moment they appear in a firm's report.

---

## 3. Firm adaptation: the firm's own journey

Brief §5.1 says firms may rename, merge or introduce stages. Proposed model (Release 2–3; pilots use
the standard journey):

- A discovery's **journey variant** is created from the pinned release: the standard stages with
  firm-specific names, merges and additions. It's stored per discovery, with a mapping back to the
  standard stage IDs.
- **Regulated-judgement flags can't be removed by a firm.** A merged stage that contains a
  regulated stage inherits the flag, and an added stage defaults to non-regulated until a JADA
  reviewer marks it. This is a deterministic rule.
- Analysis, scoring and cross-firm learning always run on **standard IDs**, so findings stay
  comparable. The firm sees its own names.

This requires stages, roles and tasks to be data (from the knowledge release) instead of TypeScript
constants and Postgres enums. That's the "mortgage journey as data" change proposed in the
[product direction §4.4](builda-product-direction.md#44-relationship-to-the-architecture-documents),
which replaces the multi-industry "domain pack" idea.

---

## 4. Knowledge sources

### 4.1 Approved source types

| Source type | Examples | Used for | Approval |
|---|---|---|---|
| Regulation and guidance | FCA Handbook (MCOB, PRIN incl. Consumer Duty, SYSC), FCA guidance and Dear CEO letters, ICO guidance, UK GDPR | Regulatory checks and boundaries | Compliance reviewer |
| Practitioner knowledge | Interviews with experienced advisers and case managers engaged by JADA | Cards, tasks, signs, interview questions | Mortgage SME + second reviewer |
| JADA implementation experience | Template builds, measured reductions | Templates; the reduction basis | JADA engineering lead |
| Discovery-derived patterns | Pain-point keys recurring across firms (`knowledge_candidates`) | Candidate new cards, **never** used directly | SME review; aggregate data only (≥ 5 firms, keys and counts, no free text) |
| Public industry statistics | Published market data from trade bodies or regulators (cited) | Context for cards ("remortgage volumes peak when…"), never firm figures | Knowledge editor + citation |

### 4.2 Prohibited sources

- Paid training materials or proprietary firm documents without permission (brief §9.2).
- A firm's own documents feeding the shared playbook. Firm documents are firm evidence, never
  knowledge.
- LLM-generated content that hasn't been human-authored or reviewed. An LLM may *draft* a card for
  an editor, but only the reviewed version enters a release (the four-eyes rule already enforces
  this).

---

## 5. Maintenance and versioning

Keep the existing mechanism and extend what it covers:

| Rule | Status |
|---|---|
| Every item is versioned (`kind`, `key`, `version`) | Exists |
| A different person from the author approves (four-eyes, DB-enforced) | Exists |
| Checks must cite approved sources; a release is blocked otherwise | Exists |
| Every regulated stage is covered by at least one approved check before release | Exists |
| Releases are immutable snapshots; each discovery pins one | Exists |
| New kinds: `task`, `system_category`, `external_party`, `metric`, `pattern`, `reference_solution`, `template` (with `tested` per integration tier), `problem_type`, `segment_dimension`, `profile_relevance_rule`, and for the external assessment (revision 2) `public_signal_type` and `signal_relevance_rule` | **New** (Release 1–2) |
| Relevance rules carry a tracked **hit rate** (confirmed ÷ (confirmed + not supported), aggregate counts only). Rules with persistently low hit rates are reviewed or retired through the normal four-eyes process | **New** (revision 2) |
| Templates move from code into knowledge, owned by JADA engineering, and `tested` can only be set by an engineering-lead review | **New** |
| `lastReviewed` older than 12 months shows as a warning at release preview; regulatory checks older than 6 months block the release | **New** |
| A source update (new `updatedOn`) flags every check and card citing it for re-review | **New** |
| Corrections from discoveries feed *candidate* drafts only, through the reviewed path (brief §9.2) | Partly exists (candidates) |
| A taxonomy change (problem types, stages) ships with a mapping from old to new (design-decisions 10.G) | **New** |

### 5.1 Profile relevance rules (for the Firm Snapshot)

These are simple, reviewed, deterministic rules attached to cards. For example:

```
card: case_status_updates
relevant_when: profile.monthlyApplications >= 80
           AND profile.systems includes category lender_portal
```

They're used only to select "common in firms like yours" hypotheses. They never change confidence,
never produce figures, and every rule is visible in the snapshot ("shown because you process about
120 applications a month and use several lender portals").

### 5.2 Content ownership (needs names before pilot 1)

| Content | Owner role | Reviewer role |
|---|---|---|
| Cards, tasks, patterns | Mortgage operations SME (knowledge editor) | Second SME or JADA lead |
| Regulatory checks, sources | Knowledge editor | **Qualified compliance reviewer** (brief §9.3) |
| Templates | JADA engineer | JADA engineering lead |
| Problem types, segment dimensions, metric definitions | Product lead | Mortgage SME |

## 6. Content plan for pilots

| Item | Pilot target | Brief target |
|---|---|---|
| Cards | 15–20, covering enquiry → offer + aftercare, weighted to case-manager and admin work | 30–50 |
| Tasks | Those referenced by the 15–20 cards (about 40–60) | — |
| Regulatory checks | ≥ 1 per regulated stage (4) + general data protection + communications (Consumer Duty) | — |
| Sources | About 6–10, enough to cover the checks | — |
| Templates (tested) | 1 (document chasing). A second (status updates) is drafted | — |
| Metric definitions | One per card | — |

The content effort is about 3–5 weeks of part-time SME and compliance time, and it runs **in parallel**
with Phase 0 engineering. It's the most likely cause of pilot delay, so it should start first.
