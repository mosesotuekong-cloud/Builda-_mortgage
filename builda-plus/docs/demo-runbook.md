# builda+ demonstration runbook

A ~20-minute story for a mortgage brokerage: **what a builda+ discovery gives you. Your own people's
account of where time is lost, evidence you can check, opportunities classified before anything is
recommended, and a report your partners can act on.**

What we sell first is the discovery itself. Implementation by JADA is a separate, later conversation.

Everything shown is the working application. The firm, people, quotes and figures are **synthetic**.

---

## Before the meeting (10 minutes)

1. **Fresh data.** The live steps change state, so reset before every audience (local database on port 5433):

   ```bash
   dropdb -h localhost -p 5433 -U postgres builda_demo && createdb -h localhost -p 5433 -U postgres builda_demo
   ```

   ```bash
   DATABASE_ADMIN_URL=postgres://postgres@localhost:5433/builda_demo DATABASE_URL=postgres://builda_app:<password>@localhost:5433/builda_demo npx tsx scripts/migrate.ts
   ```

   ```bash
   DATABASE_ADMIN_URL=postgres://postgres@localhost:5433/builda_demo DATABASE_URL=postgres://builda_app:<password>@localhost:5433/builda_demo DEMO_SEED=yes APP_BASE_URL=http://localhost:3003 npx tsx scripts/demo-seed.ts
   ```

2. **Start the app** against `builda_demo`. In this repo:
   - `builda-plus-demo-ai` (port 3003): Plus, the in-app guide, answers with AI using the key in `.env`.
   - `builda-plus-demo` (port 3002): the AI is switched off, and Plus answers from its written help.

   Engineering, implementation and impact are parked (`LATER_STAGES` is off), so they don't appear.
