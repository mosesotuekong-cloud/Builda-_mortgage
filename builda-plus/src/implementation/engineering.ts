import { z } from 'zod';
import { withFirmContext, withJadaContext, type Db, type FirmContext, type Tx } from '../db/pool';
import { insertAudit, NotFoundError } from '../db/repositories';
import type { AnalysisService } from '../analysis/service';
import { handoverBrief } from '../analysis/opportunityAssessment';
import { STAGES, type Classification, type StageId } from '../domain/journey';
import { assessTwoWeekFeasibility } from '../engine/feasibility';
import { ReviewSchema, type ImplementationPack } from './pack';
import type { DecisionService } from './service';
import { APPROACHES_FOR, APPROACH_LABEL, matchTemplates, readiness, SOLUTION_TEMPLATES, type SolutionApproach, type SolutionTemplate } from '../knowledge/solutionTemplates';

// Phase 5: the engineering workflow between builda+ (discovers, assesses, recommends) and JADA (reviews,
// designs, implements). Built on the existing tables, with no schema change:
//  - implementation_packs: one row per submission (any classification). `status` holds the workflow status.
//  - pack_reviews: append-only log of every workflow step (who, when, what), folded into the current state.
// Nothing here is automatic: every transition is a named person's action, checked against the rules below.

type Actor = FirmContext & { userId: string };
export type Brief = ReturnType<typeof handoverBrief> & { voices?: { role: string; quote: string }[]; note?: string };

export const STATUS = ['in_review', 'under_assessment', 'awaiting_information', 'approved_for_implementation', 'in_progress', 'completed', 'rejected', 'deferred'] as const;
export type EngineeringStatus = (typeof STATUS)[number] | 'needs_changes' | 'confirmed';   // the last two from the earlier two-week review
export const QUEUE_GROUPS: { key: string; label: string; statuses: EngineeringStatus[] }[] = [
  { key: 'awaiting_review', label: 'Awaiting engineering review', statuses: ['in_review'] },
  { key: 'under_assessment', label: 'Under assessment', statuses: ['under_assessment', 'needs_changes', 'confirmed'] },
  { key: 'awaiting_information', label: 'Awaiting information', statuses: ['awaiting_information'] },
  { key: 'approved', label: 'Approved for implementation', statuses: ['approved_for_implementation'] },
  { key: 'in_progress', label: 'In progress', statuses: ['in_progress'] },
  { key: 'completed', label: 'Completed', statuses: ['completed'] },
  { key: 'closed', label: 'Rejected or deferred', statuses: ['rejected', 'deferred'] },
];
export const groupOf = (s: string) => QUEUE_GROUPS.find((g) => g.statuses.includes(s as EngineeringStatus)) ?? QUEUE_GROUPS[0]!;
const ASSESSING: EngineeringStatus[] = ['under_assessment', 'needs_changes', 'confirmed'];
const OPEN: EngineeringStatus[] = ['in_review', 'under_assessment', 'needs_changes', 'confirmed', 'awaiting_information', 'approved_for_implementation', 'in_progress'];

