import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp, type AppDeps } from '../src/http/app';
import { DevCookieAuth } from '../src/http/auth';

// Private demo: the demo sign-in lets anyone pick any account, so online it sits behind one shared password.
const publicDir = join(__dirname, '..', 'public');
const SECRET = 'gate-test-secret-gate-test-secret-12345';
const auth = new DevCookieAuth(SECRET);
const PASSWORD = 'synthetic-demo-pass-42';
const app = (gate?: AppDeps['accessGate']) => buildApp({
  db: {} as any, interviews: {} as any, firms: {} as any, participants: {} as any, analysis: {} as any,
  decisions: {} as any, jada: {} as any, firmAuth: auth, jadaAuth: auth, guide: { llm: null },
  sessionSecret: SECRET, consent: { retentionMonths: 12, jadaContact: 'test' }, secureCookies: false, publicDir,
  ...(gate ? { accessGate: gate } : {}),
} as AppDeps);
const basic = (user: string, pw: string) => `Basic ${Buffer.from(`${user}:${pw}`).toString('base64')}`;

describe('private demo access gate', () => {
  it('asks for the password on every page, API call and interview link', async () => {
    const a = app({ password: PASSWORD });
    for (const url of ['/', '/signin', '/app', '/interview', '/static/guide.js', '/api/signin/directory', '/api/whoami']) {
      const r = await a.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(401);
      expect(r.headers['www-authenticate'], url).toContain('Basic realm="builda+ private demo"');
      expect(r.body, url).not.toContain('<html');
    }
    expect((await a.inject({ method: 'POST', url: '/api/guide/ask', payload: { question: 'hi' } })).statusCode).toBe(401);
  });

  it('refuses a wrong or malformed password', async () => {
    const a = app({ password: PASSWORD });
    for (const authorization of [basic('demo', 'wrong'), basic('demo', `${PASSWORD}x`), basic('demo', ''), 'Basic !!!', `Bearer ${PASSWORD}`, PASSWORD]) {
      expect((await a.inject({ method: 'GET', url: '/', headers: { authorization } })).statusCode, authorization).toBe(401);
    }
  });

  it('lets the right password through with any user name, and asks search engines not to index', async () => {
    const a = app({ password: PASSWORD });
    for (const user of ['demo', 'anyone', '']) {
      const r = await a.inject({ method: 'GET', url: '/', headers: { authorization: basic(user, PASSWORD) } });
      expect(r.statusCode, user).toBe(200);
      expect(r.headers['x-robots-tag']).toBe('noindex, nofollow');
    }
  });

  it('leaves only the health check open, and it reveals nothing', async () => {
    const a = app({ password: PASSWORD });
    const r = await a.inject({ method: 'GET', url: '/healthz' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    for (const url of ['/healthz/', '/healthz?x=/app', '/healthz/../app']) expect((await a.inject({ method: 'GET', url })).statusCode, url).toBe(401);
  });

  it('changes nothing when no password is set (this computer only)', async () => {
    const r = await app().inject({ method: 'GET', url: '/' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['x-robots-tag']).toBeUndefined();
  });
});
