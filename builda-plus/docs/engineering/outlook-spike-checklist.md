# Outlook follow-up drafts — Microsoft 365 test-tenant spike checklist

For: [outlook-follow-up-drafts-spec.md](outlook-follow-up-drafts-spec.md) revision 2.1.
Decisions: [decision-record](../strategy/decision-record.md) A1–A6, D15.

**Every test starts at status "Not run".** A test passes only when the evidence listed for it is
saved to the spike evidence folder (`spike-evidence/T<n>/`) and a reviewer signs it off. No
Microsoft behaviour is treated as verified on the strength of documentation alone.

| Role | Responsibility |
|---|---|
| Spike engineer (JADA) | Runs the tests, captures evidence |
| Reviewer: JADA engineering lead | Signs each result |
| Data protection lead | Also signs T8, T19, T31 (data-minimisation evidence) |

---

## Ground rules

1. **RBAC-only configuration throughout.** The app registration requests **no** Microsoft Graph
   application permissions. Mail access comes **only** from the Exchange RBAC for Applications
   assignment. Never add an Entra-consented mail permission, not even temporarily (decision A3). If
   one is added by mistake, discard every result obtained since, and re-run.
2. **Synthetic data only.** Test mailboxes, an external test domain acting as the "client", and no
   real client or staff data.
3. **Product calls go through the gateway prototype.** Tests of Microsoft behaviour that need to
   inspect a draft's recipients or headers use a **separate, test-only inspection harness**, kept out
   of the product codebase and labelled as such in the evidence.
4. **Stop rule (A3).** If T2, T3 or T4 fails, stop the spike. Record what was observed and return
   with alternatives for approval. Don't work around it.

---

## Environment (T0)

**T0. Test environment set up**
- **Setup:**
  - *JADA tenant:* owns the multi-tenant app registration (certificate credential, no Graph app
    permissions).
  - *Firm tenant:* mailboxes `cm-a`, `cm-b` (in scope) and `canary` (out of scope); a mail-enabled
    security group `JADA Follow-up Mailboxes` containing `cm-a` and `cm-b`; the JADA app's service
    principal created in the firm tenant; the Exchange service principal, management scope (recipient
    filter on group membership) and role assignment `Application Mail.ReadWrite`.
  - *External test domain:* a "client" mailbox.
- **Expected:** all objects exist as described.
- **Evidence:** app registration manifest (showing `requiredResourceAccess` contains no Graph
  application roles); the Exchange PowerShell output of `Get-ServicePrincipal`, `Get-ManagementScope`
  and `Get-ManagementRoleAssignment` for the app; group membership listing.
- **Fail if:** any Graph application permission is in the manifest; the scope includes `canary`.

---

## A. Permission boundaries (Microsoft-enforced)

**T1. No Entra-consented mail permission exists** *(critical)*
- **Steps:** list the service principal's app role assignments (Microsoft Graph PowerShell); acquire
  an app-only token and decode it.
- **Expected:** no app role assignments for Microsoft Graph or Exchange; the token's `roles` claim
  contains no `Mail.*` or `full_access_as_app`.
- **Evidence:** command output; decoded token claims (signature removed).
- **Fail if:** any mail-related assignment or role claim exists.

**T2. RBAC scope covers exactly the named mailboxes** *(critical; stop rule)*
- **Steps:** `Test-ServicePrincipalAuthorization` (or the equivalent RBAC-for-Applications test
  cmdlet available in the tenant) against `cm-a`, `cm-b` and `canary`.
- **Expected:** `cm-a` and `cm-b` in scope for `Application Mail.ReadWrite`; `canary` not in scope.
- **Evidence:** cmdlet output for all three.
- **Fail if:** `canary` is in scope; `cm-a` or `cm-b` is not; the cmdlet is unavailable *and* T3/T4
  don't independently establish the boundary.

**T3. In-scope access works with the RBAC-only token** *(critical; stop rule)*
- **Steps:** gateway call G1 against `cm-a` and `cm-b`.
- **Expected:** HTTP 200.
- **Evidence:** request (method, URL, headers without the token) and response status + body for each.
- **Fail if:** 401/403 after the documented propagation window. Stop rule applies: RBAC-only access
  doesn't work for the multi-tenant app.

