import { STAGES, type Classification, type StageId } from '../domain/journey';
import type { ConfidenceOrInsufficient } from './confidence';
import type { ImpactResult } from './impact';

// Deterministic opportunity scoring (brief §6.2). Every dimension is 1–5 with a documented band.
export const DIMENSIONS = ['impact', 'volume', 'feasibility', 'complexity', 'risk', 'confidence'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface ScoringConfig { version: string; weights: Record<Dimension, number> }
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  version: 'scoring-2026-11-v1',
  weights: { impact: 0.3, volume: 0.15, feasibility: 0.2, complexity: 0.1, risk: 0.1, confidence: 0.15 },
};

export interface OpportunityInput {
  id: string;
  title: string;
  stageId: StageId;
  classification: Classification;
  impact: ImpactResult;
  monthlyVolume: number | null;
  confidence: ConfidenceOrInsufficient;
  templateAvailable: boolean;
  complexity: 'low' | 'medium' | 'high' | null;
}
export interface DimensionScore { score: number; rationale: string }
export interface ScoredOpportunity { input: OpportunityInput; total: number; dimensions: Record<Dimension, DimensionScore>; configVersion: string }
export interface RankedOpportunity extends ScoredOpportunity { rank: number }

const band = (v: number, limits: number[]) => 1 + limits.filter((l) => v >= l).length; // limits ascending, 4 limits -> 1..5

export function scoreDimensions(o: OpportunityInput): Record<Dimension, DimensionScore> {
  const hrs = o.impact.monthlyHoursRecovered;
  const reg = STAGES[o.stageId].regulatedJudgement;
  return {
    impact: hrs === null
      ? { score: 1, rationale: 'unknown' }
      : { score: band(hrs, [5, 15, 30, 60]), rationale: `${hrs} hours a month` },
    volume: o.monthlyVolume === null
      ? { score: 1, rationale: 'unknown' }
      : { score: band(o.monthlyVolume, [20, 50, 100, 200]), rationale: `${o.monthlyVolume} times a month` },
    feasibility: o.templateAvailable
      ? { score: 5, rationale: 'a proven JADA design' }
      : { score: { fix: 4, automate: 3, overhaul: 2, keep_human: 1 }[o.classification], rationale: { fix: 'a fix to the existing process', automate: 'automation with no proven design yet', overhaul: 'a process redesign', keep_human: 'work that stays with people' }[o.classification] },
    complexity: o.complexity === null
      ? { score: 2, rationale: 'not yet assessed' }
      : { score: { low: 5, medium: 3, high: 1 }[o.complexity], rationale: o.complexity },
    risk: reg
      ? { score: 2, rationale: 'a regulated step (the adviser decides)' }
      : { score: 5, rationale: 'no regulated decisions at this step' },
    confidence: {
      score: { very_high: 5, high: 4, medium: 3, low: 2, insufficient: 0 }[o.confidence],
      rationale: o.confidence.replace('_', ' '),
    },
  };
}

export function validateConfig(cfg: ScoringConfig): void {
  const sum = DIMENSIONS.reduce((n, d) => n + cfg.weights[d], 0);
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`Scoring weights must sum to 1 (got ${sum})`);
  if (DIMENSIONS.some((d) => cfg.weights[d] < 0)) throw new Error('Scoring weights must be non-negative');
}

export function scoreOpportunity(o: OpportunityInput, cfg = DEFAULT_SCORING_CONFIG): ScoredOpportunity {
  validateConfig(cfg);
  const dimensions = scoreDimensions(o);
  const total = DIMENSIONS.reduce((n, d) => n + cfg.weights[d] * (dimensions[d].score / 5) * 100, 0);
  return { input: o, total: Math.round(total * 10) / 10, dimensions, configVersion: cfg.version };
}

export const unsized = (s: ScoredOpportunity) => s.input.impact.monthlyHoursSpent === null;

export function rankOpportunities(list: OpportunityInput[], cfg = DEFAULT_SCORING_CONFIG) {
  const excluded: { id: string; reason: string }[] = [];
  const eligible: ScoredOpportunity[] = [];
  for (const o of list) {
    if (o.classification === 'keep_human') { excluded.push({ id: o.id, reason: 'Classified keep human — not ranked as an improvement opportunity' }); continue; }
    if (o.confidence === 'insufficient') { excluded.push({ id: o.id, reason: 'Insufficient evidence — more information needed before ranking' }); continue; }
    eligible.push(scoreOpportunity(o, cfg));
  }
  // A problem whose staff time is known comes before one nobody has sized, whatever the score: otherwise a
  // problem with no figures can outrank one costing the firm many hours.
  eligible.sort((a, b) =>
    Number(unsized(a)) - Number(unsized(b)) ||
    b.total - a.total ||
    (b.input.impact.monthlyHoursRecovered ?? -1) - (a.input.impact.monthlyHoursRecovered ?? -1) ||
    a.input.id.localeCompare(b.input.id));
  const ranked: RankedOpportunity[] = eligible.map((s, i) => ({ ...s, rank: i + 1 }));
  return { ranked, excluded, configVersion: cfg.version };
}

// "Why does A rank above B?" — weighted contribution differences, largest first, in plain words.
const PLAIN: Record<Dimension, string> = { impact: 'Time saved', volume: 'How often it happens', feasibility: 'Readiness to build', complexity: 'Build effort', risk: 'Regulatory risk', confidence: 'Strength of evidence' };
export function explainRanking(a: ScoredOpportunity, b: ScoredOpportunity, cfg = DEFAULT_SCORING_CONFIG): string[] {
  const sizing = !unsized(a) && unsized(b)
    ? [`Staff time: ${a.input.impact.monthlyHoursSpent} hours a month here, not given yet for the next one (problems we can size come first)`] : [];
  return [...sizing, ...DIMENSIONS
    .map((d) => ({ d, delta: cfg.weights[d] * ((a.dimensions[d].score - b.dimensions[d].score) / 5) * 100 }))
    .filter((x) => Math.abs(x.delta) >= 0.05)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .map(({ d, delta }) => `${PLAIN[d]}: ${a.dimensions[d].rationale} here, ${b.dimensions[d].rationale} for the next one (${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(0)} points out of 100)`)];
}
