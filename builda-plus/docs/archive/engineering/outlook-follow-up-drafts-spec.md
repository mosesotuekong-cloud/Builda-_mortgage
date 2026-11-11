# Outlook follow-up drafts — MVP engineering specification

Status: **revision 2.1: decisions A1–A6 closed** (2026-11-06). Ready for the technical spike
([outlook-spike-checklist](outlook-spike-checklist.md)). **The spike gates only the Outlook
integration** (§11.1). The rest of the application build proceeds in parallel. **No Microsoft
behaviour in this document is verified yet.**
Owner: JADA engineering.
Implements [decision-record](../strategy/decision-record.md) D3–D6, D9, D11, D14 and **D15**
(enrolled conversations only).

**Runtime boundary.** This is a JADA delivery runtime, **separate from builda+**: its own repository,
database, deployment and credentials. Nothing in the builda+ codebase changes for this MVP.

**Notation:**
- **[MS]** a boundary enforced by Microsoft (Entra ID / Exchange Online / Graph);
- **[APP]** a restriction enforced only by JADA's own code, and evidenced by tests and logs;
- **[SPIKE]** platform behaviour that must be confirmed in a test tenant before build. It reflects
  documented behaviour as I understand it, but hasn't been tested here.

### What changed from revision 1

| Area | Revision 1 | Revision 2 |
|---|---|---|
| Principle | Track threads tagged `Chase` | **JADA works only on conversations a case manager explicitly enrols.** No mailbox monitoring |
| Discovery of work | 15-minute poll of Sent Items per mailbox | Category-based enrolment (Option A, §3), discovered by one narrow, server-filtered query per mailbox per cycle. **Needs approval** (A1) |
| Conversation checks | Every 15 minutes | **Once per business day** before drafting, plus a just-in-time re-check immediately before any draft is created |
| Permission grant | `Mail.ReadWrite` via Entra admin consent, plus mailbox scoping | `Mail.ReadWrite` granted **only through Exchange RBAC for Applications**, scoped to named mailboxes. **No Entra-consented mail permission** (§5) |
| Controls | Categories | Categories, plus a **Graph gateway allowlist** in code (§5.4) |
| Visibility for case managers | Not specified | A native Outlook category view of all enrolled conversations (§7) |
| Notifications | Weekly team summary to the firm contact | Unchanged; **no digest to case managers in v0** (it would require storing their addresses) |

---

## 1. Architectural principle

> JADA does not own or monitor the firm's mailbox. It temporarily works on specific email
> conversations that a case manager has explicitly delegated to it.

| Rule | How it's enforced |
|---|---|
| No continuous mailbox monitoring | [APP] The only recurring calls are (a) the enrolment query (§4.1) and (b) per-conversation checks on enrolled conversations |
| No scanning or searching the mailbox for potential cases | [APP] There is no content search. The single enrolment query is a server-side filter on one folder for one category; JADA receives only messages carrying that category. See §3.3 for exactly how far this goes |
| No reading unrelated conversations | [APP] Conversation checks always filter by a stored `conversationId`; the gateway rejects any unfiltered list call |
| No unnecessary access to bodies, subjects, attachments | [APP] Gateway `$select` allowlist; body, subject, preview and attachment fields are never requested |
| No autonomous sending | **[MS]** No send permission is granted; send endpoints return 403 |
| No client email content in JADA's database | [APP] Schema has no columns for content; log scrubbing; tests |
| Access limited to named case-manager mailboxes | **[MS]** Exchange RBAC for Applications management scope |
| Access limited to enrolled conversations | **[APP] only.** Microsoft can't restrict an application below mailbox level. This must be stated as such in the DPIA and to the firm |

---

## 2. Revised architecture and workflow

```
Case manager (Outlook)                       JADA runtime (multi-tenant, separate from builda+)
──────────────────────                       ─────────────────────────────────────────────────
1 sends document request (as today)
2 applies category "JADA Follow-up"   ──►  enrolment pass (every 30 min, business hours):
  (one click via Quick Step)                 Sent Items, category filter, metadata only
                                             → register anchor (immutable id, conversationId,
                                               internetMessageId, sentDateTime)
                                           ◄── applies "JADA: active" to the anchor (confirmation)
                                           daily check (07:30 local) of each ACTIVE conversation:
                                             metadata of that conversation's messages only
                                             → client replied? paused? done? manual follow-up sent?
                                           draft pass (08:00 local), for each due step:
                                             just-in-time re-check of the conversation
                                             → createReply on the latest outbound message
                                           ◄── draft appears in the conversation, category
                                               "JADA: draft ready"
3 reviews, edits, presses Send (or deletes)
                                           next daily check: draft sent / discarded recorded
4 applies "JADA: done" when documents arrive, ─► workflow ends; nothing more is read
  or removes "JADA Follow-up" to cancel
```

There's one worker process with a Postgres job table (`FOR UPDATE SKIP LOCKED`). No webhooks, queues
or streaming.

