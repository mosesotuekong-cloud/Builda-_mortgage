import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { buildApp, type AppDeps } from '../src/http/app';
import { DevCookieAuth } from '../src/http/auth';
import { FirmService } from '../src/firm/service';
import { AnalysisService } from '../src/analysis/service';
import { ScriptedProvider } from '../src/llm/mock';
import { SEED_PLAYBOOK } from '../src/knowledge/playbook';
import { assessConfidence, assessDimensions } from '../src/engine/confidence';

// ---------------------------------------------------------------- unit: confidence rules (Phase 3)
const rec = (participantRef: string, source: any, monthlyVolume: number | null, minutesPerOccurrence: number | null) => ({ participantRef, source, monthlyVolume, minutesPerOccurrence });

describe('confidence: source and claim are separate', () => {
  it('a single measurement no longer makes a whole finding very high', () => {
    const r = [rec('P1', 'firm_said', 100, 20), rec('m', 'measured_baseline', 120, null)];
    expect(assessConfidence(r).level).not.toBe('very_high');
    expect(assessConfidence([...r, rec('m2', 'measured_baseline', null, 18)]).level).toBe('very_high');
    expect(assessConfidence([rec('m', 'measured_baseline', 120, 20)]).level).toBe('insufficient');
  });
  it('assesses existence, volume, effort and impact independently', () => {
    const d = assessDimensions([rec('P1', 'firm_said', 100, 20), rec('P2', 'firm_said', 110, 60), rec('m', 'measured_baseline', 105, null)]);
    expect(d.existence.level).toBe('high');            // two accounts plus a record; a measurement never proves existence on its own
    expect(d.volume.level).toBe('very_high');          // volume itself was measured
    expect(d.effort.level).toBe('low');                // 20 vs 60 minutes differ materially
    expect(d.impact.level).toBe('low');                // only as strong as the weaker figure
    expect(assessDimensions([rec('m', 'measured_baseline', 100, 20)]).existence.level).toBe('insufficient');
  });
  it('a firm-lead correction counts as one account and never raises confidence', () => {
    const r = [rec('P1', 'firm_said', 100, 20), rec('P2', 'firm_said', 100, 20)];
    expect(assessDimensions(r).volume.level).toBe('medium');
    expect(assessDimensions(r, { overrides: { monthlyVolume: 150 } }).volume.level).toBe('low');
    expect(assessDimensions(r, { reductionBasis: 'template' }).impact.level).toBe('low');
  });
});

// ---------------------------------------------------------------- integration: discovery workspace
const APP = process.env.TEST_DATABASE_URL, ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const SECRET = 'discovery-ws-secret-discovery-ws-1234';