3. **One browser window.** Sign in at `/signin` as **Demo Firm Lead (synthetic)** before the audience
   arrives (the sign-in page says it's a password-free demo). Open `/app/opportunities` in a second tab.
4. **Screen width:** present full-width (1280 px or wider). Narrower windows wrap the priority table.

## The scenario (say this first, 1 minute)

> “builda+ helps a mortgage firm see where time is lost across its operation, using independent
> interviews with the people who do the work. It turns what they say into evidence, shows where people
> disagree, and classifies each opportunity (fix it, redesign it, automate it, or keep it with people)
> before anything is recommended. You get a report your partners can act on.
>
> What you're about to see is the real application running on a **synthetic** firm: about 15 advisers,
> 6 case managers and 3 administrators. The firm, the people, the quotes and the numbers are all invented.
> Nothing here is a real result, and I'll point out where something hasn't been measured.”

---

## The story: 6 moments

### 1. Your operation, from the people who run it (2 minutes)
**Discovery → Interviews, then the Journey tab.**

- **Show:** 9 interviews, by role (firm lead, advisers, case managers, administrators). Then the journey
  stages, with findings on Documents, Enquiry, Decision in principle, Full application and Offer.
- **Say:** “Each person had a 20–30 minute interview about their own work, on their phone or computer.
  We look at how work moves through the firm, never at individual performance, and no client files are involved.”
- **Ask:** *“Where do you think your cases lose the most time today?”* (Note the answer; you'll come back to it.)

### 2. Evidence, and where people disagree (4 minutes)
**Discovery → Evidence**, then **Findings → “Handing a case to the case team”**.

- **Show on Evidence:** every item says where it came from (employee-reported, or the “Measured” CRM report
  the firm lead supplied) and how confident we are. Case-manager and administrator quotes are withheld,
  because fewer than three people hold each of those roles.
- **Say:** “If a role only has two people, a quote could identify them, so we don't show it.”
- **Show on the finding:** “Different perspectives”. The adviser says a handover takes about 10 minutes;
  the case manager says about 45.
- **Say:** “We don't average that away. The difference *is* the finding: the cost lands on the case team.”
- **Ask:** *“Would your advisers and case managers describe your handovers the same way?”*

### 3. Opportunities, classified before anything is recommended (4 minutes)
**Second tab → Opportunities.**

- **Show:** the classification chips, the priority table and the “Not prioritised” list.
- **Say, using the examples on screen:**
  - **Automate: “Manual chasing of outstanding client documents.”** Repetitive, structured work. Four people
    describe it the same way, and the CRM report backs it up.
  - **Fix: “Merging duplicate enquiry records.”** A CRM setting creates the duplicates. No new tool needed.
  - **Overhaul: “Handing a case to the case team.”** The process itself is the problem; automating it
    would only speed up the wrong thing.
  - **Keep human:** advice and suitability stay with your advisers. *(Don't open the regulated items; one
    sentence is enough.)*
- **“Hours recovered: Unknown”** on most rows. **Say:** “We only estimate what a change would recover
  where there's a basis for it; otherwise we don't guess.”
- **Point at “Logging back in to lender portals”:** “It ranks high because it's an easy fix, but only one
  person mentioned it. Priority and evidence are kept separate.” It ties with “Merging duplicate enquiry
  records” on 48; refer to both by name, not rank.

### 4. What it's worth, honestly (3 minutes)
**Open “Manual chasing of outstanding client documents” → Business case.**

- **Time recovered:** 40 staff hours a month spent; about 20 could be recovered. The 40 is from your staff
  (120 a month × 20 minutes, the middle of four accounts); the 20 rests on a **planning assumption** (point
  at the row labelled **Assumption** under “Inputs and where each came from”).
- The £560 under it is that time at the firm's stated hourly cost. **Say: “that's an indication of scale,
  not a saving. You only save money if you stop spending it.”**
- **Cash savings:** none stated. **Capacity:** about 3 more cases a month. **Revenue:** not estimated.
  **Payback:** not calculated.
- **Ask:** *“If your team got 20 hours a month back, would that go on more cases, better service, or fewer hours?”*

### 5. You decide what matters (2 minutes)
**Back to Opportunities → “Manual progress updates to clients, introducers and solicitors” → Review and approval.**

- **Live:** type a short reason (optional), then click **Approve**. The page reloads; its status reads **Approved**.
- **Say:** “Nothing goes forward on our say-so. You approve, challenge or reject each one, with a reason,
  and every decision is recorded.”
- **Ask:** *“Who in your firm would make this call?”*

### 6. The report (3 minutes)
**Overview.**

- **Show:** the recommended next action now reads **Discovery complete** (4 opportunities approved). Click
  **Go to the report**, then **Create and download report (PDF)**.
- **Open the PDF** and page through: the findings, the evidence and confidence behind each, the
  disagreements, the classifications and priorities, and the figures with their sources.
- **Say:** “Each report is a fixed, numbered version: the baseline for checking later whether a change
  actually helped. Quotes from small roles are left out.”

**Optional (1 minute, on port 3003):** open **Plus**, the green guide in the corner, and ask *“What should
I do next?”*. It answers from builda+'s own help and can take you to the right page.

---

## Closing: what a discovery involves (2 minutes)

> “A discovery looks like this:
> 1. A short conversation about how your firm works.
> 2. Independent interviews with 6 to 10 of your people over two to three weeks, 20–30 minutes each, on their
>    phone or computer.
> 3. You review the findings and the evidence, correct anything that's wrong, and decide what matters.
> 4. You get the report, with the opportunities prioritised and every figure sourced.
>
> If you then want help making the changes, JADA can scope that separately, starting with fixes and process
> changes. Nothing you've seen today touches client files or your email.”

Then ask the five questions below. **Don't quote prices or timescales**: neither has been set.

---

## Commercial validation: five questions

1. **Recognition:** “Which of the problems we showed exist in your firm today, and which one costs you most?”
2. **Trust:** “Would you trust findings built this way, from your own people's accounts with the evidence and
   disagreements visible, enough to act on them? What would you need to see?”
3. **Willingness to pay:** “If this showed you where your operation loses time, would that be worth paying for
   on its own? Roughly what would you compare it to?”
4. **Staff time:** “Could you give 6 to 10 people half an hour each over a couple of weeks? Who would they be?”
5. **Barriers:** “What would stop you going ahead: staff time, data concerns, your network, timing, something else?”

Write the answers down word for word. They are the evidence for the next decision.

---

## Honesty: what to claim and what not to

| Category | What it covers |
|---|---|
| **Works today** | Interviews, the discovery workspace, evidence and confidence, disagreements, classification and prioritisation, the business case, approvals with reasons, the PDF report, firm isolation |
| **Illustrative synthetic data** | The firm, every person, quote and figure, the CRM report, the £28 hourly cost and hours per case |
| **Not measured** | No change has been made or measured. No saving, capacity gain or payback has been demonstrated |
| **Not ready for a real firm yet** | Sign-in (demo push-button only), automatic data deletion, and reviewed mortgage knowledge (draft). These are needed before a real firm's staff are interviewed (`docs/archive/pilot-remediation-spec.md`) |

**Never say:** FCA-approved, compliant, proven, guaranteed savings, or “our AI found”.

**If asked about AI:** “In a real discovery, AI conducts the interviews and proposes a classification, quoting
what people said. Your firm lead confirms or corrects it. Calculations, scoring and the rules are ordinary
deterministic software.” In this demo every classification was set or confirmed by the synthetic firm lead
(shown as “Set by firm lead”). The only AI running is Plus on port 3003, which words answers from builda+'s
own help.

---

## Data reference (for the presenter)

| Opportunity | Class | Use in the story | State after seeding |
|---|---|---|---|
| Manual chasing of outstanding client documents | Automate | Moments 3, 4 | Approved |
| Merging duplicate enquiry records | Fix | Moment 3 | Approved |
| Handing a case to the case team | Overhaul | Moments 2, 3 | Approved |
| Manual progress updates to clients, introducers and solicitors | Automate | Moment 5 (live approve) | Ready for the firm's decision |
| Logging back in to lender portals | Fix (one account) | Moment 3 (single-account explanation) | Ready for the firm's decision |
| Re-keying fact-find notes into the CRM | Automate at a regulated stage | **Don't open** | Held for compliance review |
| Writing suitability letters | Keep human (regulated) | **Don't open**; one sentence in moment 3 | Not ranked |

**Removing test firms** (test and demo databases only, cannot be undone): `npm run delete-firm` lists the
firms; add the exact name to see what would be removed; add `--yes` to delete it. It uses `DATABASE_ADMIN_URL`.

The engineering, implementation and impact screens still exist, parked: start the app and run the seed with
`LATER_STAGES=on` to bring them back.