// ---------------------------------------------------------------- inputs
const line = z.string().trim().min(2).max(600);
const lines = (min = 0, max = 40) => z.array(line).min(min).max(max).default([]);
const reason = z.object({ reason: z.string().trim().min(3).max(2000) });
export const DesignSchema = z.object({
  templateId: z.string().nullable(),
  approach: z.enum(['process_redesign', 'process_or_configuration_fix', 'conventional_automation', 'ai_assisted']),
  rationale: z.string().trim().min(10).max(3000),
  aiJustification: z.string().trim().max(2000).default(''),
  systems: lines(), dependencies: lines(), humanApprovalPoints: lines(),
  requirements: z.object({
    functional: lines(), nonFunctional: lines(), data: lines(), integration: lines(), access: lines(),
    security: lines(), errorHandling: lines(), logging: lines(), acceptance: lines(),
  }),
  risks: z.object({ operational: lines(), security: lines(), regulatory: lines(), privacy: lines(), technical: lines() }),
  outstandingDecisions: lines(),
});
const Measure = z.object({
  name: z.string().trim().min(3).max(200),
  valueType: z.enum(['time', 'cash', 'capacity', 'revenue']),
  unit: z.string().trim().min(1).max(60),
  baseline: z.number().finite().nullable(), baselineSource: z.string().trim().min(3).max(300),
  target: z.number().finite().nullable(), direction: z.enum(['decrease', 'increase']),
  measurementSource: z.string().trim().min(3).max(300), period: z.string().trim().min(3).max(200),
});
export const PlanSchema = z.object({
  scope: z.string().trim().min(10).max(4000),
  deliverables: lines(1), dependencies: lines(), unresolvedDependencies: lines(),
  requiredAccess: lines(), accessConfirmed: z.boolean(),
  testingPlan: lines(1), acceptanceCriteria: lines(1),
  responsibleParties: z.array(z.object({ party: z.string().trim().min(2).max(120), responsibility: z.string().trim().min(3).max(400) })).min(1).max(20),
  duration: z.object({ text: z.string().trim().min(2).max(200), validated: z.boolean(), basis: z.string().trim().max(500).default('') }).nullable(),
  successMeasures: z.array(Measure).min(1).max(20),
}).refine((p) => !p.duration?.validated || p.duration.basis.length >= 10, { message: 'Say what the validated estimate is based on', path: ['duration', 'basis'] });
export const OutcomeSchema = z.object({
  results: z.array(z.object({ measure: z.string().trim().min(3).max(200), value: z.number().finite().nullable(), measuredAt: z.string().trim().min(4).max(40),
    source: z.string().trim().min(3).max(300), note: z.string().trim().max(1000).default('') })).min(1).max(20),
});
const ACTIONS = {
  start_assessment: { by: 'jada', from: ['in_review', 'needs_changes', 'confirmed'], to: 'under_assessment', schema: z.object({ note: z.string().max(2000).default('') }) },
  request_information: { by: 'jada', from: ASSESSING, to: 'awaiting_information', schema: z.object({ questions: z.array(z.string().trim().min(3).max(600)).min(1).max(10) }) },
  provide_information: { by: 'firm', from: ['awaiting_information'], to: 'under_assessment', schema: z.object({ answer: z.string().trim().min(3).max(4000) }) },
  record_design: { by: 'jada', from: ASSESSING, to: null, schema: DesignSchema },
  two_week_check: { by: 'jada', from: [...ASSESSING, 'approved_for_implementation'], to: null, schema: ReviewSchema },
  approve_for_implementation: { by: 'jada', from: ASSESSING, to: 'approved_for_implementation', schema: z.object({ note: z.string().max(2000).default('') }) },
  record_plan: { by: 'jada', from: ['approved_for_implementation'], to: null, schema: PlanSchema },
  start_implementation: { by: 'jada', from: ['approved_for_implementation'], to: 'in_progress', schema: z.object({ note: z.string().max(2000).default('') }) },
  activate_integration: { by: 'jada', from: ['in_progress'], to: null, schema: z.object({ note: z.string().max(2000).default('') }) },
  complete_implementation: { by: 'jada', from: ['in_progress'], to: 'completed', schema: z.object({ note: z.string().max(2000).default('') }) },
  record_outcome: { by: 'jada', from: ['completed'], to: null, schema: OutcomeSchema },
  reject: { by: 'jada', from: OPEN, to: 'rejected', schema: reason },
  defer: { by: 'jada', from: OPEN, to: 'deferred', schema: reason },
  reopen: { by: 'jada', from: ['deferred'], to: 'in_review', schema: reason },
} as const satisfies Record<string, { by: 'jada' | 'firm'; from: readonly EngineeringStatus[]; to: EngineeringStatus | null; schema: z.ZodTypeAny }>;
export type EngineeringAction = keyof typeof ACTIONS;
export const ACTION_LABEL: Record<EngineeringAction | 'confirmed' | 'needs_changes', string> = {
  start_assessment: 'Assessment started', request_information: 'Information requested', provide_information: 'Information provided by the firm',
  record_design: 'Solution design recorded', two_week_check: 'Two-week offer checked', approve_for_implementation: 'Approved for implementation',
  record_plan: 'Implementation plan recorded', start_implementation: 'Implementation started', activate_integration: 'Live integration activated',
  complete_implementation: 'Implementation completed', record_outcome: 'Outcome measured', reject: 'Rejected', defer: 'Deferred', reopen: 'Reopened',
  confirmed: 'Two-week build confirmed (earlier review)', needs_changes: 'Two-week build needs changes (earlier review)',
};
export class WorkflowError extends Error { statusCode = 409; }
const refuse = (msg: string): never => { throw new WorkflowError(msg); };

