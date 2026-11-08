import { STAGES, type Classification, type StageId } from '../domain/journey';
import { assessPriority, type DecisionValue, type PriorityAssessment } from '../engine/priority';
import type { BusinessCase } from '../engine/businessCase';
import { templateFor } from '../knowledge/templates';
import { checksFor } from '../knowledge/model';
import type { Playbook } from '../knowledge/playbook';
import type { DiscoveryWorkspace } from './service';

// Opportunity assessment (Phase 4). Deterministic: assembles what discovery established, the existing
// score and business case, and the gates. The AI's only contribution is the classification proposal
// already made during analysis (and shown with its source).

type Finding = DiscoveryWorkspace['findings'][number];
export interface PackRow { painPointId: string; status: string }
export interface OpportunityAssessment {
  id: string; key: string; title: string; stageId: StageId; stageName: string; regulated: boolean; systems: string[];
  classification: Classification | null; classificationSource: string | null; classificationRationale: string | null;
  automationType: 'conventional' | 'ai_assisted' | 'not_assessed' | null;
  status: PriorityAssessment['status']; priorityRank: number | null; band: PriorityAssessment['band']; score: number | null;
  readings: PriorityAssessment['readings']; gates: PriorityAssessment['gates']; explanation: string[];
  problem: { statement: string; roles: string[]; participantCount: number; causes: string[]; improvements: string[] };
  evidence: { ids: string[]; items: { id: string; observed: string; role: string; source: string; review: string }[]; total: number; disputed: number; bySource: Record<string, number>; dimensions: Finding['dimensions']; disagreements: Finding['disagreements'] };
  assessment: {
    dependencies: string[]; risks: string[]; missing: string[]; complexity: string; feasibility: string;
    twoWeek: { status: string; blockers: string[] } | null;
  };
  businessCase: BusinessCase | null;
  recommendedAction: { title: string; steps: string[] };
  decision: { latest: DecisionValue | null; reason: string | null; at: string | null };
  engineering: { eligible: boolean; blockers: string[]; packStatus: string | null };
  validated: boolean;
  needsReassessment: string | null;
}

const latestDecision = (f: Finding): OpportunityAssessment['decision'] => {
  const h = f.history.find((x) => x.field === 'opportunity_decision');   // history is newest first
  if (!h) return { latest: null, reason: null, at: null };
  const v = h.newValue as any;
  const d = (typeof v === 'string' ? v : v?.decision) as DecisionValue;
  return { latest: d === 'reopened' ? null : d, reason: h.reason, at: h.at as any };
};

