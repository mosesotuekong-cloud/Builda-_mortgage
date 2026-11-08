import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp, type AppDeps } from '../src/http/app';
import { DevCookieAuth } from '../src/http/auth';

// Static routes only: no database is touched, so the other services can be empty stand-ins.
const publicDir = join(__dirname, '..', 'public');
const noAuth = { authenticate: async () => null, authenticateJada: async () => null };
const base = (over: Partial<AppDeps>): AppDeps => ({
  db: {} as any, interviews: {} as any, firms: {} as any, participants: {} as any, analysis: {} as any,
  decisions: {} as any, jada: {} as any, firmAuth: noAuth, jadaAuth: noAuth,
  sessionSecret: 'x'.repeat(32), consent: { retentionMonths: 12, jadaContact: 'test' }, secureCookies: false, publicDir,
  ...over,
});

describe('landing page and design system routes', () => {
  it('serves the landing page at / and sign-in at /signin', async () => {
    const app = buildApp(base({}));
    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('Your mortgage operation has opportunities hiding in plain sight.');
    expect(home.body).toContain('Not everything needs AI.');
    expect(home.headers['content-security-policy']).toContain("script-src 'self'");
    const signin = await app.inject({ method: 'GET', url: '/signin' });
    expect(signin.statusCode).toBe(200);
    expect(signin.body).toContain('/static/signin.js');
  });

  it('serves the shared stylesheet, script and icon', async () => {
    const app = buildApp(base({}));
    for (const [url, type] of [['/static/design-system.css', 'text/css'], ['/static/landing.css', 'text/css'],
      ['/static/landing.js', 'text/javascript'], ['/static/favicon.svg', 'image/svg+xml']]) {
      const r = await app.inject({ method: 'GET', url: url! });
      expect(r.statusCode, url).toBe(200);
      expect(r.headers['content-type']).toContain(type!);
    }
  });

  it('hides the sign-in link and the design-system page when no sign-in flow exists', async () => {
    const app = buildApp(base({}));
    expect((await app.inject({ method: 'GET', url: '/' })).body).toContain('id="lp-signin" hidden>');
    expect((await app.inject({ method: 'GET', url: '/design-system' })).statusCode).toBe(404);
  });

  it('shows the sign-in link and the design-system page with the demo sign-in', async () => {
    const dev = new DevCookieAuth('y'.repeat(32));
    const app = buildApp(base({ firmAuth: dev, jadaAuth: dev, signin: {} as any }));
    const home = (await app.inject({ method: 'GET', url: '/' })).body;
    expect(home).toContain('id="lp-signin">');
    expect(home).not.toContain('id="lp-signin" hidden>');
    expect((await app.inject({ method: 'GET', url: '/design-system' })).statusCode).toBe(200);
  });

  it('makes no claims the product cannot support', async () => {
    const body = (await buildApp(base({})).inject({ method: 'GET', url: '/' })).body;
    expect(body).toContain('builda+ is not approved or endorsed by the FCA');
    expect(body).not.toMatch(/FCA[- ]approved|authorised and regulated by the FCA/i);
    expect(body).not.toMatch(/testimonial|trusted by \d|\d+% (faster|reduction|saving)/i);
    expect(body).toContain('Illustrative example');
  });
});