**T4. Out-of-scope mailbox is refused** *(critical; stop rule)*
- **Steps:** G1-shaped and G2-shaped requests against `canary` (spike harness, since the gateway would
  refuse an unregistered mailbox).
- **Expected:** 403 (access denied) for every request.
- **Evidence:** requests and responses.
- **Fail if:** any 2xx response.

**T5. The application cannot send** *(critical)*
- **Steps:** create a draft in `cm-a` (G5); attempt `POST /users/cm-a/messages/{draftId}/send` and
  `POST /users/cm-a/sendMail`.
- **Expected:** both refused (403); nothing arrives at the external test mailbox.
- **Evidence:** responses; the external mailbox showing no message after 15 minutes.
- **Fail if:** any 2xx response, or any message delivered.

**T6. Grant and revocation propagation**
- **Steps:** record the time from the role assignment to the first successful G1. Remove `cm-b` from
  the group and record the time until calls to `cm-b` return 403.
- **Expected:** both times recorded; revocation effective within the documented propagation window.
- **Evidence:** timestamped call log.
- **Fail if:** revocation isn't effective within 2 hours. (Not a stop condition, but the onboarding and
  offboarding runbooks must reflect the measured times.)

**T33. Entra permission drift is detected** *(critical)*
- **Steps:** run the onboarding check script; then, *in a separate throwaway service principal or
  after recording all other results*, add an Entra `Mail.Read` application grant and re-run the
  script; then remove the grant.
- **Expected:** the script passes first, then fails, naming the grant.
- **Evidence:** both script outputs.
- **Fail if:** the script doesn't detect the grant. (Per ground rule 1, all other tests must have
  been completed and recorded before this grant is ever added to the real test principal. Using a
  throwaway principal is preferred.)

---

## B. Enrolment discovery (requirements 1–2; decision A1)

**T7. Category filter on Sent Items, RBAC-only token** *(critical)*
- **Steps:** in `cm-a`, send 25 messages to the external domain. Apply `JADA Follow-up` to exactly one
  in Sent Items (Outlook on the web), and other categories to three others. Run G1.
- **Expected:** G1 returns exactly the one tagged message; no error about filter support.
- **Evidence:** the G1 request and full raw response; a screenshot of Sent Items showing the
  categories.
- **Fail if:** the filter is rejected, the tagged message is missing, or any untagged message is
  returned.

**T8. Category query returns only required metadata** *(critical; DP lead sign-off)*
- **Steps:** inspect the T7 raw response.
- **Expected:** each item contains only `id`, `conversationId`, `internetMessageId`, `sentDateTime`,
  `categories`, plus OData annotations (`@odata.etag`; collection-level `@odata.context` /
  `@odata.nextLink`).
- **Evidence:** the raw response, annotated.
- **Fail if:** any other property appears (e.g. `subject`, `bodyPreview`, `from`, `toRecipients`).

**T9. Category-to-filterable latency**
- **Steps:** apply the category in classic Outlook desktop, new Outlook and Outlook on the web (10
  times each, spaced out); poll G1 every minute; record the delay until each appears.
- **Expected:** p95 ≤ 30 minutes (the discovery interval).
- **Evidence:** a table of apply time vs first-seen time per client.
- **Fail if:** p95 > 30 minutes, or any tag never appears within 2 hours. That isn't a stop
  condition: return with options (a longer interval, or the add-in).

**T10. Tagging variants**
- **Steps:**
  1. tag via a Quick Step;
  2. tag a whole conversation in conversation view;
  3. tag the client's reply in the Inbox (wrong place);
  4. tag a message older than 14 days;
  5. remove and re-apply the tag.
- **Expected:**
  1. and 2. enrol;
  3. doesn't enrol (folder-scoped, by design);
  4. doesn't enrol (window);
  5. re-applying is detected, and handled per spec §7.
- **Evidence:** G1 results per variant.
- **Fail if:** Quick Step tagging isn't detected, or Inbox-tagged messages are returned.