describe.skipIf(!APP || !ADMIN)('discovery workspace (Phase 3)', () => {
  const db = new pg.Pool({ connectionString: APP });
  const admin = new pg.Pool({ connectionString: ADMIN });
  const firms = new FirmService(db, null, { appBaseUrl: 'http://test', invitationDays: 30, playbookVersion: SEED_PLAYBOOK.version });
  // No scripted responses: every AI call fails, so classification falls back to the playbook deterministically.
  const analysis = new AnalysisService(db, { providerFor: () => new ScriptedProvider({}), playbook: SEED_PLAYBOOK, mailer: null, appBaseUrl: 'http://test' });
  const auth = new DevCookieAuth(SECRET);
  const a = { orgId: randomUUID(), userId: randomUUID() }, b = { orgId: randomUUID(), userId: randomUUID() };
  let app: ReturnType<typeof buildApp>;
  let discoveryId = '', unanalysedId = '';
  const as = (who: typeof a) => ({ cookie: `bp_dev=${auth.cookieFor(who)}` });
  const ws = async (who = a, id = discoveryId) => app.inject({ method: 'GET', url: `/api/firm/discoveries/${id}/workspace`, headers: as(who) });
  const docs = async () => (await ws()).json().findings.find((f: any) => f.key === 'document_chasing');

  beforeAll(async () => {
    await firms.createFirm({ ...a, leadUserId: a.userId, name: 'Workspace Test A' });
    await firms.createFirm({ ...b, leadUserId: b.userId, name: 'Workspace Test B' });
    discoveryId = await firms.createDiscovery(a);
    unanalysedId = await firms.createDiscovery(a);
    for (const [name, role] of [['Lead', 'firm_lead'], ['Adv 1', 'adviser'], ['Adv 2', 'adviser'], ['Adv 3', 'adviser'], ['Case Manager', 'case_manager']] as const) {
      await firms.inviteParticipant(a, discoveryId, { name, role });
    }
    // Synthetic interview evidence, inserted directly (the interview engine itself is covered by http.integration).
    const ev = (p: string, key: string, stage: string, role: string, vol: number | null, mins: number | null, quote: string) => admin.query(
      `insert into evidence_records (id, org_id, discovery_id, participant_pseudonym, source, pain_point_key, stage_id, task_description, responsible_role, monthly_volume, minutes_per_occurrence, supporting_quote)
       values ($1,$2,$3,$4,'firm_said',$5,$6,$7,$8,$9,$10,$11)`, [randomUUID(), a.orgId, discoveryId, p, key, stage, `Task described by ${p}`, role, vol, mins, quote]);
    await ev('P1', 'document_chasing', 'documents', 'firm_lead', null, null, 'documents slow us down');
    await ev('P2', 'document_chasing', 'documents', 'adviser', 110, 5, 'documents are straightforward for me');
    await ev('P5', 'document_chasing', 'documents', 'case_manager', 110, 25, 'I chase most cases two or three times');
    for (const p of ['P2', 'P3', 'P4']) await ev(p, 'case_status_updates', 'offer', 'adviser', 40, 10, `status calls take my time ${p}`);
    const noAuth = { authenticate: async () => null, authenticateJada: async () => null };
    app = buildApp({ db, firms, analysis, interviews: {} as any, participants: {} as any, decisions: {} as any, jada: {} as any,
      firmAuth: auth, jadaAuth: noAuth, sessionSecret: SECRET, consent: { retentionMonths: 12, jadaContact: 'test' }, secureCookies: false,
      publicDir: join(__dirname, '..', 'public') } as AppDeps);
    const r = await app.inject({ method: 'POST', url: `/api/firm/discoveries/${discoveryId}/analyse`, headers: as(a) });
    expect(r.statusCode).toBe(200);
  });
  afterAll(async () => { await app?.close(); await db.end(); await admin.end(); });

  it('returns findings with confidence by claim and traceable evidence', async () => {
    const w = (await ws()).json();
    expect(w.findings).toHaveLength(2);
    const f = w.findings.find((x: any) => x.key === 'document_chasing');
    expect(f.dimensions.existence.level).toBe('medium');
    expect(f.dimensions.effort.level).toBe('low');           // 5 vs 25 minutes
    expect(f.disagreements).toHaveLength(1);
    expect(f.evidenceIds).toHaveLength(3);
    for (const e of w.evidence.filter((x: any) => x.findingId === f.id)) {
      expect(e).toMatchObject({ source: 'employee_reported', stageId: 'documents', review: { status: 'unreviewed' } });
      expect(e.collectedAt).toBeTruthy();
    }
    expect(w.stages.find((s: any) => s.id === 'protection').parallel).toBe(true);
    expect(w.completion.findings.total).toBe(2);
  });

  it('withholds verbatim quotes for roles with fewer than three contributors', async () => {
    const w = (await ws()).json();
    const byRole = (role: string) => w.evidence.filter((e: any) => e.role === role);
    expect(byRole('Case manager').every((e: any) => e.quote === null && e.quoteWithheld)).toBe(true);
    expect(byRole('Mortgage adviser').every((e: any) => typeof e.quote === 'string')).toBe(true);   // three advisers
    expect(byRole('Firm owner / Managing Director')[0].quote).toBe('documents slow us down');
    const pb = (await app.inject({ method: 'GET', url: `/api/firm/discoveries/${discoveryId}/playback`, headers: as(a) })).json();
    const pp = pb.painPoints.find((p: any) => p.key === 'document_chasing');
    expect(pp.quotes.map((q: any) => q.quote)).not.toContain('I chase most cases two or three times');
    expect(pp.quotesWithheld).toBe(1);
  });

  it('a correction is audited and lowers, never raises, confidence in the corrected figure', async () => {
    const before = await docs();
    expect(before.dimensions.volume.level).toBe('medium');
    const r = await app.inject({ method: 'POST', url: `/api/firm/discoveries/${discoveryId}/pain-points/${before.id}/corrections`, headers: as(a),
      payload: { field: 'monthlyVolume', value: 150, reason: 'CRM report' } });
    expect(r.statusCode).toBe(200);
    const after = await docs();
    expect(after.dimensions.volume.level).toBe('low');
    expect(after.confidence).toBe(before.confidence);          // stored finding confidence is not raised by the correction
    expect(after.history[0]).toMatchObject({ field: 'monthlyVolume', newValue: 150, reason: 'CRM report' });
    const c = await app.inject({ method: 'POST', url: `/api/firm/discoveries/${discoveryId}/pain-points/${before.id}/corrections`, headers: as(a),
      payload: { field: 'clarification', value: 'Remortgages need fewer documents' } });
    expect(c.statusCode).toBe(200);
    expect((await docs()).history[0]).toMatchObject({ field: 'clarification', newValue: 'Remortgages need fewer documents' });
  });

  it('evidence can be validated or disputed; disputes need a reason and change the assessment', async () => {
    const w = (await ws()).json();
    const adviserDoc = w.evidence.find((e: any) => e.role === 'Mortgage adviser' && e.stageId === 'documents');
    const cmDoc = w.evidence.find((e: any) => e.role === 'Case manager');
    const url = (id: string) => `/api/firm/discoveries/${discoveryId}/evidence/${id}/review`;
    expect((await app.inject({ method: 'POST', url: url(adviserDoc.id), headers: as(a), payload: { status: 'disputed' } })).statusCode).toBe(400);
    const dimsBefore = (await docs()).dimensions;
    expect((await app.inject({ method: 'POST', url: url(cmDoc.id), headers: as(a), payload: { status: 'validated' } })).statusCode).toBe(200);
    expect((await docs()).dimensions).toEqual(dimsBefore);     // validation records agreement; it doesn't raise confidence
    expect((await app.inject({ method: 'POST', url: url(adviserDoc.id), headers: as(a), payload: { status: 'disputed', reason: 'Advisers rarely chase documents' } })).statusCode).toBe(200);
    const f = await docs();
    expect(f.disputedEvidence).toBe(1);
    expect(f.dimensions.existence.reasons[0]).toContain('2 people');
    // The next analysis leaves the disputed account out.
    await app.inject({ method: 'POST', url: `/api/firm/discoveries/${discoveryId}/analyse`, headers: as(a) });
    const re = await docs();
    expect(re.participantCount).toBe(2);
    expect(re.disagreements).toHaveLength(0);
    const audit = await admin.query("select action from audit_log where discovery_id = $1 and action like 'evidence.%' order by id", [discoveryId]);
    expect(audit.rows.map((x) => x.action)).toEqual(['evidence.validated', 'evidence.disputed']);
  });

  it('completion needs an analysis, records uncertainties and keeps findings unverified', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/firm/discoveries/${unanalysedId}/complete`, headers: as(a) })).statusCode).toBe(409);
    const r = await app.inject({ method: 'POST', url: `/api/firm/discoveries/${discoveryId}/complete`, headers: as(a), payload: { note: 'Proceeding with open questions' } });
    expect(r.json()).toEqual({ status: 'review_ready' });
    const w = (await ws()).json();
    expect(w.discovery.status).toBe('review_ready');
    expect(w.findings.every((f: any) => f.validated === false)).toBe(true);
    const audit = await admin.query("select metadata from audit_log where discovery_id = $1 and action = 'discovery.completed'", [discoveryId]);
    expect(audit.rows[0].metadata).toMatchObject({ findings: 2, needValidation: 2, disputedEvidence: 1 });
  });

  it('counts only people, not records, toward the three-person quote threshold (P-1)', async () => {
    const id = await firms.createDiscovery(a);
    for (const [name, role] of [['Lead', 'firm_lead'], ['Admin 1', 'administrator'], ['Admin 2', 'administrator']] as const) await firms.inviteParticipant(a, id, { name, role });
    const ins = (p: string | null, source: string, quote: string | null) => admin.query(
      `insert into evidence_records (id, org_id, discovery_id, participant_pseudonym, source, pain_point_key, stage_id, task_description, responsible_role, monthly_volume, minutes_per_occurrence, supporting_quote)
       values ($1,$2,$3,$4,$5,'document_chasing','documents','Chasing documents','administrator',100,10,$6)`, [randomUUID(), a.orgId, id, p, source, quote]);
    await ins('P2', 'firm_said', 'I chase payslips every morning');
    await ins('P3', 'firm_said', 'the spreadsheet is always out of date');
    await ins(null, 'operational_record', 'CRM report: 30 cases waiting on documents');   // a record attributed to the role is not a third person
    expect((await app.inject({ method: 'POST', url: `/api/firm/discoveries/${id}/analyse`, headers: as(a) })).statusCode).toBe(200);
    const w = (await ws(a, id)).json();
    const admins = w.evidence.filter((e: any) => e.role === 'Administrator' && e.source === 'employee_reported');
    expect(admins).toHaveLength(2);
    expect(admins.every((e: any) => e.quote === null && e.quoteWithheld)).toBe(true);
    const pb = (await app.inject({ method: 'GET', url: `/api/firm/discoveries/${id}/playback`, headers: as(a) })).json();
    const quotes = pb.painPoints.flatMap((p: any) => p.quotes.map((q: any) => q.quote));
    expect(quotes).not.toContain('I chase payslips every morning');
  });

  it('never exposes the discovery to another firm', async () => {
    expect((await ws(b)).statusCode).toBe(404);
    const anyEvidence = (await ws()).json().evidence[0].id;
    expect((await app.inject({ method: 'POST', url: `/api/firm/discoveries/${discoveryId}/evidence/${anyEvidence}/review`, headers: as(b), payload: { status: 'validated' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/firm/discoveries/${discoveryId}/complete`, headers: as(b) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/firm/discoveries/${discoveryId}/workspace` })).statusCode).toBe(401);
  });
});
