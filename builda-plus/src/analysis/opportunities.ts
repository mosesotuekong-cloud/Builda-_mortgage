import { STAGES, type Classification, type StageId } from '../domain/journey';
import type { ConfidenceOrInsufficient } from '../engine/confidence';
import { calculateImpact, type ImpactResult } from '../engine/impact';
import { DEFAULT_SCORING_CONFIG, explainRanking, rankOpportunities, scoreDimensions, type OpportunityInput, type ScoringConfig } from '../engine/scoring';
import { businessCase, type BusinessCase, type CaseInput } from '../engine/businessCase';
import { templateFor, type AutomationTemplate } from '../knowledge/templates';
import type { FirmProfile } from '../firm/profile';

// Opportunity building (brief §6, §7). Deterministic: re-runs after every correction without the model.

export interface PainPointForScoring {
  id: string; key: string; title: string; stageId: StageId;
  classification: Classification | null;
  confidence: ConfidenceOrInsufficient;
  volume: number | null; minutes: number | null;                       // consolidated medians
  volumeN?: number; minutesN?: number;                                   // how many people gave each figure
  overrides: {
    monthlyVolume?: number | null; minutesPerOccurrence?: number | null; reductionPct?: number | null;
    // Phase 4 business-case inputs, supplied by the firm through audited corrections.
    implementationCostGBP?: number | null; monthlyCashSavingGBP?: number | null; cashSavingBasis?: string | null;
    staffHoursPerCase?: number | null; revenuePerCaseGBP?: number | null; demandConfirmed?: boolean | null;
  };
  conversionAssumptions: string[];
  requiresComplianceReview: boolean;
}

export interface TwoWeekPrecheck { status: 'blocked' | 'provisional'; blockers: string[]; toConfirmInEngineeringReview: string[] }

export interface BuiltOpportunity {
  painPointId: string;
  impact: ImpactResult & { businessCase: BusinessCase };
  assumptions: string[];
  score: number | null;
  rank: number | null;
  breakdown: unknown;
  explanation: string[];
  twoWeek: TwoWeekPrecheck;
  excludedReason: string | null;
}

const ENGINEERING_CHECKS = [
  'One workflow with a clear start and finish',
  "No changes to the firm's core systems",
  'Access and test data ready on day one',
  'No unresolved dependencies',
];

export function precheckTwoWeek(pp: PainPointForScoring, template: AutomationTemplate | null): TwoWeekPrecheck {
  const blockers: string[] = [];
  if (pp.classification !== 'automate') blockers.push(pp.classification ? `Two-week builds are for automation; this is classified as "${pp.classification}"` : 'Not yet classified');
  if (!template) blockers.push('JADA has no ready-made design for this yet');
  else if (!template.tested) blockers.push(`JADA’s design "${template.name}" hasn’t been used at a firm yet`);
  if (pp.requiresComplianceReview) blockers.push('Regulated advice questions must be settled first');
  if (template && !template.humanApprovalBuiltIn) blockers.push('JADA’s design has no step where a person approves');
  return { status: blockers.length ? 'blocked' : 'provisional', blockers, toConfirmInEngineeringReview: ENGINEERING_CHECKS };
}