export function assessOpportunities(dw: DiscoveryWorkspace, playbook: Playbook, packs: PackRow[]): OpportunityAssessment[] {
  const evidenceById = new Map(dw.evidence.map((e) => [e.id, e]));
  const inventory = dw.profile?.technology ?? [];
  const list = dw.findings.map((f): OpportunityAssessment => {
    const decision = latestDecision(f);
    const breakdown = (f as any).breakdown ?? null;
    const pr = assessPriority({
      classification: f.classification, dimensions: f.dimensions, requiresComplianceReview: f.requiresComplianceReview, validated: f.validated,
      disputedEvidence: f.disputedEvidence, missingMeasurements: f.missingMeasurements, score: f.score, breakdown, decision: decision.latest,
    });
    const items = f.evidenceIds.map((id: string) => evidenceById.get(id)).filter(Boolean) as DiscoveryWorkspace['evidence'];
    const bySource: Record<string, number> = {};
    for (const e of items) bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    const template = f.classification === 'automate' ? templateFor(f.key) : null;
    const card = playbook.cards.find((c) => c.id === f.key) ?? null;
    const systems = [...new Set(items.flatMap((e) => e.systems))];
    const known = (s: string) => inventory.find((t) => t.name.toLowerCase() === s.toLowerCase());
    const bc: BusinessCase | null = (f.impact as any)?.businessCase ?? null;

    const dependencies = [
      ...systems.map((s) => (known(s) ? `${s} (in your technology inventory)` : `${s} (named in interviews, not in your technology inventory)`)),
      ...(f.roles.length > 1 ? [`Roles involved: ${f.roles.join(', ')}`] : []),
      ...(f.requiresComplianceReview ? ['A qualified compliance reviewer'] : []),
      ...(f.classification === 'automate' ? [template ? `JADA template “${template.name}”${template.tested ? '' : ' (not yet tested)'}` : 'No JADA template yet: an engineering assessment is needed'] : []),
    ];
    const checks = f.classification ? checksFor(playbook, f.stageId as StageId, f.classification) : [];
    const risks = [
      ...(STAGES[f.stageId as StageId]?.regulatedJudgement ? ['This stage involves regulated judgement: any change may only prepare information for the adviser.'] : []),
      ...checks.map((c) => `${c.check.title}: ${c.check.requiredAction}`),
      ...(f.requiresComplianceReview && !checks.length ? ['No approved regulatory check covers this stage: refer it to a qualified compliance reviewer.'] : []),
      ...(card?.regulatoryLimits ?? []),
      ...(f.classification === 'automate' ? (card?.humanApproval ?? ['Staff approve client communications and record changes.']).map((x) => `Control: ${x}`) : []),
      ...(f.disputedEvidence ? [`${f.disputedEvidence} piece${f.disputedEvidence === 1 ? '' : 's'} of evidence disputed by the firm.`] : []),
    ];
    const missing = [
      ...f.missingMeasurements.map((m: string) => (m === 'monthlyVolume' ? 'How often it happens each month' : 'How long each occurrence takes')),
      ...(f.dimensions.existence.level === 'low' ? ['A second account from someone else involved'] : []),
      ...(f.dimensions.existence.level === 'insufficient' ? ['Any firm-specific account that this happens'] : []),
      ...(bc ? bc.missing.filter((m) => !/how often|minutes of staff/i.test(m)) : []),
      ...(f.outstandingQuestions as string[]),
    ];

    const action = recommend(f.classification, pr, f, template, systems, missing);
    const blockers = pr.gates.filter((g) => g.blocksEngineering).map((g) => g.label);
    if (decision.latest !== 'approved' && decision.latest !== 'sent_to_engineering') blockers.push('Not yet approved by the firm');
    const pack = packs.find((p) => p.painPointId === f.id) ?? null;
    return {
      id: f.id, key: f.key, systems, title: f.title, stageId: f.stageId as StageId, stageName: f.stageName, regulated: !!STAGES[f.stageId as StageId]?.regulatedJudgement,
      classification: f.classification, classificationSource: f.classificationSource ?? null, classificationRationale: f.classificationRationale ?? null,
      automationType: f.classification === 'automate' ? (template?.automationType ?? 'not_assessed') : null,
      status: pack && pr.status === 'approved' ? 'sent_to_engineering' : pr.status, priorityRank: null, band: pr.band, score: f.score,
      readings: pr.readings, gates: pr.gates, explanation: f.explanation as string[],
      problem: {
        statement: `${f.title}, at the ${f.stageName.toLowerCase()} stage, reported by ${f.roles.join(', ') || 'the firm'} (${f.participantCount} ${f.participantCount === 1 ? 'person' : 'people'}).`,
        roles: f.roles, participantCount: f.participantCount, causes: f.causes as string[], improvements: f.improvements as string[],
      },
      evidence: { ids: f.evidenceIds, items: items.map((e) => ({ id: e.id, observed: e.observed, role: e.role, source: e.source, review: e.review.status })), total: items.length, disputed: f.disputedEvidence, bySource, dimensions: f.dimensions, disagreements: f.disagreements },
      assessment: {
        dependencies, risks, missing: [...new Set(missing)],
        complexity: template ? `${template.typicalComplexity[0]!.toUpperCase()}${template.typicalComplexity.slice(1)} (from the JADA template)` : 'Not yet assessed: needs engineering review',
        feasibility: f.classification === 'automate' ? (template?.tested ? 'A tested JADA template exists' : template ? 'A JADA template exists but is not yet tested' : 'No JADA template: feasibility to be assessed')
          : f.classification === 'fix' ? 'Usually feasible within existing systems and processes' : f.classification === 'overhaul' ? 'Needs process redesign before anything is built' : '—',
        twoWeek: f.classification === 'automate' && f.twoWeek ? { status: (f.twoWeek as any).status, blockers: (f.twoWeek as any).blockers ?? [] } : null,
      },
      businessCase: bc, recommendedAction: action, decision,
      engineering: { eligible: blockers.length === 0 && !pack && decision.latest === 'approved', blockers: pack ? [] : blockers, packStatus: pack?.status ?? null },
      validated: f.validated,
      // Never fill in a missing score: say the item needs reassessing (e.g. analysed under earlier rules).
      needsReassessment: f.classification && f.classification !== 'keep_human' && f.score === null && !pr.gates.some((g) => g.blocksPriority)
        ? 'No score under the current rules: re-run the analysis to reassess it.' : null,
    };
  });
  // Priority order: only rankable items, by the existing deterministic score (ties: hours recovered, then id).
  const rankable = list.filter((o) => o.band !== null && o.status !== 'rejected')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)
      || (b.businessCase?.timeRecovered.monthlyHoursRecovered ?? -1) - (a.businessCase?.timeRecovered.monthlyHoursRecovered ?? -1) || a.id.localeCompare(b.id));
  rankable.forEach((o, i) => { o.priorityRank = i + 1; });
  return list.sort((a, b) => (a.priorityRank ?? 1e9) - (b.priorityRank ?? 1e9) || a.title.localeCompare(b.title));
}