// ---------------------------------------------------------------- reading a submission
interface Row { id: string; org_id: string; discovery_id: string; pain_point_id: string; status: string; content: any; created_at: Date; updated_at: Date }
interface EventRow { decision: string; result: any; notes: string | null; checks: any; reviewer_id: string; created_at: Date }

// Packs created before Phase 5 hold the implementation pack itself; later ones wrap it with the brief.
export const packOf = (content: any): ImplementationPack | null => (content?.schemaVersion === 2 ? content.pack ?? null : content ?? null);
export function submissionOf(content: any): Brief {
  if (content?.schemaVersion === 2) return content.submission;
  const p = content as ImplementationPack;
  const cls = (p.painPoint.classification ?? null) as Classification | null;
  return {
    schemaVersion: 1, firmName: '', opportunityId: p.painPoint.id, generatedAt: p.generatedAt, title: p.painPoint.title, key: p.painPoint.key,
    stageId: (Object.values(STAGES).find((s) => s.name === p.painPoint.stage)?.id ?? 'documents') as StageId, stageName: p.painPoint.stage,
    regulated: false, roles: [], participantCount: 0, systems: p.systems, improvements: [], priority: null as any,
    businessCase: null, gates: [], firmValidated: { finding: true, decision: 'approved', decisionReason: null, decidedAt: null, disputedEvidence: 0, firmProvidedInputs: [] },
    problemStatement: `${p.painPoint.title}, at the ${p.painPoint.stage.toLowerCase()} stage.`, causes: p.currentProcess.facts,
    evidenceSummary: { items: 0, bySource: {}, disputed: 0, confidence: { existence: p.painPoint.confidence }, disagreements: [] },
    classification: cls, automationType: null, classificationRationale: null, recommendedOutcome: p.targetProcess,
    expectedImpact: { monthlyHoursSpent: p.baseline.monthlyHoursSpent, monthlyHoursRecovered: p.baseline.monthlyHoursRecovered, cashSavingsGBP: null, additionalCasesPerMonth: null, revenuePotentialGBP: null, paybackMonths: null, confidence: p.baseline.evidence },
    dependencies: p.dependencies, risksAndControls: p.risks, outstandingQuestions: p.openQuestions, successMeasures: [],
    status: 'Submitted before Phase 5 as an implementation pack.', voices: p.currentProcess.quotes,
  } as unknown as Brief;
}

export interface Measurement { name: string; target: number | null; direction: 'decrease' | 'increase'; result: number | null; status: 'met' | 'not_met' | 'not_measured' | 'no_target' }
// Success is judged only against the measures agreed with the firm, never by the automation having run.
export function evaluateOutcome(measures: z.infer<typeof Measure>[], results: z.infer<typeof OutcomeSchema>['results'] | null) {
  const rows: Measurement[] = measures.map((m) => {
    const r = results?.find((x) => x.measure === m.name) ?? null;
    const value = r?.value ?? null;
    const status: Measurement['status'] = m.target === null ? 'no_target' : value === null ? 'not_measured'
      : (m.direction === 'decrease' ? value <= m.target : value >= m.target) ? 'met' : 'not_met';
    return { name: m.name, target: m.target, direction: m.direction, result: value, status };
  });
  const targeted = rows.filter((r) => r.status !== 'no_target');
  const overall = !results ? 'not_yet_measured'
    : !targeted.length ? 'no_agreed_targets'
      : targeted.some((r) => r.status === 'not_met') ? 'not_met'
        : targeted.some((r) => r.status === 'not_measured') ? 'partly_measured' : 'met';
  return { rows, overall: overall as 'not_yet_measured' | 'no_agreed_targets' | 'not_met' | 'partly_measured' | 'met' };
}

const templateById = (id: string | null | undefined): SolutionTemplate | null => (id ? SOLUTION_TEMPLATES.find((t) => t.id === id) ?? null : null);

