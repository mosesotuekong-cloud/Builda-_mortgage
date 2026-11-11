# Capability C — Operational Intelligence Engine

Status: strategy proposal. Part of the [product direction](builda-product-direction.md).

Turns attributed evidence into an operational profile, process map, cross-role findings, classified
problems and quantified, ranked opportunities. **Deterministic by default; the LLM proposes only
where judgement over language is needed.**

---

## 1. What exists (verified)

The pipeline in `AnalysisService.analyse` → `rescore` → `playback`:

```
load evidence ─► AI proposes key merges ─► code validates merges (applyKeyMerges)
   ─► consolidate (deterministic): per pain point, median per participant, ranges, disagreements by role,
      blind spots, unreported stages, missing measurements, confidence
   ─► classify (AI proposal; must cite verified quotes; else playbook fallback; else firm lead)
   ─► buildOpportunities (deterministic): impact, two-week precheck, scoring, ranking, explanation
   ─► playback (journey, pain points, top three, cross-role) ─► corrections (audited) ─► rescore
```

Strengths to keep:
- the AI never computes a number;
- unknown inputs give unknown outputs;
- a firm-lead classification is never overwritten;
- every ranked item has a rank explanation.

### Defects to fix before pilots (all verified in code)

| Defect | Effect | Fix |
|---|---|---|
| Keys merged away in a later run leave stale `pain_points` rows, which are still scored | Phantom or duplicate findings in playback and report | Mark superseded rows; `rescore` skips them |
| Merges are re-proposed by the LLM on every run | Pain-point identity can drift between runs | Persist accepted merges and re-apply them; ask the LLM only about new keys |
| `rescore` uses `DEFAULT_SCORING_CONFIG`, ignoring `discoveries.scoring_config_version` | Weights aren't version-pinned as the brief requires | Load config by the pinned version |
| `implementationCostGBP` is always `null` | Payback never shown | Take the estimate from JADA review (see the solution engineering document) |
| `peopleInvolved` is unused, and the meaning of "minutes per occurrence" is ambiguous when several people touch a task | Possible under- or over-counting | Define minutes as **total active staff minutes per occurrence**; show people involved descriptively |
| Opportunities are deleted and re-inserted on every rescore | No score history | Append-only assessments (later; a report snapshot covers pilots) |

---

## 2. Process understanding and operational mapping

### 2.1 Outputs

