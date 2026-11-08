# Scoring review: why a single-account Fix outranked a two-account Overhaul

Phase 5, issue C. Scoring configuration reviewed: `scoring-2026-11-v1` (`src/engine/scoring.ts`).
**No change has been made to the scoring engine.** This note explains the behaviour and sets out the options.

## The case

In the Phase 4 synthetic discovery (local database, synthetic data only):

| Opportunity | Accounts | Class | Score | impact | volume | feasibility | complexity | risk | confidence |
|---|---|---|---|---|---|---|---|---|---|
| Logging in to lender portals | 1 | Fix | **48** | 1 | 2 | **4** | 2 | 5 | 2 (low) |
| Handing the case to the case team | 2 (10 vs 60 min) | Overhaul | **40** | 1 | 2 | **2** | 2 | 5 | 2 (low) |

Score = Σ weight × (dimension ÷ 5) × 100, with weights impact 0.30, volume 0.15, feasibility 0.20,
complexity 0.10, risk 0.10, confidence 0.15.

The whole 8-point gap is the feasibility dimension: 0.20 × (4 − 2) ÷ 5 × 100 = 8. Every other
dimension is identical.

## Why each dimension came out as it did

1. **Feasibility is a classification proxy when there is no tested template.** The engine scores
   fix 4, automate 3, overhaul 2, keep human 1. This is deliberate ("fix before automate"; a
   configuration change is usually cheaper and safer than a process redesign). It is not a judgement
   that the fix matters more.
2. **Confidence uses the older single aggregate rating, not Phase 3's per-claim ratings.** Both items
   were rated *low*, for different reasons: the Fix because one person described it; the Overhaul
   because two people agree it happens but disagree on the time (10 vs 60 minutes). Phase 3 separates
   these: existence is *low* for the Fix and *medium* for the Overhaul. The score does not see that
   difference.
3. **Unknown impact scores at the floor.** Neither item has a recovered-hours estimate (no reduction
   assumption exists for fixes or overhauls without a template), so both score 1 for impact, the same
   as a known, very small impact. Among items with unknown value, the order is therefore driven by
   classification and evidence, not by value.

## Is the result unintended?

- **Feasibility ordering: intended.** It encodes the agreed "fix before automate" principle.
- **Confidence collapse: an unintended side effect of Phase 3.** The score predates per-claim
  confidence. However, even if the confidence dimension used existence confidence, the Overhaul would
  gain 3 points (to 43) and still rank below the Fix (48). So this is not what produced this ordering.
- **Unknown impact treated as small: a transparency risk, not an arithmetic error.** The ordering
  between unknown-value items should not be read as a value ordering.

**Conclusion:** the ranking is the engine working as designed. It is reliable as an ordering of
"value where known, then ease and evidence"; it is not a ranking of evidence strength. Evidence
strength is enforced separately by the gates: the single-account Fix is ranked, but it cannot be sent
to engineering until a second account corroborates it (Phase 4 `single_account` gate).

## What changed in Phase 5 (transparency only)

- Each opportunity's value reading now says when impact is unknown and scored at the floor, so a
  low value reading is not mistaken for a measured small value.
- A regression test (`tests/engineering.integration.test.ts`, "scoring review") pins the breakdown
  above, so any future scoring change that alters it must be deliberate.

## Options for a versioned scoring change (not applied; needs a decision)

| Option | Effect on this case | Trade-off |
|---|---|---|
| A. Keep v1 (recommended for now) | None | Relies on gates for evidence strength |
| B. v2: confidence dimension = lower of aggregate and existence confidence | Overhaul 40 → 40 (existence medium does not lower it), Fix 48 → 48 | Makes single-account items never score above their existence rating; no change here |
| C. v2: confidence dimension = existence confidence | Overhaul 40 → 43, Fix 48 → 48 | Rewards corroboration; figure disagreement no longer lowers the score |
| D. v2: unknown impact excluded from the weighted sum and shown as "value unknown" | Both re-normalised; order unchanged | Clearer, but scores no longer comparable with v1 reports |

Any change would be issued as a new `scoring_config_version`, re-run on stored findings, with the
old version kept for reports already generated. Weights and bands remain a decision for the JADA
owner listed in the README ("Decisions needing a human owner").
