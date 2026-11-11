import { z } from 'zod';
import { withFirmContext, type Db, type FirmContext, type Tx } from '../db/pool';
import { insertAudit, insertSession, NotFoundError } from '../db/repositories';
import { CLASSIFICATIONS, ROLE_LABELS, STAGE_IDS, STAGES, type Classification, type Role, type StageId } from '../domain/journey';
import { StageIdSchema } from '../domain/schemas';
import type { LLMProvider } from '../llm/provider';
import type { Playbook } from '../knowledge/playbook';
import { applyKeyMerges, consolidate, keysThatAreNotProblems, planFollowUps, type AnalysisEvidence, type ConsolidatedPainPoint, type CrossRoleFindings } from './consolidate';
import { classifyPainPoint, proposeKeyMerges } from './classify';
import { buildOpportunities, type PainPointForScoring } from './opportunities';
import { FirmProfileSchema } from '../firm/profile';
import { DEFAULT_SCORING_CONFIG } from '../engine/scoring';
import { assessDimensions, type ConfidenceOrInsufficient } from '../engine/confidence';
import { templateFor } from '../knowledge/templates';
import { approvalBlockers, assessOpportunities } from './opportunityAssessment';
import { PRIORITY_BANDS } from '../engine/priority';
import { startFollowUp } from '../interview/orchestrator';
import type { Mailer } from '../firm/mailer';
import { hashToken, newInvitationToken } from '../http/tokens';

type Actor = FirmContext & { userId: string };

export interface PainPointSummary {
  evidenceIds: string[]; roles: Role[]; participantCount: number;
  volume: ConsolidatedPainPoint['volume']; minutes: ConsolidatedPainPoint['minutes'];
  disagreementsByRole: ConsolidatedPainPoint['disagreementsByRole'];
  quotesByRole: ConsolidatedPainPoint['quotesByRole'];
  systems: string[]; causes: string[]; improvements: string[]; outstandingQuestions: string[];
  conversionAssumptions: string[]; missingMeasurements: string[]; classificationRationale?: string;
}

export const CorrectionSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('classification'), value: z.enum(CLASSIFICATIONS), reason: z.string().min(3).max(1000) }),
  z.object({ field: z.literal('title'), value: z.string().min(3).max(300), reason: z.string().min(3).max(1000) }),
  z.object({ field: z.literal('stageId'), value: StageIdSchema, reason: z.string().min(3).max(1000) }),
  z.object({ field: z.literal('monthlyVolume'), value: z.number().min(0).max(100000).nullable(), reason: z.string().min(3).max(1000) }),
  z.object({ field: z.literal('minutesPerOccurrence'), value: z.number().min(0).max(10000).nullable(), reason: z.string().min(3).max(1000) }),
  z.object({ field: z.literal('reductionPct'), value: z.number().min(0).max(1).nullable(), reason: z.string().min(3).max(1000) }),
  // Phase 4 business-case inputs. Supplied by the firm; each one is audited like any other correction.
  z.object({ field: z.literal('implementationCostGBP'), value: z.number().min(0).max(10_000_000).nullable(), reason: z.string().min(3).max(1000) }),
  z.object({ field: z.literal('monthlyCashSavingGBP'), value: z.number().min(0).max(1_000_000).nullable(), reason: z.string().min(10).max(1000) }),
  z.object({ field: z.literal('staffHoursPerCase'), value: z.number().gt(0).max(500).nullable(), reason: z.string().min(3).max(1000) }),
  z.object({ field: z.literal('revenuePerCaseGBP'), value: z.number().min(0).max(1_000_000).nullable(), reason: z.string().min(3).max(1000) }),
  z.object({ field: z.literal('demandConfirmed'), value: z.boolean(), reason: z.string().min(3).max(1000) }),
  z.object({ field: z.literal('validated'), value: z.boolean(), reason: z.string().max(1000).default('') }),
  // A note added to the finding's record. It changes no figure and no confidence.
  z.object({ field: z.literal('clarification'), value: z.string().trim().min(3).max(2000), reason: z.string().max(1000).default('Clarification') }),
]);
export const OpportunityDecisionSchema = z.object({
  decision: z.enum(['approved', 'challenged', 'rejected', 'reopened']),
  reason: z.string().trim().max(1000).default(''),
}).refine((d) => !['challenged', 'rejected'].includes(d.decision) || d.reason.length >= 3, { message: 'Say why', path: ['reason'] });
export const EvidenceReviewSchema = z.object({
  status: z.enum(['validated', 'disputed', 'unreviewed']),
  reason: z.string().trim().max(1000).default(''),
}).refine((r) => r.status !== 'disputed' || r.reason.length >= 3, { message: 'Say why this evidence is disputed', path: ['reason'] });
export type Correction = z.infer<typeof CorrectionSchema>;

export type Playback = Awaited<ReturnType<AnalysisService["playback"]>>;
export type DiscoveryWorkspace = Awaited<ReturnType<AnalysisService["discoveryWorkspace"]>>;
export type OpportunityIntelligence = Awaited<ReturnType<AnalysisService["opportunityAssessments"]>>;
// Verbatim quotes are shown to the firm only when at least this many people in the role contributed.
export const QUOTE_MIN_GROUP = 3;

export class AnalysisService {
  constructor(private db: Db, private deps: { providerFor: (ctx: { orgId: string; discoveryId: string }) => LLMProvider; playbook: Playbook; playbookFor?: (ctx: FirmContext, discoveryId: string) => Promise<Playbook>; mailer?: Mailer | null; appBaseUrl: string }) {}

  playbookFor(ctx: FirmContext, discoveryId: string): Promise<Playbook> {
    return this.deps.playbookFor ? this.deps.playbookFor(ctx, discoveryId) : Promise.resolve(this.deps.playbook);
  }

