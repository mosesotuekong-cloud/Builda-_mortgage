// R3: withdrawal and end-of-retention deletion. Seeded marker strings stand in for people's words and
// names; after a withdrawal or purge, no text or jsonb column anywhere in the discovery may contain them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildApp, type AppDeps } from '../src/http/app';
import { DevCookieAuth } from '../src/http/auth';
import { FirmService, ParticipantAccessService } from '../src/firm/service';
import { AnalysisService } from '../src/analysis/service';
import { ScriptedProvider } from '../src/llm/mock';
import { SEED_PLAYBOOK } from '../src/knowledge/playbook';
import { CONSENT_VERSION } from '../src/participant/consent';

const APP = process.env.TEST_DATABASE_URL, ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const SECRET = 'retention-secret-retention-secret-1234';
const RETENTION_PW = 'retention-test-pw';

describe.skipIf(!APP || !ADMIN)('retention and withdrawal (R3)', () => {
  const db = new pg.Pool({ connectionString: APP });
  const admin = new pg.Pool({ connectionString: ADMIN });
  const retentionUrl = (() => { const u = new URL(ADMIN!); u.username = 'builda_retention'; u.password = RETENTION_PW; return u.toString(); })();
  let retention: pg.Pool;
  const firms = new FirmService(db, null, { appBaseUrl: 'http://test', invitationDays: 30, playbookVersion: SEED_PLAYBOOK.version });
  const analysis = new AnalysisService(db, { providerFor: () => new ScriptedProvider({}), playbook: SEED_PLAYBOOK, mailer: null, appBaseUrl: 'http://test' });
  const auth = new DevCookieAuth(SECRET);
  const lead = { orgId: randomUUID(), userId: randomUUID() };
  let app: ReturnType<typeof buildApp>;
  let discoveryId = '';
  const people: Record<string, { id: string; pseudonym: string; link: string }> = {};
  const asLead = { cookie: `bp_dev=${auth.cookieFor(lead)}` };

  // Every text, text[] and jsonb column of every table holding this discovery's rows.
  const leftovers = async (marker: string) => {
    const cols = (await admin.query(`
      select c.table_name, c.column_name from information_schema.columns c
       where c.table_schema = 'public' and c.data_type in ('text', 'jsonb', 'ARRAY')
         and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.table_name and k.column_name = 'discovery_id')
         and c.table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')`)).rows;
    const found: string[] = [];
    for (const { table_name: t, column_name: c } of cols) {
      const r = await admin.query(`select count(*)::int as n from ${pg.escapeIdentifier(t)} where discovery_id = $1 and ${pg.escapeIdentifier(c)}::text like $2`, [discoveryId, `%${marker}%`]);
      if (r.rows[0].n) found.push(`${t}.${c}`);
    }
    return found;
  };
  const open = async (link: string) => {
    const res = await app.inject({ method: 'GET', url: link.replace('http://test', '') });
    return `bp_p=${res.cookies.find((x) => x.name === 'bp_p')!.value}`;
  };

  beforeAll(async () => {
    await admin.query(`alter role builda_retention with login password '${RETENTION_PW}'`);
    retention = new pg.Pool({ connectionString: retentionUrl });
    await firms.createFirm({ ...lead, leadUserId: lead.userId, name: 'Retention Test Brokers' });
    discoveryId = await firms.createDiscovery(lead);
    for (const [key, role] of [['lead', 'firm_lead'], ['ann', 'case_manager'], ['bob', 'case_manager'], ['cat', 'case_manager']] as const) {
      const r = await firms.inviteParticipant(lead, discoveryId, { name: `Name-${key.toUpperCase()}-MARK`, email: `${key}-mark@example.test`, role });
      people[key] = { id: r.participantId, pseudonym: r.pseudonym, link: r.link };
    }
    const ps = new ParticipantAccessService(db);
    for (const p of Object.values(people)) await ps.recordConsent({ orgId: lead.orgId }, p.id, CONSENT_VERSION);
    // People's words, each carrying its owner's marker.
    const ev = (key: string, quote: string) => admin.query(
      `insert into evidence_records (id, org_id, discovery_id, participant_pseudonym, source, pain_point_key, stage_id, task_description, responsible_role,
         monthly_volume, minutes_per_occurrence, supporting_quote, reported_cause)
       values (gen_random_uuid(),$1,$2,$3,'firm_said','document_chasing','documents',$4,'case_manager',100,10,$5,$6)`,
      [lead.orgId, discoveryId, people[key]!.pseudonym, `Chasing payslips ${key.toUpperCase()}-TASK`, quote, `Clients are slow ${key.toUpperCase()}-CAUSE`]);
    await ev('ann', 'I chase payslips every single morning ANN-MARK');
    await ev('bob', 'The spreadsheet is never up to date BOB-MARK');
    await ev('cat', 'Clients send documents in bits CAT-MARK');
    await ev('lead', 'Documents slow every case down LEAD-MARK');
    const sess = (await admin.query(
      `insert into interview_sessions (id, org_id, discovery_id, participant_id, status, state) values (gen_random_uuid(),$1,$2,$3,'completed',$4) returning id`,
      [lead.orgId, discoveryId, people.ann!.id, JSON.stringify({ transcript: [{ role: 'participant', content: 'I chase payslips every single morning ANN-MARK' }] })])).rows[0].id;
    await admin.query(`insert into kn_evidence (id, org_id, discovery_id, session_id, participant_pseudonym, source, quote) values ($1,$2,$3,$4,$5,'firm_said',$6)`,
      [randomUUID(), lead.orgId, discoveryId, sess, people.ann!.pseudonym, 'Every morning I chase ANN-MARK']);
    await admin.query(`insert into follow_ups (org_id, discovery_id, participant_id, pain_point_key, stage_id, question, reason) values ($1,$2,$3,'document_chasing','documents','How long does ANN-MARK take?','figures differ')`,
      [lead.orgId, discoveryId, people.ann!.id]);

    app = buildApp({ db, firms, analysis, interviews: { startOrResume: async () => null } as any, participants: ps, decisions: {} as any, jada: {} as any,
      firmAuth: auth, jadaAuth: { authenticate: async () => null, authenticateJada: async () => null } as any, sessionSecret: SECRET,
      consent: { retentionMonths: 12, jadaContact: 'test' }, secureCookies: false, publicDir: join(__dirname, '..', 'public') } as AppDeps);
    expect((await app.inject({ method: 'POST', url: `/api/firm/discoveries/${discoveryId}/analyse`, headers: asLead })).statusCode).toBe(200);
    // An immutable report snapshot that quotes people.
    const model = (await admin.query('select findings from analysis_runs where discovery_id = $1 order by created_at desc limit 1', [discoveryId])).rows[0].findings;
    await admin.query(`insert into reports (org_id, discovery_id, version, model, created_by) values ($1,$2,1,$3,'test')`,
      [lead.orgId, discoveryId, JSON.stringify({ ...model, voices: [{ role: 'Case manager', quote: 'I chase payslips every single morning ANN-MARK' }, { role: 'Case manager', quote: 'The spreadsheet is never up to date BOB-MARK' }] })]);
  });
  afterAll(async () => { await app?.close(); await retention?.end(); await db.end(); await admin.end(); });

  it('seeds people’s words in many places (the checks below would otherwise prove nothing)', async () => {
    expect((await leftovers('ANN-MARK')).length).toBeGreaterThanOrEqual(5);
    expect(await leftovers('BOB-MARK')).toContain('reports.model');
  });

  it('a participant withdraws through their own link: their words go everywhere, others’ stay', async () => {
    const cookie = await open(people.ann!.link);
    const runsBefore = (await admin.query('select count(*)::int as n from analysis_runs where discovery_id = $1', [discoveryId])).rows[0].n;
    const r = await app.inject({ method: 'POST', url: '/api/interview/withdraw', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(await leftovers('ANN')).toEqual([]);               // quotes, task, cause, name, email, transcript, follow-up, report
    expect(await leftovers('BOB-MARK')).toContain('reports.model');
    expect(await leftovers('BOB-MARK')).toContain('evidence_records.supporting_quote');
    // The link is dead and the session refused.
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(410);
    expect((await app.inject({ method: 'POST', url: `/api/firm/discoveries/${discoveryId}/participants/${people.ann!.id}/link`, headers: asLead })).statusCode).toBe(409);
    const ev = await admin.query("select requested_by, counts from retention_events where discovery_id = $1 and kind = 'participant_withdrawn'", [discoveryId]);
    expect(ev.rows).toEqual([{ requested_by: 'participant', counts: expect.objectContaining({ evidence: 1 }) }]);
    expect(JSON.stringify(ev.rows)).not.toMatch(/MARK/);
    // The analysis re-runs without them, so the finding counts one person fewer.
    for (let i = 0; i < 50; i++) {
      if ((await admin.query('select count(*)::int as n from analysis_runs where discovery_id = $1', [discoveryId])).rows[0].n > runsBefore) break;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    const audit = await admin.query("select actor from audit_log where discovery_id = $1 and action = 'analysis.run' order by id desc limit 1", [discoveryId]);
    expect(audit.rows[0].actor).toBe('system:withdrawal');
    const pp = await admin.query("select evidence_summary->>'participantCount' as n from pain_points where discovery_id = $1 and key = 'document_chasing'", [discoveryId]);
    expect(Number(pp.rows[0].n)).toBe(3);
  });

  it('the app still can’t change append-only records itself', async () => {
    await expect(db.query("update reports set model = '{}' where discovery_id = $1", [discoveryId])).rejects.toThrow(/permission denied/);
    await expect(db.query('delete from retention_events')).rejects.toThrow(/permission denied/);
  });

  it('the retention role can only use its functions', async () => {
    await expect(retention.query('select * from participants')).rejects.toThrow(/permission denied/);
    await expect(retention.query('select retention_scrub($1, $2, true)', [discoveryId, '{}'])).rejects.toThrow(/permission denied/);
  });

  it('closing starts the clock; at the end of retention every word and name is removed', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/firm/discoveries/${discoveryId}/close`, headers: asLead })).statusCode).toBe(200);
    expect((await retention.query('select discovery_id from retention_due(12)')).rows.map((r) => r.discovery_id)).not.toContain(discoveryId);
    await admin.query("update discoveries set closed_at = now() - interval '13 months' where id = $1", [discoveryId]);
    expect((await retention.query('select discovery_id from retention_due(12)')).rows.map((r) => r.discovery_id)).toContain(discoveryId);

    const counts = (await retention.query('select purge_discovery_content($1) as c', [discoveryId])).rows[0].c;
    expect(counts.evidence).toBe(3);
    expect(await leftovers('MARK')).toEqual([]);
    expect(await leftovers('TASK')).toEqual([]);
    expect(await leftovers('CAUSE')).toEqual([]);
    // De-identified findings stay: titles, counts and figures.
    const pp = await admin.query("select title, evidence_summary->>'participantCount' as n from pain_points where discovery_id = $1 and key = 'document_chasing'", [discoveryId]);
    expect(pp.rows[0].title).toBeTruthy();
    expect(Number(pp.rows[0].n)).toBe(3);
    // Done once; recorded without content; shown to the firm lead.
    expect((await retention.query('select purge_discovery_content($1) as c', [discoveryId])).rows[0].c).toBeNull();
    const ev = await admin.query("select requested_by from retention_events where discovery_id = $1 and kind = 'discovery_purged'", [discoveryId]);
    expect(ev.rows).toEqual([{ requested_by: 'retention job' }]);
    const ws = (await app.inject({ method: 'GET', url: `/api/firm/discoveries/${discoveryId}/workspace`, headers: asLead })).json();
    expect(ws.discovery.contentPurgedAt).toBeTruthy();
    expect(ws.discovery.withdrawals).toBe(1);
    expect(ws.retentionMonths).toBe(12);
    // Nobody can use an interview link afterwards.
    const cookie = await open(people.bob!.link).catch(() => '');
    expect(cookie).toBe('');                                    // invitations are gone, so the link no longer opens
  });

  it('the job refuses to run without a retention period', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', join(__dirname, '..', 'scripts', 'retention.ts')],
      { env: { ...process.env, RETENTION_DATABASE_URL: retentionUrl, RETENTION_MONTHS: '' }, encoding: 'utf8', cwd: join(__dirname, '..') });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/RETENTION_MONTHS/);
  });
});
