# builda+ — first commercial MVP

> **Partly superseded by [decision-record](decision-record.md).** External assessments are manual
> first (D2), so §3.1–3.2's assisted software is deferred. The first build is Outlook follow-up drafts
> (D3), and the first offer is as defined in D11 (case-study participation optional).

Status: strategy proposal, **revision 2** (dual entry). Part of the
[product direction](builda-product-direction.md).

Changes from revision 1:
- adds the **external intelligence pathway** (entry A) alongside firm-assisted discovery (entry B);
- compares the two and recommends how they combine;
- makes the **tested document-chasing template** a named commercial deliverable;
- revises the build list and exclusions.

---

## 1. The commercial result we are designing for

> **A UK brokerage with 10–30 advisers moves from first contact to a signed JADA implementation,
> on evidence it recognises, with little JADA effort per firm, in a way JADA can repeat.**

Three things to optimise, in this order:

1. **Credibility.** Nothing the firm sees is wrong, overstated, or presented as verified when it
   isn't.
2. **Implementation revenue.** A confirmed build, which needs firm-specific evidence, access, and a
   tested template.
3. **Repeatability.** Low marginal cost per firm, so JADA can run many opportunities in parallel.

Pilot success measures:

| Measure | Target for the first 3–5 pilot firms |
|---|---|
| External assessment claims later contradicted by the firm as factually wrong (public facts) | 0 |
| External hypotheses confirmed by firm-assisted discovery (hit rate, tracked per card) | Measured; no target yet. It's the key learning metric |
| Firms that review an external assessment and then start a Firm Snapshot | Measured; aim ≥ 25% of warm prospects |
| Participants complete interviews without assistance | ≥ 80% of invited staff |
| Firm lead validates the top-three findings without major correction | ≥ 2 of 3 per firm |
| Invented measurements found in review | 0 |
| JADA engineer can quote from the pack without repeating discovery | Yes, in every pilot |
| Discovery converts to a signed implementation (build or fix sprint) | ≥ 1 of the first 3 pilots |
| JADA hours per firm: external assessment / full discovery (excl. build) | ≤ 1 h / ≤ 4 h |

---

## 2. The two entry experiences

### A. External intelligence assessment (no firm participation)

builda+ researches a firm from **public information** (FCA register, Companies House, the firm's
own website, careers pages) and the **approved mortgage knowledge release**. It produces an
**External Opportunity Assessment**:

- what we observed publicly, each fact with source and date;
- what that suggests about the firm's operating environment (business mix, channels, network or DA
  status, client-facing technology, growth signals);
- **opportunity hypotheses**: where firms with these characteristics commonly lose time, with the
  likely classification (fix / overhaul / automate / keep human);
- for each hypothesis, exactly what firm evidence would confirm or rule it out.