**T11. ImmutableId behaviour** *(critical)*
- **Steps:** fetch the anchor's ID with and without `Prefer: IdType="ImmutableId"` (harness); move the
  anchor to another folder and back; GET it by the stored immutable ID.
- **Expected:** the immutable ID differs in format from the default ID and still resolves after
  moves.
- **Evidence:** the IDs before and after the moves; the GET responses.
- **Fail if:** the stored immutable ID stops resolving after an in-mailbox move.

---

## C. Conversation processing

**T12. Conversation filter returns only the enrolled conversation, across folders** *(critical)*
- **Steps:** the external client replies to the enrolled request; an inbox rule moves the reply to a
  subfolder. Also create five unrelated conversations with the same client address. Run G2 for the
  enrolled `conversationId`.
- **Expected:** G2 returns the anchor and the reply (from the subfolder), and nothing from the
  unrelated conversations.
- **Evidence:** the raw G2 response with message IDs mapped to the test script.
- **Fail if:** the filter is rejected, the reply is missing, or any unrelated message is returned.

**T13. Anchor recovery by `internetMessageId`**
- **Steps:** run G4 with the stored `internetMessageId`.
- **Expected:** exactly the anchor.
- **Evidence:** response.
- **Fail if:** more or fewer messages are returned.

**T14. Reply status from metadata**
- **Steps:** with G2 results, the gateway classifies messages: client reply vs internal colleague vs
  outbound.
- **Expected:** classification matches the scripted scenario; `from` isn't stored or logged.
- **Evidence:** classification output; a database row and log extract showing no address.
- **Fail if:** misclassification, or the address appears in storage or logs.

**T15. Headers for auto-replies and delivery reports**
- **Steps:** trigger an out-of-office reply and a non-delivery report into the enrolled conversation;
  run G3a.
- **Expected:** `internetMessageHeaders` readable under the RBAC role; auto-reply identified by
  `Auto-Submitted` / `X-Auto-Response-Suppress`; the delivery report identifiable.
- **Evidence:** the relevant header names and values (other headers redacted from the evidence).
- **Fail if:** headers aren't returned. Not a stop condition, but the classification design must
  change, and the change must be documented.

**T16. Deleted and archived anchors**
- **Steps:** delete one enrolled anchor; move another to the online archive, if available in the test
  tenant.
- **Expected:** GET by immutable ID → not found; G4 recovery fails gracefully; the workflow becomes
  `needs_attention` without any wider search.
- **Evidence:** responses; the gateway audit log showing no calls beyond G2/G4 for that workflow.
- **Fail if:** an unhandled error, or any call outside the allowed shapes.

**T23. Manual follow-up detection**
- **Steps:** the case manager sends their own follow-up in the conversation before a step is due.
- **Expected:** detected as an outbound message; the step is marked as satisfied; no JADA draft for
  that step.
- **Evidence:** the workflow event log.
- **Fail if:** a JADA draft is created for that step.

**T24. "Done" time proxy**
- **Steps:** apply `JADA: done` at a recorded time; separately mark another message read, flag it,
  and move it; compare `lastModifiedDateTime`.
- **Expected:** `lastModifiedDateTime` reflects the category change. Record which other actions also
  change it.
- **Evidence:** before/after values.
- **Fail if:** it isn't updated by a category change. M1 then uses the first-seen time (daily
  granularity), and the measurement plan must say so.

---

## D. Draft creation (requirement 6)

**T17. `createReply` on the latest outbound message: conversation and recipients** *(critical)*
- **Steps:**
  1. Run G5 (`createReply` with `comment`) on the enrolled sent request, which had the client as To
     and a colleague as Cc.
  2. Inspect the draft with the inspection harness (`$select=toRecipients,ccRecipients,
     conversationId,parentFolderId,subject`; harness only).
  3. Open it in Outlook.
- **Expected:**
  - the draft is in Drafts;
  - same `conversationId`;
  - **To = the original To recipient (the client), not the mailbox owner**;
  - Cc behaviour recorded;
  - the approved text sits above the quoted chain;
  - the subject is the reply form of the original.
