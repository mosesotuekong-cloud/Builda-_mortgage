import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { buildApp, type AppDeps } from '../src/http/app';
import { DevCookieAuth } from '../src/http/auth';
import { FirmService } from '../src/firm/service';
import { AnalysisService } from '../src/analysis/service';
import { DecisionService } from '../src/implementation/service';
import { SEED_PLAYBOOK } from '../src/knowledge/playbook';
import type { LLMProvider, StructuredRequest, StructuredResult } from '../src/llm/provider';
import { businessCase, type CaseInput } from '../src/engine/businessCase';
import { assessPriority } from '../src/engine/priority';

// ---------------------------------------------------------------- unit: business case
const given = (value: number | null, source: CaseInput['source'] = value === null ? null : 'firm_provided'): CaseInput => ({ value, source });
const inputs = (o: Partial<Record<string, CaseInput>> = {}, demandConfirmed = false) => ({
  monthlyVolume: given(100, 'employee_reported'), minutesPerOccurrence: given(30, 'employee_reported'), reductionPct: given(0.5, 'assumption'),
  loadedHourlyCostGBP: given(null), implementationCostGBP: given(null), monthlyCashSavingGBP: given(null), staffHoursPerCase: given(null), revenuePerCaseGBP: given(null),
  ...o, demandConfirmed,
});

describe('business case: four kinds of value, nothing invented', () => {
  it('recovered time is capacity, not cash, and never produces a payback', () => {
    const bc = businessCase(inputs({ loadedHourlyCostGBP: given(30), implementationCostGBP: given(5000) }));
    expect(bc.timeRecovered).toMatchObject({ monthlyHoursSpent: 50, monthlyHoursRecovered: 25, valueAtStatedCostGBP: 750 });
    expect(bc.cashSavings.monthlyGBP).toBeNull();
    expect(bc.payback.months).toBeNull();
    expect(bc.payback.reason).toMatch(/Time saved is not money saved/);
  });
  it('payback is only calculated when implementation cost and a cash saving are both known', () => {
    expect(businessCase(inputs({ monthlyCashSavingGBP: given(400) })).payback).toMatchObject({ months: null, reason: expect.stringMatching(/isn’t known yet/) });
    expect(businessCase(inputs({ monthlyCashSavingGBP: given(400), implementationCostGBP: given(6000) })).payback.months).toBe(15);
  });
  it('revenue needs confirmed demand; capacity needs the firm’s own hours per case', () => {
    const base = { staffHoursPerCase: given(8), revenuePerCaseGBP: given(900) };
    expect(businessCase(inputs(base)).capacity.additionalCasesPerMonth).toBe(3);
    expect(businessCase(inputs(base)).revenue.monthlyPotentialGBP).toBeNull();
    expect(businessCase(inputs(base, true)).revenue.monthlyPotentialGBP).toBe(2700);
    expect(businessCase(inputs()).capacity.additionalCasesPerMonth).toBeNull();
  });
  it('lists missing inputs instead of filling them in, and keeps each source', () => {
    const bc = businessCase(inputs({ monthlyVolume: given(null) }));
    expect(bc.timeRecovered.monthlyHoursRecovered).toBeNull();
    expect(bc.missing).toEqual(expect.arrayContaining(['How often it happens (per month)', 'Cost to build it']));
    expect(bc.inputs.reductionPct.source).toBe('assumption');
    expect(bc.complete).toBe(false);
  });
});

// ---------------------------------------------------------------- unit: priority gates
const dim = (level: string) => ({ level, reasons: [] }) as any;
const dims = (existence = 'medium') => ({ existence: dim(existence), volume: dim('medium'), effort: dim('medium'), impact: dim('medium') });
const pr = (o: Partial<Parameters<typeof assessPriority>[0]> = {}) => assessPriority({ classification: 'automate', dimensions: dims(), requiresComplianceReview: false, validated: true,
  disputedEvidence: 0, missingMeasurements: [], score: 80, breakdown: null, decision: null, ...o });