// Suggested requirements to start the design from: the template's own content where one fits, the brief
// otherwise, plus JADA's standard controls. Labelled as suggestions; the engineer records the design.
const STANDARD = {
  security: ['JADA standard: client data stays in the firm’s systems; the solution keeps case references only.', 'JADA standard: least-privilege access, granted by the firm and revocable at any time.'],
  logging: ['JADA standard: every automated action and every human approval is logged with who and when.', 'JADA standard: logs contain no client content.'],
};
export function suggestedDesign(s: Brief) {
  const { matches } = matchTemplates({ key: s.key, classification: s.classification, systems: s.systems ?? [] });
  const t = matches[0]?.template ?? null;
  const approaches = s.classification ? APPROACHES_FOR[s.classification] : [];
  return {
    templateId: t?.id ?? null, approach: (t?.approach ?? approaches[0] ?? null) as SolutionApproach | null,
    systems: s.systems ?? [], dependencies: s.dependencies ?? [],
    humanApprovalPoints: t?.humanControls ?? (s.risksAndControls ?? []).filter((r: string) => r.startsWith('Control: ')).map((r: string) => r.slice(9)),
    requirements: {
      functional: t?.architectureOverview ?? s.recommendedOutcome ?? [], nonFunctional: [], data: t?.requiredInputs ?? [],
      integration: [...(t?.supportedSystems ?? []), ...(s.systems ?? []).map((x: string) => `${x}: integration method to be confirmed`)],
      access: t?.requiredPermissions ?? [], security: STANDARD.security, errorHandling: [], logging: STANDARD.logging,
      acceptance: [...(t?.acceptanceCriteria ?? []), ...(t?.testingRequirements ?? [])],
    },
    risks: {
      operational: [], security: [], privacy: [],
      regulatory: (s.risksAndControls ?? []).filter((r: string) => !r.startsWith('Control: ')),
      technical: [...(t?.knownLimitations ?? []), ...(t ? [] : ['No reference template: custom engineering review required.'])],
    },
    // builda+'s open questions stay under "what remains uncertain"; decisions are the engineer's to record.
    outstandingDecisions: [] as string[],
  };
}
// Proposed (not agreed) success measures from the firm's own baseline. Targets stay empty until agreed.
export function suggestedMeasures(s: Brief): z.infer<typeof Measure>[] {
  const bc = s.businessCase;
  const out: z.infer<typeof Measure>[] = [];
  const src = (k: 'monthlyVolume' | 'minutesPerOccurrence') => { const i = bc?.inputs?.[k]; return i?.source ? `${i.source.replace(/_/g, ' ')}${i.note ? `, ${i.note}` : ''}` : 'not yet measured'; };
  out.push({ name: 'Staff hours a month on this work', valueType: 'time', unit: 'hours / month', baseline: bc?.timeRecovered.monthlyHoursSpent ?? null, baselineSource: bc?.timeRecovered.monthlyHoursSpent != null ? 'Discovery estimate (times a month × minutes each time)' : 'Not yet measured', target: null, direction: 'decrease', measurementSource: 'To agree with the firm', period: 'To agree with the firm' });
  out.push({ name: 'Minutes of staff time each time', valueType: 'time', unit: 'minutes', baseline: bc?.inputs?.minutesPerOccurrence?.value ?? null, baselineSource: src('minutesPerOccurrence'), target: null, direction: 'decrease', measurementSource: 'To agree with the firm', period: 'To agree with the firm' });
  if (bc?.cashSavings.monthlyGBP != null) out.push({ name: 'Spending reduced', valueType: 'cash', unit: '£ / month', baseline: null, baselineSource: `Firm-stated saving: ${bc.cashSavings.basis ?? 'basis recorded in builda+'}`, target: null, direction: 'increase', measurementSource: 'Firm’s accounts', period: 'To agree with the firm' });
  if (bc?.capacity.additionalCasesPerMonth != null) out.push({ name: 'Cases handled a month', valueType: 'capacity', unit: 'cases / month', baseline: null, baselineSource: 'Not yet measured', target: null, direction: 'increase', measurementSource: 'Firm’s case system', period: 'To agree with the firm' });
  return out;
}

