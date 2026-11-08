import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp, type AppDeps } from '../src/http/app';
import { DevCookieAuth } from '../src/http/auth';
import { FirmService } from '../src/firm/service';
import { AnalysisService } from '../src/analysis/service';
import { DecisionService, JadaService } from '../src/implementation/service';
import { evaluateOutcome } from '../src/implementation/engineering';
import { SEED_PLAYBOOK } from '../src/knowledge/playbook';
import { matchTemplates, readiness, SOLUTION_TEMPLATES, OUTLOOK_SPIKE_GATE } from '../src/knowledge/solutionTemplates';
import { scoreOpportunity } from '../src/engine/scoring';
import type { LLMProvider, StructuredRequest, StructuredResult } from '../src/llm/provider';

// ---------------------------------------------------------------- unit: scoring review (issue C)
describe('scoring review: why a single-account fix outranked a two-account overhaul', () => {
  const base = { stageId: 'dip' as const, impact: { monthlyHoursSpent: null, monthlyHoursRecovered: null, monthlyCapacityValueGBP: null, paybackMonths: null, unknowns: [] } as any, complexity: null, templateAvailable: false };
  it('the whole gap is the feasibility proxy for classification; evidence scored the same', () => {
    const fix = scoreOpportunity({ ...base, id: 'a', title: 'Portal', classification: 'fix', monthlyVolume: 30, confidence: 'low' });
    const overhaul = scoreOpportunity({ ...base, id: 'b', title: 'Handover', stageId: 'full_application', classification: 'overhaul', monthlyVolume: 40, confidence: 'low' });
    expect([fix.total, overhaul.total]).toEqual([48, 40]);
    const differing = (Object.keys(fix.dimensions) as (keyof typeof fix.dimensions)[]).filter((d) => fix.dimensions[d].score !== overhaul.dimensions[d].score);
    expect(differing).toEqual(['feasibility']);
    // Using existence confidence (medium) for the overhaul would add 3 points: still below the fix.
    expect(scoreOpportunity({ ...base, id: 'b', title: 'Handover', classification: 'overhaul', monthlyVolume: 40, confidence: 'medium' }).total).toBe(43);
  });
});

// ---------------------------------------------------------------- unit: templates and outcomes
describe('solution templates and outcome evaluation', () => {
  it('no untested or ungated template is presented as production-ready', () => {
    for (const t of SOLUTION_TEMPLATES) expect(readiness(t).productionReady).toBe(false);
    expect(readiness(SOLUTION_TEMPLATES.find((t) => t.id === 'outlook_follow_up_drafts_r2_1')!).reasons.join(' ')).toMatch(/spike/i);
    expect(OUTLOOK_SPIKE_GATE.status).not.toBe('passed');
  });
  it('matches only where both the problem and the classification fit', () => {
    expect(matchTemplates({ key: 'document_chasing', classification: 'automate', systems: [] }).matches.map((m) => m.template.id))
      .toEqual(['outlook_follow_up_drafts_r2_1', 'document_chasing_v1']);   // reviewed design first; neither production-ready
    expect(matchTemplates({ key: 'document_chasing', classification: 'fix', systems: [] })).toMatchObject({ matches: [], custom: true });
    expect(matchTemplates({ key: 'crm_duplicate_records', classification: 'fix', systems: [] }).reason).toMatch(/custom engineering review/);
    expect(matchTemplates({ key: 'x', classification: 'keep_human', systems: [] })).toMatchObject({ matches: [], custom: false });
  });
  it('success is judged against agreed measures, never by the implementation running', () => {
    const m = [{ name: 'Hours', valueType: 'time', unit: 'h', baseline: 33, baselineSource: 'x', target: 20, direction: 'decrease', measurementSource: 'pulse', period: '4 weeks' }] as any;
    expect(evaluateOutcome(m, null).overall).toBe('not_yet_measured');
    expect(evaluateOutcome(m, [{ measure: 'Hours', value: 18, measuredAt: '2026-12-01', source: 'pulse', note: '' }]).overall).toBe('met');
    expect(evaluateOutcome(m, [{ measure: 'Hours', value: 30, measuredAt: '2026-12-01', source: 'pulse', note: '' }]).overall).toBe('not_met');
    expect(evaluateOutcome([{ ...m[0], target: null }], [{ measure: 'Hours', value: 18, measuredAt: '2026-12-01', source: 'pulse', note: '' }]).overall).toBe('no_agreed_targets');
  });
  it('builda+ contains no Microsoft Graph client: the Outlook integration cannot be reached from here', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
    walk(join(__dirname, '..', 'src'));
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/graph\.microsoft\.com|login\.microsoftonline\.com/);
    }
    const pkg = readFileSync(join(__dirname, '..', 'package.json'), 'utf8');
    expect(pkg).not.toMatch(/@microsoft\/microsoft-graph-client|@azure\/msal/);
  });
});

