import type { EvidenceSource } from '../domain/schemas';

// Evidence confidence (brief §4 step 7). Describes evidence quality, not statistical certainty.
export type ConfidenceLevel = 'low' | 'medium' | 'high' | 'very_high';
export type ConfidenceOrInsufficient = ConfidenceLevel | 'insufficient';

export interface ConfidenceInput {
  participantRef: string;
  source: EvidenceSource;
  monthlyVolume: number | null;
  minutesPerOccurrence: number | null;
}
export interface Disagreement { field: 'monthlyVolume' | 'minutesPerOccurrence'; min: number; max: number; byParticipant: Record<string, number> }
export interface ConfidenceAssessment { level: ConfidenceOrInsufficient; participantCount: number; disagreements: Disagreement[]; reasons: string[] }

// Two accounts count as "consistent" if the larger figure is at most this multiple of the smaller.
export const CONSISTENCY_RATIO = 2;

export function assessConfidence(records: ConfidenceInput[]): ConfidenceAssessment {
  const said = records.filter((r) => r.source === 'firm_said');
  const participants = [...new Set(said.map((r) => r.participantRef))];
  const disagreements = findDisagreements(said);

  // A measurement proves a figure, not that the problem exists or why. Very high needs both figures
  // measured AND the problem reported by the people doing the work.
  const measured = records.filter((r) => r.source === 'measured_baseline');
  const fullyMeasured = measured.some((r) => r.monthlyVolume !== null) && measured.some((r) => r.minutesPerOccurrence !== null);
  if (fullyMeasured && participants.length >= 1) {
    return { level: 'very_high', participantCount: participants.length, disagreements, reasons: ['Volume and time directly measured, and the problem reported by staff'] };
  }
  if (participants.length === 0) {
    return { level: 'insufficient', participantCount: 0, disagreements, reasons: ['No direct participant account — playbook knowledge or assumptions alone cannot support a recommendation'] };
  }
  const consistent = disagreements.length === 0;
  if (participants.length >= 2 && consistent) {
    const hasRecords = records.some((r) => r.source === 'operational_record' || r.source === 'measured_baseline');
    return hasRecords
      ? { level: 'high', participantCount: participants.length, disagreements, reasons: ['Consistent accounts from multiple participants, supported by operational records'] }
      : { level: 'medium', participantCount: participants.length, disagreements, reasons: ['Consistent accounts from multiple participants'] };
  }
  return {
    level: 'low', participantCount: participants.length, disagreements,
    reasons: [participants.length === 1 ? "Single participant's estimate" : 'Participants gave materially different figures — preserved for firm-lead review'],
  };
}

function findDisagreements(rs: ConfidenceInput[]): Disagreement[] {
  const out: Disagreement[] = [];
  for (const field of ['monthlyVolume', 'minutesPerOccurrence'] as const) {
    const byParticipant: Record<string, number> = {};
    for (const r of rs) { const v = r[field]; if (v !== null) byParticipant[r.participantRef] = v; } // latest per participant
    const values = Object.values(byParticipant);
    if (values.length < 2) continue;
    const min = Math.min(...values), max = Math.max(...values);
    const inconsistent = min === 0 ? max > 0 : max / min > CONSISTENCY_RATIO;
    if (inconsistent) out.push({ field, min, max, byParticipant });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Confidence by dimension (Phase 3). Each claim about a finding is assessed on its own evidence:
// that the problem exists here, how often it happens, how long it takes, and the resulting impact.
// Deterministic; the AI plays no part. A firm-lead correction is recorded as one attested account,
// so it never raises confidence by itself.
export type ConfidenceDimension = 'existence' | 'volume' | 'effort' | 'impact';
export interface DimensionAssessment { level: ConfidenceOrInsufficient; reasons: string[] }
export interface DimensionOptions {
  overrides?: { monthlyVolume?: number | null; minutesPerOccurrence?: number | null; reductionPct?: number | null };
  reductionBasis?: 'firm_lead' | 'template' | null;
}
const ORDER: ConfidenceOrInsufficient[] = ['insufficient', 'low', 'medium', 'high', 'very_high'];
export const minLevel = (...ls: ConfidenceOrInsufficient[]): ConfidenceOrInsufficient => ls.reduce((m, l) => (ORDER.indexOf(l) < ORDER.indexOf(m) ? l : m), 'very_high' as ConfidenceOrInsufficient);

function figureConfidence(records: ConfidenceInput[], field: 'monthlyVolume' | 'minutesPerOccurrence', override: number | null | undefined, label: string): DimensionAssessment {
  if (override !== undefined) {
    return { level: override === null ? 'insufficient' : 'low', reasons: [override === null ? `${label} cleared by the firm lead` : `${label} entered by the firm lead; nobody else has confirmed it yet`] };
  }
  if (records.some((r) => r.source === 'measured_baseline' && r[field] !== null)) return { level: 'very_high', reasons: [`${label} directly measured`] };
  const said = records.filter((r) => r.source === 'firm_said' && r[field] !== null);
  const people = new Set(said.map((r) => r.participantRef)).size;
  const differ = findDisagreements(said).some((d) => d.field === field);
  const recorded = records.some((r) => r.source === 'operational_record' && r[field] !== null);
  if (people === 0) return recorded ? { level: 'medium', reasons: [`${label} from an operational record only`] } : { level: 'insufficient', reasons: [`No ${label.toLowerCase()} given yet`] };
  if (differ) return { level: 'low', reasons: [`Accounts of ${label.toLowerCase()} differ materially`] };
  if (people >= 2) return recorded ? { level: 'high', reasons: [`Consistent ${label.toLowerCase()} from ${people} people, supported by records`] } : { level: 'medium', reasons: [`Consistent ${label.toLowerCase()} from ${people} people`] };
  return { level: 'low', reasons: [`${label} estimated by one person`] };
}

export function assessDimensions(records: ConfidenceInput[], opts: DimensionOptions = {}): Record<ConfidenceDimension, DimensionAssessment> {
  const said = records.filter((r) => r.source === 'firm_said');
  const people = new Set(said.map((r) => r.participantRef)).size;
  const recorded = records.some((r) => r.source === 'operational_record' || r.source === 'measured_baseline');
  // Existence never reaches very high from measurement: a measured volume does not show the work is a problem.
  const existence: DimensionAssessment = people === 0
    ? { level: 'insufficient', reasons: ['Nobody at the firm has described this. Industry knowledge or assumptions alone cannot show it happens here'] }
    : people === 1 ? { level: 'low', reasons: ['Described by one person'] }
      : recorded ? { level: 'high', reasons: [`Described by ${people} people, supported by operational records`] }
        : { level: 'medium', reasons: [`Described independently by ${people} people`] };
  const volume = figureConfidence(records, 'monthlyVolume', opts.overrides?.monthlyVolume, 'Volume');
  const effort = figureConfidence(records, 'minutesPerOccurrence', opts.overrides?.minutesPerOccurrence, 'Time per occurrence');
  const base = minLevel(existence.level, volume.level, effort.level);
  const impactReasons = [`Worked out from how often it happens and how long it takes, so it is only as certain as the less certain of the two (${base.replace('_', ' ')})`];
  let impact: ConfidenceOrInsufficient = base;
  if (opts.reductionBasis) {
    impact = minLevel(base, 'low');
    impactReasons.push(opts.reductionBasis === 'template'
      ? 'The share of time that could be saved is JADA’s working estimate, not yet measured at a real firm'
      : 'The share of time that could be saved is the firm lead’s estimate');
  }
  return { existence, volume, effort, impact: { level: impact, reasons: impactReasons } };
}