// Two-week offer: a conditional commercial proposition, never a promise. Every condition must hold.
export function twoWeekOffer(s: Brief, design: z.infer<typeof DesignSchema> | null, plan: z.infer<typeof PlanSchema> | null, lastCheck: { qualifies: boolean; failures: string[] } | null) {
  if (s.classification !== 'automate') return { offered: false, reasons: ['The two-week build applies only to automating one defined workflow'] };
  const t = templateById(design?.templateId);
  const reasons = [
    ...(!t ? ['No reference template chosen'] : !readiness(t).productionReady ? readiness(t).reasons.map((r) => `Template: ${r.toLowerCase()}`) : []),
    ...(!plan ? ['No implementation plan yet'] : [...(!plan.accessConfirmed ? ['Access and test data not confirmed'] : []), ...plan.unresolvedDependencies.map((d) => `Unresolved dependency: ${d}`)]),
    ...(!lastCheck ? ['Two-week checklist not yet completed'] : lastCheck.failures),
  ];
  return { offered: reasons.length === 0, reasons: [...new Set(reasons)] };
}

function fold(row: Row, events: EventRow[]) {
  const latest = (d: string) => [...events].reverse().find((e) => e.decision === d) ?? null;
  const design = latest('record_design')?.result?.design ?? null;
  const plan = latest('record_plan')?.result?.plan ?? null;
  const outcome = latest('record_outcome')?.result?.outcome ?? null;
  const check = [...events].reverse().find((e) => e.decision === 'two_week_check' || e.decision === 'confirmed' || e.decision === 'needs_changes');
  const requests: { questions: string[]; at: Date; answer: string | null; answeredAt: Date | null }[] = [];
  for (const e of events) {
    if (e.decision === 'request_information') requests.push({ questions: e.result.questions, at: e.created_at, answer: null, answeredAt: null });
    if (e.decision === 'provide_information') { const open = [...requests].reverse().find((r) => r.answer === null); if (open) { open.answer = e.result.answer; open.answeredAt = e.created_at; } }
  }
  return { design, plan, outcome, lastCheck: check ? { qualifies: !!check.result?.qualifies, failures: check.result?.failures ?? [], at: check.created_at } : null, requests };
}

// ---------------------------------------------------------------- service
export class EngineeringService {
  constructor(private db: Db, private deps: { analysis: AnalysisService; decisions: DecisionService }) {}

  // Firm lead sends an approved opportunity to JADA. Same gates as Phase 4; any classification except keep human.
  async submit(ctx: Actor, discoveryId: string, painPointId: string, note: string) {
    const intel = await this.deps.analysis.opportunityAssessments(ctx, discoveryId);
    const o = intel.opportunities.find((x) => x.id === painPointId);
    if (!o) throw new NotFoundError('Opportunity not found');
    if (o.classification === 'keep_human') refuse('Keep human opportunities aren’t implemented as changes. If a supporting task around it could be improved (for example preparing information for the adviser), it must be raised and evidenced as its own finding, for instance in a follow-up interview, so it is classified and assessed on its own.');
    if (o.decision.latest !== 'approved') refuse('Approve this opportunity before sending it to JADA engineering review.');
    if (!o.engineering.eligible) refuse(`This opportunity can’t go to engineering review yet: ${o.engineering.blockers.join('; ') || 'already sent'}.`);
    const playback = await this.deps.analysis.playback(ctx, discoveryId);
    const voices = (playback.painPoints.find((p) => p.id === o.id)?.quotes ?? []).slice(0, 6);   // already privacy-filtered by role size
    const submission: Brief = { ...handoverBrief(o, intel.firmName), voices, note };
    // Reuse the existing approval service: it records the approval and, for automate items, builds the pack.
    let approved: { approvalId: string; packId: string | null };
    try { approved = await this.deps.decisions.approve(ctx, discoveryId, { priorities: [o.id], proceedWith: o.classification === 'automate' ? o.id : null, note }); }
    catch (err: any) { if (err?.statusCode !== 400) throw err; approved = await this.deps.decisions.approve(ctx, discoveryId, { priorities: [o.id], proceedWith: null, note }); }
    const packId = await withFirmContext(this.db, ctx, async (tx) => {
      const existing = approved.packId ? (await tx.query('select content from implementation_packs where id = $1', [approved.packId])).rows[0] : null;
      const content = { schemaVersion: 2, submission, pack: existing ? packOf(existing.content) : null };
      let id = approved.packId;
      if (id) await tx.query("update implementation_packs set content = $1, status = 'in_review', updated_at = now() where id = $2", [content, id]);
      else id = (await tx.query('insert into implementation_packs (org_id, discovery_id, pain_point_id, approval_id, content) values ($1,$2,$3,$4,$5) returning id',
        [ctx.orgId, discoveryId, o.id, approved.approvalId, content])).rows[0].id as string;
      await insertAudit(tx, [{ orgId: ctx.orgId, discoveryId, actor: `user:${ctx.userId}`, action: 'engineering.submitted', entityType: 'implementation_pack', entityId: id, metadata: { classification: o.classification } }]);
      return id;
    });
    // The append-only decision record keeps the brief without quotes: quotes live only in the submission row.
    const { voices: _voices, ...snapshot } = submission;
    await this.deps.analysis.recordEngineeringHandover(ctx, discoveryId, o.id, { ...snapshot, packId }, o.decision.latest);
    return { packId, brief: submission };
  }

