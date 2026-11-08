# Capability B — Multi-source Discovery

Status: strategy proposal, **revision 2**. Adds external intelligence discovery (§8) and its
relationship to firm-verified evidence (§9). Part of the [product direction](builda-product-direction.md).

Goal: understand a mortgage firm from several kinds of evidence, while keeping clear **where each
piece came from**, **what it can and can't prove**, and **how confident we are**.

---

## 1. Original interview-based discovery (verified, keep)

The interview remains the backbone. It's the only source that reveals actual effort, hidden admin
work and cross-role differences, which are the brief's core insight.

What the code does today:

1. **Invitation and consent:** a hashed, expiring link; versioned consent; no client data;
   processes, not people.
2. **Role-scoped interview:** stages in scope come from the role (`DEFAULT_STAGES_BY_ROLE`) and are
   narrowed by the participant ("which parts do you work on?").
3. **Per turn:**
   - the regex client-data guard runs *before* the LLM ("definite" escalates; "possible" asks the
     participant to rephrase);
   - hard-keyword escalation;
   - the LLM interprets the message into a schema-validated `TurnInterpretation`;
   - flags escalate;
   - **evidence is kept only if its quote appears verbatim in the message**;
   - units are converted in code, with assumptions recorded;
   - code picks the next stage (`chooseFocus`);
   - the LLM words the question using the playbook cards for that stage.
4. **Limits:** 40 turns, 3 questions per stage, 2 evidence items to cover a stage, 8 messages of
   context. Pause and resume are supported, with optimistic concurrency on save.
5. **Follow-ups:** code-written questions about disagreements and missing measurements, sent as a
   short follow-up session.

Small improvements for the MVP: persist `turn_index`, add the as-you-type client-data warning,
trigger `insufficient_evidence` escalation when analysis finds no rankable opportunity, and
reminders. Interview logic otherwise stays unchanged.

---

## 2. Additional discovery mechanisms, ranked

| # | Source | What it can establish | What it **cannot** establish | Value | Cost and risk | When |
|---|---|---|---|---|---|---|
| 1 | **Technology inventory** (structured form) | Which systems exist, per category; how data gets in and out (API / export / manual / unknown); who administers them | How well they're used; time lost | High for solution engineering (access requirements, feasibility) | Very low | **MVP** |
| 2 | **Case milestone data** (CSV in a fixed builda+ template) | Volumes by case type; **elapsed** days between milestones; drop-outs; seasonality | Active effort; *why* cases wait | Very high: the only route to High/Very-high confidence on volume and elapsed time | Medium (mapping, small-n statistics, pseudonymisation) | **Release 2** |
| 3 | **SOPs and procedure documents** | Intended process structure: tasks, owners, steps, checklists | Actual practice; time; volume | Medium: improves process maps; **divergence from interviews is itself a finding** | Medium (document extraction; client and staff names in examples) | **Release 2** |
| 4 | **Firm process maps / workflow descriptions** | Same as SOPs: intended structure | Same | Medium | Low–medium | Release 2 (same pipeline as SOPs) |
| 5 | **Operational spreadsheets** (trackers, pipeline sheets) | Depends on content: often volumes and statuses | Usually effort | Variable | High variance; often contain client data | Release 3, handled as #2 once a template fits |
| 6 | **Approved industry knowledge** | What commonly happens in brokerages | **Anything about this firm** | High for interview quality and hypotheses | Content effort (Capability A) | MVP (exists as mechanism) |
| 7 | **Public information** | Context: FCA register status (DA/AR, network, permissions), trading names, size signals, services offered, client-facing channels, hiring | Internal operations; any problem | Medium **as an entry point**: it powers the External Opportunity Assessment (§8) | Legal/ethical risk; personal data about named advisers on public registers | **MVP: assisted** (researcher supplies sources; builda+ extracts and verifies). Automated fetching in Release 2 |