describe('priority: gates come before impact', () => {
  it('a high score cannot outweigh a regulatory constraint or missing evidence', () => {
    expect(pr({ requiresComplianceReview: true, score: 99 })).toMatchObject({ rankable: false, band: null, status: 'compliance_review' });
    expect(pr({ dimensions: dims('insufficient'), score: 99 })).toMatchObject({ rankable: false, status: 'needs_evidence' });
    expect(pr({ classification: 'keep_human', score: 99 })).toMatchObject({ rankable: false, status: 'keep_human' });
  });
  it('a single account is ranked but cannot go to engineering', () => {
    const p = pr({ dimensions: dims('low') });
    expect(p.rankable).toBe(true);
    expect(p.gates.find((g) => g.code === 'single_account')).toMatchObject({ blocksPriority: false, blocksEngineering: true });
  });
  it('bands describe the score and decisions set the status', () => {
    expect(pr({ score: 70 }).band).toBe('High');
    expect(pr({ score: 50 }).band).toBe('Medium');
    expect(pr({ score: 30 }).band).toBe('Low');
    expect(pr({ decision: 'approved' }).status).toBe('approved');
    expect(pr({ decision: 'rejected' }).rankable).toBe(false);
    expect(pr({ validated: false }).status).toBe('ready_for_review');   // no separate validation step: approving is the confirmation
    expect(pr({ classification: null })).toMatchObject({ status: 'needs_classification', rankable: false });
    expect(pr({ classification: null, dimensions: dims('insufficient') }).status).toBe('needs_evidence');
  });
});

// ---------------------------------------------------------------- integration: ten synthetic scenarios
const APP = process.env.TEST_DATABASE_URL, ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const SECRET = 'opportunities-secret-opportunities-1234';

// Deterministic stand-in for the AI: picks the classification from a marker in the quotes it is shown,
// and cites one of those quotes exactly (so the pipeline's quote check passes).
const CLASSIFY: [RegExp, string][] = [[/chase|chasing/i, 'automate'], [/duplicate/i, 'fix'], [/handover/i, 'overhaul'], [/suitability/i, 'keep_human'], [/re-?key/i, 'automate'], [/portal/i, 'fix']];
class MarkerProvider implements LLMProvider {
  readonly name = 'marker';
  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const usage = { inputTokens: 0, outputTokens: 0, model: 'marker' };
    if (req.task === 'analysis.merge_keys') return { data: req.schema.parse({ merges: [] }), usage };
    if (req.task !== 'analysis.classify') throw new Error(`no response for ${req.task}`);
    const text = String(req.messages[0]!.content);
    const quote = /"([^"]+)"/.exec(text)?.[1] ?? '';
    const c = CLASSIFY.find(([re]) => re.test(text))?.[1] ?? 'fix';
    return { data: req.schema.parse({ classification: c, rationale: `Synthetic test classification: ${c} based on the accounts given.`, supportingQuotes: [quote], humanElements: [] }), usage };
  }
}