- **Evidence:** harness output; Outlook screenshots (web and desktop); the G5 request body.
- **Fail if:**
  - To is the mailbox owner or anyone other than the original To recipients;
  - the draft is in a different conversation;
  - the comment is missing or misplaced.
  On failure, run T18. **G5 is not built as specified.**

**T18. Recipient alternatives (only if T17 fails)**
- **Steps:**
  1. `createReplyAll` on the same message;
  2. `createReply` with an explicit `message.toRecipients` copied from the anchor (which requires
     reading `toRecipients`).
- **Expected:** record the recipients, threading and placement for each.
- **Evidence:** as T17.
- **Fail if:** neither produces a correctly addressed, same-conversation draft. Return with options.
  **Choosing option 2 needs approval**, because it widens the data JADA reads.

**T19. Response handling: the draft body is never retained** *(critical; DP lead sign-off)*
- **Steps:** run G5 with log capture on; inspect the database and logs.
- **Expected:** only `id` and `createdDateTime` are extracted; no body, recipients or subject in the
  database or logs.
- **Evidence:** a database row dump; a log extract; a scan for test-domain addresses and subject text
  (zero hits).
- **Fail if:** any content is persisted or logged.

**T20. Draft categories after sending**
- **Steps:** G6 adds `JADA: draft ready` to a draft; the case manager sends it; inspect (a) the sent
  copy's categories (harness) and (b) the full raw source of the message received by the external
  test mailbox.
- **Expected:** record whether the sent copy keeps the category; **the external message contains no
  category or keyword data**.
- **Evidence:** harness output; the external raw message source.
- **Fail if:** the category is visible in the external message. Then stop categorising drafts and use
  T21, which is a technical change within the approved scope.

