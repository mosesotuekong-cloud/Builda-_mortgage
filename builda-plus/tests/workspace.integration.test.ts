import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { buildApp, type AppDeps } from '../src/http/app';
import { DevCookieAuth } from '../src/http/auth';
import { FirmService } from '../src/firm/service';
import { FirmProfileSchema } from '../src/firm/profile';
import { SEED_PLAYBOOK } from '../src/knowledge/playbook';

const base = {
  advisers: 14, monthlyApplications: 120, typicalWeeksEnquiryToOffer: 6, businessStructure: 'One office', authorisation: 'directly_authorised',
  staffRoles: [{ role: 'adviser', count: 14 }], systems: ['Legacy CRM'], operationalChallenges: '', loadedHourlyCostGBP: null,
};

describe('firm profile schema (Phase 2 fields)', () => {
  it('still accepts a profile saved before Phase 2', () => {
    const p = FirmProfileSchema.parse(base);
    expect(p.systems).toEqual(['Legacy CRM']);
    expect(p.technology).toBeUndefined();
  });
  it('derives the systems list from the technology inventory', () => {
    const p = FirmProfileSchema.parse({ ...base, website: 'https://example.co.uk', location: 'Leeds', businessFocus: ['buy_to_let'], operatingModel: 'mixed',
      technology: [{ name: 'Example CRM', category: 'crm_mortgage', teams: ['case_managers'] }, { name: 'Mail', category: 'email_communication' }] });
    expect(p.systems).toEqual(['Example CRM', 'Mail']);
    expect(p.technology![1]).toEqual({ name: 'Mail', category: 'email_communication', purpose: '', teams: [], notes: '' });
    expect(FirmProfileSchema.parse({ ...base, technology: [] }).systems).toEqual([]);
  });
  it('keeps other roles and notes, and rejects a role without a count', () => {
    const p = FirmProfileSchema.parse({ ...base, otherRoles: [{ name: 'Paraplanner', count: 1 }], notes: 'Two advisers are part-time.' });
    expect(p).toMatchObject({ otherRoles: [{ name: 'Paraplanner', count: 1 }], notes: 'Two advisers are part-time.' });
    expect(() => FirmProfileSchema.parse({ ...base, otherRoles: [{ name: 'Paraplanner' }] })).toThrow();
    expect(() => FirmProfileSchema.parse({ ...base, notes: 'x'.repeat(2001) })).toThrow();
  });
  it('rejects invalid Phase 2 values', () => {
    expect(() => FirmProfileSchema.parse({ ...base, website: 'not a url' })).toThrow();
    expect(() => FirmProfileSchema.parse({ ...base, technology: [{ name: '', category: 'crm_mortgage' }] })).toThrow();
    expect(() => FirmProfileSchema.parse({ ...base, technology: [{ name: 'X', category: 'marketplace' }] })).toThrow();
    expect(() => FirmProfileSchema.parse({ ...base, businessFocus: ['payday'] })).toThrow();
  });
});

const APP = process.env.TEST_DATABASE_URL;
const SECRET = 'workspace-secret-workspace-secret-123';

describe.skipIf(!APP)('firm workspace endpoint', () => {
  const db = new pg.Pool({ connectionString: APP });
  const firms = new FirmService(db, null, { appBaseUrl: 'http://test', invitationDays: 30, playbookVersion: SEED_PLAYBOOK.version });
  const auth = new DevCookieAuth(SECRET);
  const a = { orgId: randomUUID(), userId: randomUUID() }, b = { orgId: randomUUID(), userId: randomUUID() };
  let app: ReturnType<typeof buildApp>;
  let discoveryA = '';
  const as = (who: typeof a) => ({ cookie: `bp_dev=${auth.cookieFor(who)}` });

  beforeAll(async () => {
    await firms.createFirm({ ...a, leadUserId: a.userId, name: 'Workspace Firm A' });
    await firms.createFirm({ ...b, leadUserId: b.userId, name: 'Workspace Firm B' });
    discoveryA = await firms.createDiscovery(a);
    await firms.saveProfile(a, discoveryA, { ...base, technology: [{ name: 'Example CRM', category: 'crm_mortgage' }] });
    await firms.inviteParticipant(a, discoveryA, { name: 'Case Manager', role: 'case_manager' });
    const noAuth = { authenticate: async () => null, authenticateJada: async () => null };
    app = buildApp({
      db, firms, interviews: {} as any, participants: {} as any, analysis: {} as any, decisions: {} as any, jada: {} as any,
      firmAuth: auth, jadaAuth: noAuth, sessionSecret: SECRET, consent: { retentionMonths: 12, jadaContact: 'test' }, secureCookies: false,
      publicDir: join(__dirname, '..', 'public'),
    } as AppDeps);
  });
  afterAll(async () => { await app?.close(); await db.end(); });

  it('requires a signed-in firm lead', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/firm/workspace' })).statusCode).toBe(401);
  });

  it('summarises the firm’s own discoveries from real data', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/firm/workspace', headers: as(a) });
    expect(r.statusCode).toBe(200);
    const ws = r.json();
    expect(ws.firmName).toBe('Workspace Firm A');
    expect(ws.discoveries).toHaveLength(1);
    expect(ws.discoveries[0]).toMatchObject({ id: discoveryA, status: 'interviews', hasProfile: true, people: 1, completed: 0, evidence: 0, painPoints: 0, ranked: 0, packs: 0, analysedAt: null });
    expect(ws.profile.discoveryId).toBe(discoveryA);
    expect(ws.profile.value.systems).toEqual(['Example CRM']);
    const actions = ws.activity.map((x: any) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['firm.created', 'discovery.created', 'discovery.profile_saved', 'participant.invited']));
    // Activity carries no actor identities, pseudonyms or metadata.
    for (const x of ws.activity) expect(Object.keys(x).sort()).toEqual(['action', 'actorKind', 'at', 'discoveryId', 'entityType']);
  });

  it('never shows another firm’s data', async () => {
    const ws = (await app.inject({ method: 'GET', url: '/api/firm/workspace', headers: as(b) })).json();
    expect(ws.firmName).toBe('Workspace Firm B');
    expect(ws.discoveries).toEqual([]);
    expect(ws.profile).toBeNull();
    expect(ws.activity.every((x: any) => x.discoveryId === null)).toBe(true);
    const put = await app.inject({ method: 'PUT', url: `/api/firm/discoveries/${discoveryA}/profile`, headers: as(b), payload: base });
    expect(put.statusCode).toBe(404);
  });

  it('serves the workspace shell for every section path', async () => {
    for (const url of ['/app', '/app/profile', '/app/profile/technology', '/app/discovery', `/app/discovery/${discoveryA}`, '/app/evidence', '/app/opportunities', '/app/implementation', '/app/impact', '/app/settings/organisation', '/app/settings/account']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(200);
      expect(r.body).toContain('/static/workspace.js');
    }
  });
});