  // Evidence the firm lead has disputed is left out of analysis and confidence until they change their mind
  // (the dispute and its reason stay in the corrections history).
  private async loadEvidence(tx: Tx, discoveryId: string, opts: { includeDisputed?: boolean } = {}): Promise<AnalysisEvidence[]> {
    const r = await tx.query(
      `select e.*, p.role as participant_role from evidence_records e
         left join participants p on p.discovery_id = e.discovery_id and p.pseudonym = e.participant_pseudonym
        where e.discovery_id = $1
          and ($2 or coalesce((select c.new_value #>> '{}' from corrections c
                                 where c.entity_type = 'evidence_record' and c.entity_id = e.id and c.field = 'review'
                                 order by c.created_at desc limit 1), '') <> 'disputed')
        order by e.created_at`, [discoveryId, !!opts.includeDisputed]);
    return r.rows.map((x) => ({
      id: x.id, participantRef: x.participant_pseudonym ?? 'firm', role: (x.participant_role ?? x.responsible_role) as Role,
      source: x.source, painPointKey: x.pain_point_key, stageId: x.stage_id, taskDescription: x.task_description,
      monthlyVolume: x.monthly_volume === null ? null : Number(x.monthly_volume),
      minutesPerOccurrence: x.minutes_per_occurrence === null ? null : Number(x.minutes_per_occurrence),
      systems: x.systems, reportedCause: x.reported_cause, potentialImprovement: x.potential_improvement,
      supportingQuote: x.supporting_quote, outstandingQuestions: x.outstanding_questions, conversionAssumptions: x.conversion_assumptions,
      createdAt: x.created_at,
    }));
  }

  // Milestones 5–6: consolidate across roles, classify, then score. Uses the model only for
  // key merging and classification proposals; everything else is deterministic.
  async analyse(ctx: Actor, discoveryId: string): Promise<CrossRoleFindings> {
    const llm = this.deps.providerFor({ orgId: ctx.orgId, discoveryId });
    const { evidence, firmLeadInterviewed, existing } = await withFirmContext(this.db, ctx, async (tx) => {
      const d = await tx.query('select 1 from discoveries where id = $1', [discoveryId]);
      if (!d.rows[0]) throw new NotFoundError('Discovery not found');
      const lead = await tx.query(
        `select 1 from interview_sessions s join participants p on p.id = s.participant_id
          where s.discovery_id = $1 and p.role = 'firm_lead' and s.kind = 'main' and s.status = 'completed'`, [discoveryId]);
      const ex = await tx.query('select key, classification, classification_source, evidence_summary from pain_points where discovery_id = $1', [discoveryId]);
      return { evidence: await this.loadEvidence(tx, discoveryId), firmLeadInterviewed: (lead.rowCount ?? 0) > 0, existing: new Map(ex.rows.map((r) => [r.key, r])) };
    });

    const playbook = await this.playbookFor(ctx, discoveryId);
    const playbookKeys = playbook.cards.map((c) => c.id);
    const keys = [...new Set(evidence.map((e) => e.painPointKey))];
    // Merging is an AI suggestion. If it isn't available, analysis carries on with keys unmerged rather than failing.
    let mergeUnavailable = false;
    const items = keys.map((k) => {
      const rs = evidence.filter((e) => e.painPointKey === k);
      return { key: k, stage: STAGES[rs[0]!.stageId].name, roles: [...new Set(rs.map((e) => ROLE_LABELS[e.role]))], descriptions: rs.map((e) => e.taskDescription),
        causes: [...new Set(rs.map((e) => e.reportedCause).filter((c): c is string => !!c))] };
    });
    const review = await proposeKeyMerges(llm, items, playbookKeys).catch(() => { mergeUnavailable = true; return { merges: [], notProblems: [] }; });
    const merged = applyKeyMerges(evidence, review.merges, playbook);
    // Plain descriptions of a task ("I do the fact find; it works") stay as evidence but aren't findings.
    const notProblems = keysThatAreNotProblems(merged.evidence, review.notProblems, merged.applied, playbook);
    const findings = consolidate(merged.evidence.filter((e) => !notProblems.has(e.painPointKey)), { playbook, firmLeadInterviewed });

    // Classify only what changed; firm-lead decisions are never overwritten.
    const classifications = new Map<string, Awaited<ReturnType<typeof classifyPainPoint>> | null>();
    for (const pp of findings.painPoints) {
      const prev = existing.get(pp.key);
      const sameEvidence = prev && JSON.stringify(prev.evidence_summary?.evidenceIds ?? []) === JSON.stringify(pp.evidenceIds);
      if (prev?.classification_source === 'firm_lead' || (sameEvidence && prev.classification)) { classifications.set(pp.key, null); continue; }
      classifications.set(pp.key, await classifyPainPoint(llm, pp, playbook.cards.find((c) => c.id === pp.key) ?? null));
    }

    await withFirmContext(this.db, ctx, async (tx) => {
      for (const pp of findings.painPoints) {
        const summary: PainPointSummary = {
          evidenceIds: pp.evidenceIds, roles: pp.roles, participantCount: pp.participantRefs.length, volume: pp.volume, minutes: pp.minutes,
          disagreementsByRole: pp.disagreementsByRole, quotesByRole: pp.quotesByRole, systems: pp.systems, causes: pp.causes,
          improvements: pp.improvements, outstandingQuestions: pp.outstandingQuestions, conversionAssumptions: pp.conversionAssumptions,
          missingMeasurements: pp.missingMeasurements,
        };
        const c = classifications.get(pp.key);
        await tx.query(
          `insert into pain_points (org_id, discovery_id, key, stage_id, title, classification, classification_rationale, classification_source,
                                    requires_compliance_review, confidence, confidence_detail, evidence_summary)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           on conflict (discovery_id, key) do update set
             evidence_summary = excluded.evidence_summary, confidence = excluded.confidence, confidence_detail = excluded.confidence_detail,
             classification = case when $13 then excluded.classification else pain_points.classification end,
             classification_rationale = case when $13 then excluded.classification_rationale else pain_points.classification_rationale end,
             classification_source = case when $13 then excluded.classification_source else pain_points.classification_source end,
             requires_compliance_review = case when $13 then excluded.requires_compliance_review else pain_points.requires_compliance_review end,
             updated_at = now()`,
          [ctx.orgId, discoveryId, pp.key, pp.stageId, pp.title, c?.classification ?? null, c?.rationale ?? null, c?.source ?? null,
           c?.requiresComplianceReview ?? STAGES[pp.stageId].regulatedJudgement, pp.confidence.level, { level: pp.confidence.level, reasons: pp.confidence.reasons, participantCount: pp.confidence.participantCount }, summary, c !== null && c !== undefined]);
      }
      // A finding from an earlier analysis that this one no longer produces (merged into another, or not a
      // problem after all) is retired, not deleted: its corrections and decisions stay in the history.
      await tx.query(`update pain_points set evidence_summary = evidence_summary || '{"retired": true}'::jsonb, updated_at = now()
                       where discovery_id = $1 and not (key = any($2::text[])) and not coalesce((evidence_summary->>'retired')::boolean, false)`,
        [discoveryId, findings.painPoints.map((p) => p.key)]);
      await tx.query('insert into analysis_runs (org_id, discovery_id, findings, key_merges, playbook_version) values ($1,$2,$3,$4,$5)',
        [ctx.orgId, discoveryId, JSON.stringify({ ...findingsForStorage(findings), firmLeadInterviewed, notProblems: [...notProblems] }), JSON.stringify(merged.applied), playbook.version]);
      await insertAudit(tx, [{ orgId: ctx.orgId, discoveryId, actor: `user:${ctx.userId}`, action: 'analysis.run',
        metadata: { painPoints: findings.painPoints.length, merges: merged.applied.length, mergeUnavailable, classified: [...classifications.values()].filter(Boolean).length } }]);
    });
    await this.rescore(ctx, discoveryId);
    return findings;
  }