---

## 3. Enrolment options

### 3.1 Option A — Outlook category

The case manager applies `JADA Follow-up` to the sent document-request message. Onboarding sets up a
**Quick Step** ("Start JADA follow-up") that applies the category in one click.

**How JADA finds new enrolments without scanning:** once per cycle, per in-scope mailbox:

```
GET /users/{mailboxId}/mailFolders/sentitems/messages
    ?$filter=categories/any(c:c eq 'JADA Follow-up') and sentDateTime ge {now − 14 days}
    &$select=id,conversationId,internetMessageId,sentDateTime,categories
Prefer: IdType="ImmutableId"
```

- Exchange evaluates the filter **server-side**. JADA receives only messages carrying the category, and
  only the five listed fields. **[SPIKE]** Confirm that a `categories/any` filter is supported on this
  folder query, that it combines with `sentDateTime`, and how quickly a newly applied category becomes
  filterable.
- The 14-day window bounds the query. Requests tagged more than 14 days after sending aren't picked
  up; the case manager is told so at onboarding.

### 3.2 Option B — "Start JADA follow-up" Outlook action (add-in)

A web add-in shows a button on the reading pane. It reads the current item's ID through Office.js,
converts it to a REST/immutable ID, and posts it to JADA's API with the user's SSO token.

| Concern | Assessment |
|---|---|
| Discovery | **Push registration.** No folder query at all; JADA learns of exactly the one conversation |
| Permissions | The add-in itself needs only item-read on the open message. **The scheduled checks and draft creation still need the same application access (§5)**, because nothing runs when the user isn't in Outlook. Mailbox-level access is unchanged |
| New components | Add-in manifest; hosted add-in web app; Entra SSO (nested app authentication) to identify the user; a public registration API with authentication; central deployment by the firm's admin through the Microsoft 365 admin centre |
| Client coverage | Classic Outlook desktop, new Outlook, Outlook on the web; mobile is limited. Each needs testing. The add-in platform (manifest formats, SSO model) is changing, which adds maintenance |
| Usability | Explicit, immediate feedback ("follow-up started"); a task pane could show status |
| Reliability | More moving parts: add-in loading, SSO prompts, conditional-access policies, admin deployment propagation |
| Effort | **+2–3 engineer-weeks**, plus a firm-side admin deployment step in onboarding |

### 3.3 Comparison and recommendation

| Criterion | A. Category | B. Add-in |
|---|---|---|
| Microsoft-enforced mailbox access | Same | Same |
| What JADA's code queries beyond enrolled conversations | **One server-filtered query of Sent Items per mailbox per cycle**, returning only category-tagged message metadata | Nothing |
| Components to build and run | None beyond the runtime | Add-in, hosting, SSO, registration API |
| Firm IT work | Exchange scoping (needed for both) | Exchange scoping + add-in deployment |
| Case-manager effort | One click (Quick Step) | One click |
| Confirmation | "JADA: active" category within 30 minutes | Immediate |
| Mistakes | Tagging the wrong message (e.g. in the Inbox) is missed; the enrolled-view check catches it | Fewer |
| Time to pilot | Fastest | +2–3 weeks |

**Recommendation for pilot 1: Option A** with a Quick Step. It's the simplest reliable approach, adds
no client-side software, and gives case managers a native view of what's enrolled (§7). Option B
gives a better *code-level* minimisation (no folder query), but it doesn't reduce the
Microsoft-enforced access at all, and it adds a meaningful amount of software and deployment work.

**A1: approved for the first pilot, conditional on successful Microsoft Graph testing.** The
enrolment query is the one place where JADA's code queries a folder rather than a known
conversation. If the spike's critical enrolment tests fail (checklist T7, T8, T11, T12), return with options, Option B
among them, for approval.

Revisit Option B if any of these hold: a firm's DPIA rejects the folder query; tagging errors are
frequent in the pilot; firms want in-Outlook status.

---

## 4. Conversation-level processing

### 4.1 Identifiers: what each operation needs

A `conversationId` alone isn't enough for most operations.

