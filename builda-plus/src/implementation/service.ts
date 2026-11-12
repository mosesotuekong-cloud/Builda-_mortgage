import { z } from 'zod';
import { withFirmContext, withJadaContext, type Db, type FirmContext } from '../db/pool';
import { insertAudit, NotFoundError } from '../db/repositories';
import type { AnalysisService } from '../analysis/service';
import type { FirmService } from '../firm/service';
import type { Playbook } from '../knowledge/playbook';
import { TEMPLATES, type AutomationTemplate } from '../knowledge/templates';
import { buildReportModel, type ReportModel } from '../report/model';
import { playbookPlan, systemsInPlan, timelineFor, writePlan, type PlanInput, type SolutionPlan } from '../report/plans';
import { STAGES, type StageId } from '../domain/journey';
import type { LLMProvider } from '../llm/provider';
import { approvalBlockers, briefToMarkdown } from '../analysis/opportunityAssessment';
import { packOf, submissionOf } from './engineering';
import { assessReview, buildImplementationPack, packToMarkdown, PackNotPossibleError, ReviewSchema, type ImplementationPack } from './pack';

type Actor = FirmContext & { userId: string };

export const ApprovalSchema = z.object({
  priorities: z.array(z.string().uuid()).min(1).max(10),
  proceedWith: z.string().uuid().nullable(),
  note: z.string().max(2000).default(''),
});

export class DecisionService {
  constructor(private db: Db, private deps: { analysis: AnalysisService; firms: FirmService; playbook: Playbook; templates?: AutomationTemplate[];
    // Writes each top opportunity's concrete plan. Without it (tests), plans come from the playbook.
    llmFor?: (ctx: { orgId: string; discoveryId: string }) => LLMProvider }) {}

  private async firmName(ctx: FirmContext): Promise<string> {
    return withFirmContext(this.db, ctx, async (tx) => (await tx.query('select name from organisations where id = $1', [ctx.orgId])).rows[0]?.name ?? 'Your firm');
  }

  // Milestone 9: an immutable report snapshot (the baseline) plus its PDF.
  async createReport(ctx: Actor, discoveryId: string): Promise<{ reportId: string; version: number }> {
    const playback = await this.deps.analysis.playback(ctx, discoveryId);
    if (!playback.analysedAt) throw Object.assign(new Error('Run the analysis before creating a report.'), { statusCode: 409 });
    const profile = await this.deps.firms.getProfile(ctx, discoveryId);
    const firmName = await this.firmName(ctx);
    const playbook = await this.deps.analysis.playbookFor(ctx, discoveryId);
    // Concrete plans for the top opportunities, written before the transaction (AI calls take seconds).
    const systems = profile?.technology?.length ? profile.technology.map((t) => t.name) : profile?.systems ?? [];
    const plans = new Map<string, SolutionPlan>();
    const llm = this.deps.llmFor?.({ orgId: ctx.orgId, discoveryId });
    await Promise.all(playback.topThree.map(async (id) => {
      const x = playback.painPoints.find((p) => p.id === id);
      if (!x || !timelineFor(x.classification, systems)) return;
      const input: PlanInput = {
        title: x.title, stage: x.stageName, classification: x.classification, regulated: !!STAGES[x.stageId as StageId]?.regulatedJudgement,
        roles: x.roles, causes: x.causes, improvements: x.improvements, quotes: x.quotes,
        monthlyVolume: x.overrides.monthlyVolume ?? x.volume?.value ?? null, minutesEach: x.overrides.minutesPerOccurrence ?? x.minutes?.value ?? null,
        hoursRecovered: x.impact?.monthlyHoursRecovered ?? null, systems, card: playbook.cards.find((c) => c.id === x.key) ?? null,
      };
      const text = llm ? await writePlan(llm, input).catch(() => null) : null;
      const plan = text ?? playbookPlan(input);
      plans.set(id, { ...plan, timeline: timelineFor(x.classification, systemsInPlan(plan, systems))!, source: text ? 'ai' : 'playbook' });
    }));
    return withFirmContext(this.db, ctx, async (tx) => {
      await tx.query('select id from discoveries where id = $1 for update', [discoveryId]);
      const v = (await tx.query('select coalesce(max(version), 0) + 1 as v from reports where discovery_id = $1', [discoveryId])).rows[0].v as number;
      const model = buildReportModel({ playback, profile, firmName, discoveryId, version: v, playbook, plans });
      const r = await tx.query('insert into reports (org_id, discovery_id, version, model, created_by) values ($1,$2,$3,$4,$5) returning id',
        [ctx.orgId, discoveryId, v, model, `user:${ctx.userId}`]);
      await insertAudit(tx, [{ orgId: ctx.orgId, discoveryId, actor: `user:${ctx.userId}`, action: 'report.created', entityType: 'report', entityId: r.rows[0].id, metadata: { version: v } }]);
      return { reportId: r.rows[0].id, version: v };
    });
  }

