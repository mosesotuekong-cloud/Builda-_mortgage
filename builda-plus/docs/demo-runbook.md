# builda+ demonstration runbook

A ~20-minute story for a UK mortgage brokerage: **how builda+ moves from understanding your operation, to
evidence-backed opportunities, to engineering work JADA can act on, to outcomes that are actually measured.**

Everything shown is the working application. The firm, people, quotes and figures are **synthetic**.

---

## Before the meeting (15 minutes)

1. **Fresh data.** The live steps change state, so reset before every audience:

   ```bash
   dropdb builda_demo && createdb builda_demo
   ```

   ```bash
   DATABASE_ADMIN_URL=postgres://postgres@localhost/builda_demo DATABASE_URL=postgres://builda_app:<password>@localhost/builda_demo npx tsx scripts/migrate.ts
   ```

   ```bash
   DATABASE_ADMIN_URL=postgres://postgres@localhost/builda_demo DATABASE_URL=postgres://builda_app:<password>@localhost/builda_demo DEMO_SEED=yes APP_BASE_URL=http://localhost:3002 npx tsx scripts/demo-seed.ts
   ```

   Start the app against `builda_demo` (in this repo: the `builda-plus-demo` launch configuration, port 3002;
   the AI is pointed at an unreachable address, so nothing leaves the machine).
2. **Two browser windows,** because the two roles can't share one browser session. Signing in as one signs
   the other out.
   - **Window 1 (firm):** sign in at `/signin` as **Demo Firm Lead (synthetic)**. Open
     `/app/opportunities` in a second tab.
   - **Window 2 (JADA, private or another browser):** sign in as **Demo Engineer (synthetic)** and leave it
     on `/jada/engineering`.
   - Sign in before the audience arrives: the sign-in page says it is a password-free demo.
3. **Screen width:** present on a full-width window (1280 px or wider). Narrower windows wrap the tables,
   cut off the last column and crowd the confidence labels. Zoom to 110% only if the screen is wide enough
   that the priority table still fits.

## The scenario (say this first, 1 minute)

> “builda+ helps a mortgage firm see where time is lost across its operation, using independent
> interviews with the people who do the work. It turns what they say into evidence-backed opportunities,
> classifies each one (fix it, redesign it, automate it, or keep it with people) and hands the approved
> ones to JADA as engineering work. Afterwards it checks whether the change delivered what was agreed.
>
> What you're about to see is the real application running on a **synthetic** firm: about 15 advisers,
> 6 case managers and 3 administrators. The firm, the people, the quotes and the numbers are all invented
> for this demonstration. Nothing here is a real result, and I'll point out where something hasn't been
> measured.”

---

## The story: 6 moments, 9 screens

### 1. Your operation, from the people who run it (2 minutes)
**Window 1 → Discovery → Interviews, then the Journey tab.**

- **Show:** 9 interviews, by role (firm lead, advisers, case managers, administrators). Then the journey
  stages, with findings on Documents, Enquiry, Decision in principle, Full application and Offer.
- **Say:** “Each person had a 20–30 minute interview about their own work. We look at how work moves
  through the firm, never at individual performance, and no client files are involved.”
- **Business value:** leadership sees the operation as the people doing it see it, not as it is supposed
  to work.
- **Ask the audience:** *“Where do you think your cases lose the most time today?”* (Note the answer:
  you'll come back to it.)

### 2. Evidence, and where people disagree (4 minutes)
**Discovery → Evidence**, then **Findings → “Handing a case to the case team”**.

- **Show on Evidence:**
  - every item says where it came from (employee-reported, or the “Measured” CRM report the firm lead
    supplied) and how confident we are;
  - case-manager and administrator quotes are withheld, because fewer than three people hold each of
    those roles.
- **Say:** “If a role only has two people, a quote could identify them, so we don't show it. Advisers'
  quotes are shown because four advisers contributed.”
- **Show on the finding:** “Different perspectives”. The adviser says a handover takes about 10 minutes;
  the case manager says about 45.
- **Say:** “We don't average that away. The difference *is* the finding: the adviser thinks the handover
  is quick because the cost lands on the case team. It lowers our confidence in the time figure until
  you've looked at it.”
- **Business value:** decisions rest on evidence the firm can inspect and challenge, including the
  uncertainty.
- **Ask:** *“Would your advisers and case managers describe your handovers the same way?”*

### 3. Opportunities, classified before anything is recommended (4 minutes)
**Window 1, second tab → Opportunities.**

- **Show:** the classification chips, the priority table and the “Not prioritised” list.
- **Say, using the examples on screen:**
  - **Automate — “Manual chasing of outstanding client documents.”** Repetitive, structured work. Four
    people describe it the same way, and the CRM report backs it up.
  - **Fix — “Merging duplicate enquiry records.”** A CRM setting creates the duplicates. No new tool is
    needed, just set it up properly.
  - **Overhaul — “Handing a case to the case team.”** The process itself is the problem. Automating it
    would only speed up the wrong thing.
  - **Keep human:** advice and suitability stay with your advisers. builda+ doesn't change regulated
    judgement; anything raised there is held, which is why those items aren't ranked. *(Don't open the
    regulated items; one sentence is enough.)*