  // ---- JADA side
  async queue(userId: string) {
    return withJadaContext(this.db, userId, async (tx) => {
      const r = await tx.query(
        `select p.id, p.discovery_id, p.status, p.content, p.created_at, p.updated_at, o.name as firm_name,
                (select max(created_at) from pack_reviews r where r.pack_id = p.id) as last_activity
           from implementation_packs p join organisations o on o.id = p.org_id order by p.created_at`);
      return r.rows.map((x) => {
        const s = submissionOf(x.content);
        return { id: x.id, discoveryId: x.discovery_id, firmName: x.firm_name, title: s.title, classification: s.classification, stageId: s.stageId, stageName: s.stageName,
          priority: s.priority ? { rank: s.priority.rank, band: s.priority.band } : null, confidence: s.evidenceSummary?.confidence?.existence ?? null,
          submittedAt: x.created_at, lastActivity: x.last_activity ?? x.updated_at, status: x.status, group: groupOf(x.status).key, assignedReviewer: 'You',
          needsReassessment: x.content?.schemaVersion === 2 ? null : 'Submitted before the full assessment existed: priority and assessment not recorded. Reassess before approving.' };
      });
    });
  }

  async detail(userId: string, packId: string) {
    return withJadaContext(this.db, userId, async (tx) => this.view(tx, packId, userId, 'jada'));
  }

  async act(userId: string, packId: string, action: string, input: unknown) {
    if (!(action in ACTIONS) || ACTIONS[action as EngineeringAction].by !== 'jada') throw Object.assign(new Error('Unknown action'), { statusCode: 400 });
    return withJadaContext(this.db, userId, async (tx) => { await this.apply(tx, packId, action as EngineeringAction, input, userId, 'jada'); return this.view(tx, packId, userId, 'jada'); });
  }

  // ---- firm side
  async forFirm(ctx: Actor, discoveryId: string) {
    return withFirmContext(this.db, ctx, async (tx) => {
      const ids = (await tx.query('select id from implementation_packs where discovery_id = $1 order by created_at', [discoveryId])).rows.map((r) => r.id as string);
      const out = [];
      for (const id of ids) out.push(await this.view(tx, id, ctx.userId, 'firm'));
      return out;
    });
  }
  async provideInformation(ctx: Actor, discoveryId: string, packId: string, input: unknown) {
    return withFirmContext(this.db, ctx, async (tx) => {
      const r = await tx.query('select 1 from implementation_packs where id = $1 and discovery_id = $2', [packId, discoveryId]);
      if (!r.rows[0]) throw new NotFoundError('Submission not found');
      await this.apply(tx, packId, 'provide_information', input, ctx.userId, 'firm');
      return this.view(tx, packId, ctx.userId, 'firm');
    });
  }

  // ---- shared
  private async load(tx: Tx, packId: string, lock = false) {
    const r = await tx.query(`select p.id, p.org_id, p.discovery_id, p.pain_point_id, p.status, p.content, p.created_at, p.updated_at from implementation_packs p where p.id = $1${lock ? ' for update' : ''}`, [packId]);
    if (!r.rows[0]) throw new NotFoundError('Submission not found');
    const events = (await tx.query('select decision, result, notes, checks, reviewer_id, created_at from pack_reviews where pack_id = $1 order by created_at, id', [packId])).rows as EventRow[];
    return { row: r.rows[0] as Row, events };
  }