function recommend(c: Classification | null, pr: PriorityAssessment, f: Finding, template: ReturnType<typeof templateFor>, systems: string[], missing: string[]) {
  if (pr.status === 'needs_evidence') return { title: 'Collect firm-specific evidence', steps: [...missing.slice(0, 4), 'Use follow-up questions or interview another person involved.'] };
  if (pr.status === 'compliance_review') return { title: 'Compliance review first', steps: ['Ask a qualified compliance reviewer to review the proposed change.', 'Any change may only prepare information for the adviser; the regulated decision stays with them.'] };
  switch (c) {
    case 'overhaul': return { title: 'Redesign the process', steps: ['Map the current process with the roles involved, including handovers and waiting points.', 'Agree a target process and clear ownership.', 'Only consider automation once the redesigned process is stable.'] };
    case 'fix': return { title: 'Correct the existing process or configuration', steps: [systems.length ? `Investigate how ${systems.join(', ')} is set up and used for this work.` : 'Investigate how the existing process is followed.', 'Correct it with the people involved; no new tool is needed.', 'Check the problem has gone after a few weeks.'] };
    case 'automate': return { title: 'Prepare a solution specification for engineering review', steps: [template ? `Start from the JADA template “${template.name}” (${template.automationType === 'conventional' ? 'conventional automation, no AI' : 'approach to be confirmed'}).` : 'No tested pattern exists: JADA engineering assesses whether and how to automate it.', 'Agree success measures and the human approval points before building.', 'Send to JADA engineering review once approved.'] };
    case 'keep_human': return { title: 'Keep this with people', steps: ['Record why human judgement and accountability must remain.', 'Look for safe supporting improvements, such as preparing information in advance.'] };
    default: return { title: 'Classify this finding', steps: ['Choose overhaul, fix, automate or keep human in the finding’s “Correct or clarify” section in discovery.', 'Classification comes before prioritisation: an unclassified finding is not ranked.'] };
  }
}

// The one approval rule, used by individual decisions and by the older bulk endpoint alike (Phase 5, issue A).
export const approvalBlockers = (o: Pick<OpportunityAssessment, 'gates'>) => o.gates.filter((g) => g.blocksPriority || g.code === 'not_validated');

// What JADA receives when an approved opportunity moves to engineering review (also kept as an audit snapshot).
export function handoverBrief(o: OpportunityAssessment, firmName: string) {
  const bc = o.businessCase;
  return {
    schemaVersion: 1, firmName, opportunityId: o.id, generatedAt: new Date().toISOString(),
    // Context for engineering (Phase 5): enough to assess without repeating discovery. No names, no client data.
    title: o.title, key: o.key, stageId: o.stageId, stageName: o.stageName, regulated: o.regulated, roles: o.problem.roles, participantCount: o.problem.participantCount,
    systems: o.systems, improvements: o.problem.improvements,
    priority: { rank: o.priorityRank, band: o.band, score: o.score, readings: o.readings },
    businessCase: bc, gates: o.gates.map((g) => g.label),
    firmValidated: { finding: o.validated, decision: o.decision.latest, decisionReason: o.decision.reason, decidedAt: o.decision.at, disputedEvidence: o.evidence.disputed,
      firmProvidedInputs: bc ? Object.values(bc.inputs).filter((i) => i.source === 'firm_provided').map((i) => i.label) : [] },
    problemStatement: o.problem.statement, causes: o.problem.causes,
    evidenceSummary: { items: o.evidence.total, bySource: o.evidence.bySource, disputed: o.evidence.disputed,
      confidence: Object.fromEntries(Object.entries(o.evidence.dimensions).map(([k, v]) => [k, v.level])),
      disagreements: o.evidence.disagreements.map((d: any) => `${d.field === 'minutesPerOccurrence' ? 'Minutes each time' : 'Times a month'}: ${d.values.map((v: any) => `${v.role} ${v.value}`).join(', ')}`) },
    classification: o.classification, automationType: o.automationType, classificationRationale: o.classificationRationale,
    recommendedOutcome: [...o.problem.improvements, ...o.recommendedAction.steps],
    expectedImpact: bc ? { monthlyHoursSpent: bc.timeRecovered.monthlyHoursSpent, monthlyHoursRecovered: bc.timeRecovered.monthlyHoursRecovered,
      cashSavingsGBP: bc.cashSavings.monthlyGBP, additionalCasesPerMonth: bc.capacity.additionalCasesPerMonth, revenuePotentialGBP: bc.revenue.monthlyPotentialGBP,
      paybackMonths: bc.payback.months, confidence: o.evidence.dimensions.impact.level } : null,
    dependencies: o.assessment.dependencies, risksAndControls: o.assessment.risks, outstandingQuestions: o.assessment.missing,
    successMeasures: proposedMeasures(o),
    status: 'Awaiting JADA engineering review. Nothing has been built or confirmed as feasible.',
  };
}