  // Deterministic re-scoring from stored pain points. Runs after analysis and after every correction.
  async rescore(ctx: Actor, discoveryId: string): Promise<void> {
    await withFirmContext(this.db, ctx, async (tx) => {
      const d = await tx.query('select firm_profile from discoveries where id = $1', [discoveryId]);
      if (!d.rows[0]) throw new NotFoundError('Discovery not found');
      const profile = FirmProfileSchema.safeParse(d.rows[0].firm_profile);
      const r = await tx.query(`select * from pain_points where discovery_id = $1 and not coalesce((evidence_summary->>'retired')::boolean, false)`, [discoveryId]);
      const pps: PainPointForScoring[] = r.rows.map((x) => ({
        id: x.id, key: x.key, title: x.title, stageId: x.stage_id, classification: x.classification,
        confidence: x.confidence as ConfidenceOrInsufficient,
        volume: x.evidence_summary?.volume?.value ?? null, minutes: x.evidence_summary?.minutes?.value ?? null,
        volumeN: x.evidence_summary?.volume?.n, minutesN: x.evidence_summary?.minutes?.n,
        overrides: x.overrides ?? {}, conversionAssumptions: x.evidence_summary?.conversionAssumptions ?? [],
        requiresComplianceReview: x.requires_compliance_review,
      }));
      const built = buildOpportunities(pps, profile.success ? profile.data : null, DEFAULT_SCORING_CONFIG);
      await tx.query('delete from opportunities where discovery_id = $1', [discoveryId]);
      for (const o of built) {
        await tx.query(
          `insert into opportunities (org_id, discovery_id, pain_point_id, impact, score, score_breakdown, scoring_config_version, rank, feasibility, assumptions, explanation)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [ctx.orgId, discoveryId, o.painPointId, o.impact, o.score, JSON.stringify(o.breakdown), DEFAULT_SCORING_CONFIG.version, o.rank,
           { ...o.twoWeek, excludedReason: o.excludedReason }, JSON.stringify(o.assumptions), JSON.stringify(o.explanation)]);
      }
      await insertAudit(tx, [{ orgId: ctx.orgId, discoveryId, actor: 'system', action: 'opportunities.rescored', metadata: { configVersion: DEFAULT_SCORING_CONFIG.version, count: built.length } }]);
    });
  }

  // Milestone 5: send targeted follow-ups based on the latest analysis.
  async sendFollowUps(ctx: Actor, discoveryId: string): Promise<{ participants: number; questions: number; links: { name: string; link: string }[] }> {
    const playbook = await this.playbookFor(ctx, discoveryId);
    const plan = await withFirmContext(this.db, ctx, async (tx) => {
      const live = await tx.query("select p.pseudonym from interview_sessions s join participants p on p.id = s.participant_id where s.discovery_id = $1 and s.status in ('in_progress','paused')", [discoveryId]);
      const exclude = new Set<string>(live.rows.map((r) => r.pseudonym));
      const evidence = await this.loadEvidence(tx, discoveryId);
      const merges = await tx.query('select key_merges, findings from analysis_runs where discovery_id = $1 order by created_at desc limit 1', [discoveryId]);
      const notProblems = new Set<string>(merges.rows[0]?.findings?.notProblems ?? []);
      const merged = applyKeyMerges(evidence, merges.rows[0]?.key_merges ?? [], playbook).evidence.filter((e) => !notProblems.has(e.painPointKey));
      return planFollowUps(consolidate(merged, { playbook, firmLeadInterviewed: false }), merged, { exclude });
    });
    const byRef = new Map<string, typeof plan>();
    plan.forEach((f) => byRef.set(f.participantRef, [...(byRef.get(f.participantRef) ?? []), f]));

    const emails: { to: string; name: string; link: string }[] = [];
    await withFirmContext(this.db, ctx, async (tx) => {
      for (const [ref, items] of byRef) {
        const p = await tx.query('select id, role, email, display_name from participants where discovery_id = $1 and pseudonym = $2', [discoveryId, ref]);
        const participant = p.rows[0];
        if (!participant) continue;
        const ids: string[] = [];
        for (const f of items) {
          const r = await tx.query(
            `insert into follow_ups (org_id, discovery_id, participant_id, pain_point_key, stage_id, question, reason, status)
             values ($1,$2,$3,$4,$5,$6,$7,'asked') returning id`,
            [ctx.orgId, discoveryId, participant.id, f.painPointKey, f.stageId, f.question, f.reason]);
          ids.push(r.rows[0].id);
        }
        const { state } = startFollowUp({ discoveryId, participantRef: ref, role: participant.role,
          items: items.map((f, i) => ({ id: ids[i]!, painPointKey: f.painPointKey, stageId: f.stageId as StageId, question: f.question })) });
        await insertSession(tx, { orgId: ctx.orgId, participantId: participant.id, state, kind: 'follow_up' });
        const token = newInvitationToken();
        await tx.query(`insert into invitations (org_id, discovery_id, participant_id, token_hash, expires_at) values ($1,$2,$3,$4, now() + interval '14 days')`,
          [ctx.orgId, discoveryId, participant.id, hashToken(token)]);
        // Any earlier link for this person is switched off; the new one opens the follow-up.
        await tx.query('update invitations set expires_at = now() where participant_id = $1 and token_hash <> $2 and expires_at > now()', [participant.id, hashToken(token)]);
        emails.push({ to: participant.email ?? '', name: participant.display_name, link: `${this.deps.appBaseUrl}/i/${token}` });
      }
      await insertAudit(tx, [{ orgId: ctx.orgId, discoveryId, actor: `user:${ctx.userId}`, action: 'follow_ups.sent', metadata: { participants: byRef.size, questions: plan.length } }]);
    });
    for (const e of emails) {
      if (!this.deps.mailer || !e.to) continue;
      await this.deps.mailer.send({ to: e.to, subject: 'A few short follow-up questions',
        text: `Hi ${e.name},\n\nThanks for taking part in the process review. After comparing answers across the team, there are a few short questions where a little more detail would help. It should take under five minutes.\n\nContinue here: ${e.link}\n\nAs before, please leave out client names and case details.` });
    }
    return { participants: byRef.size, questions: plan.length, links: emails.map((e) => ({ name: e.name, link: e.link })) };
  }

  // Milestone 7: firm playback.
  async playback(ctx: FirmContext, discoveryId: string) {
    return withFirmContext(this.db, ctx, async (tx) => {
      const run = await tx.query('select findings, created_at from analysis_runs where discovery_id = $1 order by created_at desc limit 1', [discoveryId]);
      const rows = await tx.query(
        `select pp.*, o.impact, o.score, o.rank, o.feasibility, o.assumptions, o.explanation, o.score_breakdown
           from pain_points pp left join opportunities o on o.pain_point_id = pp.id where pp.discovery_id = $1 and not coalesce((pp.evidence_summary->>'retired')::boolean, false)`, [discoveryId]);
      const progress = await tx.query(
        `select p.role, coalesce((select s.status::text from interview_sessions s where s.participant_id = p.id and s.kind = 'main' order by s.started_at desc limit 1), 'not started') as status
           from participants p where p.discovery_id = $1`, [discoveryId]);
      const corrections = await tx.query('select entity_id, field, old_value, new_value, reason, created_at from corrections where discovery_id = $1 order by created_at', [discoveryId]);
      // Small-firm privacy: verbatim quotes reach the firm (screens, report, pack) only when the role has
      // enough contributors that a quote can't be pinned on one person. The firm lead's own words always can.
      const groups = new Map((await tx.query(
        `select p.role, count(distinct e.participant_pseudonym)::int as n from evidence_records e
           join participants p on p.discovery_id = e.discovery_id and p.pseudonym = e.participant_pseudonym
          where e.discovery_id = $1 group by p.role`, [discoveryId])).rows.map((r) => [r.role as string, r.n as number]));
      const quotable = (role: string) => role === 'firm_lead' || (groups.get(role) ?? 0) >= QUOTE_MIN_GROUP;

      const painPoints = rows.rows.map((x) => ({
        id: x.id, key: x.key, title: x.title, stageId: x.stage_id as StageId, stageName: STAGES[x.stage_id as StageId].name,
        classification: x.classification as Classification | null, classificationSource: x.classification_source, classificationRationale: x.classification_rationale,
        requiresComplianceReview: x.requires_compliance_review, validated: x.validated_by_firm_lead,
        confidence: x.confidence, confidenceReasons: x.confidence_detail?.reasons ?? [],
        roles: (x.evidence_summary?.roles ?? []).map((r: Role) => ROLE_LABELS[r]),
        participantCount: x.evidence_summary?.participantCount ?? 0,
        volume: x.evidence_summary?.volume ?? null, minutes: x.evidence_summary?.minutes ?? null, overrides: x.overrides,
        disagreements: (x.evidence_summary?.disagreementsByRole ?? []).map((d: any) => ({ field: d.field, values: d.values.map((v: any) => ({ role: ROLE_LABELS[v.role as Role], value: v.value })) })),
        quotes: (x.evidence_summary?.quotesByRole ?? []).filter((q: any) => quotable(q.role)).map((q: any) => ({ role: ROLE_LABELS[q.role as Role], quote: q.quote })),
        quotesWithheld: (x.evidence_summary?.quotesByRole ?? []).filter((q: any) => !quotable(q.role)).length as number,
        systems: (x.evidence_summary?.systems ?? []) as string[], causes: x.evidence_summary?.causes ?? [], improvements: x.evidence_summary?.improvements ?? [],
        outstandingQuestions: x.evidence_summary?.outstandingQuestions ?? [], // A figure the firm lead has entered isn't missing any more.
        missingMeasurements: ((x.evidence_summary?.missingMeasurements ?? []) as string[]).filter((m) => x.overrides?.[m] === undefined || x.overrides?.[m] === null),
        impact: x.impact, score: x.score === null ? null : Number(x.score), rank: x.rank, twoWeek: x.feasibility, breakdown: x.score_breakdown ?? null,
        assumptions: x.assumptions ?? [], explanation: x.explanation ?? [],
        corrections: corrections.rows.filter((c) => c.entity_id === x.id),
      }));
      painPoints.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || STAGE_IDS.indexOf(a.stageId) - STAGE_IDS.indexOf(b.stageId));
      const ranked = painPoints.filter((p) => p.rank !== null);
      const findings = run.rows[0]?.findings ?? null;
      return {
        analysedAt: run.rows[0]?.created_at ?? null,
        participation: progress.rows.map((r) => ({ role: ROLE_LABELS[r.role as Role], status: r.status })),
        journey: STAGE_IDS.map((s) => ({ id: s, name: STAGES[s].name, regulatedJudgement: STAGES[s].regulatedJudgement,
          painPoints: painPoints.filter((p) => p.stageId === s).map((p) => p.id) })),
        painPoints,
        topThree: ranked.slice(0, 3).map((p) => p.id),
        crossRole: findings ? {
          agreements: findings.agreements, disagreements: findings.disagreements, blindSpots: findings.blindSpots, firmLeadInterviewed: !!findings.firmLeadInterviewed,
          unreportedStages: (findings.unreportedStages as StageId[]).map((s) => STAGES[s].name), missingMeasurements: findings.missingMeasurements,
        } : null,
        scoringConfigVersion: DEFAULT_SCORING_CONFIG.version,
      };
    });
  }

  async correct(ctx: Actor, discoveryId: string, painPointId: string, input: unknown): Promise<void> {
    const c = CorrectionSchema.parse(input);
    await withFirmContext(this.db, ctx, async (tx) => {
      const r = await tx.query('select * from pain_points where id = $1 and discovery_id = $2 for update', [painPointId, discoveryId]);
      const pp = r.rows[0];
      if (!pp) throw new NotFoundError('Pain point not found');
      let oldValue: unknown;
      switch (c.field) {
        case 'classification':
          oldValue = pp.classification;
          await tx.query(`update pain_points set classification = $1, classification_source = 'firm_lead', classification_rationale = $2, updated_at = now() where id = $3`, [c.value, `Set by firm lead: ${c.reason}`, painPointId]);
          break;
        case 'title':
          oldValue = pp.title;
          await tx.query('update pain_points set title = $1, updated_at = now() where id = $2', [c.value, painPointId]);
          break;
        case 'stageId':
          oldValue = pp.stage_id;
          await tx.query('update pain_points set stage_id = $1, requires_compliance_review = $2 or requires_compliance_review, updated_at = now() where id = $3', [c.value, STAGES[c.value].regulatedJudgement, painPointId]);
          break;
        case 'clarification':
          oldValue = null;
          break;
        case 'validated':
          oldValue = pp.validated_by_firm_lead;
          await tx.query('update pain_points set validated_by_firm_lead = $1, updated_at = now() where id = $2', [c.value, painPointId]);
          break;
        default: {
          oldValue = pp.overrides?.[c.field] ?? null;
          const overrides = { ...(pp.overrides ?? {}) };
          if (c.value === null) delete overrides[c.field]; else overrides[c.field] = c.value;
          // The firm's own explanation of which spending it can reduce travels with the figure.
          if (c.field === 'monthlyCashSavingGBP') { if (c.value === null) delete overrides.cashSavingBasis; else overrides.cashSavingBasis = c.reason; }
          await tx.query('update pain_points set overrides = $1, updated_at = now() where id = $2', [overrides, painPointId]);
        }
      }
      await tx.query(
        `insert into corrections (org_id, discovery_id, entity_type, entity_id, field, old_value, new_value, reason, corrected_by)
         values ($1,$2,'pain_point',$3,$4,$5,$6,$7,$8)`,
        [ctx.orgId, discoveryId, painPointId, c.field, JSON.stringify(oldValue ?? null), JSON.stringify(c.value), c.reason, ctx.userId]);
      await insertAudit(tx, [{ orgId: ctx.orgId, discoveryId, actor: `user:${ctx.userId}`, action: c.field === 'clarification' ? 'pain_point.clarified' : 'pain_point.corrected', entityType: 'pain_point', entityId: painPointId, metadata: { field: c.field } }]);
    });
    if (c.field !== 'clarification') await this.rescore(ctx, discoveryId);
  }

  // Phase 3: everything the discovery workspace shows, from existing tables. Read-only.
  // Privacy: verbatim quotes are returned only for roles with at least QUOTE_MIN_GROUP contributors
  // (or the firm lead's own words); otherwise the extracted observation is shown without the quote.
  async discoveryWorkspace(ctx: FirmContext, discoveryId: string) {
    const playbook = await this.playbookFor(ctx, discoveryId);
    const pb = await this.playback(ctx, discoveryId);
    return withFirmContext(this.db, ctx, async (tx) => {
      const dr = await tx.query(
        `select d.id, d.status, d.created_at, d.firm_profile, d.playbook_version, o.name as firm_name,
                greatest(d.created_at, (select max(created_at) from audit_log l where l.discovery_id = d.id)) as updated_at,
                (select max(created_at) from reports r where r.discovery_id = d.id) as reported_at
           from discoveries d join organisations o on o.id = d.org_id where d.id = $1`, [discoveryId]);
      const d = dr.rows[0];
      if (!d) throw new NotFoundError('Discovery not found');
      const raw = await this.loadEvidence(tx, discoveryId, { includeDisputed: true });
      const kinds = new Map((await tx.query(
        `select e.id, s.kind from evidence_records e left join interview_sessions s on s.id = e.session_id where e.discovery_id = $1`, [discoveryId])).rows.map((r) => [r.id, r.kind]));
      const reviews = new Map((await tx.query(
        `select distinct on (entity_id) entity_id, new_value #>> '{}' as status, reason, created_at from corrections
          where discovery_id = $1 and entity_type = 'evidence_record' and field = 'review' order by entity_id, created_at desc`, [discoveryId])).rows
        .map((r) => [r.entity_id, { status: r.status as string, reason: r.reason as string | null, at: r.created_at }]));
      const history = (await tx.query(
        `select entity_type, entity_id, field, old_value, new_value, reason, created_at from corrections where discovery_id = $1 order by created_at desc`, [discoveryId])).rows;
      const merges = (await tx.query('select key_merges from analysis_runs where discovery_id = $1 order by created_at desc limit 1', [discoveryId])).rows[0]?.key_merges ?? [];
      const sessions = (await tx.query(
        `select s.kind, s.status, s.state->'coverage' as coverage from interview_sessions s where s.discovery_id = $1`, [discoveryId])).rows;
      const people = (await tx.query(
        `select p.id, p.display_name, p.role, p.consented_at,
                (select s.status from interview_sessions s where s.participant_id = p.id and s.kind = 'main' order by s.started_at desc limit 1) as main_status,
                (select count(*)::int from follow_ups f where f.participant_id = p.id) as follow_ups,
                (select bool_or(s.status in ('in_progress','paused')) from interview_sessions s where s.participant_id = p.id and s.kind = 'follow_up') as follow_up_open,
                exists (select 1 from invitations i where i.participant_id = p.id and i.first_used_at is not null) as opened
           from participants p where p.discovery_id = $1 order by p.invited_at`, [discoveryId])).rows;

      // Map evidence to findings through the merges the last analysis applied.
      const merged = applyKeyMerges(raw, merges, playbook).evidence;
      const byKey = new Map(pb.painPoints.map((p) => [p.key, p]));
      const reviewOf = (id: string) => reviews.get(id) ?? { status: 'unreviewed', reason: null, at: null };
      const contributors = new Map<string, Set<string>>();
      for (const e of merged) contributors.set(e.role, (contributors.get(e.role) ?? new Set()).add(e.participantRef));
      const quoteAllowed = (role: string) => role === 'firm_lead' || (contributors.get(role)?.size ?? 0) >= QUOTE_MIN_GROUP;
      const SOURCE: Record<string, string> = { firm_said: 'employee_reported', operational_record: 'measured', measured_baseline: 'measured', playbook: 'industry_knowledge', assumption: 'assumption' };

      const evidence = merged.map((e) => {
        const finding = byKey.get(e.painPointKey) ?? null;
        const allowed = quoteAllowed(e.role);
        return {
          id: e.id, findingId: finding?.id ?? null, findingTitle: finding?.title ?? null,
          stageId: e.stageId, stageName: STAGES[e.stageId]?.name ?? e.stageId,
          source: SOURCE[e.source] ?? 'assumption', role: ROLE_LABELS[e.role] ?? e.role,
          origin: kinds.get(e.id) === 'follow_up' ? 'Follow-up interview' : e.participantRef === 'firm' ? 'Firm' : 'Interview',
          observed: e.taskDescription, monthlyVolume: e.monthlyVolume, minutesPerOccurrence: e.minutesPerOccurrence,
          conversionAssumptions: e.conversionAssumptions, systems: e.systems, reportedCause: e.reportedCause, potentialImprovement: e.potentialImprovement,
          outstandingQuestions: e.outstandingQuestions,
          quote: allowed ? e.supportingQuote : null, quoteWithheld: !allowed,
          collectedAt: e.createdAt, review: reviewOf(e.id),
        };
      });

      const FIELD_LABEL: Record<string, string> = { classification: 'Approach', title: 'Title', stageId: 'Stage', monthlyVolume: 'Monthly volume', minutesPerOccurrence: 'Minutes each time',
        reductionPct: 'Share of work that could be removed', validated: 'Validated', clarification: 'Clarification', review: 'Evidence review',
        implementationCostGBP: 'Cost to build it', monthlyCashSavingGBP: 'Spending the firm can reduce', staffHoursPerCase: 'Staff hours per case',
        revenuePerCaseGBP: 'Revenue per case', demandConfirmed: 'Demand for more cases confirmed', opportunity_decision: 'Opportunity decision' };
      const entry = (h: any) => ({ entityType: h.entity_type as string, entityId: h.entity_id as string, field: h.field as string, label: FIELD_LABEL[h.field] ?? h.field, oldValue: h.old_value, newValue: h.new_value, reason: h.reason as string | null, at: h.created_at });

      const findings = pb.painPoints.map((p) => {
        const items = evidence.filter((e) => e.findingId === p.id);
        const active = merged.filter((e) => byKey.get(e.painPointKey)?.id === p.id && reviewOf(e.id).status !== 'disputed');
        const template = p.classification === 'automate' ? templateFor(p.key) : null;
        const reductionBasis: 'firm_lead' | 'template' | null = p.overrides.reductionPct !== undefined && p.overrides.reductionPct !== null ? 'firm_lead' : template ? 'template' : null;
        const dimensions = assessDimensions(active.map((e) => ({ participantRef: e.participantRef, source: e.source, monthlyVolume: e.monthlyVolume, minutesPerOccurrence: e.minutesPerOccurrence })),
          { overrides: p.overrides, reductionBasis });
        const disputed = items.filter((e) => e.review.status === 'disputed').length;
        const actions: string[] = [];
        if (p.missingMeasurements.includes('monthlyVolume')) actions.push('Ask how often this happens: follow-up questions can collect it.');
        if (p.missingMeasurements.includes('minutesPerOccurrence')) actions.push('Ask how long each occurrence takes: follow-up questions can collect it.');
        if (p.disagreements.length) actions.push('Accounts differ: talk to the roles involved before relying on the figures.');
        if (p.participantCount === 1) actions.push('Only one person described this: hear from someone else in a related role.');
        if (disputed) actions.push(`Resolve ${disputed === 1 ? 'the disputed piece' : `${disputed} disputed pieces`} of evidence.`);
        if (p.classificationSource === 'playbook') actions.push('The suggested approach comes from industry knowledge: confirm or correct it.');
        if (!p.classification) actions.push('Choose an approach: overhaul, fix, automate or keep human.');
        if (p.requiresComplianceReview) actions.push('Involves regulated judgement: a qualified compliance reviewer must look at any change.');
        if (!p.validated) actions.push('Confirm the finding, or correct what doesn’t match how your firm works.');
        const { quotes: _withheldUnlessAllowed, corrections: _legacy, ...rest } = p;
        return {
          ...rest, evidenceIds: items.map((e) => e.id), disputedEvidence: disputed, dimensions, reductionBasis, validationActions: actions,
          history: history.filter((h) => h.entity_id === p.id || items.some((e) => e.id === h.entity_id)).map(entry),
        };
      });

      const coverage = new Map<string, { asked: number; notInvolved: number }>();
      for (const sRow of sessions) for (const [stage, c] of Object.entries((sRow.coverage ?? {}) as Record<string, any>)) {
        const cur = coverage.get(stage) ?? { asked: 0, notInvolved: 0 };
        cur.asked += Number(c?.questionsAsked ?? 0); cur.notInvolved += c?.notInvolved ? 1 : 0; coverage.set(stage, cur);
      }
      const findingKeys = new Set(pb.painPoints.map((p) => p.key));
      const stages = STAGE_IDS.map((id) => {
        const ev = evidence.filter((e) => e.stageId === id && e.review.status !== 'disputed');
        const cov = coverage.get(id) ?? { asked: 0, notInvolved: 0 };
        return {
          id, name: STAGES[id].name, regulatedJudgement: STAGES[id].regulatedJudgement, parallel: id === 'protection',
          evidence: ev.length, findings: pb.painPoints.filter((p) => p.stageId === id).map((p) => p.id),
          openQuestions: [...new Set(findings.filter((f) => f.stageId === id).flatMap((f) => f.outstandingQuestions as string[]))].length,
          explored: ev.length > 0 || cov.asked > 0, questionsAsked: cov.asked, notInvolved: cov.notInvolved,
          hypotheses: playbook.cards.filter((c) => c.stageId === id && !findingKeys.has(c.id)).map((c) => ({ key: c.id, title: c.title, likelyClassification: c.likelyClassification })),
        };
      });

      const participants = people.map((r) => ({
        id: r.id as string, name: r.display_name as string, role: r.role as string, roleLabel: ROLE_LABELS[r.role as Role] ?? r.role,
        status: (r.main_status ?? (r.consented_at ? 'consented' : r.opened ? 'opened' : 'invited')) as string,
        consented: !!r.consented_at, followUps: r.follow_ups as number, followUpOpen: !!r.follow_up_open,
      }));
      const roles = Object.keys(ROLE_LABELS).map((role) => ({
        role, label: ROLE_LABELS[role as Role], invited: participants.filter((x) => x.role === role).length,
        completed: participants.filter((x) => x.role === role && x.status === 'completed').length,
      }));
      const mainStages = stages.filter((s) => !s.parallel);
      const openQuestions = [...new Set(findings.flatMap((f) => f.outstandingQuestions as string[]))];
      const assumptions = [...new Set(findings.flatMap((f) => [...(f.assumptions as string[]), ...(f.classificationSource === 'playbook' ? [`${f.title}: approach suggested by industry knowledge, not confirmed`] : [])]))];
      const profile = FirmProfileSchema.safeParse(d.firm_profile);
      const blockers = [
        ...(pb.analysedAt ? [] : ['The interviews haven’t been analysed yet.']),
        ...(d.status === 'priorities_approved' ? ['Priorities are already approved.'] : []),
      ];
      return {
        discovery: { id: d.id as string, name: `Discovery started ${new Date(d.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
          status: d.status as string, createdAt: d.created_at, updatedAt: d.updated_at, analysedAt: pb.analysedAt, reportedAt: d.reported_at, knowledgeVersion: d.playbook_version as string },
        firmName: d.firm_name as string,
        profile: profile.success ? profile.data : null,
        participants, roles, stages, evidence, findings,
        crossRole: pb.crossRole, topThree: pb.topThree,
        completion: {
          blockers, canComplete: blockers.length === 0,
          interviews: { invited: participants.length, completed: participants.filter((x) => x.status === 'completed').length },
          stagesExplored: mainStages.filter((s) => s.explored).length, stagesTotal: mainStages.length,
          findings: {
            total: findings.length, withEvidence: findings.filter((f) => f.evidenceIds.length - f.disputedEvidence > 0).length,
            needValidation: findings.filter((f) => !f.validated).length,
            weakExistence: findings.filter((f) => ['insufficient', 'low'].includes(f.dimensions.existence.level)).length,
          },
          openQuestions: openQuestions.length, openQuestionList: openQuestions.slice(0, 50),
          missingMeasurements: findings.filter((f) => (f.missingMeasurements as string[]).length > 0).length,
          assumptions: assumptions.length, assumptionList: assumptions.slice(0, 50),
          disputedEvidence: evidence.filter((e) => e.review.status === 'disputed').length,
        },
      };
    });
  }

  // Phase 4: opportunity intelligence for one discovery. Everything is derived from discovery, the existing
  // scores and the stored business case; nothing here calls the AI.
  async opportunityAssessments(ctx: FirmContext, discoveryId: string) {
    const dw = await this.discoveryWorkspace(ctx, discoveryId);
    const playbook = await this.playbookFor(ctx, discoveryId);
    const packs = await withFirmContext(this.db, ctx, async (tx) => (await tx.query(
      'select pain_point_id, status from implementation_packs where discovery_id = $1', [discoveryId])).rows.map((r) => ({ painPointId: r.pain_point_id as string, status: r.status as string })));
    const opportunities = assessOpportunities(dw, playbook, packs);
    const count = (...s: string[]) => opportunities.filter((o) => s.includes(o.status)).length;
    const byClass = (c: string | null) => opportunities.filter((o) => o.classification === c).length;
    return {
      discovery: dw.discovery, firmName: dw.firmName,
      summary: {
        total: opportunities.length,
        byClassification: { overhaul: byClass('overhaul'), fix: byClass('fix'), automate: byClass('automate'), keep_human: byClass('keep_human'), unclassified: byClass(null) },
        awaitingValidation: count('awaiting_validation'), readyForReview: count('ready_for_review', 'challenged'), approved: count('approved', 'sent_to_engineering'),
        sentToEngineering: count('sent_to_engineering'), needsEvidence: count('needs_evidence'), needsClassification: count('needs_classification'), complianceReview: count('compliance_review'),
        keepHuman: count('keep_human'), rejected: count('rejected'), prioritised: opportunities.filter((o) => o.priorityRank !== null).length,
      },
      opportunities,
      history: Object.fromEntries(dw.findings.map((f) => [f.id, f.history])),
      hypotheses: dw.stages.flatMap((s) => s.hypotheses.map((h) => ({ ...h, stageId: s.id, stageName: s.name }))),
      scoring: { version: DEFAULT_SCORING_CONFIG.version, weights: DEFAULT_SCORING_CONFIG.weights, bands: PRIORITY_BANDS },
    };
  }

  // Review decisions on an opportunity: approve, challenge, reject or reopen. Append-only, audited.
  async recordOpportunityDecision(ctx: Actor, discoveryId: string, painPointId: string, input: unknown): Promise<void> {
    const d = OpportunityDecisionSchema.parse(input);
    const { opportunities } = await this.opportunityAssessments(ctx, discoveryId);
    const o = opportunities.find((x) => x.id === painPointId);
    if (!o) throw new NotFoundError('Opportunity not found');
    if (d.decision === 'approved') {
      const blocking = approvalBlockers(o);
      if (blocking.length) throw Object.assign(new Error(`This opportunity can’t be approved yet: ${blocking.map((g) => g.label.toLowerCase()).join('; ')}.`), { statusCode: 409 });
    }
    await this.insertDecision(ctx, discoveryId, painPointId, { decision: d.decision }, o.decision.latest, d.reason || null);
  }

  // Records the hand-over to JADA engineering, with a snapshot of exactly what was sent.
  async recordEngineeringHandover(ctx: Actor, discoveryId: string, painPointId: string, brief: unknown, previous: string | null): Promise<void> {
    await this.insertDecision(ctx, discoveryId, painPointId, { decision: 'sent_to_engineering', brief }, previous, 'Sent to JADA engineering review');
  }

  private async insertDecision(ctx: Actor, discoveryId: string, painPointId: string, value: Record<string, unknown>, previous: string | null, reason: string | null) {
    await withFirmContext(this.db, ctx, async (tx) => {
      await tx.query(
        `insert into corrections (org_id, discovery_id, entity_type, entity_id, field, old_value, new_value, reason, corrected_by)
         values ($1,$2,'pain_point',$3,'opportunity_decision',$4,$5,$6,$7)`,
        [ctx.orgId, discoveryId, painPointId, JSON.stringify(previous), JSON.stringify(value), reason, ctx.userId]);
      // Approving is how the firm confirms a finding (there is no separate validation step).
      if (value.decision === 'approved') await tx.query('update pain_points set validated_by_firm_lead = true, updated_at = now() where id = $1 and discovery_id = $2', [painPointId, discoveryId]);
      await insertAudit(tx, [{ orgId: ctx.orgId, discoveryId, actor: `user:${ctx.userId}`, action: `opportunity.${value.decision}`, entityType: 'pain_point', entityId: painPointId }]);
    });
  }

  // Phase 3: the firm lead marks one piece of evidence validated or disputed, with a reason.
  // Recorded in the append-only corrections history; a dispute removes it from the next analysis.
  async reviewEvidence(ctx: Actor, discoveryId: string, evidenceId: string, input: unknown): Promise<void> {
    const review = EvidenceReviewSchema.parse(input);
    await withFirmContext(this.db, ctx, async (tx) => {
      const e = await tx.query('select id from evidence_records where id = $1 and discovery_id = $2', [evidenceId, discoveryId]);
      if (!e.rows[0]) throw new NotFoundError('Evidence not found');
      const prev = await tx.query(
        `select new_value from corrections where entity_type = 'evidence_record' and entity_id = $1 and field = 'review' order by created_at desc limit 1`, [evidenceId]);
      await tx.query(
        `insert into corrections (org_id, discovery_id, entity_type, entity_id, field, old_value, new_value, reason, corrected_by)
         values ($1,$2,'evidence_record',$3,'review',$4,$5,$6,$7)`,
        [ctx.orgId, discoveryId, evidenceId, JSON.stringify(prev.rows[0]?.new_value ?? 'unreviewed'), JSON.stringify(review.status), review.reason || null, ctx.userId]);
      await insertAudit(tx, [{ orgId: ctx.orgId, discoveryId, actor: `user:${ctx.userId}`, action: `evidence.${review.status}`, entityType: 'evidence_record', entityId: evidenceId }]);
    });
  }

  // Phase 3: discovery completion. The firm lead marks the discovery ready for opportunity review.
  // Nothing is forced to "verified": open questions and uncertainties are recorded with the decision.
  async completeDiscovery(ctx: Actor, discoveryId: string, note: string): Promise<{ status: string }> {
    const ws = await this.discoveryWorkspace(ctx, discoveryId);
    if (!ws.discovery.analysedAt) throw Object.assign(new Error('Analyse the interviews before completing the discovery.'), { statusCode: 409 });
    if (ws.discovery.status === 'priorities_approved') throw Object.assign(new Error('Priorities are already approved for this discovery.'), { statusCode: 409 });
    await withFirmContext(this.db, ctx, async (tx) => {
      await tx.query("update discoveries set status = 'review_ready' where id = $1", [discoveryId]);
      const c = ws.completion;
      await insertAudit(tx, [{ orgId: ctx.orgId, discoveryId, actor: `user:${ctx.userId}`, action: 'discovery.completed', entityType: 'discovery', entityId: discoveryId,
        metadata: { findings: c.findings.total, needValidation: c.findings.needValidation, openQuestions: c.openQuestions, missingMeasurements: c.missingMeasurements,
          unresolvedAssumptions: c.assumptions, disputedEvidence: c.disputedEvidence, noteLength: note.length } }]);
    });
    return { status: 'review_ready' };
  }
}

// Stored findings keep keys and role-level detail only — no pseudonyms.
function findingsForStorage(f: CrossRoleFindings) {
  return {
    agreements: f.agreements, disagreements: f.disagreements, blindSpots: f.blindSpots,
    unreportedStages: f.unreportedStages, missingMeasurements: f.missingMeasurements,
    painPoints: f.painPoints.map((p) => ({ key: p.key, roles: p.roles, participantCount: p.participantRefs.length, confidence: p.confidence.level })),
  };
}