  async getReport(ctx: FirmContext, discoveryId: string, reportId: string): Promise<ReportModel> {
    return withFirmContext(this.db, ctx, async (tx) => {
      const r = await tx.query('select model from reports where id = $1 and discovery_id = $2', [reportId, discoveryId]);
      if (!r.rows[0]) throw new NotFoundError('Report not found');
      return r.rows[0].model as ReportModel;
    });
  }

  // Firm lead approves priorities and chooses what to build (brief §2, §4 step 10). Creates the pack for JADA.
  async approve(ctx: Actor, discoveryId: string, input: unknown): Promise<{ approvalId: string; packId: string | null }> {
    const a = ApprovalSchema.parse(input);
    // Phase 5, issue A: approving several priorities at once follows exactly the rules for approving one.
    // Every priority must pass the same gates, and each is recorded as its own audited decision.
    const intel = await this.deps.analysis.opportunityAssessments(ctx, discoveryId);
    const byId = new Map(intel.opportunities.map((o) => [o.id, o]));
    const refused = a.priorities.flatMap((id) => {
      const o = byId.get(id);
      const b = o ? approvalBlockers(o) : [];
      return b.length ? [`${o!.title}: ${b.map((g) => g.label.toLowerCase()).join('; ')}`] : [];
    });
    if (refused.length) throw Object.assign(new Error(`Nothing was approved. Each priority must meet the same rules as approving it on its own. ${refused.join('. ')}.`), { statusCode: 409 });
    if (a.proceedWith && byId.has(a.proceedWith)) {
      const eb = byId.get(a.proceedWith)!.gates.filter((g) => g.blocksEngineering && g.code !== 'not_validated');
      if (eb.length) throw Object.assign(new Error(`This item can’t go to engineering yet: ${eb.map((g) => g.label.toLowerCase()).join('; ')}.`), { statusCode: 409 });
    }
    for (const id of a.priorities) {
      const o = byId.get(id);
      if (o && o.decision.latest !== 'approved' && o.decision.latest !== 'sent_to_engineering') {
        await this.deps.analysis.recordOpportunityDecision(ctx, discoveryId, id, { decision: 'approved', reason: a.note || 'Approved with the priorities' });
      }
    }
    const playback = await this.deps.analysis.playback(ctx, discoveryId);
    const ids = new Set(playback.painPoints.map((p) => p.id));
    if (!a.priorities.every((id) => ids.has(id))) throw Object.assign(new Error('Some priorities are not findings of this discovery.'), { statusCode: 400 });
    let pack: ImplementationPack | null = null;
    if (a.proceedWith) {
      if (!a.priorities.includes(a.proceedWith)) throw Object.assign(new Error('The item to build must be one of the approved priorities.'), { statusCode: 400 });
      try {
        pack = buildImplementationPack({ playback, painPointId: a.proceedWith, profile: await this.deps.firms.getProfile(ctx, discoveryId), playbook: await this.deps.analysis.playbookFor(ctx, discoveryId), templates: this.deps.templates });
      } catch (err) {
        if (err instanceof PackNotPossibleError) throw Object.assign(new Error(err.message), { statusCode: 400 });
        throw err;
      }
    }
    return withFirmContext(this.db, ctx, async (tx) => {
      const r = await tx.query(
        'insert into priority_approvals (org_id, discovery_id, priorities, proceed_with, note, approved_by) values ($1,$2,$3,$4,$5,$6) returning id',
        [ctx.orgId, discoveryId, a.priorities, a.proceedWith, a.note, ctx.userId]);
      const approvalId = r.rows[0].id as string;
      // Approving priorities confirms those findings.
      await tx.query('update pain_points set validated_by_firm_lead = true, updated_at = now() where id = any($1) and discovery_id = $2', [a.priorities, discoveryId]);
      let packId: string | null = null;
      if (pack && a.proceedWith) {
        // Re-approving must not create a second pack for the same item.
        const existing = await tx.query('select id from implementation_packs where discovery_id = $1 and pain_point_id = $2', [discoveryId, a.proceedWith]);
        if (existing.rows[0]) packId = existing.rows[0].id;
      }
      if (pack && a.proceedWith && !packId) {
        const pr = await tx.query('insert into implementation_packs (org_id, discovery_id, pain_point_id, approval_id, content) values ($1,$2,$3,$4,$5) returning id',
          [ctx.orgId, discoveryId, a.proceedWith, approvalId, pack]);
        packId = pr.rows[0].id;
      }
      await tx.query("update discoveries set status = 'priorities_approved' where id = $1", [discoveryId]);
      await insertAudit(tx, [{ orgId: ctx.orgId, discoveryId, actor: `user:${ctx.userId}`, action: 'priorities.approved', entityType: 'priority_approval', entityId: approvalId,
        metadata: { priorities: a.priorities.length, packId } }]);
      return { approvalId, packId };
    });
  }

