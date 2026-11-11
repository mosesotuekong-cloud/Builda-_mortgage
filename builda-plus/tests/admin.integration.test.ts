import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp, type AppDeps } from '../src/http/app';
import { DevCookieAuth } from '../src/http/auth';
import { AdminService } from '../src/admin/service';
import { DEMO_FIRM } from '../src/admin/demoFirm';

// The JADA admin page: every firm, the saved demo firm (complete flow up to the report), and deleting a firm.
const APP = process.env.TEST_DATABASE_URL, ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const SECRET = 'admin-test-secret-admin-test-secret-1';
const publicDir = join(__dirname, '..', 'public');

describe.skipIf(!APP || !ADMIN)('JADA admin (Postgres)', () => {
  const db = new pg.Pool({ connectionString: APP });
  const admin = new pg.Pool({ connectionString: ADMIN });
  const auth = new DevCookieAuth(SECRET);
  const svc = new AdminService(db, admin, { appBaseUrl: 'http://localhost' });
  const app = (withAdmin = true) => buildApp({
    db, interviews: {} as any, firms: {} as any, participants: {} as any, analysis: {} as any, decisions: {} as any, jada: {} as any,
    firmAuth: auth, jadaAuth: auth, guide: { llm: null }, sessionSecret: SECRET, consent: { retentionMonths: 12, jadaContact: 'test' }, secureCookies: false, publicDir,
    ...(withAdmin ? { admin: svc } : {}),
  } as AppDeps);
  const jada = `bp_jada=${auth.jadaCookieFor(randomUUID())}`;
  const firmLead = `bp_dev=${auth.cookieFor({ userId: randomUUID(), orgId: randomUUID() })}`;

  const removeDemo = async () => {
    const f = (await svc.firms()).find((x) => x.name === DEMO_FIRM);
    if (f) await svc.deleteFirm(f.id, DEMO_FIRM, 'test');
  };
  beforeAll(removeDemo, 120_000);
  afterAll(async () => { await removeDemo(); await db.end(); await admin.end(); }, 120_000);

  it('is for JADA staff only, and is off without the administrator connection', async () => {
    expect((await app().inject({ method: 'GET', url: '/api/jada/admin/firms' })).statusCode).toBe(401);
    expect((await app().inject({ method: 'GET', url: '/api/jada/admin/firms', headers: { cookie: firmLead } })).statusCode).toBe(401);
    expect((await app(false).inject({ method: 'GET', url: '/api/jada/admin/firms', headers: { cookie: jada } })).statusCode).toBe(404);
    expect((await app().inject({ method: 'GET', url: '/jada/admin' })).statusCode).toBe(200);
  });

  it('creates the saved demo firm with the complete flow, once', async () => {
    const r = await app().inject({ method: 'POST', url: '/api/jada/admin/demo-firm', headers: { cookie: jada } });
    expect(r.statusCode).toBe(201);
    const demo = (await app().inject({ method: 'GET', url: '/api/jada/admin/firms', headers: { cookie: jada } })).json().firms.find((f: any) => f.name === DEMO_FIRM);
    expect(demo).toMatchObject({ isDemo: true, discoveries: 1, people: 9, reports: 1 });
    // The report carries a concrete plan for each top opportunity.
    const report = (await admin.query('select model from reports where org_id = $1', [demo.id])).rows[0].model;
    expect(report.businessCases.some((b: any) => b.plan?.timeline?.headline)).toBe(true);
    expect(report.offer?.headline).toBeTruthy();
    expect((await app().inject({ method: 'POST', url: '/api/jada/admin/demo-firm', headers: { cookie: jada } })).statusCode).toBe(409);
  }, 120_000);

  it('deletes a firm and everything in it only when its exact name is typed back', async () => {
    const demo = (await svc.firms()).find((f) => f.name === DEMO_FIRM)!;
    const del = (confirmName: unknown) => app().inject({ method: 'POST', url: `/api/jada/admin/firms/${demo.id}/delete`, headers: { cookie: jada }, payload: { confirmName } });
    for (const wrong of ['', 'Synthetic Demo Mortgages', null, 42]) expect((await del(wrong)).statusCode).toBe(400);
    expect((await admin.query('select count(*)::int as n from organisations where id = $1', [demo.id])).rows[0].n).toBe(1);
    const ok = await del(DEMO_FIRM);
    expect(ok.json()).toEqual({ deleted: DEMO_FIRM });
    for (const t of ['organisations', 'discoveries', 'participants', 'evidence_records', 'reports', 'audit_log']) {
      const col = t === 'organisations' ? 'id' : 'org_id';
      expect((await admin.query(`select count(*)::int as n from ${t} where ${col} = $1`, [demo.id])).rows[0].n, t).toBe(0);
    }
    expect((await del(DEMO_FIRM)).statusCode).toBe(404);
  }, 120_000);
});