- **“Hours recovered: Unknown”** shows on four of the five rows. **Say:** “We know how long these take. We
  only estimate what a change would recover where there's a reviewed pattern to base it on; otherwise we
  don't guess.”
- **Point at “Logging back in to lender portals”** (#2 or #3; see below): “It ranks high because it's an
  easy fix, but only one person mentioned it. builda+ won't send it to engineering until someone else
  confirms it. Priority and evidence are kept separate.”
  - It ties with “Merging duplicate enquiry records” on a score of 48, and which of the two comes first
    changes each time the demo is reseeded. Refer to it by name, not by rank. If anyone asks: “these two
    score the same; the order between them isn't meaningful.”
- **Business value:** the firm doesn't buy automation for problems that need a process fix, and nothing
  goes forward on one person's say-so.

### 4. What it's worth, honestly (3 minutes)
**Open “Manual chasing of outstanding client documents” → Business case.**

- **Show the four boxes, one at a time:**
  - **Time recovered:** 40 staff hours a month spent; about 20 could be recovered. **Say where each comes
    from:** the 40 is from your staff (120 a month × 20 minutes, the middle of four accounts); the 20 rests
    on a **planning assumption** that half that time can be removed. Scroll to “Inputs and where each came
    from” and point at the row labelled **Assumption**: “until a first implementation measures it, that
    half is a planning figure, not a fact.”
  - The £560 under it is that time valued at the firm's stated hourly cost. **Say clearly: “that's an
    indication of scale, not a saving. You only save money if you stop spending it.”**
  - **Cash savings:** none stated. Cash only counts when the firm names spending that will stop.
  - **Operational capacity:** about 3 more cases a month, using the firm's own figure for hours per case.
  - **Revenue:** not estimated, because the firm hasn't confirmed it has more demand to fill.
  - **Payback:** not calculated, because implementation cost isn't known yet.
- **Business value:** a business case the partners can defend. Every number shows its source, and gaps
  stay gaps.
- **Ask:** *“If your team got 20 hours a month back, would that go on more cases, better service, or
  fewer hours?”*

### 5. From decision to engineering brief (4 minutes)
**Window 1 → “Manual progress updates to clients, introducers and solicitors” → Review and approval.**

- **Live:** click **Approve**. The page reloads at the top, so use the **“Review and approval”** link
  under the title to return, then click **Send to JADA engineering review**. Wait for the status to read
  “With JADA engineering”; click once only.
- Mention that the same brief can be downloaded, but **don't open the download**: it is a plain Markdown
  file. The engineer's page in Window 2 shows the same content properly laid out.
- **Say:** “You decide what goes forward. JADA receives the problem, the evidence, what you've validated,
  what's still uncertain, the risks and the proposed measures. An engineer can start without repeating
  the discovery.”
- **Window 2 → refresh the Engineering queue.** The item appears under “Awaiting engineering review”.
  Open it and scroll **Business problem → What remains uncertain**.
- **Then open “Manual chasing of outstanding client documents”** (In progress) and show three things:
  1. **Proposed solution:** conventional automation, not AI. Staff approve every reminder before it goes.
  2. **Implementation plan:** “Two-week build not offered”. Summarise the reasons rather than reading the
     list aloud: the template isn't proven yet, access isn't confirmed, and one dependency is open. (The
     list repeats itself and shows an internal template name; that's a known wording issue.)
  3. **Expected outcomes:** the baseline and the agreed target.
- **Say:** “JADA designs, approves and plans each change. We don't promise a timescale until the
  conditions are actually met.”
- **Business value:** approved opportunities become concrete, reviewable engineering work, with human
  approval built in.
- **Ask:** *“Who in your firm would sign off a change like this?”*

### 6. Measuring what changed (2 minutes)
**Window 1 → Impact.**

- **Show:** document chasing has a baseline of 40 hours a month (from discovery), a target of 28 or less
  agreed for the demonstration, and a result of **Not yet measured**.
- **Say:** “The 28-hour target is illustrative for this synthetic firm; it isn't a forecast. Finishing the
  work doesn't count as success. Success is the agreed measure, from the agreed source, over the agreed
  period. Until then it says ‘not yet measured’.”
- **Business value:** the firm pays for outcomes it can verify, not for activity.

**Optional, if time allows (2 minutes):** Window 1 → “Handing a case to the case team” → answer JADA's two
questions live. Then refresh it in Window 2: the answer appears in its history. This shows the two-way
loop between your team and the engineers.

---

## Closing: how a firm engages (2 minutes)

> “A first engagement would look like this:
> 1. A short conversation about how your firm works.
> 2. Independent interviews with 6 to 10 of your people over about three weeks, each 20–30 minutes on their
>    phone or computer.
> 3. You review the findings and the evidence, correct anything that's wrong, and choose what goes forward.
> 4. JADA scopes and delivers those changes, starting with fixes and process changes. Automation comes only
>    where it's justified, and always with your staff approving what goes out.
> 5. We measure the agreed outcomes against the baseline.
>
> We're preparing a first pilot with one firm. Before any real firm's data goes in, we're completing
> production sign-in, data-retention controls and reviewed mortgage knowledge. Nothing you've seen today
> touches client files or your email.”

Then ask the five validation questions below. Don't quote prices or delivery times: neither has been
set.

---

## Commercial validation: five questions

1. **Recognition:** “Which of the problems we showed exist in your firm today, and which one costs you most?”
2. **Trust:** “Would you trust findings built this way, from your own people's accounts with the evidence
   and disagreements visible, enough to act on them? What would you need to see?”
3. **Willingness to pay for discovery:** “If this showed you where your operation loses time, would that
   on its own be worth paying for? Roughly what would you compare it to?”
4. **Value of JADA implementing:** “Would you want JADA to implement the changes, or would you take the
   findings and do it yourselves?”
5. **Barriers:** “What would stop you going ahead: staff time, data concerns, your network, timing,
   something else?”

Write the answers down word for word. They are the evidence for the next decision.

---

## Honesty: what to claim and what not to

| Category | What it covers |
|---|---|
| **Works today** | The discovery workspace, evidence and confidence, disagreements, classification and prioritisation, the business case, approval and hand-over to JADA, the engineering workflow, outcome tracking, firm isolation |
| **Illustrative synthetic data** | The firm, every person, every quote and figure, the CRM report, the £28 hourly cost, hours per case, and the 28-hour target |
| **Not measured** | Every outcome. No implementation in the demo has a result. No saving, capacity gain or payback has been demonstrated |
| **Not production-ready** | Sign-in (demo push-button only), data retention and deletion, the mortgage knowledge (a draft, unreviewed), the solution templates (untested), the Outlook integration (not built; its technical test hasn't run). Details: `docs/pilot-go-no-go.md` |

**Never say:** FCA-approved, compliant, proven, guaranteed savings, two-week delivery, live, or “our AI found”.
No AI runs in this demo. Every classification was set or confirmed by the synthetic firm lead (shown as
“Set by firm lead”); two of them confirm a suggestion from the draft industry knowledge.

**If asked about AI:** “In a real discovery, AI conducts the interviews and proposes a classification,
quoting what people said. Your firm lead confirms or corrects it. Calculations, scoring and the rules are
ordinary deterministic software.”

---

## Data reference (for the presenter)

| Opportunity | Class | Use in the story | State after seeding |
|---|---|---|---|
| Manual chasing of outstanding client documents | Automate | Moments 3, 4, 5, 6 | With JADA, in progress |
| Merging duplicate enquiry records | Fix | Moment 3 | With JADA, approved for implementation |
| Handing a case to the case team | Overhaul | Moments 2, 3 (optional live answer) | With JADA, awaiting information |
| Manual progress updates to clients, introducers and solicitors | Automate | Moment 5 (live approve and send) | Ready for the firm's decision |
| Logging back in to lender portals | Fix (one account) | Moment 3 (single-account explanation; ranks #2 or #3) | Ready, but blocked from engineering |
| Re-keying fact-find notes into the CRM | Automate at a regulated stage | **Don't open** | Held for compliance review |
| Writing suitability letters | Keep human (regulated) | **Don't open**; one sentence in moment 3 | Not ranked |