// ---------------------------------------------------------------- integration: the engineering workflow
const APP = process.env.TEST_DATABASE_URL, ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const SECRET = 'engineering-secret-engineering-12345';
const CLASSIFY: [RegExp, string][] = [[/chase|chasing/i, 'automate'], [/duplicate/i, 'fix'], [/handover/i, 'overhaul'], [/suitability/i, 'keep_human'], [/re-?key/i, 'automate']];
class MarkerProvider implements LLMProvider {
  readonly name = 'marker';
  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const usage = { inputTokens: 0, outputTokens: 0, model: 'marker' };
    if (req.task === 'analysis.merge_keys') return { data: req.schema.parse({ merges: [] }), usage };
    if (req.task !== 'analysis.classify') throw new Error(`no response for ${req.task}`);
    const text = String(req.messages[0]!.content);
    const c = CLASSIFY.find(([re]) => re.test(text))?.[1] ?? 'fix';
    return { data: req.schema.parse({ classification: c, rationale: `Synthetic test classification: ${c}.`, supportingQuotes: [/"([^"]+)"/.exec(text)?.[1] ?? ''], humanElements: [] }), usage };
  }
}

describe.skipIf(!APP || !ADMIN)('engineering workflow (Phase 5)', () => {
  const db = new pg.Pool({ connectionString: APP });
  const admin = new pg.Pool({ connectionString: ADMIN });
  const firms = new FirmService(db, null, { appBaseUrl: 'http://test', invitationDays: 30, playbookVersion: SEED_PLAYBOOK.version });
  const analysis = new AnalysisService(db, { providerFor: () => new MarkerProvider(), playbook: SEED_PLAYBOOK, mailer: null, appBaseUrl: 'http://test' });
  const decisions = new DecisionService(db, { analysis, firms, playbook: SEED_PLAYBOOK });
  const auth = new DevCookieAuth(SECRET);
  const a = { orgId: randomUUID(), userId: randomUUID() }, b = { orgId: randomUUID(), userId: randomUUID() };
  const engineer = randomUUID(), outsider = randomUUID(), editor = randomUUID();
  let app: ReturnType<typeof buildApp>;
  let id = '';
  const firm = (who = a) => ({ cookie: `bp_dev=${auth.cookieFor(who)}` });
  const jada = (u = engineer) => ({ cookie: `bp_jada=${auth.jadaCookieFor(u)}` });
  const post = (url: string, payload: unknown, headers = firm()) => app.inject({ method: 'POST', url, headers, payload: payload as any });
  const get = (url: string, headers = firm()) => app.inject({ method: 'GET', url, headers });
  const opps = async () => (await get(`/api/firm/discoveries/${id}/opportunities`)).json().opportunities as any[];
  const oppId = async (key: string) => (await analysis.discoveryWorkspace(a, id)).findings.find((f) => f.key === key)!.id;
  const validate = (pp: string) => post(`/api/firm/discoveries/${id}/pain-points/${pp}/corrections`, { field: 'validated', value: true, reason: 'Confirmed' });
  const decide = (pp: string, decision: string, reason = '') => post(`/api/firm/discoveries/${id}/opportunities/${pp}/decision`, { decision, reason });
  const submit = (pp: string) => post(`/api/firm/discoveries/${id}/opportunities/${pp}/engineering-review`, { note: 'Synthetic test' });
  const act = (pack: string, action: string, payload: unknown = {}, u = engineer) => post(`/api/jada/engineering/${pack}/${action}`, payload, jada(u));
  const detail = async (pack: string) => (await get(`/api/jada/engineering/${pack}`, jada())).json();
  const packs: Record<string, string> = {};
  const design = (over: Record<string, unknown> = {}) => ({
    templateId: null, approach: 'process_or_configuration_fix', rationale: 'Correct the CRM matching rule with the administrator.',
    systems: ['Acre'], dependencies: [], humanApprovalPoints: [],
    requirements: { functional: ['One record per enquiry'], nonFunctional: [], data: [], integration: [], access: ['CRM admin access'], security: [], errorHandling: [], logging: [], acceptance: ['No duplicates created for a week of web enquiries'] },
    risks: { operational: [], security: [], regulatory: [], privacy: [], technical: [] }, outstandingDecisions: [], ...over });
  const measures = [{ name: 'Staff hours a month on this work', valueType: 'time', unit: 'hours / month', baseline: 33.3, baselineSource: 'Discovery estimate', target: 20, direction: 'decrease', measurementSource: 'Weekly pulse', period: '4 weeks after go-live' }];
  const plan = (over: Record<string, unknown> = {}) => ({ scope: 'One workflow: chasing outstanding documents for new purchase cases.', deliverables: ['Configured reminder workflow'],
    dependencies: [], unresolvedDependencies: [], requiredAccess: ['Case system export'], accessConfirmed: true, testingPlan: ['Run the template test cases on dummy data'],
    acceptanceCriteria: ['All test cases pass'], responsibleParties: [{ party: 'JADA engineer', responsibility: 'Build and test' }], duration: null, successMeasures: measures, ...over });

  beforeAll(async () => {
    await firms.createFirm({ ...a, leadUserId: a.userId, name: 'Engineering Test A' });
    await firms.createFirm({ ...b, leadUserId: b.userId, name: 'Engineering Test B' });
    id = await firms.createDiscovery(a);
    const ev = (p: string, key: string, stage: string, role: string, vol: number | null, mins: number | null, quote: string, source = 'firm_said') => admin.query(
      `insert into evidence_records (id, org_id, discovery_id, participant_pseudonym, source, pain_point_key, stage_id, task_description, responsible_role, monthly_volume, minutes_per_occurrence, supporting_quote, systems)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [randomUUID(), a.orgId, id, p, source, key, stage, `Task: ${quote}`, role, vol, mins, quote, key === 'crm_duplicate_records' ? ['Acre'] : []]);
    for (const p of ['P2', 'P3', 'P4']) await ev(p, 'document_chasing', 'documents', 'adviser', 100, 20, `I chase payslips by email ${p}`);
    await ev('P2', 'crm_duplicate_records', 'enquiry', 'adviser', 60, 5, 'the CRM creates a duplicate record for each enquiry');
    await ev('P5', 'crm_duplicate_records', 'enquiry', 'administrator', 60, 5, 'I merge duplicate records every morning');
    await ev('P3', 'application_handover', 'full_application', 'adviser', 40, 30, 'the handover to the case team loses information');
    await ev('P6', 'application_handover', 'full_application', 'case_manager', 40, 30, 'every handover means re-asking the client');
    await ev('P2', 'suitability_letter_drafting', 'recommendation', 'adviser', 60, 45, 'the suitability letter needs my judgement');
    await ev('P3', 'suitability_letter_drafting', 'recommendation', 'adviser', 60, 45, 'each suitability letter is my advice');
    await ev('P2', 'fact_find_rekeying', 'fact_find', 'adviser', 80, 15, 'I re-key the fact find into the CRM');
    await ev('P4', 'fact_find_rekeying', 'fact_find', 'adviser', 80, 15, 'I rekey every fact find');
    await ev('m', 'lender_portal_logins', 'dip', 'case_manager', 30, 5, 'portal log extract', 'measured_baseline');   // a record only: no account that it happens here
    await admin.query('insert into jada_assignments (discovery_id, staff_user_id) values ($1, $2)', [id, engineer]);
    for (const u of [engineer, outsider]) await admin.query("insert into jada_staff_roles (user_id, role) values ($1, 'engineer')", [u]);
    await admin.query("insert into jada_staff_roles (user_id, role) values ($1, 'knowledge_editor')", [editor]);
    const noAuth = auth;
    app = buildApp({ db, firms, analysis, decisions, interviews: {} as any, participants: {} as any, jada: new JadaService(db),
      firmAuth: auth, jadaAuth: noAuth, sessionSecret: SECRET, consent: { retentionMonths: 12, jadaContact: 'test' }, secureCookies: false,
      publicDir: join(__dirname, '..', 'public') } as AppDeps);
    expect((await post(`/api/firm/discoveries/${id}/analyse`, {})).statusCode).toBe(200);
  });
  afterAll(async () => { await app?.close(); await db.end(); await admin.end(); });

  it('12. bulk approval cannot bypass the gates: same rules as one decision, all-or-nothing', async () => {
    const docs = await oppId('document_chasing'), regulated = await oppId('fact_find_rekeying');
    let r = await post(`/api/firm/discoveries/${id}/approve`, { priorities: [docs], proceedWith: null });
    expect(r.statusCode).toBe(409);                                         // not validated
    await validate(docs); await validate(regulated);
    r = await post(`/api/firm/discoveries/${id}/approve`, { priorities: [docs, regulated], proceedWith: null });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/Nothing was approved.*compliance review/);
    expect((await opps()).find((o) => o.id === docs).decision.latest).toBeNull();      // all-or-nothing
    r = await post(`/api/firm/discoveries/${id}/approve`, { priorities: [docs], proceedWith: null, note: 'Agreed at the partners meeting' });
    expect(r.statusCode).toBe(200);
    const o = (await opps()).find((x) => x.id === docs);
    expect(o.decision).toMatchObject({ latest: 'approved', reason: 'Agreed at the partners meeting' });   // recorded like a single decision
    const audit = (await admin.query("select action from audit_log where entity_id = $1 and action = 'opportunity.approved'", [docs])).rows;
    expect(audit).toHaveLength(1);
  });

  it('1–3. approved automate, fix and overhaul opportunities all enter the engineering queue', async () => {
    for (const key of ['document_chasing', 'crm_duplicate_records', 'application_handover']) {
      const pp = await oppId(key);
      await validate(pp);
      if (key !== 'document_chasing') expect((await decide(pp, 'approved')).statusCode).toBe(200);
      const r = await submit(pp);
      expect(r.statusCode).toBe(200);
      packs[key] = r.json().packId;
    }
    const q = (await get('/api/jada/engineering', jada())).json();
    const byKey = Object.fromEntries(Object.entries(packs).map(([k, pid]) => [k, q.submissions.find((s: any) => s.id === pid)]));
    expect(byKey.document_chasing).toMatchObject({ classification: 'automate', status: 'in_review', group: 'awaiting_review', firmName: 'Engineering Test A', stageId: 'documents' });
    expect(byKey.crm_duplicate_records).toMatchObject({ classification: 'fix', group: 'awaiting_review' });
    expect(byKey.application_handover).toMatchObject({ classification: 'overhaul', group: 'awaiting_review' });
    expect(q.groups.map((g: any) => g.label)).toEqual(['Awaiting engineering review', 'Under assessment', 'Awaiting information', 'Approved for implementation', 'In progress', 'Completed', 'Rejected or deferred']);
    const d = await detail(packs.application_handover!);
    expect(d.submission).toMatchObject({ classification: 'overhaul', problemStatement: expect.stringContaining('full application') });
    expect(d.submission.firmValidated.finding).toBe(true);
    expect(d.approaches.map((x: any) => x.id)).toEqual(['process_redesign']);
    expect(d.templates.custom).toBe(true);
    expect(d.pack).toBeNull();                                              // brief only: no automation pack for an overhaul
    expect((await detail(packs.document_chasing!)).pack.testCases.length).toBeGreaterThan(0);
    for (const secret of ['"P2"', '"P3"', 'Engineering Test B']) expect(JSON.stringify(d)).not.toContain(secret);
  });

  it('4–6. keep human, insufficient evidence and regulated-stage items cannot be submitted', async () => {
    const keep = await oppId('suitability_letter_drafting');
    await validate(keep);
    expect((await decide(keep, 'approved')).statusCode).toBe(409);
    expect((await submit(keep)).statusCode).toBe(409);
    const thin = await oppId('lender_portal_logins');
    await validate(thin);
    expect((await decide(thin, 'approved')).statusCode).toBe(409);
    expect((await submit(thin)).json().error).toMatch(/Approve this opportunity|firm-specific evidence/);
    const regulated = await oppId('fact_find_rekeying');
    const r = await decide(regulated, 'approved');
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/compliance review/);
    expect((await submit(regulated)).statusCode).toBe(409);
    const ids = (await get('/api/jada/engineering', jada())).json().submissions.map((s: any) => s.title);
    expect(ids).toHaveLength(3);
  });

  it('7. engineering can request information and the firm answers it', async () => {
    const pk = packs.crm_duplicate_records!;
    expect((await act(pk, 'request_information', { questions: ['Which web form feeds the CRM?'] })).statusCode).toBe(409);   // assess first
    expect((await act(pk, 'start_assessment')).statusCode).toBe(200);
    expect((await act(pk, 'request_information', { questions: ['Which web form feeds the CRM?'] })).json().group.key).toBe('awaiting_information');
    expect((await act(pk, 'record_design', design())).statusCode).toBe(409);        // waiting on the firm
    const firmView = (await get(`/api/firm/discoveries/${id}/engineering`)).json().submissions.find((s: any) => s.id === pk);
    expect(firmView.informationRequests[0]).toMatchObject({ questions: ['Which web form feeds the CRM?'], answer: null });
    expect(firmView.pack).toBeNull();
    const ans = await post(`/api/firm/discoveries/${id}/engineering/${pk}/information`, { answer: 'The website contact form, through Zapier.' });
    expect(ans.statusCode).toBe(200);
    expect(ans.json()).toMatchObject({ status: 'under_assessment', informationRequests: [{ answer: 'The website contact form, through Zapier.' }] });
  });

  it('10. template rules: approach must fit the classification, AI needs a reason, templates must fit', async () => {
    const fix = packs.crm_duplicate_records!, auto = packs.document_chasing!;
    expect((await act(fix, 'record_design', design({ approach: 'conventional_automation' }))).json().error).toMatch(/can’t use/);
    expect((await act(fix, 'record_design', design({ templateId: 'document_chasing_v1' }))).json().error).toMatch(/doesn’t fit/);
    await act(auto, 'start_assessment');
    const aiNoReason = design({ approach: 'ai_assisted', humanApprovalPoints: ['Staff approve each reminder'] });
    expect((await act(auto, 'record_design', aiNoReason)).json().error).toMatch(/conventional automation isn’t sufficient/);
    expect((await act(auto, 'record_design', design({ approach: 'conventional_automation' }))).json().error).toMatch(/human approval point/);
    const d = await detail(auto);
    expect(d.templates.matches.map((m: any) => m.template.id)).toEqual(['outlook_follow_up_drafts_r2_1', 'document_chasing_v1']);
    expect(d.suggestions.design.templateId).toBe('outlook_follow_up_drafts_r2_1');
  });

  it('8 + 11. design, approval for implementation, and untested templates never shown as ready', async () => {
    const fix = packs.crm_duplicate_records!;
    expect((await act(fix, 'approve_for_implementation')).json().error).toMatch(/Record the solution design/);
    expect((await act(fix, 'record_design', design({ outstandingDecisions: ['Who owns the CRM settings?'] }))).statusCode).toBe(200);
    expect((await act(fix, 'approve_for_implementation')).json().error).toMatch(/outstanding decisions/);
    expect((await act(fix, 'record_design', design())).statusCode).toBe(200);
    const ok = await act(fix, 'approve_for_implementation', { note: 'Small configuration change' });
    expect(ok.json()).toMatchObject({ status: 'approved_for_implementation', group: { key: 'approved' } });

    const auto = packs.document_chasing!;
    const dc = design({ templateId: 'document_chasing_v1', approach: 'conventional_automation', humanApprovalPoints: ['Staff approve each reminder'] });
    expect((await act(auto, 'record_design', dc)).statusCode).toBe(200);
    const check = await act(auto, 'two_week_check', { checks: { singleWorkflowWithStartAndFinish: true, changesCoreSystems: false, accessAndTestDataReadyDayOne: true, humanApprovalForCommsAndRecordChanges: true, complianceQuestionsResolved: true }, unresolvedDependencies: [] });
    expect(check.json().lastCheck).toMatchObject({ qualifies: false, failures: ['Template document_chasing_v1 is not yet tested'] });
    const d = (await act(auto, 'approve_for_implementation')).json();
    expect(d.design.template.readiness).toMatchObject({ productionReady: false, label: 'Draft reference design, not production-ready' });
    const planned = (await act(auto, 'record_plan', plan({ duration: { text: 'Two weeks', validated: true, basis: '' } })));
    expect(planned.statusCode).toBe(400);                                     // a "validated" estimate needs its basis
    const p = (await act(auto, 'record_plan', plan())).json();
    expect(p.twoWeekOffer.offered).toBe(false);
    expect(p.twoWeekOffer.reasons.join(' ')).toMatch(/not yet proven/i);
  });

  it('15. the implementation carries its agreed success measures through to the outcome', async () => {
    const auto = packs.document_chasing!;
    expect((await act(auto, 'start_implementation')).json().status).toBe('in_progress');
    expect((await act(auto, 'complete_implementation')).json()).toMatchObject({ status: 'completed', outcome: { overall: 'not_yet_measured' } });
    expect((await act(auto, 'record_outcome', { results: [{ measure: 'Something else', value: 1, measuredAt: '2026-12-15', source: 'pulse' }] })).statusCode).toBe(409);
    const done = (await act(auto, 'record_outcome', { results: [{ measure: 'Staff hours a month on this work', value: 24, measuredAt: '2026-12-15', source: 'Weekly pulse' }] })).json();
    expect(done.outcome).toMatchObject({ overall: 'not_met', rows: [{ target: 20, result: 24, status: 'not_met' }] });
    expect(done.plan.successMeasures[0]).toMatchObject({ baseline: 33.3, measurementSource: 'Weekly pulse', period: '4 weeks after go-live' });
    const firmView = (await get(`/api/firm/discoveries/${id}/engineering`)).json().submissions.find((s: any) => s.id === auto);
    expect(firmView.outcome.overall).toBe('not_met');
  });

  it('Outlook boundary: the workflow cannot activate mailbox access before the spike passes', async () => {
    // A fresh automate submission designed on the Outlook template.
    const chasing = packs.document_chasing!;
    const fresh = await admin.query(`insert into implementation_packs (org_id, discovery_id, pain_point_id, approval_id, content)
      select org_id, discovery_id, pain_point_id, approval_id, content from implementation_packs where id = $1 returning id`, [chasing]);
    const pk = fresh.rows[0].id as string;
    await act(pk, 'start_assessment');
    const od = design({ templateId: 'outlook_follow_up_drafts_r2_1', approach: 'conventional_automation', humanApprovalPoints: ['Every follow-up is a draft a person sends'] });
    expect((await act(pk, 'record_design', od)).statusCode).toBe(200);
    await act(pk, 'approve_for_implementation');
    await act(pk, 'record_plan', plan());
    expect((await act(pk, 'start_implementation')).statusCode).toBe(200);    // the Microsoft-independent build may proceed
    const activate = await act(pk, 'activate_integration');
    expect(activate.statusCode).toBe(409);
    expect(activate.json().error).toMatch(/spike/i);
    expect((await act(pk, 'complete_implementation')).json().error).toMatch(/spike/i);
    const d = await detail(pk);
    expect(d.integration).toMatchObject({ activated: false, gate: { status: 'not_run' } });
    expect(d.twoWeekOffer.offered).toBe(false);
  });

  it('9. engineering can reject or defer, and reopen a deferral', async () => {
    const pk = packs.application_handover!;
    expect((await act(pk, 'defer', {})).statusCode).toBe(400);              // a reason is required
    expect((await act(pk, 'defer', { reason: 'Firm restructuring the case team first' })).json().group.key).toBe('closed');
    expect((await act(pk, 'reopen', { reason: 'Restructure finished' })).json().status).toBe('in_review');
    expect((await act(pk, 'reject', { reason: 'The firm chose to fix this internally' })).json().status).toBe('rejected');
    expect((await act(pk, 'start_assessment')).statusCode).toBe(409);
  });

  it('13. engineering data is never visible across firms or to unassigned engineers', async () => {
    const pk = packs.crm_duplicate_records!;
    expect((await get('/api/jada/engineering', jada(outsider))).json().submissions).toEqual([]);
    expect((await get(`/api/jada/engineering/${pk}`, jada(outsider))).statusCode).toBe(404);
    expect((await act(pk, 'reject', { reason: 'not mine' }, outsider)).statusCode).toBe(404);
    expect((await get(`/api/firm/discoveries/${id}/engineering`, firm(b))).statusCode).toBe(404);
    expect((await post(`/api/firm/discoveries/${id}/engineering/${pk}/information`, { answer: 'injected' }, firm(b))).statusCode).toBe(404);
    expect((await get('/api/jada/engineering')).statusCode).toBe(401);
    expect((await post(`/api/jada/engineering/${pk}/provide_information`, { answer: 'x' }, jada())).statusCode).toBe(400);   // firm-only action
  });

  it('14. every engineering decision is in the audit log with who made it', async () => {
    const rows = (await admin.query(`select action, actor from audit_log where entity_id = $1 and action like 'engineering.%' order by created_at`, [packs.crm_duplicate_records])).rows;
    expect(rows.map((r) => r.action)).toEqual(['engineering.submitted', 'engineering.start_assessment', 'engineering.request_information', 'engineering.provide_information',
      'engineering.record_design', 'engineering.record_design', 'engineering.approve_for_implementation']);
    expect(rows.find((r) => r.action === 'engineering.provide_information')!.actor).toBe(`user:${a.userId}`);
    expect(rows.find((r) => r.action === 'engineering.start_assessment')!.actor).toBe(`jada:${engineer}`);
    const hist = (await detail(packs.crm_duplicate_records!)).history;
    expect(hist.map((h: any) => h.label)).toContain('Approved for implementation');
    expect((await db.query("update pack_reviews set decision = 'reject'").catch((e) => e)).message).toMatch(/permission denied/);
  });
  // ---------------------------------------------------------------- Phase 6 regressions
  it('P6: only JADA engineers can use engineering controls; other JADA roles get 403', async () => {
    expect((await get('/api/jada/engineering', jada(editor))).statusCode).toBe(403);
    expect((await get(`/api/jada/engineering/${packs.crm_duplicate_records}`, jada(editor))).statusCode).toBe(403);
    expect((await act(packs.crm_duplicate_records!, 'reject', { reason: 'not an engineer' }, editor)).statusCode).toBe(403);
    expect((await get('/api/jada/engineering', firm())).statusCode).toBe(401);      // a firm session is not a JADA session
  });

  it('P6: an engineer can only pick up a discovery that is actually waiting in the queue', async () => {
    const quiet = await firms.createDiscovery(b);                          // another firm, still in its first step
    const r = await post(`/api/jada/discoveries/${quiet}/pick-up`, {}, jada(outsider));
    expect(r.statusCode).toBe(404);
    expect((await admin.query('select 1 from jada_assignments where discovery_id = $1', [quiet])).rowCount).toBe(0);
  });

  it('P6: the pick-up queue describes submissions accurately and shows nothing more', async () => {
    const other = await firms.createDiscovery(b);
    await admin.query("update discoveries set status = 'priorities_approved' where id = $1", [other]);
    const q = (await get('/api/jada/engineering', jada(outsider))).json().unassigned;
    const row = q.find((x: any) => x.discoveryId === other);
    expect(row.reason).toBe('Approved opportunities sent for engineering review');
    expect(JSON.stringify(q)).not.toMatch(/implementation pack ready/);
    expect(Object.keys(row).sort()).toEqual(['discoveryId', 'firmName', 'reason', 'since']);
  });

  it('P6: the two-week checklist is refused for fix and overhaul submissions', async () => {
    const r = await act(packs.crm_duplicate_records!, 'two_week_check', { checks: { singleWorkflowWithStartAndFinish: true, changesCoreSystems: false, accessAndTestDataReadyDayOne: true, humanApprovalForCommsAndRecordChanges: true, complianceQuestionsResolved: true }, unresolvedDependencies: [] });
    expect(r.statusCode).toBe(409);
    const d = await detail(packs.crm_duplicate_records!);
    expect(d.twoWeekOffer).toEqual({ offered: false, reasons: ['The two-week build applies only to automating one defined workflow'] });
  });

  it('P6: keep human is never submitted, by any route', async () => {
    const keep = await oppId('suitability_letter_drafting');
    expect((await post(`/api/firm/discoveries/${id}/approve`, { priorities: [keep], proceedWith: null })).statusCode).toBe(409);
    expect((await submit(keep)).statusCode).toBe(409);
    expect((await admin.query('select 1 from implementation_packs where pain_point_id = $1', [keep])).rowCount).toBe(0);
  });

  it('P6: the append-only hand-over record keeps no interview quotes', async () => {
    const rows = (await admin.query("select new_value from corrections where discovery_id = $1 and field = 'opportunity_decision'", [id])).rows;
    const sent = rows.filter((r) => r.new_value?.decision === 'sent_to_engineering');
    expect(sent.length).toBeGreaterThan(0);
    for (const r of sent) { expect(r.new_value.brief).not.toHaveProperty('voices'); expect(JSON.stringify(r.new_value)).not.toMatch(/I chase payslips/); }
  });

  it('P6: older submissions are flagged for reassessment, never given an invented priority', async () => {
    const legacy = await admin.query(`insert into implementation_packs (org_id, discovery_id, pain_point_id, approval_id, content)
      select org_id, discovery_id, pain_point_id, approval_id, content->'pack' from implementation_packs where id = $1 returning id`, [packs.document_chasing]);
    const lid = legacy.rows[0].id as string;
    const row = (await get('/api/jada/engineering', jada())).json().submissions.find((s: any) => s.id === lid);
    expect(row.priority).toBeNull();
    expect(row.needsReassessment).toMatch(/Reassess/);
    expect((await detail(lid)).needsReassessment).toMatch(/Reassess/);
  });

  it('P6: a new discovery starts from the latest firm profile instead of a blank one', async () => {
    const profile = { advisers: 4, monthlyApplications: 60, typicalWeeksEnquiryToOffer: 6, businessStructure: 'Synthetic test firm', staffRoles: [{ role: 'adviser', count: 4 }], systems: [], authorisation: 'directly_authorised', operationalChallenges: '', loadedHourlyCostGBP: 32 };
    const put = await app.inject({ method: 'PUT', url: `/api/firm/discoveries/${id}/profile`, headers: firm(), payload: profile as any });
    expect(put.statusCode).toBe(200);
    const next = (await post('/api/firm/discoveries', {})).json().discoveryId;
    expect((await get(`/api/firm/discoveries/${next}/profile`)).json().profile).toMatchObject({ monthlyApplications: 60, loadedHourlyCostGBP: 32 });
    expect((await admin.query('select status from discoveries where id = $1', [next])).rows[0].status).toBe('profile');   // the lead still confirms it
    const otherNew = (await post('/api/firm/discoveries', {}, firm(b))).json().discoveryId;
    expect((await get(`/api/firm/discoveries/${otherNew}/profile`, firm(b))).json().profile).toBeNull();
  });

  it('P6 journey C: no firm API exposes another firm’s data, and sessions stay in their lane', async () => {
    const pk = packs.crm_duplicate_records!;
    const urls = [`/api/firm/discoveries/${id}/profile`, `/api/firm/discoveries/${id}/workspace`, `/api/firm/discoveries/${id}/playback`, `/api/firm/discoveries/${id}/progress`,
      `/api/firm/discoveries/${id}/opportunities`, `/api/firm/discoveries/${id}/implementation`, `/api/firm/discoveries/${id}/engineering`];
    for (const u of urls) {
      const r = await get(u, firm(b));
      expect(r.body, u).not.toMatch(/Engineering Test A|duplicate record|payslips/);
      expect(r.body, u).not.toContain(pk);
      expect(r.statusCode, u).toBe(404);
    }
    for (const [m, u, p] of [['POST', `/api/firm/discoveries/${id}/analyse`, {}], ['POST', `/api/firm/discoveries/${id}/reports`, {}],
      ['POST', `/api/firm/discoveries/${id}/participants`, { name: 'X', role: 'adviser' }], ['PUT', `/api/firm/discoveries/${id}/profile`, { staffRoles: [] }]] as const) {
      expect((await app.inject({ method: m, url: u, headers: firm(b), payload: p as any })).statusCode, u).toBeGreaterThanOrEqual(400);
    }
    expect((await get('/api/firm/workspace', firm(b))).json().discoveries.map((d: any) => d.id)).not.toContain(id);
    expect((await get(`/api/firm/discoveries/${id}/opportunities`, jada())).statusCode).toBe(401);
    expect((await post(`/api/jada/engineering/${pk}/start_assessment`, {}, firm())).statusCode).toBe(401);
  });
});
