# Where we are (November 2026)

**What we're selling first:** the discovery itself. A brokerage's own staff are interviewed; builda+ turns
what they say into evidence, findings and classified, prioritised opportunities; the firm lead validates and
approves; the firm gets a PDF report. Implementation by JADA is a separate, later conversation.

**Who to:** UK mortgage brokerages, roughly 10–30 advisers. No pilot firm is lined up yet, so the job now is
to demo well and find the first buyer.

**What's in the product:** sign-in → firm profile and technology → invite staff → interviews → evidence and
findings → discovery review → opportunities and business case → approvals → report. Plus, the in-app guide,
helps throughout.

**What's parked** (behind `LATER_STAGES=on`, nothing deleted, still tested): the JADA engineering workspace,
solution templates, implementation and impact pages, and the knowledge editor.

**Before a real firm's staff are interviewed** (selling a discovery means real people's accounts):
production sign-in instead of the demo push-button (R1), then binding the database identity to that sign-in's
server-side session. Also: legal review of the consent v2 wording against the DPIA, and scheduling the daily
retention job (`npm run retention`). Done: the quote-privacy fix (P-1), database functions that take identity
from the transaction and same-firm references (R2, `db/009`), and retention, deletion and withdrawal (R3, `db/010`).
Specs: `archive/pilot-remediation-spec.md`.

## Documents

| Document | Use |
|---|---|
| `demo-runbook.md` | The 20-minute demo, its honesty rules and the five validation questions |
| `private-demo-hosting.md` | Putting the demo online behind a password (tunnel or Railway) |
| `archive/` | Earlier strategy, architecture, the Outlook spec and the pilot gates. Kept for reference; not being extended |
