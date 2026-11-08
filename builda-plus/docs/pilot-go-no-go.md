# First pilot: definition and go/no-go gates

The pilot decision is made against these gates, not against feature completeness or passing tests.
Completing the build and the demonstration does **not** authorise a live customer deployment.

## 1. Pilot definition (minimum viable first pilot)

| Dimension | Definition |
|---|---|
| Firm | One UK mortgage brokerage, FCA-authorised (directly authorised preferred; an appointed representative only with its network's written agreement to the scope), 10–30 advisers, with case managers or administrators |
| People | 6–10 participants: the firm lead, at least 3 advisers, and at least 2 from case management or administration. Fewer than 3 in a role means that role's quotes are withheld, as designed |
| Stages in scope for change | Non-regulated operational stages: enquiry, documents, decision in principle, full application, valuation and underwriting, offer, completion |
| Regulated stages | Interviews may touch them, but anything raised there is held (keep human, or compliance review). Nothing is changed at a regulated stage during the pilot |
| Data | Interview accounts and the firm's own operational figures. **No client mortgage case data, no client documents, no client identifiers.** Client-data guard active; any trigger is reviewed by JADA |
| Integrations | **None.** No Outlook (spike not run), no CRM connection. Any data from the firm's systems arrives as a summary the firm lead enters themselves |
| Automation | **No autonomous actions.** Recommendations only; every recommendation is reviewed by the firm lead; every engineering decision is made by a named JADA engineer |
| Engineering outcomes in scope | Fix and Overhaul by default. Automate only if `document_chasing_v1` has passed design review and its tests, and then only with staff approval of every message |
| Duration | About 8 weeks: weeks 1–3 discovery, week 4 review and decisions, weeks 5–8 implementation of at most two approved Fix or Overhaul changes, plus measurement |
| Commercial | The two-week build is not offered (no tested template). No savings are promised |

## 2. What the pilot must validate (measurable, no financial assumptions)

| # | Question | Measure | Evidence source | Pass threshold (to agree before start) |
|---|---|---|---|---|
| 1 | Will people complete the interviews? | Share of invited participants who finish; median interview length | Discovery progress, interview sessions | ≥ 80% complete; median ≤ 30 minutes |
| 2 | Is the evidence good enough to act on? | Share of findings with "problem exists here" at medium or above; number with conflicting accounts surfaced | Discovery workspace | ≥ 60% at medium+; conflicts shown, not averaged |
| 3 | Does the firm recognise the findings? | Share of findings the firm lead validates; number corrected or disputed, with reasons | Corrections and evidence reviews (audit) | ≥ 70% validated; every dispute has a reason |
| 4 | Are the classifications right? | Firm lead and JADA agreement with each classification; number reclassified | Corrections; engineering design records | Reclassification recorded and explained; no keep-human or regulated item submitted |
| 5 | Is the brief enough for engineering? | Information requests per submission; days from submission to a design decision | Engineering history | ≤ 2 requests on average; design decision within 10 working days |
| 6 | Did an implemented change improve the agreed operational measure? | For each implemented change: baseline, agreed target, measured result, measurement source and period | Implementation plan and outcome | Result recorded from the agreed source. "Not yet measured" is an acceptable, honest end state if the period hasn't elapsed |
| 7 | Did the safeguards hold? | Cross-firm access events; quotes shown below the 3-person threshold; client-data guard triggers and their handling; actions taken without a human | Audit log, tests, JADA review | Zero cross-firm access, zero threshold breaches, zero unhandled client-data triggers, zero autonomous actions |
| 8 | Would the firm continue? | Firm lead's structured end-of-pilot answer (continue, change, stop) with reasons | Pilot review meeting notes | Recorded; not scored |

Time recovered is reported as **capacity**, never as savings. Cash savings appear only if the firm states
specific spending it will stop, with its basis. Revenue is not reported.

## 3. Gates

All gates must be **Go** before the pilot firm is onboarded. Each gate names the evidence that closes it.

| Gate | Requirement | Evidence that closes it | Owner | Status today |
|---|---|---|---|---|
| G1 Production sign-in | R1 in `pilot-remediation-spec.md`: OIDC for firm leads and JADA, server-side revocable sessions, audited role management | R1 tests passing; demo routes absent in production | JADA engineering lead | **No-go**: not built |
| G2 Database authorisation | R2: definer functions use session identity; pick-up requires queue state; directory function removed; composite tenant keys | R2 SQL and integration tests; the Phase 6 exploit reproduced and refused | JADA engineering lead | **No-go**: app-level mitigation only |
| G3 Retention, deletion and withdrawal | R3 implemented; consent v2 wording approved; DPIA completed and signed | R3 tests; DPIA document; retention period set | Data protection lead | **No-go**: promise without implementation |
| G4 Quote-privacy threshold | P-1 fixed | P-1 tests | JADA engineering | **No-go**: latent defect |
| G5 Approved knowledge | Release published with reviewed cards for in-scope stages and four regulated-stage checks citing reviewer-verified sources (`knowledge-readiness.md` §4) | Published release version; four-eyes review records | Compliance reviewer + knowledge editor | **No-go**: no release |
| G6 Firm agreements | Data processing agreement; firm lead briefing; written employee briefing that discovery is not performance assessment; network agreement if an AR | Signed documents | JADA commercial lead | Not started |
| G7 Operational readiness | Named JADA engineer and compliance reviewer for the pilot; `JADA_CONTACT` set; escalation handling rehearsed; backup and restore tested on the pilot database | Named people; restore test record | JADA engineering lead | Not started |
| G8 Outlook | **Excluded from the pilot.** Becomes a separate gate (the spike's critical tests) only if a later pilot includes it | — | — | Out of scope |
| G9 Demonstration accepted | The `demo-runbook.md` journey shown to the decision-makers; open questions recorded | Meeting notes | Product owner | Ready to run |

### Decision points
1. **Demonstration (now):** run G9, then agree the pass thresholds in section 2.
2. **Pre-pilot gate:** G1–G7 all Go, then onboard the firm. Any No-go means no onboarding, with no
   exceptions and no "temporary" workarounds such as demo sign-in in production.
3. **Start of interviews:** confirm the participant list meets section 1 (role group sizes) and the
   employee briefing has been given.
4. **End of pilot (week 8):** review each section 2 measure against its threshold, the safeguard record
   (measure 7) and the firm's answer (measure 8). Decide: proceed to a second firm (which first requires
   the composite tenant keys under G2), revise, or stop.

## 4. What would stop the pilot early

- Any cross-firm data exposure, or any quote shown below the threshold.
- Client case data found in discovery content that the guard did not catch.
- Any automated action taken without a named person's approval.
- A participant withdrawal that can't be completed within the stated process.
