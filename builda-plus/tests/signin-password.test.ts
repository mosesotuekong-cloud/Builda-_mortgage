import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp, type AppDeps } from '../src/http/app';
import { DevCookieAuth } from '../src/http/auth';

// The host sets a sign-in password. Public pages stay open; the account list and every sign-in action
// need the password first, and the sign-in-by-URL route is switched off so it can't get round it.
const publicDir = join(__dirname, '..', 'public');
const SECRET = 'signin-pw-test-secret-signin-pw-test-1';
const auth = new DevCookieAuth(SECRET);
const PASSWORD = 'synthetic-signin-pass-42';
const account = { userId: '11111111-1111-4111-8111-111111111111', name: 'Sam', kind: 'firm_lead' as const, orgId: '22222222-2222-4222-8222-222222222222', orgName: 'Made-up Mortgages', roles: [] };
const signin = { directory: async () => [account], find: async (id: string) => (id === account.userId ? account : null), newFirm: async () => account } as any;
const app = (password?: string) => buildApp({
  db: {} as any, interviews: {} as any, firms: {} as any, participants: {} as any, analysis: {} as any,
  decisions: {} as any, jada: {} as any, firmAuth: auth, jadaAuth: auth, guide: { llm: null }, signin,
  sessionSecret: SECRET, consent: { retentionMonths: 12, jadaContact: 'test' }, secureCookies: false, publicDir,
  ...(password ? { signinPassword: password } : {}),
} as AppDeps);
const cookieFrom = (res: any, name: string) => { const c = res.cookies.find((x: any) => x.name === name && x.value); return c ? `${name}=${c.value}` : ''; };

describe('sign-in password', () => {
  it('leaves the public pages open: no site-wide password any more', async () => {
    const a = app(PASSWORD);
    for (const url of ['/', '/demo', '/signin', '/interview', '/static/demo.js']) {
      const r = await a.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(200);
      expect(r.headers['www-authenticate'], url).toBeUndefined();
    }
  });

  it('shows no account and allows no sign-in until the password is given', async () => {
    const a = app(PASSWORD);
    expect((await a.inject({ method: 'GET', url: '/api/signin/status' })).json()).toEqual({ passwordRequired: true, unlocked: false });
    const dir = await a.inject({ method: 'GET', url: '/api/signin/directory' });
    expect(dir.statusCode).toBe(401);
    expect(dir.body).not.toContain('Made-up Mortgages');
    expect((await a.inject({ method: 'POST', url: '/api/signin', payload: { userId: account.userId } })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: '/api/signin/new-firm', payload: { firmName: 'X firm', yourName: 'X' } })).statusCode).toBe(401);
  });

  it('switches off sign-in by URL when a password is set', async () => {
    const a = app(PASSWORD);
    const r = await a.inject({ method: 'GET', url: `/dev/login?userId=${account.userId}&orgId=${account.orgId}` });
    expect(r.statusCode).toBe(404);
    expect(cookieFrom(r, 'bp_dev')).toBe('');
    expect((await a.inject({ method: 'GET', url: `/dev/jada-login?userId=${account.userId}` })).statusCode).toBe(404);
  });

  it('refuses a wrong password, and lets the right one through', async () => {
    const a = app(PASSWORD);
    for (const password of ['wrong', `${PASSWORD}x`, '', 42, null]) {
      const r = await a.inject({ method: 'POST', url: '/api/signin/unlock', payload: { password } });
      expect(r.statusCode, String(password)).toBe(401);
      expect(cookieFrom(r, 'bp_signin')).toBe('');
    }
    const ok = await a.inject({ method: 'POST', url: '/api/signin/unlock', payload: { password: PASSWORD } });
    expect(ok.statusCode).toBe(200);
    const cookie = cookieFrom(ok, 'bp_signin');
    expect(cookie).not.toBe('');
    expect((await a.inject({ method: 'GET', url: '/api/signin/status', headers: { cookie } })).json()).toEqual({ passwordRequired: true, unlocked: true });
    expect((await a.inject({ method: 'GET', url: '/api/signin/directory', headers: { cookie } })).json().accounts).toHaveLength(1);
    const signedIn = await a.inject({ method: 'POST', url: '/api/signin', headers: { cookie }, payload: { userId: account.userId } });
    expect(signedIn.json()).toEqual({ next: '/app' });
    // A forged unlock cookie doesn't work.
    expect((await a.inject({ method: 'GET', url: '/api/signin/directory', headers: { cookie: 'bp_signin=forged.value' } })).statusCode).toBe(401);
  });

  it('slows down guessing: after 10 wrong tries even the right password waits', async () => {
    const a = app(PASSWORD);
    for (let i = 0; i < 10; i++) await a.inject({ method: 'POST', url: '/api/signin/unlock', payload: { password: `guess-${i}` } });
    expect((await a.inject({ method: 'POST', url: '/api/signin/unlock', payload: { password: PASSWORD } })).statusCode).toBe(429);
  });

  it('needs no password when none is set (this computer only)', async () => {
    const a = app();
    expect((await a.inject({ method: 'GET', url: '/api/signin/status' })).json()).toEqual({ passwordRequired: false, unlocked: true });
    expect((await a.inject({ method: 'GET', url: '/api/signin/directory' })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: `/dev/login?userId=${account.userId}&orgId=${account.orgId}` })).statusCode).toBe(303);
  });

  it('signing in clears any interview this browser was in, so a firm never sees another firm’s interview', async () => {
    const a = app();
    for (const url of ['/api/signin', '/api/signin/new-firm']) {
      const r = await a.inject({ method: 'POST', url, payload: { userId: account.userId, firmName: 'New firm (made up)', yourName: 'Pat' }, headers: { cookie: 'bp_p=earlier-interview' } });
      const cleared = r.cookies.find((c: any) => c.name === 'bp_p');
      expect(cleared, url).toBeTruthy();
      expect(cleared!.value, url).toBe('');
    }
    const out = await a.inject({ method: 'GET', url: '/signout', headers: { cookie: 'bp_p=earlier-interview' } });
    expect(out.cookies.find((c: any) => c.name === 'bp_p')?.value).toBe('');
  });

  it('the health check still answers', async () => {
    expect((await app(PASSWORD).inject({ method: 'GET', url: '/healthz' })).json()).toEqual({ ok: true });
  });
});