| Identifier | Source | Used for | Notes |
|---|---|---|---|
| Mailbox object ID (GUID) | Onboarding (from the firm's admin) | `/users/{id}` in every call | Pseudonymous employee identifier; UPN not stored |
| **Anchor message immutable ID** | Enrolment query (`Prefer: IdType="ImmutableId"`) | Reading the anchor's categories; fallback reply target | Immutable IDs survive moves within the mailbox. **[SPIKE]** Behaviour when a message moves to an online archive (expected: inaccessible) |
| **`conversationId`** | Enrolment query | `$filter=conversationId eq '…'` to list only that conversation's messages | **[SPIKE]** Filter support on `/users/{id}/messages` across folders; stability when a reply changes the subject (expected: may start a new conversation, so not detected) |
| `internetMessageId` | Enrolment query | Recovery: re-locate the anchor if the immutable ID stops resolving (`$filter=internetMessageId eq '…'` returns only that message) | Stable across moves |
| **Reply-target message ID** | Latest *outbound* message in the conversation (from the daily check) | `POST …/messages/{id}/createReply` needs a message ID, not a conversation ID | Replying to the latest outbound message keeps the chain and the original recipients. **[SPIKE]** Recipients of `createReply` on a sent item |
| Draft immutable ID | `createReply` response | Duplicate prevention; sent/discarded detection | **[SPIKE]** Whether the sent copy keeps an identifiable marker (category or extended property) |

### 4.2 Lifecycle

| Step | What happens | Calls (all through the gateway, §5.4) |
|---|---|---|
| 1 Register | The enrolment query finds a tagged anchor not yet registered → create a workflow record (IDs, `sentDateTime`, schedule, state `active` or `shadow`) | Enrolment query; `PATCH` anchor categories (+`JADA: active`) |
| 2 Schedule | Due dates computed in business days from the anchor's `sentDateTime` (default 3 / 7 / 10, then "call client"); UK bank holidays by region | None |
| 3 Daily check | For each active workflow: list the conversation's messages (metadata only); read the anchor's categories | `GET …/messages?$filter=conversationId eq '…'&$select=…` |
| 4 Reply status | A client reply is a message received after the last outbound message, from a sender domain outside the firm's accepted domains, that isn't an auto-reply or delivery report (headers read only for that message) | `GET …/messages/{id}?$select=internetMessageHeaders` (candidate replies only) |
| 5 Draft | If a step is due, no client reply, not paused, and no unsent JADA draft exists → re-check the conversation (just in time) → `createReply` with the approved wording as `comment` → set `JADA: draft ready` on the draft | Conversation list; `POST createReply`; `PATCH` draft categories |
| 6 Notify | The draft sits in the conversation and Drafts folder, visible in the category view (§7). No other notification in v0 | — |
| 7 Human send | The case manager edits and sends, or deletes. The next check records sent (an outbound message in the conversation after the draft's creation) or discarded (the draft ID no longer resolves, and no matching sent message) | Conversation list; `GET` draft by ID (`$select=isDraft`) |
| 8 Stop | Client replied → `JADA: client replied` on the anchor, state `replied`. Cancel (category removed) → `cancelled`. `JADA: done` on any message in the conversation → `done`. Final step passed → `JADA: call client`, then `expired` after 10 business days. Anchor unrecoverable → `needs_attention`. **After a terminal state, the conversation is never queried again** | `PATCH` anchor categories (where possible) |

**Manual follow-ups:** if the case manager sends their own follow-up in the conversation, it's
recorded as that step's follow-up (no JADA draft for that step), and the schedule continues from
it. This prevents duplicate reminders and feeds M2.

### 4.2a Two separate jobs: enrolment discovery and processing

The worker runs two jobs with **disjoint permitted call sets**. The gateway enforces this, not just
convention (§5.4):

| Job | Runs | Reads | Writes | Must never |
|---|---|---|---|---|
| **Enrolment discovery** | Every 30 min, business hours | G1 only (tagged Sent Items metadata) | Registers new workflows; G6 to add `JADA: active` **only on a message it registered in the same run** | Call G2–G5; touch any existing workflow |
| **Processing** | 07:30 daily checks; 08:00 draft pass | G2–G4 on **registered, non-terminal** workflows only | G5 (drafts), G6 (JADA categories) on those workflows | Call G1; act on any conversation not already registered |

Discovery never decides follow-up timing, and processing never discovers new work. The two can't
interfere: they share only the workflow table, with per-workflow locks.

### 4.3 Scheduled checks: frequency and trade-offs (A4 approved)

| Pass | Recommended frequency (pilot) | Rationale |
|---|---|---|
| Enrolment discovery | Every **30 minutes**, 08:00–18:00 local, business days | Case managers see `JADA: active` within half an hour. More frequent adds little; less frequent makes confirmation feel broken |
| Conversation checks | **Once per business day at 07:30** for active workflows + **just-in-time** before each draft | Drafts are only created at 08:00, so a reply is always caught before a draft. Measurement timestamps come from message metadata (`sentDateTime`, `receivedDateTime`), **not poll time**, so a daily check loses no measurement precision |
| Draft pass | **08:00 local** | Drafts are ready at the start of the day |

The trade-off: daily checks mean `JADA: client replied` labelling and `done` detection can lag by up
to a day. That's acceptable because no draft is ever created without a just-in-time check.

Expected volume: about 20 enrolment queries a day per mailbox + about 2–3 calls per active
conversation per day. That's far below Graph mailbox throttling limits, so webhooks aren't justified.

### 4.4 Failure handling

| Failure | Behaviour |
|---|---|
| 429 / 503 | Honour `Retry-After`; at most one in-flight call per mailbox; the pass resumes next cycle. No partial step is recorded as complete |
| Anchor immutable ID not found (deleted / moved to archive) | Try `internetMessageId` recovery → if still missing: `needs_attention`. Category set on the latest outbound message, if any remains. Never search further |
| Conversation filter returns nothing | Same as above |
| `createReply` succeeded but categorising failed | The draft ID is persisted first (in its own transaction); the category is retried next pass. **Duplicate guard:** the unique `(workflow_id, step)` constraint plus a check for an unsent JADA draft before any create |
| Crash between `createReply` and persisting the draft ID | On restart, the just-in-time check looks for a draft in the conversation created after the step's due time (`isDraft`, `createdDateTime`) → adopt it rather than create another. **[SPIKE]** Whether a draft can be reliably identified as ours without reading content (category or extended property) |
| Consent or RBAC removed (401/403) | Tenant paused; JADA alerted; firm contact told within 1 business day |
| Out-of-scope canary readable | **Tenant halted** (§5.3) |
| Five consecutive failures on one workflow | `needs_attention`; alert; no further calls for that workflow until reviewed |

Each workflow is serialised (row lock, per-workflow sequence numbers) so concurrent passes can't act
on the same conversation.

---

## 5. Permissions and security

### 5.1 Minimum Graph permission

| Operation | Lowest Graph permission that supports it |
|---|---|
| Enrolment query; conversation metadata; headers | `Mail.ReadBasic` would cover metadata. **[SPIKE]** Whether `internetMessageHeaders` is available under ReadBasic (expected: not) |
| Set categories on messages | `Mail.ReadWrite` |
| `createReply` (create draft) | `Mail.ReadWrite` |
| Send | `Mail.Send`: **not granted** |

**Conclusion: `Mail.ReadWrite` (application) is the minimum.** Microsoft Graph has no narrower
permission for "create drafts" or "write categories". Adding `Mail.ReadBasic` wouldn't narrow
anything, because application permissions are additive. Splitting into two apps (a ReadBasic
"checker" and a ReadWrite "drafter") doesn't reduce what Microsoft allows either, so it isn't
proposed.

**What `Mail.ReadWrite` allows, as enforced by Microsoft, within each scoped mailbox:**
- read every message, including bodies and attachments;
- create, update, move and delete messages;
- **not** send.

JADA's restrictions inside that are application-level (§5.4).

### 5.2 Granting it: Exchange RBAC for Applications, not Entra consent

- **[MS]** Exchange Online RBAC for Applications assigns an application role (`Application
  Mail.ReadWrite`) to the app's service principal, **limited to a management scope**: for example
  mailboxes that are members of a mail-enabled security group (`JADA Follow-up Mailboxes`) containing
  only the named case-manager mailboxes.
- **Critical:** permissions granted through RBAC for Applications and permissions granted through
  Entra admin consent are **additive**. If the app also held an Entra-consented Graph `Mail.ReadWrite`
  application permission, it would have **unscoped access to every mailbox**, and the Exchange scope
  wouldn't restrict it. Therefore:
  - the multi-tenant app registration **requests no Microsoft Graph application permissions** in
    its manifest;
  - the firm's admin creates the service principal in their tenant without granting mail
    permissions; Exchange RBAC then grants the scoped role;
  - **onboarding verification:** the JADA onboarding script lists the service principal's Entra app
    role assignments and **fails if any `Mail.*`, `Mail.Send` or `full_access_as_app` permission
    exists**. This check repeats monthly, with an alert to JADA and the firm on any change.
- **[SPIKE]** Confirm end to end, in a separate test tenant acting as the "firm":
  - creating the Exchange service principal for JADA's multi-tenant app;
  - that a client-credentials token with **no** Graph roles is authorised by Exchange for the scoped
    mailboxes only;
  - propagation time.
- **No pre-approved fallback (A3).** If mailbox scoping through RBAC for Applications fails in the
  spike, **work stops**. JADA returns with alternatives and their security implications for
  explicit approval. During the spike, **an Entra-consented mail permission must never be added**,
  not even temporarily to "make a test pass", because it would invalidate every scoping result.

### 5.3 Microsoft-enforced boundary verification

| Test | When | Expected |
|---|---|---|
| Read metadata from an **out-of-scope canary mailbox** | Onboarding + daily | 403. **Any success halts the tenant** |
| Send a draft (`POST /messages/{id}/send`) or `sendMail` | Onboarding + spike | 403 |
| Service principal's Entra app role assignments | Onboarding + monthly | No mail-related assignments |
| Firm-side evidence | On request | Where the firm's Microsoft 365 licensing provides mailbox audit (`MailItemsAccessed`), the firm can independently review JADA's access |

### 5.4 Application-enforced restrictions (the Graph gateway)

**Single access module.** Every Microsoft Graph request is made by one module, the *Graph gateway*.
Nothing else in the codebase may reach Microsoft. Bypass is prevented by three controls, with no new
infrastructure:

1. **Credential confinement.** Only the gateway can load the certificate and acquire tokens. The key
   reference is read inside the gateway module, and no other module exports a token or authorisation
   header.
2. **Static boundary test (CI).** A test fails the build if any file outside the gateway imports an
   HTTP client or Microsoft SDK, references `graph.microsoft.com` or `login.microsoftonline.com`, or
   imports the gateway's internal transport. The test is itself tested: a deliberately violating
   fixture must fail it (spike T26).
3. **Runtime self-check.** On start-up, the worker asserts that the gateway's transport is the only
   one configured for Microsoft hosts. Requests are made only through the gateway's dedicated HTTP
   agent.

**ImmutableId everywhere.** The gateway adds `Prefer: IdType="ImmutableId"` to **every** request.
Callers can't omit or override it. Every message ID stored, logged or used comes from such a
response (spike T11, T29).

**Per-job call sets.** Each gateway call states the job it runs under. The gateway rejects calls
outside that job's set (§4.2a).

The permitted request shapes:

| # | Method | Path template | Allowed query | Purpose |
|---|---|---|---|---|
| G1 | GET | `/users/{mbx}/mailFolders/sentitems/messages` | `$filter` exactly `categories/any(c:c eq '<enrol category>') and sentDateTime ge <date>`; `$select` ⊆ {id, conversationId, internetMessageId, sentDateTime, categories} | Enrolment |
| G2 | GET | `/users/{mbx}/messages` | `$filter` exactly `conversationId eq '<registered id>'` (an ID present in an **active** workflow for that mailbox); `$select` ⊆ {id, conversationId, sentDateTime, receivedDateTime, createdDateTime, lastModifiedDateTime, isDraft, categories, from} | Conversation check |
| G3 | GET | `/users/{mbx}/messages/{id}` | `$select` ⊆ {internetMessageHeaders} **or** {isDraft, categories}; `{id}` must belong to an active workflow's conversation (as last seen by G2) | Reply classification / draft status |
| G4 | GET | `/users/{mbx}/messages` | `$filter` exactly `internetMessageId eq '<registered value>'`; `$select` as G1 | Anchor recovery |
| G5 | POST | `/users/{mbx}/messages/{id}/createReply` | Body: `comment` from an **approved template version** only; `{id}` = the latest outbound message of an active workflow | Draft |
| G6 | PATCH | `/users/{mbx}/messages/{id}` | Body: `categories` only; `{id}` in an active workflow's conversation or its JADA draft; only JADA categories added or removed, user categories preserved | Signals |

Everything else (other paths, `$search`, unfiltered lists, `body`, `bodyPreview`, `uniqueBody`,
`subject`, `toRecipients`, attachments, delete, move, send) is **rejected before any network call**.
Supporting controls:
- network egress allowed only to Graph and Entra endpoints;
- every gateway call is written to the audit log (method, path template, mailbox GUID, message or
  conversation IDs, status). No content;
- `$select` is mandatory on every GET, so default property sets (which include `subject` and
  `bodyPreview`) are never returned.

Microsoft can't verify these restrictions. They're evidenced by gateway unit tests (every disallowed
shape rejected), code review, and the call audit log. The DPIA and firm documentation must say this
plainly.

### 5.4a Exact Graph calls, permissions and data processed

All calls: base `https://graph.microsoft.com/v1.0`, header `Prefer: IdType="ImmutableId"`, app-only
token. Required permission in every case: the Exchange RBAC for Applications role **`Application
Mail.ReadWrite`**, scoped to the named mailboxes (no Entra-consented Graph permission). Graph always
adds response annotations (`@odata.context`, `@odata.etag`, and `@odata.nextLink` when paging). These
are expected and not stored.

| ID | Job | Request | Properties returned (`$select`) | Processed transiently | Stored | Logged |
|---|---|---|---|---|---|---|
| G1 | Discovery | `GET /users/{mbx}/mailFolders/sentitems/messages?$filter=categories/any(c:c eq 'JADA Follow-up') and sentDateTime ge {T−14d}&$select=id,conversationId,internetMessageId,sentDateTime,categories&$top=50` | id, conversationId, internetMessageId, sentDateTime, categories | Category list (to detect existing JADA categories) | id (anchor), conversationId, internetMessageId, sentDateTime | Mailbox GUID, count, new anchor IDs, status |
| G2 | Processing | `GET /users/{mbx}/messages?$filter=conversationId eq '{cid}'&$select=id,conversationId,sentDateTime,receivedDateTime,createdDateTime,lastModifiedDateTime,isDraft,categories,from` | as selected | `from` address → domain comparison with accepted domains; categories; isDraft | Derived events only: client-reply time, outbound send times, draft sent/discarded, done/paused/cancelled times | Workflow ID, message IDs, event codes |
| G3a | Processing | `GET /users/{mbx}/messages/{id}?$select=internetMessageHeaders` (candidate client replies only) | internetMessageHeaders | `Auto-Submitted`, `X-Auto-Response-Suppress`, `Content-Type` evaluated; **all other headers discarded unread** | Classification result (reply / auto-reply / delivery report) | Message ID, classification |
| G3b | Processing | `GET /users/{mbx}/messages/{draftId}?$select=isDraft,categories` | isDraft, categories | — | Draft status | Draft ID, status |
| G4 | Processing | `GET /users/{mbx}/messages?$filter=internetMessageId eq '{imid}'&$select=id,conversationId,sentDateTime,categories` (anchor recovery only) | as selected | — | Replacement anchor ID | Workflow ID, outcome |
| G5 | Processing | `POST /users/{mbx}/messages/{latestOutboundId}/createReply` with body `{"comment": "<approved template text>"}` | (response is the full draft message, including body and recipients) | **Response discarded unread** apart from `id` and `createdDateTime`, which are extracted by the gateway | Draft ID, created time, template version, step | Workflow ID, draft ID, step |
| G6 | Discovery (new anchor only) / Processing | `PATCH /users/{mbx}/messages/{id}` with body `{"categories": [...]}`: the current list ± JADA categories only | (response discarded) | Current category list (from G1/G2) | — | Message ID, categories added or removed |

**Reply recipients (requirement verified only by spike T17–T18).** G5 uses `createReply` on the
latest **outbound** message so that the reply stays in the original conversation. Microsoft's
recipient behaviour for a reply to the mailbox's *own sent message* is **not yet verified**. The
intended result is a draft addressed to the original To recipients (the client), not to the mailbox
owner.
- If T17 shows `createReply` addresses the draft to the mailbox owner (or anyone else), **G5 isn't
  built as specified.** The alternatives (`createReplyAll`; or `createReply` with explicit
  `toRecipients` copied transiently from the anchor, which would add `toRecipients` to the
  properties JADA reads) are evaluated in T18 and **returned for approval**, because the second
  widens the data JADA processes.
- Whichever is used, the case manager reviews the recipients before sending. That's a safeguard, not
  a substitute for correct behaviour.

### 5.5 Other security controls (unchanged from revision 1)

- Certificate-based client credentials; key in a managed vault; 12-month rotation.
- UK/EU hosting, encrypted database, tenant isolation (RLS + composite tenant FKs, the builda+
  pattern).
- Global and per-tenant kill switches, checked before every write call (G5, G6).
- JADA admin CLI only; no firm-facing UI.
- The weekly team summary is sent from JADA's own mail domain.

---

## 6. Data access and retention matrix

| Data element | Read by JADA? | Processed transiently? | Stored? | Logged? | Retention |
|---|---|---|---|---|---|
| Messages outside enrolled conversations | **No** ([APP]); possible under the Microsoft permission | — | No | No | — |
| Enrolment query result fields (id, conversationId, internetMessageId, sentDateTime, categories) | Tagged Sent Items messages only | Yes | IDs, `sentDateTime` | IDs only | 90 days after terminal state |
| Conversation message metadata (ids, timestamps, isDraft, categories) | Enrolled conversations only | Yes | Derived events only (reply time, outbound send times, draft status) | Event codes + IDs | 90 days after terminal state |
| `from` address of conversation messages (may be the client's email) | Enrolled conversations only | **Yes**: domain compared with accepted domains | **No** | **No** | — |
| `internetMessageHeaders` of candidate replies | Only messages that might be client replies | Yes: three header checks | No | No | — |
| Subject, body, preview, attachments, recipients | **Never requested** | No* | No | No | — |
| `createReply` response (contains the draft body with quoted client correspondence) | Returned by Graph | *Yes, unavoidably in memory; discarded unread* | Draft ID only | Draft ID only | 90 days |
| Draft in the firm's mailbox | Created by JADA, owned by the firm | — | — | — | The firm's mailbox policies |
| Template wording | — | — | Yes (firm-approved, no client data) | Version IDs | Contract + 12 months |
| Mailbox identifiers | — | — | Object GUID + label | GUID | Contract duration |
| Approver identity | — | — | Name + time per template version | Yes (audit) | 12 months |
| Gateway call audit | — | — | Method, path template, IDs, status | Yes | 12 months |
| Weekly metrics | — | — | Tenant-level aggregates, no IDs | — | Contract + 12 months |

\* Except as noted for the `createReply` response.

**For the DPIA:**
- all transient processing above is listed;
- the Microsoft-enforced boundary is the scoped mailboxes;
- the conversation-level boundary is application-enforced;
- drafts JADA creates contain quoted client correspondence inside the firm's mailbox.

---

## 7. Workflow controls for the case manager

All controls are Outlook categories, set up at onboarding (the category list is created by the case
manager or IT; JADA needs no permission for that).

| Need | How |
|---|---|
| **Start** follow-up | Quick Step "Start JADA follow-up" on the sent request (applies `JADA Follow-up`) |
| Know it's enrolled | `JADA: active` appears on the message within 30 minutes |
| **See all enrolled conversations** | The `JADA Follow-up` category added to Favourites (Outlook on the web / new Outlook), or a search folder (classic Outlook). Set up at onboarding. Native Outlook, no JADA UI |
| **Pause** | Apply `JADA: paused` to the request; remove it to resume |
| **Cancel** | Remove `JADA Follow-up` |
| **Documents received** | Apply `JADA: done` to any message in the conversation |
| Know a draft is ready | The draft appears in the conversation with `JADA: draft ready`; the Favourites view shows it |
| Prevent duplicate reminders | JADA never creates a second draft while one is unsent, and a follow-up the case manager sends manually counts as that step |
| Client replies | No further drafts; `JADA: client replied` added to the request. Re-applying `JADA Follow-up` resumes from the next step |
| Original email edited | Sent emails can't be edited; changing categories on it is a control action (above) |
| Original email deleted or archived | Recovery by `internetMessageId`; otherwise `needs_attention`, flagged on the latest outbound message if one exists, and the workflow stops |
| Expiry (A6) | The workflow expires at **30 working days after enrolment, or 10 working days after the final follow-up, whichever occurs first.** After the final step the anchor gets `JADA: call client`. Expired workflows are never queried again |
| Notifications (A5) | **None beyond Outlook.** Categories and drafts are the interface in v0 |
| Human approval | **Mandatory by construction**: JADA has no send permission. Every email is sent by a person in Outlook |

**[SPIKE]** Confirm that categories on a **draft** are not transmitted to external recipients when it's
sent. If they could be, JADA won't categorise drafts. It uses a single-value extended property for
identification instead, and `JADA: draft ready` goes on the anchor.

---

## 8. Measurement (D9, preserved)

Collected entirely from enrolled conversations. No additional mailbox access, and no historical
mailbox analysis.

| Metric | Source under revision 2 |
|---|---|
| **Shadow-mode baseline** | Workflows enrolled in state `shadow` (5–10 business days before go-live): the same enrolment and daily checks, **no drafts**. Manual follow-ups and replies are recorded from conversation metadata |
| **M1** Request → documents received | Anchor `sentDateTime` → `JADA: done` (time taken from the message's `lastModifiedDateTime` when the category is first seen. **[SPIKE]** Accuracy of that proxy). Median, IQR, n; fewer than 10 → "insufficient data" |
| **M2** Follow-up due → sent | Due time (schedule) → the next outbound message's `sentDateTime` in the conversation (manual in shadow mode, draft or manual live); plus the share sent within 1 business day |
| **M3** Case-manager chasing time | Weekly 2-question pulse run by JADA (not the runtime); shadow and live weeks |
| **A1** Adoption | Enrolled requests ÷ document requests sent (denominator from the firm's case count or the pulse); drafts sent ÷ drafts created |
| **C1** Control | Runtime sends = 0 (Microsoft-enforced); unsent drafts |

Interpretation rules, team-level reporting, and the "not used for performance assessment" commitment
are unchanged.

---

## 9. Technical spike

The spike is defined in **[outlook-spike-checklist.md](outlook-spike-checklist.md)**: numbered tests,
the expected result, the evidence required to pass, explicit failure conditions, and the build
go/no-go criteria. That file is authoritative for the spike.

Rules carried into it:
- every test runs under the **RBAC-for-Applications-only** configuration;
- an Entra-consented mail permission is **never** added, not even temporarily (A3);
- no Microsoft behaviour in this specification counts as verified until its checklist test has
  passed, with evidence recorded.

---

## 10. Data protection requirements (before pilot go-live, unchanged in substance)

- Article 28 DPA (the firm is controller, JADA processor). The firm's DPIA, with JADA's support pack
  updated for revision 2: the §6 matrix, the [MS] vs [APP] boundaries, and the onboarding
  verification checks.
- **A2 disclosure (mandatory):** the DPIA and the employee briefing must both state that
  Microsoft's permission gives JADA technical access to the whole of each enrolled case manager's
  mailbox (except sending), and that restricting it to enrolled conversations is enforced by JADA's
  software, not by Microsoft. They must also say how that is evidenced (gateway tests, call audit
  log, and the firm's own mailbox audit where licensed).
- **Case managers informed before onboarding:** what JADA can technically access (their whole mailbox,
  under Microsoft's permission model); what it actually reads (enrolled conversations' metadata); what
  it stores; and that metrics are team-level and not used for performance assessment (contractual).
- Clients: service messages sent by staff; no marketing content (PECR); Consumer Duty clarity in
  templates.
- Appointed-representative firms: the network's view on wording before the clock starts.

---

## 11. Implementation scope and delivery estimate

| Phase | Revision 1 | Revision 2 | Change |
|---|---|---|---|
| Spike | 3–4 days | **4–5 days** | Two tenants; RBAC-without-Entra-consent test; full checklist T0–T33 |
| Core build | 2–3 weeks | **2–3 weeks** | Simpler monitoring (daily checks), offset by the gateway allowlist, anchor recovery and category controls |
| Hardening | 1 week | **1 week** | Adds the canary and Entra-drift checks, and the gateway audit evidence |
| **Total to `tested`** | 4–5 weeks | **About 3½–4½ weeks** (one engineer) | The spike runs alongside the Microsoft-independent build (§11.1), so it's no longer entirely on the critical path. Option B would add 2–3 weeks |

### 11.1 What the spike gates, and what it doesn't

The spike blocks **only the Outlook integration**. Everything else proceeds in parallel.

| Not blocked: build now | Blocked until the spike's critical tests pass (checklist exit criteria) |
|---|---|
| All builda+ work (decision-record P1: production auth, trusted session identity, database function security, analysis fixes, knowledge release). It never depended on the spike | The real Graph transport: certificate token acquisition against Microsoft tenants |
| Runtime database, with tenant isolation (RLS + composite tenant FKs) and retention job | The concrete G1–G6 request definitions whose behaviour is unverified (category filter, conversation filter, `createReply` recipients, draft marking, headers) |
| Workflow state machine, business-day calendar, scheduler, job runner, per-workflow locking | The onboarding scoping and verification scripts, in their final form |
| The Graph gateway *framework*: allowlist, per-job call sets, `ImmutableId` injection, rejection-before-network, static boundary test, credential confinement, content-free audit logging. All tested against a **fake Graph transport** | Any connection to a real firm tenant; pilot onboarding |
| Metrics calculations, weekly summary, admin CLI, log-scrubbing tests | Marking any Microsoft-dependent behaviour as working |

Rules for building in parallel:
- Microsoft behaviour is represented **only behind the gateway interface**, and the fake transport
  encodes *assumptions*, labelled as such. Code that would change with spike results (G5 recipients
  per T17/T18, draft marking per T20/T21, reply classification per T15) stays isolated, so changing it
  is cheap.
- Parallel work creates **no pressure on spike outcomes**. The A3 stop rule and the checklist's
  failure conditions are unchanged. If scoping fails, the Microsoft-independent components are kept,
  and alternatives come back for approval.

**Per-firm onboarding ("two weeks from access")**:
- Days 1–2: create the service principal; the Exchange admin runs JADA's scoping script; the
  verification script passes (canary 403, no Entra mail permissions, cannot send); Quick Step,
  categories and Favourites view set up per case manager.
- Day 3: shadow mode starts.
- Day 10: drafts go live.
- Then the 4-week measured pilot.

Firm-side prerequisites are unchanged, plus an **Exchange administrator** (often the firm's IT
provider) for the scoping steps.

---

## 12. Relationship to the decision record

| Item | Status |
|---|---|
| D3 (drafts-only, thread-based), D5 (multi-tenant runtime separate from builda+), D6 (transient processing still needs a DPIA), D9 (measurement), D11 (offer), D14 (separation of roles) | **Consistent**; preserved |
| The "enrolled conversations only" principle | **Not in the decision record before this change.** Recorded as **D15** |
| Revision 1 of this spec (15-minute Sent Items polling; `Chase` categories; Entra-consented permission) | **Superseded** by this revision |
| Contradictions with D1–D14 | **None found** |

### Decisions (closed 2026-11-06)

| # | Decision | Outcome |
|---|---|---|
| **A1** | Category-based enrolment (Option A) | **Approved for the first pilot, conditional on successful Microsoft Graph testing** (critical checklist tests T7, T8, T11, T12) |
| **A2** | Microsoft-enforced mailbox boundary vs JADA-enforced conversation boundary | **Approved.** Must be disclosed in the DPIA and in the employee briefing (§10) |
| **A3** | Weaker fallback if mailbox scoping fails | **Not approved in advance.** If scoping fails: stop, and return with alternatives for explicit approval (§5.2) |
| **A4** | Daily conversation checks | **Approved**, with a fresh reply-status check immediately before draft creation (§4.3) |
| **A5** | No extra case-manager notifications in v0 | **Approved.** Outlook categories and drafts are the interface (§7) |
| **A6** | Expiry | **Approved:** 30 working days from enrolment, or 10 working days after the final follow-up, whichever occurs first (§7) |

### Open items that would need approval if the spike requires them

- **G5 recipients:** if `createReply` on a sent message doesn't address the original recipients
  (T17), the alternative chosen in T18 needs approval, because one option widens the data read.
- **Draft marking:** if categories on drafts are visible to external recipients (T20), switching to
  an extended property (T21) is a technical change within the approved scope. Recorded, no approval
  needed.
- **Enrolment:** if T7, T8, T11 or T12 fails, return with options (including the Outlook add-in) for approval.