**T21. Extended-property marking (if T20 fails, or the category isn't kept on sent copies)**
- **Steps:** set a single-value extended property on the draft; send it; read the property on the
  sent copy.
- **Expected:** the property persists on the sent copy, and isn't present in the external raw source.
- **Evidence:** as T20.
- **Fail if:** not persisted. Sent detection then falls back to "an outbound message in the
  conversation after the draft's creation time", which must be documented.

**T22. Duplicate prevention** *(critical)*
- **Steps:**
  1. run the draft pass twice for the same due step;
  2. kill the process after G5 returns but before the draft ID is persisted; restart.
- **Expected:**
  1. exactly one draft;
  2. the orphaned draft is found by the just-in-time check and adopted; no second draft.
- **Evidence:** a Drafts folder listing (harness); the workflow event log.
- **Fail if:** more than one JADA draft exists for one step.

**T25. Throttling and retry**
- **Steps:** inject 429 and 503 responses (with `Retry-After`) at each gateway call in the test
  harness.
- **Expected:** back-off is honoured; no duplicate or partial step; resumes next cycle.
- **Evidence:** the event log and call log.
- **Fail if:** a duplicate draft, a lost state transition, or a retry storm.

---

## E. Gateway and architecture (requirements 3, 4, 5, 7, 8)

**T26. No component can bypass the gateway** *(critical)*
- **Steps:** run the static boundary test on the spike codebase; add a fixture file outside the
  gateway that imports an HTTP client and calls `graph.microsoft.com`; re-run.
- **Expected:** passes on the clean code; **fails** on the fixture, naming the file.
- **Evidence:** CI output for both runs.
- **Fail if:** the violating fixture isn't detected.

**T27. Credential confinement** *(critical)*
- **Steps:** code inspection and a unit test: attempt to obtain a token or certificate from outside the
  gateway module.
- **Expected:** no exported token or credential accessor; the attempt fails.
- **Evidence:** test output; a reviewer's note on the inspection.
- **Fail if:** any non-gateway path can obtain a token.

**T28. Disallowed request shapes are rejected before the network** *(critical)*
- **Steps:** a unit-test matrix against the gateway:
  - `$select` with `body`, `bodyPreview`, `subject` or `toRecipients`;
  - `$search`;
  - an unfiltered message list;
  - a conversation ID not in an active workflow;
  - a terminal workflow;
  - delete, move, send;
  - an unknown path;
  - a G5 comment not matching an approved template version.
- **Expected:** every case is rejected; **zero HTTP requests are made** (asserted with a transport
  spy).
- **Evidence:** test report.
- **Fail if:** any case reaches the transport.

**T29. ImmutableId on every request** *(critical)*
- **Steps:** capture all outgoing requests during the T7–T25 runs.
- **Expected:** 100% carry `Prefer: IdType="ImmutableId"`; callers can't override it (unit test).
- **Evidence:** the captured request log with a count; the unit test.
- **Fail if:** any request lacks the header.

**T30. Discovery and processing are separated** *(critical)*
- **Steps:**
  1. the discovery job attempts G2/G5 (unit test);
  2. the processing job attempts G1 (unit test);
  3. discovery attempts G6 on an already-registered anchor;
  4. a 3-day run.
- **Expected:**
  1.–3. rejected;
  4. the call log shows discovery issuing only G1 plus G6 on newly registered anchors, and
     processing never issuing G1.
- **Evidence:** test report; a call-log extract grouped by job.
- **Fail if:** any cross-job call succeeds.

**T31. Three-day run: only enrolled conversations touched; logs content-free** *(critical; DP lead
sign-off)*
- **Steps:** run discovery and processing for 3 days (with an accelerated clock if needed) on `cm-a`
  with 1–2 enrolled conversations and at least 30 unrelated ones, including messages from the same
  client address.
- **Expected:** the gateway audit log contains only:
  - G1 results (tagged messages);
  - message IDs in enrolled conversations;
  - JADA drafts.
  A scan of logs and the database finds no email addresses, subjects or body text.
- **Evidence:** the audit log extract with an ID-to-scenario mapping; scan output.
- **Fail if:** any ID from an unrelated conversation appears, or any content is found.

**T32. Revocation handling in the runtime**
- **Steps:** remove `cm-b` from the scope group during a run.
- **Expected:** after propagation, 403 → mailbox marked inactive, its workflows paused, JADA alerted;
  no retry storm.
- **Evidence:** the event log; the alert record.
- **Fail if:** unhandled errors, or continued attempts beyond the back-off policy.

---

## Exit criteria and go/no-go

### Critical tests (all must pass for the build to start)

T1, T2, T3, T4, T5, T7, T8, T11, T12, T17 (or an approved T18 alternative), T19, T22, T26, T27, T28,
T29, T30, T31, T33.

### Non-critical tests (failures have documented fallbacks; must be *run*, not necessarily passed)

T6, T9, T10, T13, T14, T15, T16, T20/T21, T23, T24, T25, T32.

### Outcomes

| Result | Decision |
|---|---|
| All critical tests pass; all non-critical tests run, with fallbacks documented where needed | **GO for the Outlook integration** (real Graph transport, G1–G6, onboarding scripts, then tenant connection) |
| T2, T3 or T4 fails | **STOP the Outlook integration (A3).** Return with alternatives and their security implications for explicit approval. Microsoft-independent work is unaffected |
| T5, T19, T26–T31 or T33 fails | **NO-GO** until fixed and re-tested. These are JADA-side controls, so the fix is in JADA's code or configuration |
| T7, T8, T11 or T12 fails | **NO-GO for Option A.** Return with options (including the Outlook add-in) for approval (A1 condition) |
| T17 fails and T18 offers only option 2 | **Pause** for approval of the widened data read |

### Recommendation

- **Spike: GO now.** Estimated 4–5 days, with one engineer and both test tenants available.
- **The spike gates only the Outlook integration.** The rest of the application build (all builda+
  work, and the runtime's Microsoft-independent components, built against a fake Graph transport)
  proceeds in parallel. See spec §11.1.
- **Outlook integration: NO-GO until the critical tests pass**, with evidence signed off. That covers
  the real Graph transport, the concrete G1–G6 calls, the onboarding scripts, and any connection to a
  firm tenant.
- Parallel work doesn't change the A3 stop rule or any failure condition. A spike failure is never
  accepted to protect work already done.
- After a GO, the per-firm onboarding runbook must use the measured T6 (propagation) and T9
  (latency) values, not assumed ones.
