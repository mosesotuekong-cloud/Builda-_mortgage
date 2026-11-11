import type { Classification } from '../domain/journey';
import type { ConfidenceDimension, DimensionAssessment } from './confidence';
import type { Dimension, DimensionScore } from './scoring';

// Opportunity gates and priority (Phase 4). Sits on top of the existing scoring engine: the weighted
// score and its dimensions come from scoring.ts unchanged. This layer decides what may be ranked and
// keeps value, feasibility, confidence and risk visible as separate readings.
export type OpportunityStatus = 'keep_human' | 'needs_classification' | 'needs_evidence' | 'compliance_review' | 'awaiting_validation' | 'ready_for_review'
  | 'approved' | 'challenged' | 'rejected' | 'sent_to_engineering';
export type DecisionValue = 'approved' | 'challenged' | 'rejected' | 'reopened' | 'sent_to_engineering';
export interface Gate { code: string; label: string; blocksPriority: boolean; blocksEngineering: boolean }
export interface PriorityInput {
  classification: Classification | null;
  dimensions: Record<ConfidenceDimension, DimensionAssessment>;
  requiresComplianceReview: boolean;
  validated: boolean;
  disputedEvidence: number;
  missingMeasurements: string[];
  score: number | null;                         // existing deterministic score (null when the scoring engine excluded it)
  breakdown: Partial<Record<Dimension, DimensionScore>> | null;
  decision: DecisionValue | null;               // latest firm decision
}
export interface PriorityAssessment {
  gates: Gate[];
  status: OpportunityStatus;
  rankable: boolean;
  band: 'High' | 'Medium' | 'Low' | null;
  readings: { value: number | null; feasibility: number | null; confidence: number | null; risk: number | null; valueUnknown: boolean };
}

// Bands are fixed and documented: they describe the existing 0–100 score; they don't change it.
export const PRIORITY_BANDS = { high: 65, medium: 45 };
const avg = (...xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

export function assessPriority(i: PriorityInput): PriorityAssessment {
  const gates: Gate[] = [];
  const gate = (code: string, label: string, blocksPriority: boolean, blocksEngineering = blocksPriority) => gates.push({ code, label, blocksPriority, blocksEngineering });
  if (i.classification === 'keep_human') gate('keep_human', 'Stays with people: not ranked as a change', true);
  if (!i.classification) gate('unclassified', 'Not yet classified', true);
  if (i.dimensions.existence.level === 'insufficient') gate('no_firm_evidence', 'No firm-specific evidence that the problem exists here', true);
  else if (i.dimensions.existence.level === 'low') gate('single_account', 'Described by one person only: corroborate before engineering review', false, true);
  // A serious regulatory constraint is never outweighed by impact: it takes the item out of the ranking.
  if (i.requiresComplianceReview && i.classification && i.classification !== 'keep_human') gate('compliance_review', 'Involves regulated judgement: compliance review first', true);
  if (i.disputedEvidence > 0) gate('disputed_evidence', 'Some evidence is disputed', false, false);
  if (i.missingMeasurements.length) gate('missing_measurements', 'Volume or time not yet given: value can’t be estimated', false, false);
  // No separate validation step: approving an opportunity is how the firm confirms its finding. Unconfirmed
  // findings still can't go to the (parked) engineering hand-over.
  if (!i.validated) gate('not_validated', 'Not yet confirmed by the firm', false, true);

  const blocked = gates.some((g) => g.blocksPriority);
  let status: OpportunityStatus;
  if (i.classification === 'keep_human') status = 'keep_human';
  else if (gates.some((g) => g.code === 'no_firm_evidence')) status = 'needs_evidence';
  else if (gates.some((g) => g.code === 'unclassified')) status = 'needs_classification';
  else if (gates.some((g) => g.code === 'compliance_review')) status = 'compliance_review';
  else if (i.decision === 'sent_to_engineering') status = 'sent_to_engineering';
  else if (i.decision === 'approved') status = 'approved';
  else if (i.decision === 'rejected') status = 'rejected';
  else if (i.decision === 'challenged') status = 'challenged';
  else status = 'ready_for_review';

  const rankable = !blocked && i.score !== null && status !== 'rejected';
  const b = i.breakdown;
  return {
    gates, status, rankable,
    band: rankable && i.score !== null ? (i.score >= PRIORITY_BANDS.high ? 'High' : i.score >= PRIORITY_BANDS.medium ? 'Medium' : 'Low') : null,
    readings: b
      ? { value: avg(b.impact?.score, b.volume?.score), feasibility: avg(b.feasibility?.score, b.complexity?.score), confidence: b.confidence?.score ?? null, risk: b.risk?.score ?? null,
          // Unknown impact is scored at the floor (1) by the engine; say so rather than let it read as a small value.
          valueUnknown: /unknown/i.test(b.impact?.rationale ?? '') }
      : { value: null, feasibility: null, confidence: null, risk: null, valueUnknown: true },
  };
}
