# Knowledge and solution readiness for a controlled first pilot

Status at 6 November 2026. Nothing in this document is approved knowledge, and no regulatory citation is
given or implied. Where a source is needed, it must be chosen, checked and recorded by the named reviewer
through the knowledge base, not taken from this document.

## 1. What exists today

| Item | State |
|---|---|
| Seed playbook `0.1.0-draft` (`src/knowledge/playbook.ts`) | 3 cards, all **owner unassigned, unreviewed**: document chasing (Documents, suggests automate), case status updates (Offer, suggests automate), application re-keying (Full application, suggests overhaul) |
| Regulatory checks | **None** |
| Sources | **None** |
| Approved knowledge releases | **None** |
| Solution templates (`src/knowledge/solutionTemplates.ts`) | `document_chasing_v1`: draft, untested. `outlook_follow_up_drafts_r2_1`: design reviewed (decision record A1–A6), untested, gated on the spike. Neither is production-ready |

### How the product treats knowledge (enforced in code and tested)
- Outside production, the unreviewed seed may be used, and every screen that relies on it says so
  (“Suggested by industry knowledge”; packs carry an “unreviewed playbook” open question).
- **In production, no discovery can start without an approved release** (`NoApprovedReleaseError`).
- **A release can't be published unless all of these hold:**
  - it contains at least one approved card;
  - **every regulated-judgement stage** (Fact find, Research and affordability, Recommendation and
    suitability letter, Protection advice) is covered by at least one approved regulatory check;
  - every check cites at least one approved source;
  - every citation resolves to an approved source.
- **Four eyes:** an item is approved only by a compliance reviewer who is not its author. Releases are
  published by a knowledge editor.

**Consequence:** a pilot restricted to non-regulated stages **still needs four approved regulatory checks**
before production will start its discovery. That's deliberate: the interviews can't stop people talking
about regulated stages, so the product must know how to hold what they raise.

## 2. Minimum content for the first pilot, by category

### A. General mortgage operational knowledge (playbook cards)
- **Purpose:** interview prompts, signs to listen for, the likely classification, metrics to collect and
  human-approval patterns for common operational problems.
- **Minimum for the pilot:** reviewed cards for the non-regulated stages in scope: enquiry, documents,
  decision in principle, full application, valuation and underwriting, offer, completion. Start with the 3
  existing drafts (reviewed and corrected), and add cards only where the reviewer has direct operational
  experience.
- **Source requirements:** a card may rest on practitioner experience. It must say so, in its owner field
  and content, rather than cite a document. Any external source cited must be recorded as a source item
  and approved first.
- **Review requirements:**
  - a named owner with UK mortgage brokerage operations experience;
  - approval by a compliance reviewer who is not the author;
  - the card's `regulatoryLimits` must never describe a regulated activity as automatable.

### B. Regulatory and compliance-sensitive knowledge (checks and sources)
- **Purpose:**
  - tell builda+ what must happen when a finding touches a regulated stage;
  - attach the required action to any opportunity there.
- **Minimum for the pilot:** one conservative check for each of the four regulated stages. Its effect is a
  hold: builda+ recommends no change to the regulated judgement itself; any change may only prepare
  information for the adviser; and the opportunity must be referred to a qualified compliance reviewer.
  This matches what the product already does through its compliance-review gate.
- **Source requirements:** each check must cite a primary source chosen and verified by the compliance
  reviewer, recorded as a source item with its publisher, reference, the sections relied on and the date
  checked. **This document deliberately names none.**
- **Review requirements:**
  - author: a knowledge editor;
  - approver: a qualified compliance reviewer (not the author);
  - reviewed again whenever the cited source changes, and at least before each pilot;
  - no wording may imply FCA approval or endorsement.

### C. Firm-specific information
- **Purpose:** the context for one firm's discovery: profile, technology inventory, and what its people
  say.
- **Minimum:**
  - a completed firm profile, including authorisation status (directly authorised or appointed
    representative; an AR's network rules may affect client communications);
  - a technology inventory;
  - 6–10 completed interviews across at least advisers, case managers and administrators.
- **Source requirements:** the firm itself. Figures given by staff are labelled employee-reported; figures
  entered by the firm lead are firm-provided. No client case data is collected.
- **Review requirements:**
  - the firm lead validates or disputes each finding and each evidence item;
  - nothing becomes a priority without that validation;
  - this is not reusable knowledge: it never enters the playbook except as anonymised, multi-firm
    "candidates" (at least two firms, no identifiers), which then go through category A review.

### D. Solution implementation knowledge (templates)
- **Purpose:** reviewed reference designs that engineering starts from.
- **Minimum for the pilot:**
  - **None is required for Fix and Overhaul.** Those go to custom engineering review by design.
  - For any automation: `document_chasing_v1` needs a recorded JADA design review, and its test cases run
    on dummy data, before it is offered.
  - The two-week build stays unavailable until a template is tested in a delivered implementation.
- **Source requirements:** JADA engineering, changed through code review, with the version, approval
  (who and when) and validation status updated in the template.
- **Review requirements:**
  - design review by a JADA engineer other than the author;
  - a regulatory-limits review by a compliance reviewer where the template touches client
    communications;
  - "tested" set only after a delivered implementation has passed its acceptance criteria.

## 3. Can Fix and Overhaul discovery be shown without unapproved regulatory knowledge?

**In the demonstration: yes.** The Fix and Overhaul findings in the demo are at non-regulated stages
(enquiry, decision in principle, full application). They draw on no regulatory check, because none
exists and none applies at those stages. Their classifications were set by the synthetic firm lead and
are labelled that way. The draft playbook still shapes the interview content and suggests two automate
classifications, and every screen labels that as unreviewed industry knowledge. Engineering for Fix and
Overhaul uses custom review, not a template.

**In a pilot with a real firm: not yet.** A production discovery can't start without an approved release,
and no release can be published without approved checks for the four regulated stages, each citing an
approved source (section 1). The minimum route is category A (reviewed operational cards for the stages
in scope) plus category B (four conservative hold checks with reviewer-verified sources).

## 4. Readiness checklist (all must be true before the pilot discovery starts)

- [ ] Named knowledge editor and two compliance reviewers (four-eyes) assigned in `jada_staff_roles`.
- [ ] Reviewed operational cards for each non-regulated stage in scope, each with a named owner.
- [ ] Four approved regulatory checks (one per regulated stage), each citing an approved, reviewer-verified source.
- [ ] Release published from the knowledge base; the preview shows no errors.
- [ ] `document_chasing_v1` has a recorded design review, or automation is excluded from the pilot.
- [ ] Outlook template excluded (spike not run).
- [ ] No content anywhere implies FCA approval, and no citation appears that a reviewer hasn't verified.