A JADA reviewer approves every assessment before anyone outside JADA sees it.
Details: [multi-source-discovery §8](multi-source-discovery.md#8-external-intelligence-discovery).

### B. Firm-assisted operational discovery

The firm lead completes the profile and technology inventory and does their own interview
(the **Firm Snapshot**). Staff then do the existing role-based interviews, and optionally upload
documents and case data. builda+ produces validated findings, business cases and an implementation
pack (most of this exists today).

### Comparison

| Criterion | A. External assessment | B. Firm-assisted discovery |
|---|---|---|
| Firm effort before value | **None** | About 30 min for the firm lead, then 3–5 × 25 min of staff time |
| What it can truthfully say | What is publicly observable, and what is *common* for firms like this | What actually happens in *this* firm, with confidence levels |
| Credibility risk | **High if overstated**; low if framed and reviewed properly | Low (evidence-backed, firm validates) |
| Can it produce a build decision? | **No.** The two-week gates need firm-specific workflow evidence, access, and the firm's approval | **Yes** |
| Financial figures | **None** (no firm volumes or times) | Yes, from firm-said or measured inputs |
| Time to implementation revenue | Indirect: only by converting into B | **Direct** |
| Marginal cost per firm | Low (about an hour of JADA review once the tooling exists) | Medium (firm and staff time; about 4 h of JADA time) |
| Repeatability | **High.** It's the top of the funnel, and it scales with the number of prospects | Medium. Limited by firm willingness and staff time |
| Differentiation | Moderate. A generic "AI opportunities" letter is common; a well-cited, honest one is less common | High: cross-role evidence is hard to get elsewhere |
| Existing code reuse | Knowledge release, deterministic report assembly, PDF, LLM extraction with quote verification, audit. New: prospect workspace, public-signal capture, relevance rules | About 90% exists |
| Legal / ethical exposure | Public-data processing (UK GDPR applies to named individuals on registers and team pages); website terms; PECR for outreach to sole traders and partnerships | Existing consent model |

### Verdict

- **Shortest credible path to implementation revenue: B.** Only firm-assisted discovery can produce
  a confirmed, quotable build, and it's largely built.
- **Shortest path to a repeatable pipeline: A.** It costs the firm nothing, it's cheap per firm, and
  it gives a concrete reason to start B.
- **A alone is not a product.** It must never be sold or presented as an operational assessment.
  Its commercial job is to earn the 30-minute Firm Snapshot.
- **B alone has a cold-start problem.** Asking an MD for staff time before showing anything costs
  conversions.

**Recommended entry strategy: "A opens, B proves, JADA builds."**

```
External Opportunity Assessment (A) ── reviewed by JADA ──► shared with the firm (read-only link)
        │  "Is this right? Confirm or correct in 30 minutes"
        ▼
Firm Snapshot (B1): profile + technology inventory + firm lead's interview
        │  each external hypothesis → confirmed / not supported / corrected / untested
        ▼
Rapid Discovery (B2): 3–5 staff interviews (+ optional documents, case data later)
        ▼
Playback → report → approval → JADA engineering review → build proposal (two-week template build,
reference-solution build, or fix sprint)
```

Firms can also enter at B directly (warm referrals, network introductions). A is an accelerator, not
a prerequisite. That's why the **first pilots should start at B**, through warm relationships, while
A is built and tested on the side. Running pilots shouldn't wait for A.

---

## 3. Revised MVP

### 3.1 Scope

| Component | Status | In MVP |
|---|---|---|
| Firm-assisted discovery end to end (existing pipeline, production-safe) | ~90% exists | **Yes, core** |
| Firm Snapshot (profile + technology inventory + firm lead's interview + hypothesis view) | New, small | **Yes** |
| External Opportunity Assessment, **assisted** (JADA researcher supplies sources; builda+ extracts, verifies and assembles; JADA approves) | New, small–medium | **Yes, lean** |
| Linking external hypotheses into a firm's discovery | New, small | **Yes** |
| Tested document-chasing template (Tier B/C; see the solution engineering document) | JADA engineering | **Yes: priority commercial deliverable** |
| Engineering estimate → payback; success measures and adoption criterion at approval | New, small | Yes (estimate in the 30 days; measures before the first proposal) |
| Automated public-source fetching (register and Companies House APIs, crawling) | — | No: Release 2 |
| Review-site analysis (Google, Trustpilot) | — | No: terms-of-use and personal-data risk; revisit later |
| Document upload, case milestone CSV | — | No: Release 2 |

### 3.2 External Opportunity Assessment (lean MVP version)

**Sources allowed in the MVP:**

| Source | How obtained | What it gives |
|---|---|---|
| FCA Financial Services Register | JADA researcher enters the firm reference number and the facts shown, with URL and date. API lookup in Release 2 | DA or AR, principal/network, permissions (e.g. home finance, insurance distribution), trading names, status |
| Companies House | Researcher enters company number and facts, with URL and date | Incorporation date, accounts category, officers' *roles* (not names) |
| Firm website (home, services, about/team, contact, careers) | Researcher supplies URLs; builda+ fetches the pages (respecting robots.txt) or the researcher pastes the text | Services and specialisms (purchase, remortgage, BTL, later life, protection, commercial), channels (introducers, estate agents, new-build), client journey technology (online fact find, document upload portal, booking, chat), team size and roles by job title, hiring |
| Job adverts on the firm's own careers page | As above | Hiring for case managers or administrators (capacity signal), systems named in requirements |

**Not in the MVP:** review sites, social media, third-party data brokers, anything behind a login,
anything about named individuals beyond what is needed to count roles (names are never stored).

**How it's produced:**

1. The **LLM extracts structured public signals** from page text: a schema-validated list of
   `{signal type, value, verbatim excerpt}`. Signal types come from the knowledge release (e.g.
   `offers_protection`, `uses_online_document_upload`, `introducer_channel_estate_agents`,
   `hiring_case_manager`, `network_ar`).
2. **Code verifies** every excerpt against the fetched or pasted text (the existing `quoteAppearsIn`).
   Unverified signals are dropped.
3. **Deterministic relevance rules** (a reviewed knowledge kind) map signals to playbook cards:
   "`hiring_case_manager` + `introducer_channel` → document chasing and status updates commonly
   heavy".
4. **The assessment is assembled by code** from fixed sentence templates. There's no free LLM prose
   in the firm-facing output, so its wording can't drift into claims.
5. **A JADA reviewer approves it.** The reviewer can remove signals or hypotheses, but can't add
   unsourced claims. Everything is audited.
6. It's shared as a read-only link (a hashed, expiring token, as with invitations), plus a PDF.

**Wording rules** (enforced by the templates):

- Observations: "*Your website states …* (source, date)". Never "you have".
- Hypotheses: "*Firms that [signal] commonly spend significant time on [card]. We have not
  observed this at your firm.*"
- No figures, no £, no "you could save". The only numeric section is an optional **"try your own
  numbers"** calculator, where the firm types its own volume and minutes. Those numbers are then
  *firm said*, labelled as such, and computed by the existing impact code.
- Every hypothesis shows its likely classification, including *fix* and *keep human*. Brief §3.1
  applies here too: no "AI opportunity" without the fix-first check.

### 3.3 The Firm Snapshot (revised)

As in revision 1 (profile, technology inventory, firm lead's interview, three-section hypothesis
view), plus: **if an external assessment exists, the Snapshot starts from it.** Each external
observation can be confirmed or corrected (which makes it *firm said*), and each external hypothesis
is shown beside whatever the firm lead's own answers indicate. The firm lead's corrections are
audited, like playback corrections.

### 3.4 User experience

| Step | Who | What | Code status |
|---|---|---|---|
| 0 | JADA researcher | Creates a prospect, enters or fetches sources, reviews extracted signals, approves the assessment, shares the link | **New** |
| 1 | Firm lead | Reads the external assessment (no account needed); corrects facts; clicks "Confirm in 30 minutes" | **New** |
| 2 | Firm lead | Signs up (production identity), which creates a firm workspace; the assessment is *copied in* with its provenance | Sign-up **new**; workspace exists |
| 3 | Firm lead | Firm Snapshot | Partly exists |
| 4 | Firm lead | Invites the recommended roles (email) | Invite exists; email **new** |
| 5 | Staff | Consent, interview, follow-up | Exists |
| 6 | Firm lead | Analyse, playback, validate, report, approve | Exists |
| 7 | JADA engineer | Review pack, estimate, confirm → build proposal | Review exists; estimate **new** |

---

## 4. Required capabilities

### Already built (reused)

The interview orchestrator, guards, escalation, consent, invitations, firm profile, consolidation,
follow-ups, confidence, classification, scoring, impact, playback and corrections, report and PDF,
approvals, pack builder, JADA review, knowledge tooling and releases, the LLM provider with
quote-verified structured extraction, the AI budget, RLS and the audit log.

### To build (engineering)

| # | Capability | Size |
|---|---|---|
| 1 | Production identity and memberships; demo sign-in behind a flag | M |
| 2 | Phase 0 security (signed context, definer rewrites, composite FKs, RLS functions, tests) | M–L |
| 3 | Email (invitations, reminders) | S |
| 4 | Retention job | S |
| 5 | Analysis fixes (stale pain points, persisted merges, config by version, `turn_index`, insufficient-evidence escalation) | S |
| 6 | **Prospect workspace and External Opportunity Assessment** (sources, signal extraction + verification, relevance rules, deterministic assembly, review/approve, share link, PDF) | M |
| 7 | Firm Snapshot + technology inventory + importing external hypotheses | S–M |
| 8 | Engineering estimate → payback | S |
| 9 | Minimum-group-size handling; as-you-type client-data warning | S |
| 10 | Success measures and adoption criterion at approval | S (before the first build proposal) |

### To build (content and engineering outside the app): the critical path

| # | Item | Owner |
|---|---|---|
| C1 | 15–20 reviewed cards, plus **public signal types and relevance rules** | SME + JADA |
| C2 | Approved regulatory checks for all regulated stages, plus sources | Compliance reviewer |
| C3 | **Document-chasing template, Tiers C and B, tested** | JADA engineering |
| C4 | Privacy framework; DPIA for discovery; **legitimate-interests assessment for external research**; LLM provider terms | DP lead |
| C5 | **Template DPA and DPIA pack for implementations** (JADA as processor of client data in the firm's automation) | DP lead + JADA |
| C6 | Outreach rules: PECR (sole traders and partnerships need consent for email marketing), tone guide | Business + DP lead |

---

## 5. Explicit exclusions

| Excluded | Reason | Revisit |
|---|---|---|
| Presenting any external hypothesis as a finding, ranking it, or attaching figures to it | Core principle | Never |
| Sending an external assessment without JADA review | Reputational risk; it's a claim about a named business | After the hit rate is known and stable (≥ 20 assessments) |
| Automated crawling beyond named pages; review sites; social media | Terms, personal data, low signal | Release 2+ |
| Storing names of individuals from public sources | Data minimisation | Never needed |
| Document upload, case CSV | Release 2 (multi-source evidence) | After pilots |
| CRM-specific integration adapters for the template (Tier A) | Built per CRM when a customer needs it | Per customer |
| Operating model, claims layer, org-level problems, networks | Long-term architecture | After pilots |
| Generated code or architectures; automation execution inside builda+ | Brief exclusion; the template runtime is separate from builda+ | No change |
| Advice, suitability or lending decisions; client files in discovery | Permanent | Never |

---

## 6. How discovery converts into JADA implementation work

1. **External assessment → Snapshot:** the call to action is to confirm or correct, not to buy.
2. **Snapshot → interviews:** hypotheses tell the firm lead *which roles* to invite.
3. **Interviews → validated findings**, with confidence and cross-role evidence.
4. **Approval → solution route**, chosen deterministically:
   - **template build** (two-week): a tested template exists and the gates pass;
   - **reference-solution build** (scoped, not two-week): a reusable pattern exists but no tested
     template;
   - **bespoke engagement**: an engineer designs it from the engineering brief;
   - **fix sprint**: the finding is *fix* or *overhaul*.
5. **Engineering review → proposal** with scope, cost, payback, success measures and an adoption
   criterion.
6. **Each external hypothesis's fate** (confirmed / not supported / untested) is recorded, so the
   relevance rules get better and A gets more accurate with every firm. This is what makes the
   method repeatable.