  private async apply(tx: Tx, packId: string, action: EngineeringAction, input: unknown, userId: string, by: 'jada' | 'firm') {
    const def = ACTIONS[action];
    const { row, events } = await this.load(tx, packId, true);
    const status = row.status as EngineeringStatus;
    if (!(def.from as readonly string[]).includes(status)) refuse(`“${ACTION_LABEL[action]}” isn’t possible while the submission is ${groupOf(status).label.toLowerCase()}.`);
    const data: any = def.schema.parse(input ?? {});
    const s = submissionOf(row.content);
    const state = fold(row, events);
    let result: Record<string, unknown> = { by };
    let checks: Record<string, unknown> = {};
    let notes: string | null = data.note || data.reason || null;

    switch (action) {
      case 'request_information': result.questions = data.questions; break;
      case 'provide_information': result.answer = data.answer; notes = null; break;
      case 'record_design': {
        const allowed = s.classification ? APPROACHES_FOR[s.classification] : [];
        if (!allowed.includes(data.approach)) refuse(`A “${s.classification ?? 'unclassified'}” opportunity can’t use ${APPROACH_LABEL[data.approach as SolutionApproach].toLowerCase()}.`);
        if (data.approach === 'ai_assisted') {
          if (s.regulated) refuse('This is a regulated-judgement stage: AI may not be used here.');
          if (data.aiJustification.length < 20) refuse('Explain why conventional automation isn’t sufficient before choosing an AI-assisted approach.');
        }
        if (data.templateId) {
          const m = matchTemplates({ key: s.key, classification: s.classification, systems: s.systems ?? [] }).matches.find((x) => x.template.id === data.templateId);
          if (!m) refuse('That template doesn’t fit this problem and classification.');
          if (m!.template.approach !== data.approach) refuse(`The template uses ${APPROACH_LABEL[m!.template.approach].toLowerCase()}; record a custom design to use a different approach.`);
        }
        if (s.classification === 'automate' && !data.humanApprovalPoints.length) refuse('Record at least one human approval point for an automation.');
        const t = templateById(data.templateId);
        result.design = { ...data, template: t ? { id: t.id, version: t.version, name: t.name, readiness: readiness(t) } : null, custom: !t };
        break;
      }
      case 'two_week_check': {
        if (s.classification !== 'automate') refuse('The two-week checklist applies only to automating one defined workflow.');
        const t = templateById(state.design?.templateId);
        const r = assessTwoWeekFeasibility({ classification: (s.classification ?? 'fix') as Classification, templateId: t?.id ?? null, templateTested: !!t && readiness(t).productionReady,
          ...data.checks, unresolvedDependencies: data.unresolvedDependencies });
        checks = { ...data.checks, unresolvedDependencies: data.unresolvedDependencies };
        result = { ...result, ...r };
        break;
      }
      case 'approve_for_implementation': {
        if (!state.design) refuse('Record the solution design before approving it for implementation.');
        if (!state.design.requirements.acceptance.length) refuse('Record acceptance criteria before approving.');
        if (state.design.outstandingDecisions.length) refuse(`Resolve the outstanding decisions first: ${state.design.outstandingDecisions.join('; ')}.`);
        result.design = { template: state.design.template, approach: state.design.approach };
        break;
      }
      case 'record_plan': {
        const offer = twoWeekOffer(s, state.design, data, state.lastCheck);
        result.plan = data; result.twoWeekOffer = offer;
        break;
      }
      case 'start_implementation':
        if (!state.plan) refuse('Record the implementation plan, with agreed success measures, before starting.');
        break;
      case 'activate_integration': {
        const gate = templateById(state.design?.templateId)?.integrationGate;
        if (!gate) refuse('This design has no live integration to activate.');
        if (gate!.status !== 'passed') refuse(`Live access can’t be activated: ${gate!.description.split(':')[0]} has not passed (${gate!.evidenceRef}).`);
        break;
      }
      case 'complete_implementation': {
        const gate = templateById(state.design?.templateId)?.integrationGate;
        if (gate && !events.some((e) => e.decision === 'activate_integration')) refuse(`Can’t be completed: it depends on ${gate.description.split(':')[0]!.toLowerCase()}, which has not passed.`);
        result.outcome = 'Implementation delivered. Success is judged only when the agreed measures are recorded.';
        break;
      }
      case 'record_outcome': {
        const names = new Set((state.plan?.successMeasures ?? []).map((m: any) => m.name));
        const unknown = data.results.filter((r: any) => !names.has(r.measure));
        if (unknown.length) refuse(`Results must be for the agreed measures. Not agreed: ${unknown.map((u: any) => u.measure).join(', ')}.`);
        result.outcome = { results: data.results, evaluation: evaluateOutcome(state.plan.successMeasures, data.results) };
        break;
      }
      default: break;
    }
    await tx.query('insert into pack_reviews (org_id, discovery_id, pack_id, reviewer_id, checks, result, decision, notes) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [row.org_id, row.discovery_id, packId, userId, checks, result, action, notes]);
    if (def.to) await tx.query('update implementation_packs set status = $1, updated_at = now() where id = $2', [def.to, packId]);
    else await tx.query('update implementation_packs set updated_at = now() where id = $1', [packId]);
    await insertAudit(tx, [{ orgId: row.org_id, discoveryId: row.discovery_id, actor: `${by === 'jada' ? 'jada' : 'user'}:${userId}`, action: `engineering.${action}`,
      entityType: 'implementation_pack', entityId: packId, metadata: { from: status, to: def.to ?? status } }]);
  }

  private async view(tx: Tx, packId: string, userId: string, viewer: 'jada' | 'firm') {
    const { row, events } = await this.load(tx, packId);
    const firm = (await tx.query('select name from organisations where id = $1', [row.org_id])).rows[0]?.name ?? '';
    const s = submissionOf(row.content);
    const state = fold(row, events);
    const status = row.status as EngineeringStatus;
    const t = templateById(state.design?.templateId);
    const allowed = (Object.keys(ACTIONS) as EngineeringAction[]).filter((a) => ACTIONS[a].by === viewer && (ACTIONS[a].from as readonly string[]).includes(status));
    const who = (e: EventRow) => (e.reviewer_id === userId ? 'You' : e.result?.by === 'firm' ? (viewer === 'firm' ? 'Your firm' : 'The firm') : viewer === 'firm' ? 'JADA engineering' : 'Another JADA engineer');
    return {
      needsReassessment: row.content?.schemaVersion === 2 ? null : 'Submitted before the full assessment existed: priority, business case and firm validation detail were not recorded. Reassess against the current opportunity in builda+ before approving.',
      id: row.id, discoveryId: row.discovery_id, opportunityId: row.pain_point_id, firmName: firm, status, group: groupOf(status), submittedAt: row.created_at, updatedAt: row.updated_at,
      submission: { ...s, firmName: firm }, pack: viewer === 'jada' ? packOf(row.content) : null,
      templates: matchTemplates({ key: s.key, classification: s.classification, systems: s.systems ?? [] }),
      approaches: (s.classification ? APPROACHES_FOR[s.classification] : []).map((a) => ({ id: a, label: APPROACH_LABEL[a] })),
      suggestions: viewer === 'jada' ? { design: suggestedDesign(s), measures: suggestedMeasures(s) } : null,
      design: state.design, plan: state.plan, informationRequests: state.requests, lastCheck: state.lastCheck,
      twoWeekOffer: twoWeekOffer(s, state.design, state.plan, state.lastCheck),
      integration: t?.integrationGate ? { gate: t.integrationGate, activated: events.some((e) => e.decision === 'activate_integration') } : null,
      outcome: state.plan ? (state.outcome?.evaluation ?? evaluateOutcome(state.plan.successMeasures, null)) : null,
      outcomeResults: state.outcome?.results ?? null,
      actions: allowed,
      history: events.map((e) => ({ action: e.decision, label: ACTION_LABEL[e.decision as EngineeringAction] ?? e.decision, by: who(e), at: e.created_at, note: e.notes,
        detail: e.decision === 'request_information' ? e.result.questions : e.decision === 'provide_information' ? [e.result.answer] : e.decision === 'two_week_check' || e.decision === 'needs_changes' ? (e.result?.failures ?? []) : [] })).reverse(),
    };
  }
}

export { QUEUE_GROUPS as ENGINEERING_GROUPS };