  async packStatus(ctx: FirmContext, discoveryId: string) {
    return withFirmContext(this.db, ctx, async (tx) => {
      const r = await tx.query(
        `select p.id, p.status, coalesce(p.content->'painPoint'->>'title', p.content->'submission'->>'title') as title, p.updated_at,
                (select r.result from pack_reviews r where r.pack_id = p.id order by r.created_at desc limit 1) as last_result
           from implementation_packs p where p.discovery_id = $1 order by p.created_at desc`, [discoveryId]);
      return r.rows.map((x) => ({ id: x.id, title: x.title, status: x.status, updatedAt: x.updated_at, failures: x.last_result?.failures ?? [] }));
    });
  }
}

export class JadaService {
  constructor(private db: Db) {}

  // Discoveries waiting for an engineer (firm name and reason only) and picking one up.
  async queue(userId: string) {
    // The database function reads the caller from the transaction's identity, never from a parameter.
    const r = await withJadaContext(this.db, userId, (tx) => tx.query('select * from jada_queue()'));
    // The database function's wording predates fix and overhaul submissions; say what is actually waiting.
    const REASON: Record<string, string> = { 'Priorities approved — implementation pack ready': 'Approved opportunities sent for engineering review' };
    return r.rows.map((x) => ({ discoveryId: x.discovery_id, firmName: x.firm_name, reason: REASON[x.reason] ?? x.reason, since: x.since }));
  }

  async isEngineer(userId: string): Promise<boolean> {
    return (await this.db.query("select 1 from jada_staff_roles where user_id = $1 and role = 'engineer'", [userId])).rowCount === 1;
  }

  async pickUp(userId: string, discoveryId: string): Promise<void> {
    // The queue check stays as defence in depth; the database function now enforces the same rules itself.
    if (!(await this.queue(userId)).some((q) => q.discoveryId === discoveryId)) throw new NotFoundError('That discovery isn’t waiting to be picked up.');
    const r = await withJadaContext(this.db, userId, (tx) => tx.query('select jada_pick_up($1) as result', [discoveryId]));
    const result = r.rows[0].result as string;
    if (result === 'not_engineer' || result === 'no_identity') throw Object.assign(new Error('Only JADA engineers can pick up discoveries.'), { statusCode: 403 });
    if (result !== 'ok') throw new NotFoundError('That discovery isn’t waiting to be picked up.');
  }

  // Hands a discovery back: the engineer's access to it ends immediately.
  async release(userId: string, discoveryId: string): Promise<void> {
    const r = await withJadaContext(this.db, userId, (tx) => tx.query('select jada_release($1) as ok', [discoveryId]));
    if (!r.rows[0].ok) throw new NotFoundError('You aren’t assigned to that discovery.');
  }

  async assignedDiscoveries(userId: string) {
    return withJadaContext(this.db, userId, async (tx) => {
      const r = await tx.query(
        `select d.id, d.status, o.name as firm_name,
                (select count(*)::int from escalations e where e.discovery_id = d.id and e.status = 'open') as open_escalations,
                (select count(*)::int from implementation_packs p where p.discovery_id = d.id and p.status = 'in_review') as packs_to_review
           from discoveries d join organisations o on o.id = d.org_id order by d.created_at desc`);
      return r.rows.map((x) => ({ id: x.id, firmName: x.firm_name, status: x.status, openEscalations: x.open_escalations, packsToReview: x.packs_to_review }));
    });
  }

