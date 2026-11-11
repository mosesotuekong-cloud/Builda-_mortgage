import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp, type AppDeps } from '../src/http/app';
import { DevCookieAuth } from '../src/http/auth';
import { DemoRequestService } from '../src/demo/requests';

// "Book a demo" on the public site: anyone can send a request; only JADA staff can read them.
const APP = process.env.TEST_DATABASE_URL, ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const SECRET = 'demo-req-secret-demo-req-secret-demo-1';
const publicDir = join(__dirname, '..', 'public');

describe.skipIf(!APP || !ADMIN)('book a demo (Postgres)', () => {
  const db = new pg.Pool({ connectionString: APP });
  const admin = new pg.Pool({ connectionString: ADMIN });
  const auth = new DevCookieAuth(SECRET);
  const app = buildApp({
    db, interviews: {} as any, firms: {} as any, participants: {} as any, analysis: {} as any, decisions: {} as any, jada: {} as any,
    firmAuth: auth, jadaAuth: auth, guide: { llm: null }, sessionSecret: SECRET, consent: { retentionMonths: 12, jadaContact: 'test' }, secureCookies: false, publicDir,
  } as AppDeps);
  const valid = { name: 'Alex Example', email: 'Alex@Example-Mortgages.test', firmName: 'Example Mortgages (made up)', role: 'operations', firmSize: '6-20', message: 'Document chasing' };
  const post = (payload: object, ip = '203.0.113.1') => app.inject({ method: 'POST', url: '/api/demo-requests', payload, remoteAddress: ip });

  beforeAll(async () => { await admin.query('truncate demo_requests'); });
  afterAll(async () => { await db.end(); await admin.end(); });

  it('stores a request and says thank you by name', async () => {
    const r = await post(valid);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ ok: true, name: 'Alex Example' });
    const rows = (await admin.query('select * from demo_requests')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'alex@example-mortgages.test', firm_name: 'Example Mortgages (made up)', role: 'operations', firm_size: '6-20', message: 'Document chasing' });
  });

  it('refuses a request with missing or invalid details, naming the fields', async () => {
    const r = await post({ ...valid, email: 'not-an-email', role: 'boss', firmName: '' }, '203.0.113.2');
    expect(r.statusCode).toBe(400);
    expect(r.json().issues.map((i: any) => i.path).sort()).toEqual(['email', 'firmName', 'role']);
  });

  it('quietly drops what a bot sends (the hidden field is filled in)', async () => {
    const before = (await admin.query('select count(*)::int as n from demo_requests')).rows[0].n;
    const r = await post({ ...valid, website: 'http://spam.test' }, '203.0.113.3');
    expect(r.statusCode).toBe(201);
    expect((await admin.query('select count(*)::int as n from demo_requests')).rows[0].n).toBe(before);
  });

  it('limits one address to 5 requests an hour', async () => {
    for (let i = 0; i < 5; i++) expect((await post({ ...valid, name: `Person ${i}` }, '203.0.113.4')).statusCode).toBe(201);
    expect((await post(valid, '203.0.113.4')).statusCode).toBe(429);
    expect((await post(valid, '203.0.113.5')).statusCode).toBe(201);
  });

  it('emails the JADA team, with Reply-To set to the person asking; a failed email still keeps the request', async () => {
    const sent: any[] = [];
    const logs: string[] = [];
    const svc = new DemoRequestService(db, { mailer: { send: async (e) => { sent.push(e); } }, to: ['moses.otuekong@jadasquad.com', 'azeez@jadasquad.com'] });
    await svc.create(valid);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['moses.otuekong@jadasquad.com', 'azeez@jadasquad.com']);
    expect(sent[0].replyTo).toBe('alex@example-mortgages.test');
    expect(sent[0].subject).toBe('Demo request: Example Mortgages (made up) (6-20 people)');
    expect(sent[0].text).toContain('Role: Operations or practice manager');
    expect(sent[0].text).toContain('Document chasing');
    const failing = new DemoRequestService(db, { mailer: { send: async () => { throw new Error('provider down'); } }, to: ['x@jadasquad.com'] }, (m) => logs.push(m));
    const before = (await admin.query('select count(*)::int as n from demo_requests')).rows[0].n;
    await expect(failing.create(valid)).resolves.toMatchObject({ name: 'Alex Example' });
    expect((await admin.query('select count(*)::int as n from demo_requests')).rows[0].n).toBe(before + 1);
    expect(logs[0]).toMatch(/saved, but the email wasn't sent: provider down/);
  });

  it('shows the requests to JADA staff only, newest first', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/jada/demo-requests' })).statusCode).toBe(401);
    const firmLead = `bp_dev=${auth.cookieFor({ userId: randomUUID(), orgId: randomUUID() })}`;
    expect((await app.inject({ method: 'GET', url: '/api/jada/demo-requests', headers: { cookie: firmLead } })).statusCode).toBe(401);
    const jada = `bp_jada=${auth.jadaCookieFor(randomUUID())}`;
    const r = await app.inject({ method: 'GET', url: '/api/jada/demo-requests', headers: { cookie: jada } });
    expect(r.statusCode).toBe(200);
    const list = r.json().requests;
    expect(list.length).toBe(9);
    expect(new Date(list[0].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(list[list.length - 1].createdAt).getTime());
    expect(list[0]).toHaveProperty('firmName');
  });
});