export function buildOpportunities(pps: PainPointForScoring[], profile: FirmProfile | null, cfg: ScoringConfig = DEFAULT_SCORING_CONFIG, templates?: AutomationTemplate[]): BuiltOpportunity[] {
  const prepared = pps.map((pp) => {
    const template = pp.classification === 'automate' ? templateFor(pp.key, templates) : null;
    const assumptions: string[] = [...pp.conversionAssumptions];
    const volume = pp.overrides.monthlyVolume !== undefined ? pp.overrides.monthlyVolume : pp.volume;
    const minutes = pp.overrides.minutesPerOccurrence !== undefined ? pp.overrides.minutesPerOccurrence : pp.minutes;
    if (pp.overrides.monthlyVolume !== undefined) assumptions.push('Monthly volume corrected by the firm lead');
    if (pp.overrides.minutesPerOccurrence !== undefined) assumptions.push('Time per occurrence corrected by the firm lead');
    let reductionPct: number | null = null;
    if (pp.overrides.reductionPct !== undefined && pp.overrides.reductionPct !== null) {
      reductionPct = pp.overrides.reductionPct; assumptions.push(`Share of time that could be saved: ${Math.round(reductionPct * 100)}%, set by the firm lead`);
    } else if (template) {
      reductionPct = template.expectedReductionPct; assumptions.push(`Share of time that could be saved: ${Math.round(reductionPct * 100)}%, ${template.reductionBasis}`);
    }
    const hourly = profile?.loadedHourlyCostGBP ?? null;
    if (hourly !== null) assumptions.push(`Labour cost of £${hourly}/hour supplied by the firm`);
    const o = pp.overrides;
    const reported = (n: number | undefined, x: number | null): CaseInput => ({ value: x, source: x === null ? null : 'employee_reported', note: n ? `middle of ${n} ${n === 1 ? 'account' : 'accounts'}` : undefined });
    const firm = (x: number | null | undefined, note?: string): CaseInput => ({ value: x ?? null, source: x === null || x === undefined ? null : 'firm_provided', note });
    const bc = businessCase({
      monthlyVolume: o.monthlyVolume !== undefined ? firm(o.monthlyVolume, 'corrected by the firm lead') : reported(pp.volumeN, pp.volume),
      minutesPerOccurrence: o.minutesPerOccurrence !== undefined ? firm(o.minutesPerOccurrence, 'corrected by the firm lead') : reported(pp.minutesN, pp.minutes),
      reductionPct: o.reductionPct !== undefined && o.reductionPct !== null ? firm(o.reductionPct, 'set by the firm lead')
        : template ? { value: template.expectedReductionPct, source: 'assumption', note: template.reductionBasis } : { value: null, source: null },
      loadedHourlyCostGBP: firm(hourly, 'firm profile'),
      implementationCostGBP: firm(o.implementationCostGBP), monthlyCashSavingGBP: firm(o.monthlyCashSavingGBP, o.cashSavingBasis ?? undefined),
      staffHoursPerCase: firm(o.staffHoursPerCase), revenuePerCaseGBP: firm(o.revenuePerCaseGBP), demandConfirmed: o.demandConfirmed === true,
    });
    // Payback is only ever calculated against cash the firm can actually save (never against recovered time).
    const impact = { ...calculateImpact({ monthlyVolume: volume, minutesPerOccurrence: minutes, reductionPct, loadedHourlyCostGBP: hourly, implementationCostGBP: null }),
      paybackMonths: bc.payback.months, businessCase: bc };
    const input: OpportunityInput | null = pp.classification ? {
      id: pp.id, title: pp.title, stageId: pp.stageId, classification: pp.classification, impact, monthlyVolume: volume,
      confidence: pp.confidence, templateAvailable: !!template?.tested, complexity: template?.typicalComplexity ?? null,
    } : null;
    return { pp, template, assumptions, impact, input };
  });

  // A regulatory constraint is never outweighed by impact: items at regulated stages that would change the
  // work are held out of the ranking until compliance review (keep-human items are excluded by the engine).
  const held = new Set(prepared.filter((p) => p.input && p.pp.requiresComplianceReview && p.pp.classification !== 'keep_human').map((p) => p.pp.id));
  const { ranked, excluded } = rankOpportunities(prepared.flatMap((p) => (p.input && !held.has(p.pp.id) ? [p.input] : [])), cfg);
  return prepared.map((p) => {
    const idx = ranked.findIndex((r) => r.input.id === p.pp.id);
    const r = ranked[idx];
    return {
      painPointId: p.pp.id,
      impact: p.impact,
      assumptions: p.assumptions,
      score: r?.total ?? null,
      rank: r?.rank ?? null,
      breakdown: r?.dimensions ?? (p.input ? scoreDimensions(p.input) : null),
      explanation: r && ranked[idx + 1] ? explainRanking(r, ranked[idx + 1]!, cfg) : [],
      twoWeek: precheckTwoWeek(p.pp, p.template),
      excludedReason: r ? null : held.has(p.pp.id) ? 'Involves regulated judgement: held out of the ranking until a compliance review'
        : (excluded.find((e) => e.id === p.pp.id)?.reason ?? 'Not yet classified'),
    };
  });
}

export { STAGES };