| Output | Content | Built from | Status |
|---|---|---|---|
| **Operational profile** | Size, volumes, roles and counts, systems, DA/AR status, channels, stated challenges | Profile + inventory (+ public context) | Profile exists; inventory new |
| **Mortgage journey map** | Stages (the firm's names later) with pain points, regulated flags and coverage | Evidence + journey | Exists (playback `journey`) |
| **Role–task matrix** | Which roles report doing which tasks, by stage; where roles disagree | Interview evidence (+ SOP intent in Release 2) | **New**; needs ontology tasks |
| **System dependency view** | Systems per stage and task; manual transfers between systems (re-keying) | Evidence `systems` + inventory | **New** (simple table, not a graph engine) |
| **Coverage view** | Stages and tasks with no evidence, or evidence from one role only | Coverage counts | Partly exists (`unreportedStages`) |
| **Intended vs reported** | Where SOPs or process maps differ from interviews | Documents + interviews | Release 2 |
| **Elapsed vs effort vs waiting** | Per stage: elapsed days (measured), active minutes (reported), external waiting (measured, with mapping) | Case data + interviews | Release 2 |

These are **views over evidence**, not a separately maintained process model. That's the
"smallest model that serves a decision" principle (design-decisions P5). Tables and the existing
journey strip are enough. A graph visualisation isn't needed.

### 2.2 Anchoring to tasks

Once the ontology has tasks, interview extraction gets a `taskId` field (an ontology key, or
`other`). Consolidation keys pain points by `(task, problem type)` before falling back to the
LLM-invented key. This gives stable identity across runs and firms with **no AI matching**, and it
removes most merge proposals.

---

## 3. Cross-role analysis (exists; extend)

Existing outputs, all kept:
- **agreements** (≥ 2 participants consistent);
- **disagreements** (preserved by role);
- **blind spots** (reported by staff, not by the firm lead);
- **unreported stages**;
- **missing measurements**;
- **targeted follow-ups**.

Extensions:

| Extension | Rule | Release |
|---|---|---|
| Hidden dependencies | A task reported by role A that waits on role B or an external party, where B doesn't report it | 2 |
| Handoff friction | ≥ 2 roles describe the same handoff with different owners or steps | 2 |
| Segment-explained disagreement | Disagreement disappears when split by case type, so it's shown as variation, not conflict | 2 |
| Small-group handling | Below the minimum group size, figures aggregate to firm level and quotes need the participant's opt-in (decision pending) | **MVP** |

Disagreements are never interpreted as error or misconduct (brief), and the UI language must reflect
that ("accounts differ", never "inconsistent").

---

## 4. Bottleneck and opportunity identification

### 4.1 Bottleneck rules (deterministic)

| Signal | Rule | Evidence needed |
|---|---|---|
| Chasing load | Problem type `chasing`, volume × minutes ≥ threshold | Interviews |
| Duplicate entry | The same task touches ≥ 2 systems with `manual` data in/out (inventory) | Interviews + inventory |
| External waiting | Elapsed between milestones ≫ reported effort, and the stage maps to an external party | Case data + interviews |
| Single point of dependency | Task reported by one role-holder only, with no alternative named | Interviews (rendered without identifying the person) |
| Rework / return | Participants report returned or re-submitted cases; or case data shows backward steps | Interviews / case data |
| Blind spot | Staff-reported effort not mentioned by the firm lead | Interviews (exists) |

The LLM may *suggest* a likely cause for a bottleneck. That suggestion is labelled
**Assumption**, carries the evidence it reasoned from, and never changes confidence or rank.

### 4.2 Classification (four outcomes, unchanged)

Kept exactly: the AI proposes with a rationale; the proposal must cite verified quotes; it falls back
to the card's likely classification (labelled *Playbook*); and the firm lead decides. Additions:

- **Fix-first check (deterministic):** if the evidence names a cause that a non-automation pattern
  addresses (missing checklist, unclear ownership, duplicate step), an `automate` proposal is shown
  with "a simpler fix may be enough first", and the fix pattern is listed. This makes brief §3.1
  visible.
- **Regulated stages:** `requires_compliance_review` stays automatic. `automate` at a regulated stage
  is only ever "prepare information for the adviser" (existing prompt rule, plus an approved check).

### 4.3 Opportunity identification across sources

An opportunity exists only for a problem with firm-specific evidence (confidence ≥ Low). Sources
contribute as follows:

| Source | Role in opportunity identification |
|---|---|
| Interviews | Create problems; give effort and volume estimates |
| Firm lead's corrections and validation | Override figures (audited); validate problems |
| Case data | Replace stated volume with measured; add elapsed and waiting views |
| Documents | Add structure and intended-vs-reported findings; never create a ranked opportunity alone |
| Playbook | Suggest classification, patterns and questions; never create an opportunity |
| Public (entry A, external assessment) | Generates **hypotheses** through reviewed relevance rules. Never an opportunity, never a score input, never a figure. A hypothesis becomes an opportunity only when firm evidence confirms it, and then the firm's evidence is what's scored (multi-source-discovery §9) |

---

## 5. Deterministic scoring and financial impact

### 5.1 Scoring (exists; changes noted)

Six dimensions, banded 1–5, with weights versioned (`scoring-2026-11-v1`): impact 0.30, volume 0.15,
feasibility 0.20, complexity 0.10, risk 0.10, confidence 0.15. `keep_human` and `insufficient` are
excluded and explained.

| Change | Reason |
|---|---|
| Load weights by the discovery's pinned version | Brief §6.2 |
| **Disclose** that feasibility scores 5 when a tested JADA template exists | The template bias favours what JADA sells. Disclosure keeps the ranking honest (product direction §6) |
| Keep "top three by value" separate from "recommended first build" | Already separate in the report model; make it explicit in playback too |
| Confidence uses the source-aware ladder | Multi-source discovery §5.2 |
| Weight changes only via a new version, reviewed by product and JADA leads, never per firm or per deal | Integrity |

**Scoring across sources** needs no separate weighting per source. Sources affect the score through
two deterministic paths only:
1. the **inputs** used: measured volume beats stated once confirmed; firm-lead overrides beat both,
   and are labelled;
2. the **confidence dimension**.

This keeps one formula, explainable with the existing `explainRanking`.

### 5.2 Financial impact (exists; extend carefully)

| Figure | Formula (code) | Inputs and labels |
|---|---|---|
| Monthly hours spent | volume × active minutes ÷ 60 | Firm said / measured volume; reported minutes |
| Monthly hours recovered | hours spent × reduction % | Reduction from the firm lead (attested) or the template's basis (**Assumption** until JADA has measured it) |
| Capacity value (£/month) | hours recovered × loaded hourly cost | Hourly cost supplied by the firm. **Never estimated by the platform** |
| Payback (months) | implementation cost ÷ capacity value | Cost from JADA's estimate at engineering review |
| **Cash saving** | Only if the firm lead states that capacity will reduce a specific cost (overtime, temp staff, a planned hire avoided) | Firm said. Otherwise shown as "capacity, not cash" (existing caveat) |
| **Revenue impact** | Only as a scenario: recovered adviser hours × the firm's stated conversion and value per case | Firm-said inputs, labelled **Scenario**, never in the headline figure |
| Elapsed-time reduction | Measured before/after (future) | Never from effort figures |

Rules (unchanged in spirit, and enforced):
- unknown inputs stay unknown, and the report lists exactly which input is missing;
- recovered capacity is never called a saving;
- no figure is produced by the LLM;
- every figure lists its assumptions (existing `assumptions` array).

## 6. Deterministic logic vs LLM

| Task | Owner |
|---|---|
| Evidence extraction from text | LLM proposes → code verifies quotes and excerpts |
| Unit conversion, aggregation, medians, ranges | Code |
| Matching evidence to tasks / pain points | Code first (task keys); LLM proposes leftover merges → code validates |
| Confidence | Code |
| Disagreement detection | Code |
| Follow-up question selection and wording | Code (templates); LLM only for main-interview wording |
| Bottleneck detection | Code (rules) |
| Likely cause, narrative summary | LLM, labelled Assumption, with citations |
| Classification | LLM proposes with verified quotes → fallback → firm lead decides |
| Scoring, ranking, impact, payback | Code |
| Two-week eligibility | Code (gates) + human engineering review |
| Report assembly | Code (no LLM, as today) |

There is no single autonomous agent. Each LLM call is a narrow, schema-validated task with a
verification step, recorded in the usage ledger.