// Proposed, not agreed: built only from the firm's own baseline. Targets are set with the firm in engineering review.
export function proposedMeasures(o: OpportunityAssessment): string[] {
  const bc = o.businessCase;
  const m: string[] = [];
  const v = bc?.inputs.monthlyVolume.value, t = bc?.inputs.minutesPerOccurrence.value;
  if (t !== null && t !== undefined) m.push(`Staff minutes per occurrence (baseline ${t}, ${bc!.inputs.minutesPerOccurrence.note ?? bc!.inputs.minutesPerOccurrence.source})`);
  if (v !== null && v !== undefined) m.push(`Occurrences a month (baseline ${v})`);
  if (bc?.timeRecovered.monthlyHoursSpent != null) m.push(`Staff hours a month on this work (baseline ${bc.timeRecovered.monthlyHoursSpent})`);
  if (o.classification === 'automate') m.push('Adoption: share of eligible cases handled through the new process (threshold to agree)');
  if (!m.length) m.push('No baseline yet: collect volume and time before agreeing success measures');
  return m;
}

// Plain Markdown version of the hand-over brief, for download.
export function briefToMarkdown(b: ReturnType<typeof handoverBrief>): string {
  const list = (xs: unknown[]) => (xs.length ? xs.map((x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n') : '- None recorded');
  const gbp = (n: number | null | undefined) => (n === null || n === undefined ? 'not known' : `£${n.toLocaleString('en-GB')}`);
  const num = (n: number | null | undefined) => (n === null || n === undefined ? 'not known' : String(n));
  const e = b.expectedImpact;
  return [
    `# Opportunity brief: ${b.firmName}`, '', `_${b.status}_`, '', `Generated ${b.generatedAt}. Opportunity ${b.opportunityId}.`, '',
    '## Problem statement', '', b.problemStatement, '', '### Causes reported', '', list(b.causes), '',
    '## Evidence summary', '', `- Evidence items: ${b.evidenceSummary.items} (${b.evidenceSummary.disputed} disputed, excluded)`,
    ...Object.entries(b.evidenceSummary.bySource).map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${v}`),
    ...Object.entries(b.evidenceSummary.confidence).map(([k, v]) => `- Confidence in ${k}: ${v}`),
    ...b.evidenceSummary.disagreements.map((d: string) => `- Disagreement: ${d}`), '',
    '## Classification', '', `${b.classification ?? 'unclassified'}${b.automationType && b.automationType !== 'not_assessed' ? ` (${b.automationType.replace('_', '-')})` : ''}`, '', b.classificationRationale ?? '', '',
    '## Recommended outcome', '', list(b.recommendedOutcome), '',
    '## Expected impact', '', e ? [
      `- Staff hours a month on this work: ${num(e.monthlyHoursSpent)}`, `- Hours a month that could be recovered: ${num(e.monthlyHoursRecovered)}`,
      `- Cash savings a month (firm-stated): ${gbp(e.cashSavingsGBP)}`, `- Additional cases a month (capacity): ${num(e.additionalCasesPerMonth)}`,
      `- Revenue potential a month: ${gbp(e.revenuePotentialGBP)}`, `- Payback: ${e.paybackMonths === null ? 'not calculated' : `${e.paybackMonths} months`}`,
      `- Confidence in impact: ${e.confidence}`].join('\n') : 'Not yet estimated.', '',
    '## Dependencies', '', list(b.dependencies), '', '## Risks and controls', '', list(b.risksAndControls), '',
    '## Outstanding questions', '', list(b.outstandingQuestions), '', '## Proposed success measures (to agree)', '', list(b.successMeasures), '',
  ].join('\n');
}