describe.skipIf(!APP || !ADMIN)('opportunity intelligence (Phase 4)', () => {
  const db = new pg.Pool({ connectionString: APP });
  const admin = new pg.Pool({ connectionString: ADMIN });
  const firms = new FirmService(db, null, { appBaseUrl: 'http://test', invitationDays: 30, playbookVersion: SEED_PLAYBOOK.version });
  const analysis = new AnalysisService(db, { providerFor: () => new MarkerProvider(), playbook: SEED_PLAYBOOK, mailer: null, appBaseUrl: 'http://test' });
  const decisions = new DecisionService(db, { analysis, firms, playbook: SEED_PLAYBOOK });
  const auth = new DevCookieAuth(SECRET);
  const a = { orgId: randomUUID(), userId: randomUUID() }, b = { orgId: randomUUID(), userId: randomUUID() };
  let app: ReturnType<typeof buildApp>;
  let id = '';
  const as = (who: typeof a) => ({ cookie: `bp_dev=${auth.cookieFor(who)}` });
  const get = async (who = a) => app.inject({ method: 'GET', url: `/api/firm/discoveries/${id}/opportunities`, headers: as(who) });
  const intel = async () => (await get()).json();
  const opp = async (key: string) => { const i = await intel(); const f = (await analysis.discoveryWorkspace(a, id)).findings.find((x) => x.key === key)!; return i.opportunities.find((o: any) => o.id === f.id); };
  const post = (path: string, payload: unknown, who = a) => app.inject({ method: 'POST', url: `/api/firm/discoveries/${id}${path}`, headers: as(who), payload: payload as any });
  const correct = (pp: string, field: string, value: unknown, reason = 'Firm figure for the test') => post(`/pain-points/${pp}/corrections`, { field, value, reason });

  beforeAll(async () => {
    await firms.createFirm({ ...a, leadUserId: a.userId, name: 'Opportunity Test A' });
    await firms.createFirm({ ...b, leadUserId: b.userId, name: 'Opportunity Test B' });
    id = await firms.createDiscovery(a);
    const ev = (p: string, key: string, stage: string, role: string, vol: number | null, mins: number | null, quote: string, extra: { cause?: string; systems?: string[] } = {}) => admin.query(
      `insert into evidence_records (id, org_id, discovery_id, participant_pseudonym, source, pain_point_key, stage_id, task_description, responsible_role, monthly_volume, minutes_per_occurrence, supporting_quote, reported_cause, systems)
       values ($1,$2,$3,$4,'firm_said',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [randomUUID(), a.orgId, id, p, key, stage, `Task: ${quote}`, role, vol, mins, quote, extra.cause ?? null, extra.systems ?? []]);
    // 1 + 6 + 7: document chasing at documents, three consistent accounts (automate; conventional template).
    for (const p of ['P2', 'P3', 'P4']) await ev(p, 'document_chasing', 'documents', 'adviser', 100, 20, `I chase payslips and bank statements by email ${p}`, { systems: ['Outlook'] });
    // 2: a CRM configuration problem at enquiry: two accounts, no figures (fix; missing measurements).
    await ev('P2', 'crm_duplicate_records', 'enquiry', 'adviser', null, null, 'the CRM creates a duplicate record for every web enquiry', { cause: 'Web form and CRM matching rule', systems: ['Acre'] });
    await ev('P5', 'crm_duplicate_records', 'enquiry', 'administrator', null, null, 'I merge duplicate records every morning', { systems: ['Acre'] });
    // 3: broken handover at full application: two accounts that disagree on the time (overhaul).
    await ev('P3', 'application_handover', 'full_application', 'adviser', 40, 10, 'the handover to the case team loses information');
    await ev('P6', 'application_handover', 'full_application', 'case_manager', 40, 60, 'every handover means I re-ask the client questions');
    // 4: suitability work at recommendation (keep human).
    await ev('P2', 'suitability_letter_drafting', 'recommendation', 'adviser', 60, 45, 'the suitability letter needs my judgement on every case');
    await ev('P3', 'suitability_letter_drafting', 'recommendation', 'adviser', 60, 45, 'I write each suitability letter myself, it is my advice');
    // 8: automation proposed at a regulated stage (fact find): held for compliance review.
    await ev('P2', 'fact_find_rekeying', 'fact_find', 'adviser', 80, 15, 'I re-key the fact find from my notes into the CRM');
    await ev('P4', 'fact_find_rekeying', 'fact_find', 'adviser', 80, 15, 'I rekey every fact find after the meeting');
    // 9: one account only (fix): ranked, but can’t go to engineering until corroborated.
    await ev('P6', 'lender_portal_logins', 'dip', 'case_manager', 30, 5, 'the lender portal logs me out constantly');
    // 5: nothing about case status updates: it must stay an industry hypothesis.
    const noAuth = { authenticate: async () => null, authenticateJada: async () => null };
    app = buildApp({ laterStages: true, db, firms, analysis, decisions, interviews: {} as any, participants: {} as any, jada: {} as any,
      firmAuth: auth, jadaAuth: noAuth, sessionSecret: SECRET, consent: { retentionMonths: 12, jadaContact: 'test' }, secureCookies: false,
      publicDir: join(__dirname, '..', 'public') } as AppDeps);
    expect((await post('/analyse', {})).statusCode).toBe(200);
  });
  afterAll(async () => { await app?.close(); await db.end(); await admin.end(); });

  it('1. a well-supported repetitive task is classified automate with a conventional approach, evidence and next action', async () => {
    const o = await opp('document_chasing');
    expect(o).toMatchObject({ classification: 'automate', automationType: 'conventional', classificationSource: 'ai_proposed', stageId: 'documents', regulated: false });
    expect(o.evidence.total).toBe(3);
    expect(o.evidence.bySource).toEqual({ employee_reported: 3 });
    expect(o.priorityRank).toBe(1);
    expect(o.band).not.toBeNull();
    expect(o.status).toBe('ready_for_review');
    expect(o.recommendedAction.title).toMatch(/what to build/i);
    expect(o.assessment.risks.some((r: string) => /^Control:/.test(r))).toBe(true);
    expect(o.assessment.dependencies.some((d: string) => /Outlook/.test(d))).toBe(true);
  });

  it('2. a configuration problem is a fix, and missing figures are listed, never filled in', async () => {
    const o = await opp('crm_duplicate_records');
    expect(o.classification).toBe('fix');
    expect(o.gates.map((g: any) => g.code)).toContain('missing_measurements');
    expect(o.businessCase.timeRecovered.monthlyHoursRecovered).toBeNull();
    expect(o.assessment.missing).toEqual(expect.arrayContaining(['How often it happens each month', 'How long each occurrence takes']));
    expect(o.recommendedAction.steps[0]).toMatch(/Acre/);
    expect(o.problem.causes).toContain('Web form and CRM matching rule');
  });

  it('3. a broken handover is an overhaul, and conflicting accounts stay side by side', async () => {
    const o = await opp('application_handover');
    expect(o.classification).toBe('overhaul');
    expect(o.evidence.disagreements).toHaveLength(1);
    expect(o.evidence.dimensions.effort.level).toBe('low');
    expect(o.recommendedAction.title).toBe('Redesign the process');
    expect(o.assessment.feasibility).toMatch(/redesign/);
  });

  it('4. regulated judgement is kept human and never ranked', async () => {
    const o = await opp('suitability_letter_drafting');
    expect(o).toMatchObject({ classification: 'keep_human', status: 'keep_human', priorityRank: null, band: null });
    const i = await intel();
    expect(i.summary.byClassification.keep_human).toBe(1);
    expect((await post(`/opportunities/${o.id}/decision`, { decision: 'approved' })).statusCode).toBe(409);
  });

  it('5. a problem nobody raised stays an industry hypothesis: shown separately, not ranked', async () => {
    const i = await intel();
    expect(i.hypotheses.map((h: any) => h.key)).toContain('case_status_updates');
    expect(i.opportunities.some((o: any) => o.title === i.hypotheses.find((h: any) => h.key === 'case_status_updates').title)).toBe(false);
    for (const h of i.hypotheses) expect(h).not.toHaveProperty('priorityRank');
  });

  it('6. without an implementation cost there is no payback, and the gap is named', async () => {
    const o = await opp('document_chasing');
    expect(o.businessCase.timeRecovered.monthlyHoursSpent).toBeCloseTo(33.3, 1);
    expect(o.businessCase.payback.months).toBeNull();
    expect(o.businessCase.payback.reason).toMatch(/cost to build it isn’t known yet/);
    expect(o.businessCase.missing).toContain('Cost to build it');
    expect(o.businessCase.inputs.reductionPct.source).toBe('assumption');
    expect(o.businessCase.inputs.monthlyVolume).toMatchObject({ source: 'employee_reported', note: 'middle of 3 accounts' });
  });

  it('7. a complete business case keeps time, cash, capacity and revenue separate, with sources', async () => {
    const before = await opp('document_chasing');
    const pp = before.id;
    expect((await correct(pp, 'monthlyCashSavingGBP', 400, 'short')).statusCode).toBe(400);   // a cash saving needs a real basis
    for (const [f, v, r] of [['implementationCostGBP', 6000, 'JADA estimate'], ['monthlyCashSavingGBP', 400, 'Temporary admin hours we will stop paying for'],
      ['staffHoursPerCase', 8, 'Our case timings'], ['revenuePerCaseGBP', 900, 'Average proc fee and broker fee'], ['demandConfirmed', true, 'We turn away referrals']] as const) {
      expect((await correct(pp, f, v, r)).statusCode).toBe(200);
    }
    const bc = (await opp('document_chasing')).businessCase;
    expect(bc.cashSavings).toMatchObject({ monthlyGBP: 400, basis: 'Temporary admin hours we will stop paying for' });
    expect(bc.payback.months).toBe(15);
    expect(bc.capacity.additionalCasesPerMonth).not.toBeNull();
    expect(bc.revenue.monthlyPotentialGBP).toBe(Math.round(bc.capacity.additionalCasesPerMonth * 900));
    expect(bc.inputs.implementationCostGBP.source).toBe('firm_provided');
    expect(bc.complete).toBe(true);
    // Firm-supplied business-case figures don't change confidence that the problem exists.
    expect((await opp('document_chasing')).evidence.dimensions).toEqual(before.evidence.dimensions);
  });

  it('8. automation at a regulated stage is held for compliance review, whatever its impact', async () => {
    const o = await opp('fact_find_rekeying');
    expect(o.classification).toBe('automate');
    expect(o).toMatchObject({ status: 'compliance_review', priorityRank: null, band: null, regulated: true });
    expect(o.recommendedAction.title).toBe('Compliance review first');
    expect(o.engineering.eligible).toBe(false);
    await correct(o.id, 'validated', true, 'Confirmed');
    const r = await post(`/opportunities/${o.id}/decision`, { decision: 'approved' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/compliance review/);
  });

  it('9. one account is ranked but cannot go to engineering review until corroborated', async () => {
    const o = await opp('lender_portal_logins');
    expect(o.evidence.dimensions.existence.level).toBe('low');
    expect(o.priorityRank).not.toBeNull();
    expect(o.assessment.missing).toContain('A second account from someone else involved');
    await correct(o.id, 'validated', true, 'Confirmed');
    expect((await post(`/opportunities/${o.id}/decision`, { decision: 'approved' })).statusCode).toBe(200);
    const after = await opp('lender_portal_logins');
    expect(after.engineering.eligible).toBe(false);
    expect(after.engineering.blockers.join(' ')).toMatch(/one person/);
    expect((await post(`/opportunities/${o.id}/engineering-review`, {})).statusCode).toBe(409);
  });

  it('10. review decisions are audited; approval leads to an engineering hand-over with the full brief', async () => {
    const o = await opp('document_chasing');
    // Approval needs no separate validation (approving IS the confirmation), but the parked engineering
    // hand-over still refuses an unconfirmed finding.
    expect((await post(`/opportunities/${o.id}/engineering-review`, {})).statusCode).toBe(409);
    await correct(o.id, 'validated', true, 'Confirmed');
    expect((await post(`/opportunities/${o.id}/decision`, { decision: 'rejected' })).statusCode).toBe(400);    // needs a reason
    expect((await post(`/opportunities/${o.id}/decision`, { decision: 'challenged', reason: 'Check the volume with the admin team' })).statusCode).toBe(200);
    expect((await opp('document_chasing')).status).toBe('challenged');
    const approvedCount = async () => (await app.inject({ method: 'GET', url: '/api/firm/workspace', headers: as(a) })).json().discoveries.find((d: any) => d.id === id).approved;
    const before = await approvedCount();                                          // a challenge isn't an approval
    expect((await post(`/opportunities/${o.id}/decision`, { decision: 'approved', reason: 'Volume checked' })).statusCode).toBe(200);
    expect(await approvedCount()).toBe(before + 1);                                // the workspace's "Discovery complete" step counts it
    expect((await opp('document_chasing')).engineering.eligible).toBe(true);
    const h = await post(`/opportunities/${o.id}/engineering-review`, { note: 'Start with remortgages' });
    expect(h.statusCode).toBe(200);
    const { brief, packId } = h.json();
    expect(packId).toBeTruthy();                                                   // automate with a template: a pack too
    for (const k of ['problemStatement', 'evidenceSummary', 'classification', 'recommendedOutcome', 'expectedImpact', 'dependencies', 'risksAndControls', 'outstandingQuestions', 'successMeasures']) expect(brief).toHaveProperty(k);
    expect(brief.status).toMatch(/Awaiting JADA engineering review/);
    expect(brief.expectedImpact.paybackMonths).toBe(15);
    const after = await opp('document_chasing');
    expect(after.status).toBe('sent_to_engineering');
    expect((await post(`/opportunities/${o.id}/engineering-review`, {})).statusCode).toBe(409);               // not twice
    const md = await app.inject({ method: 'GET', url: `/api/firm/discoveries/${id}/opportunities/${o.id}/brief.md`, headers: as(a) });
    expect(md.headers['content-type']).toMatch(/text\/markdown/);
    expect(md.body).toContain('## Risks and controls');
    const audit = (await admin.query(`select action from audit_log where discovery_id = $1 and entity_id = $2 and action like 'opportunity.%' order by created_at`, [id, o.id])).rows.map((r) => r.action);
    expect(audit).toEqual(['opportunity.challenged', 'opportunity.approved', 'opportunity.sent_to_engineering']);
    const hist = (await intel()).history[o.id];
    expect(hist.filter((x: any) => x.field === 'opportunity_decision')).toHaveLength(3);
  });

  it('keeps every firm’s opportunities private', async () => {
    expect([403, 404]).toContain((await get(b)).statusCode);
    const o = await opp('crm_duplicate_records');
    expect([403, 404]).toContain((await post(`/opportunities/${o.id}/decision`, { decision: 'rejected', reason: 'not ours' }, b)).statusCode);
    expect([403, 404]).toContain((await app.inject({ method: 'GET', url: `/api/firm/discoveries/${id}/opportunities/${o.id}/brief.md`, headers: as(b) })).statusCode);
    expect((await opp('crm_duplicate_records')).decision.latest).toBeNull();
  });
});