  async discovery(userId: string, discoveryId: string) {
    return withJadaContext(this.db, userId, async (tx) => {
      const d = await tx.query('select d.id, d.status, o.name as firm_name from discoveries d join organisations o on o.id = d.org_id where d.id = $1', [discoveryId]);
      if (!d.rows[0]) throw new NotFoundError('Discovery not found');
      const packs = await tx.query('select id, status, content, created_at, updated_at from implementation_packs where discovery_id = $1 order by created_at desc', [discoveryId]);
      const reviews = await tx.query('select pack_id, decision, result, notes, created_at from pack_reviews where discovery_id = $1 order by created_at', [discoveryId]);
      const esc = await tx.query('select id, reason, details_redacted, status, created_at, resolved_at from escalations where discovery_id = $1 order by created_at desc', [discoveryId]);
      return {
        id: d.rows[0].id, firmName: d.rows[0].firm_name, status: d.rows[0].status,
        // This earlier view shows implementation packs only; every submission (fix, overhaul, automate) is in the engineering workspace.
        packs: packs.rows.filter((p) => packOf(p.content)).map((p) => ({ id: p.id, status: p.status, content: packOf(p.content) as ImplementationPack, createdAt: p.created_at,
          reviews: reviews.rows.filter((r) => r.pack_id === p.id).map((r) => ({ decision: r.decision, failures: r.result.failures, notes: r.notes, at: r.created_at })) })),
        escalations: esc.rows.map((e) => ({ id: e.id, reason: e.reason, detail: e.details_redacted, status: e.status, createdAt: e.created_at, resolvedAt: e.resolved_at })),
      };
    });
  }

  async packMarkdown(userId: string, packId: string): Promise<string> {
    return withJadaContext(this.db, userId, async (tx) => {
      const r = await tx.query('select p.content, o.name from implementation_packs p join organisations o on o.id = p.org_id where p.id = $1', [packId]);
      if (!r.rows[0]) throw new NotFoundError('Pack not found');
      const pk = packOf(r.rows[0].content);
      if (pk) return packToMarkdown(pk, r.rows[0].name);
      return briefToMarkdown({ ...submissionOf(r.rows[0].content), firmName: r.rows[0].name } as any);
    });
  }

  async review(userId: string, packId: string, input: unknown) {
    const review = ReviewSchema.parse(input);
    return withJadaContext(this.db, userId, async (tx) => {
      const r = await tx.query('select id, org_id, discovery_id, content, status from implementation_packs where id = $1 for update', [packId]);
      const pack = r.rows[0];
      if (!pack) throw new NotFoundError('Pack not found');
      const pk = packOf(pack.content);
      if (!pk) throw Object.assign(new Error('The two-week check applies to automation packs. Use the engineering workspace for this submission.'), { statusCode: 400 });
      const result = assessReview(pk, review);
      const decision = result.qualifies ? 'confirmed' : 'needs_changes';
      await tx.query('insert into pack_reviews (org_id, discovery_id, pack_id, reviewer_id, checks, result, decision, notes) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [pack.org_id, pack.discovery_id, packId, userId, { ...review.checks, unresolvedDependencies: review.unresolvedDependencies }, result, decision, review.notes]);
      // The earlier two-week review only moves submissions that haven't entered the Phase 5 workflow.
      if (['in_review', 'needs_changes', 'confirmed'].includes(pack.status)) await tx.query('update implementation_packs set status = $1, updated_at = now() where id = $2', [decision, packId]);
      await insertAudit(tx, [{ orgId: pack.org_id, discoveryId: pack.discovery_id, actor: `jada:${userId}`, action: `pack.${decision}`, entityType: 'implementation_pack', entityId: packId,
        metadata: { failures: result.failures.length } }]);
      return { decision, failures: result.failures };
    });
  }

  async resolveEscalation(userId: string, escalationId: string, note: string) {
    return withJadaContext(this.db, userId, async (tx) => {
      const r = await tx.query("update escalations set status = 'resolved', resolved_at = now(), assigned_to = $1 where id = $2 and status = 'open' returning org_id, discovery_id", [userId, escalationId]);
      if (!r.rows[0]) throw new NotFoundError('Open escalation not found');
      await insertAudit(tx, [{ orgId: r.rows[0].org_id, discoveryId: r.rows[0].discovery_id, actor: `jada:${userId}`, action: 'escalation.resolved', entityType: 'escalation', entityId: escalationId,
        metadata: { noteLength: note.length } }]);
    });
  }
}

export { TEMPLATES };