**The key judgement:** case milestone data (#2) is the most valuable addition, because it upgrades
evidence quality where the business case needs it most (volume) and adds a dimension interviews
can't (elapsed time and waiting). Documents (#3–4) help with process *structure* but not with
quantification. Public information (#7) **opens the conversation and points discovery at the right
roles. It never diagnoses** (§8–§9).

---

## 3. Document and structured data ingestion

### 3.1 Common pipeline (Release 2)

```
upload ─► guard ─► segment ─► extract (LLM, structured) ─► verify (code) ─► attribute ─► evidence
```

1. **Upload** by the firm lead only, into the discovery workspace. File types: PDF, DOCX, XLSX, CSV.
   Size-limited and virus-scanned. Stored encrypted with a retention date.
2. **Guard (deterministic, before any LLM):**
   - the existing client-data patterns, applied to every segment;
   - **staff-name redaction**: names of the firm's participants and users (known from the
     discovery) plus titled-name patterns are replaced with role placeholders, extending the brief's
     "names never reach the AI" to documents;
   - a document with *definite* client data is **rejected whole** and the uploader is told why
     (brief §11: "uploads client files" → escalation). Example data in SOP templates is a common
     trap, so the message should say so.
3. **Segment:** by heading and paragraph for documents, by row for tables. Each segment gets a stable
   locator (page, heading path, row).
4. **Extract:** the LLM proposes structured items (tasks, steps, owners by role, systems, handoffs,
   stated rules) against the ontology's task list, each with a **verbatim excerpt**.
5. **Verify:** code checks that every excerpt exists in its segment (the generalised
   `quoteAppearsIn`). Unverified items are dropped and counted, exactly as interviews do today.
6. **Attribute:** each kept item records its source kind (`document`), document id, segment
   locator, provenance class (*Firm said: firm-provided document*) and **evidence nature:
   `intended_process`**.

### 3.2 Case milestone CSV (Release 2)

A fixed template rather than arbitrary mapping, to keep it simple and safe:

| Column | Rule |
|---|---|
| `case_ref` | Firm's own reference. **Hashed in the browser** (per-tenant salt) before upload. The raw reference never reaches builda+ |
| `case_type` | One of the ontology segment values |
| `enquiry_date`, `fact_find_date`, `submitted_date`, `offer_date`, `completion_date`, `withdrawn_date` | Dates only; blanks allowed |
| `handled_by_role` | Optional; a **role**, never a person |
| Free-text columns | Rejected |

Code computes **deterministic** metrics: volumes per month and case type; elapsed days between
milestones (median and IQR, with n); withdrawal rate. Rules: suppress any statistic with n < 10;
never label elapsed time as effort; show the figures with their period and n. The firm lead
**confirms** the upload ("this is a complete export of cases from Jan–Jun") before it's used. That
confirmation is what makes it an operational record.

### 3.3 Technology inventory (MVP)

An extension of the firm profile, with no AI:

```
for each system: name, category (ontology), stages used in, data in (API/export/manual/unknown),
                 data out (API/export/manual/unknown), administered by (role/vendor), notes
```

System names from interviews (today free text, e.g. "the CRM") are matched to inventory entries by
exact name or alias. Unmatched names are shown to the firm lead to confirm. This removes much of the
"three names for one system" problem without AI.

---

## 4. Evidence consolidation: one evidence model, several sources

### 4.1 Principle

Every source produces the same thing: **attributed evidence items** that point back to a verifiable
excerpt or record. Analysis doesn't care which pipeline produced an item, only about its
**provenance**, **nature** and **verification**.

### 4.2 Minimal model for Release 2 (extends what exists)

The existing `evidence_records` table already has `source` (`firm_said | operational_record |
measured_baseline | playbook | assumption`), `supporting_quote`, `session_id` and
`participant_pseudonym`. Extend it rather than rebuild it:

| Addition | Purpose |
|---|---|
| `source_kind` (`interview`, `firm_profile`, `tech_inventory`, `document`, `dataset`, `public`) | Which pipeline produced it |
| `source_ref_id` → a new `discovery_sources` table (uploaded document, dataset, inventory version), with a composite tenant FK | Traceability to the artefact |
| `locator jsonb` (turn index / page and heading / row range) | The exact place |
| `evidence_nature` (`reported_practice`, `intended_process`, `measured`, `context`) | What it can prove (§5.3) |
| `public_record` added to the `source` enum | The brief's three labels plus public |

This is deliberately the smallest change consistent with design-decisions' long-term **claims
layer**. Every column maps onto it later: `discovery_sources` → `sources`, `locator` → segment
plus span, item → claim. The later migration is mechanical. Building the full claims layer before
the pilots is not justified (see the backlog).

### 4.3 What feeds what

| Analysis input | Allowed sources |
|---|---|
| Pain point existence | Interviews (firm said), firm lead's validation |
| Volume | Interviews (stated), firm profile (stated), **case data (measured; preferred once confirmed)** |
| Active minutes per occurrence | Interviews (stated), firm lead correction (attested). **Never** elapsed time |
| Elapsed / waiting time | Case data (measured) only; interviews give labelled estimates |
| Process structure (tasks, owners, handoffs, systems) | Interviews, documents (intended), inventory, firm lead validation |
| Hypotheses | Playbook relevance rules, public context, AI suggestions: shown separately, never ranked |

---

## 5. Source attribution and confidence

### 5.1 Labels: the brief's three, plus one

The brief's labels stay the firm-facing vocabulary. The six provenance categories of the evolved
direction become **sub-labels**:

| Firm-facing label | Sub-label (provenance) | Examples | Can support a firm-specific finding? |
|---|---|---|---|
| **Firm said** | Employee-reported | Interview evidence | **Yes** |
| | Firm-provided | Profile, inventory, SOP, process map | Yes, for structure; **not** for time |
| | Operationally measured | Confirmed case data | **Yes**, strongest |
| | Validated by firm lead | Playback correction or validation | Yes (attested) |
| **Playbook** | Industry knowledge | Approved cards, checks, sources | **No.** Context and hypotheses only |
| **Public record** *(new)* | Publicly observable | FCA register, website | **No.** Context only |
| **Assumption** | AI hypothesis / conversion / interpretation | "21 working days a month"; AI's suggested cause; template reduction % | **No**, on its own. Always shown as needing confirmation |

### 5.2 Confidence ladder (the brief's, made source-aware)

| Level | Brief definition | Source-aware rule (deterministic) |
|---|---|---|
| Insufficient | — (code) | No firm-said account at all; playbook, public or assumption only |
| Low | A single participant's estimate | One participant (including the firm lead alone), **or** documents only, for structural claims |
| Medium | Multiple participants with consistent accounts | ≥ 2 participants within `CONSISTENCY_RATIO` |
| High | Multiple accounts supported by operational records | ≥ 2 consistent participants **and** confirmed case data consistent with their volume |
| Very high | Directly measured operational baseline | Confirmed case data for volume **and** a measured or time-studied effort baseline |

Rules:

- **Documents never raise confidence above Low on their own, and never for volume or time.** An SOP
  is not an operational record (product direction, difference D2).
- **Case data upgrades volume only.** Effort still comes from people, so High needs consistent
  people *and* records, which matches the brief.
- Confidence is computed by `assessConfidence` (extended), never by the LLM.

### 5.3 Evidence nature: what each item can prove

| Nature | Proves | Doesn't prove |
|---|---|---|
| `reported_practice` | What people say they do and how long it takes | Exact figures |
| `intended_process` | What the firm says *should* happen | That it happens |
| `measured` | Counts and elapsed times in the confirmed period | Effort; causes |
| `context` | Background (regulatory status, channels, size) | Any internal problem |

---

## 6. Conflicting evidence

Conflicts are information, not errors (brief §4 step 6). Rules, in order:

1. **Preserve both.** Nothing is overwritten or deleted, and disagreements are shown by role
   (existing behaviour).
2. **Look for variation first.** Most conflicts are different case types (purchase vs remortgage vs
   product transfer). Follow-up questions ask "what makes it quicker or slower" (existing wording).
   Where the participant states a segment, the evidence carries it.
3. **Intended vs reported.** A difference between an SOP and interviews becomes a **finding**
   ("documented process says X; three roles describe Y"). It's often the most useful insight for
   the firm lead.
4. **Measured vs stated, for volume.** Once the firm lead confirms a dataset, measured volume is used
   for scoring and the stated figures stay visible beside it. This is a deterministic,
   source-ranked rule, recorded on the opportunity's assumptions list.
5. **Effort disagreements** are resolved by follow-up or by firm-lead correction, with a reason
   (existing audited corrections). They're never resolved by AI.
6. **Confidence drops while a conflict is open** (existing `assessConfidence` behaviour).

## 7. Confidentiality across sources

- Participant names never reach the AI. This is extended to staff names in documents (§3.1).
- Role-level reporting follows the minimum-group-size decision (product direction §8, decision 2).
  Documents and datasets never reintroduce person-level detail: `handled_by_role` only, no user ids.
- No source produces per-person metrics. The CSV template has no person column, by design.

---

## 8. External intelligence discovery

The first of two entry points (see [first-commercial-mvp §2](first-commercial-mvp.md#2-the-two-entry-experiences)).
builda+ forms a preliminary view of a firm **without the firm taking part**, from public information
and approved industry knowledge. It is explicitly **not** operational discovery.

### 8.1 What can be learned publicly about a 10–30 adviser brokerage

| Public source | Typical signals | Operational relevance | Caveats |
|---|---|---|---|
| FCA Financial Services Register | DA vs appointed representative; principal/network; permissions (home finance, insurance distribution, consumer credit); trading names; status | **Network ARs often must use network-mandated systems and compliance processes.** That changes what can be automated and who must approve client communications | Facts are reliable, but the register lists individuals. Store firm-level facts only |
| Companies House | Age, accounts category, officers' roles, group structure | Size and maturity signals | Small-company accounts carry little operational data |
| Firm website | Services (purchase, remortgage, BTL, product transfer, later life, protection, commercial); channels (estate agents, new-build, introducers); client-journey technology (online fact find, upload portal, booking, chat); team page job titles | Case mix → which journeys dominate; channel → status-update load to third parties; client-facing tech → whether document collection is already digitised | Marketing claims aren't practice |
| Careers page / job adverts | Hiring case managers, administrators or paraplanners; systems named in requirements | Capacity pressure in admin roles; likely CRM or tools | Adverts go stale; a system named in an advert isn't necessarily the one in use |
| Approved knowledge release | Cards, relevance rules, regulatory checks | Turns signals into hypotheses | Industry-level only |

Excluded: review sites and social media (terms of use, reviewers' personal data, and client
sentiment can't be attributed to an operational cause), data brokers, anything behind a login.

### 8.2 Pipeline (fits the existing architecture)

```
prospect (JADA workspace) ─► sources (URL + retrieved_at + content hash, or researcher-entered fact + URL)
   ─► LLM signal extraction (schema: signal_type from knowledge release, value, verbatim excerpt)
   ─► code verification (excerpt ⊂ source text; unknown signal types rejected)
   ─► deterministic relevance rules (knowledge kind) ─► hypotheses (card, likely classification, rule shown)
   ─► deterministic assembly (fixed sentence templates) ─► JADA review/approve (audited)
   ─► share link (hashed, expiring token) + PDF
```

| Element | Reuses | New |
|---|---|---|
| Signal extraction | `LLMProvider.generateStructured`, zod schemas, budget ledger | Signal schema |
| Verification | `quoteAppearsIn` | — |
| Relevance rules, signal types | Knowledge items, four-eyes review, releases | Two knowledge kinds |
| Assembly and PDF | `buildReportModel` style, `pdf.ts` | Assessment model |
| Sharing | Invitation token hashing (`tokens.ts`) | Share-link table |
| Review | JADA review pattern, audit log | Approve/withdraw actions |

### 8.3 Where the data lives (tenancy)

An external assessment is **JADA's research about a business, not the business's data.** No tenant
is created for a firm that hasn't agreed to anything.

- Assessments live in a **JADA-internal organisation** ("JADA prospecting"). The existing RLS
  applies, and only JADA staff with a prospecting role have access.
- Each prospect is identified by FCA firm reference number and company number. **No individuals'
  names are stored.** Team-page information is reduced to role counts at extraction.
- When the firm signs up, a firm organisation is created and the assessment is **copied** into its
  first discovery, with provenance (`source_kind = public`, assessment id and version, retrieved
  dates). It's a copy, not a cross-tenant reference, which is consistent with tenant-scoped foreign
  keys (design-decisions R2).
- Prospect retention: deleted 12 months after the last activity if the firm doesn't engage, or
  immediately on request. Lawful basis: legitimate interests, with a documented assessment (MVP
  content item C4).

### 8.4 Who does the research

**MVP: assisted, not autonomous.** A JADA researcher chooses the sources (about 15 minutes), and
builda+ does extraction, verification, rule matching and assembly. This keeps quality high while the
signal types and rules are new, and it avoids building crawlers and API integrations before we know
which signals predict anything.

**Release 2: automated collection** from the FCA register and Companies House APIs and a bounded
website fetch (named page types only, robots.txt respected). The JADA review gate stays until the
hit rate (§9.4) is known.

---

## 9. Relationship between external intelligence and firm-verified evidence

### 9.1 One evidence ladder

| Rung | Source | Can it support a firm-specific finding? | Confidence contribution |
|---|---|---|---|
| 0. Industry knowledge | Approved playbook | No | None (hypotheses only) |
| 1. Public record | Register, Companies House, website, careers | No. It describes the environment, not operations | None (context only) |
| 2. Firm-provided | Profile, inventory, Snapshot corrections, documents | Yes, for structure (systems, roles, intended process) | Low, for structure only |
| 3. Employee-reported | Interviews (including the firm lead's) | **Yes** | Low (one) → Medium (≥ 2 consistent) |
| 4. Operationally measured | Confirmed case data | **Yes**, for volume and elapsed time | High / Very high, with rung 3 |

Rungs 0–1 are what entry **A** uses. Rungs 2–4 are entry **B**. The deterministic confidence code
(`assessConfidence`) already gives rungs 0–1 a rating of `insufficient`, and that must not change.

### 9.2 Hypothesis lifecycle

Every external hypothesis has an id. It follows the firm into its discovery, and code updates its
status:

| Status | Rule (deterministic) |
|---|---|
| `untested` | No firm evidence yet about the card's task or stage |
| `confirmed` | A firm-assisted pain point matches the card (same key, or task + problem type), with confidence ≥ Low |
| `not_supported` | Interviews covered the card's stage with **≥ 2 participants from the card's roles**, and none reported it. This means "not observed", never "absent" |
| `corrected` | The firm lead marked an underlying public fact wrong, or rejected the hypothesis with a reason (audited) |

A confirmed hypothesis becomes a finding **because of the firm's evidence**. The public signal stays
as context ("this was also suggested by…") and adds nothing to confidence, score or figures.

### 9.3 Presentation rules

- External items always appear in a section titled *"Common in firms like yours: not yet observed at
  your firm"* until they're confirmed.
- Confirmed findings show their firm evidence first. The external origin is a footnote.
- `not_supported` hypotheses are shown in the playback ("we expected X; your team didn't report it").
  This is useful to the firm, and it's honest about the method.

### 9.4 The learning loop

For each card and relevance rule, code tracks **hit rate** = confirmed ÷ (confirmed +
not_supported) across firms, as aggregate counts only, with no firm identities. Rules with low hit
rates are reviewed or retired through the normal knowledge review process. This is what makes
entry A more accurate over time, and it's the honest answer to "how do you know what firms like
mine need?"
