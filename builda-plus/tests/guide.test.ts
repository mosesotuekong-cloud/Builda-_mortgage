import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp, type AppDeps } from '../src/http/app';
import { DevCookieAuth } from '../src/http/auth';
import { ScriptedProvider } from '../src/llm/mock';
import { GuideService, loadGuideContent } from '../src/guide/service';
import type { LLMProvider } from '../src/llm/provider';

// Plus, the in-app guide: grounded in BuildA+'s written help, signed-in only, no firm data sent to the AI.
const publicDir = join(__dirname, '..', 'public');
const SECRET = 'guide-test-secret-guide-test-secret-123';
const auth = new DevCookieAuth(SECRET);
const app = (llm: LLMProvider | null) => buildApp({ laterStages: true,
  db: {} as any, interviews: {} as any, firms: {} as any, participants: {} as any, analysis: {} as any,
  decisions: {} as any, jada: {} as any, firmAuth: auth, jadaAuth: auth, guide: { llm },
  sessionSecret: SECRET, consent: { retentionMonths: 12, jadaContact: 'test' }, secureCookies: false, publicDir,
} as AppDeps);
const firm = { cookie: `bp_dev=${auth.cookieFor({ userId: '00000000-0000-0000-0000-0000000000f1', orgId: '00000000-0000-0000-0000-0000000000f2' })}` };
const jada = { cookie: `bp_jada=${auth.jadaCookieFor('00000000-0000-0000-0000-0000000000f3')}` };
const ask = (a: ReturnType<typeof app>, payload: unknown, headers = firm) => a.inject({ method: 'POST', url: '/api/guide/ask', headers, payload: payload as any });
const reply = (over: Record<string, unknown> = {}) => ({ answer: 'Evidence shows every observation and where it came from.', goTo: 'evidence', suggestions: ['Why are the exact words withheld?'], grounded: true, ...over });
const source = readFileSync(join(publicDir, 'guide.js'), 'utf8');
const content = loadGuideContent(publicDir);

describe('Plus: grounded AI answers', () => {
  it('only answers signed-in people', async () => {
    expect((await ask(app(new ScriptedProvider({ 'guide.ask': [reply()] })), { question: 'hi' }, {} as any)).statusCode).toBe(401);
  });

  it('grounds the AI in BuildA+’s help and the page, and never sends firm data', async () => {
    const llm = new ScriptedProvider({ 'guide.ask': [reply()] });
    const r = await ask(app(llm), { question: 'I am confused about this page', pageKey: 'disc-evidence', nextStep: 'Review and validate findings' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ answer: expect.stringContaining('Evidence'), goTo: 'evidence', grounded: true });
    const sent = JSON.stringify(llm.calls[0]);
    expect(sent).toContain(content.pages['disc-evidence']!.purpose);          // the current page's help
    expect(sent).toContain('Review and validate findings');                    // the next step the page shows
    expect(sent).toContain('Use ONLY the BuildA+ help');                       // grounding rule
    expect(sent).toContain('Never give mortgage, financial, legal or compliance advice');
  });

  it('can explain the options on its own forms (a definition is not advice)', async () => {
    const llm = new ScriptedProvider({ 'guide.ask': [reply({ answer: 'Mortgages for older borrowers.', goTo: null })] });
    await ask(app(llm), { question: 'what is later life lending', pageKey: 'profile' });
    const sent = JSON.stringify(llm.calls[0]);
    expect(sent).toContain('Explaining what a word or an option on a BuildA+ page means is NOT advice');
    expect(sent).toContain('Later life lending: Mortgages for older borrowers');
    for (const t of ['Residential purchase', 'Buy-to-let', 'Protection', 'Commercial and specialist', 'Directly authorised', 'Appointed representative of a network'])
      expect(content.terms!.map((x) => x.term), t).toContain(t);
    expect(source).toContain('(content.terms || []).map(');                      // the written fallback finds them too
  });

  it('refuses questions with client details before anything reaches the AI', async () => {
    const llm = new ScriptedProvider({ 'guide.ask': [reply()] });
    const r = await ask(app(llm), { question: 'Why is Mrs Jones’s case stuck? Her email is jones@example.com' });
    expect(r.json().answer).toMatch(/client details/);
    expect(llm.calls).toHaveLength(0);
  });

  it('only offers real destinations for the person’s role', async () => {
    const firmLlm = new ScriptedProvider({ 'guide.ask': [reply({ goTo: 'eng-templates' })] });
    expect((await ask(app(firmLlm), { question: 'templates?' })).json().goTo).toBeNull();      // a JADA page isn't offered to a firm
    const jadaLlm = new ScriptedProvider({ 'guide.ask': [reply({ goTo: 'eng-templates' })] });
    expect((await ask(app(jadaLlm), { question: 'templates?' }, jada)).json().goTo).toBe('eng-templates');
    const made = new ScriptedProvider({ 'guide.ask': [reply({ goTo: 'https://example.com' })] });
    expect((await ask(app(made), { question: 'go somewhere' })).json().goTo).toBeNull();
  });

  it('signals a fallback when the AI isn’t configured or fails', async () => {
    const none = await ask(app(null), { question: 'what is evidence?' });
    expect(none.statusCode).toBe(503);
    expect(none.json()).toMatchObject({ fallback: true });
    const failing = await ask(app(new ScriptedProvider({})), { question: 'what is evidence?' });   // no scripted answer = provider error
    expect(failing.statusCode).toBe(503);
  });

  it('limits how many questions one person can ask in a short time', async () => {
    const g = new GuideService(new ScriptedProvider({ 'guide.ask': [reply(), reply(), reply()] }), content, { perWindow: 2 });
    const who = { kind: 'firm' as const, userId: 'u1' };
    await g.ask(who, { question: 'one' });
    await g.ask(who, { question: 'two' });
    await expect(g.ask(who, { question: 'three' })).rejects.toThrow(/wait a minute/);
  });
});

describe('Plus: the page', () => {
  it('is served and loaded on the firm workspace and the JADA engineering pages', async () => {
    const a = app(null);
    for (const [url, type] of [['/static/guide.js', 'text/javascript'], ['/static/guide.css', 'text/css'], ['/static/guide-content.json', 'application/json'], ['/static/signin.css', 'text/css']]) {
      const r = await a.inject({ method: 'GET', url: url! });
      expect(r.statusCode, url).toBe(200);
      expect(r.headers['content-type']).toContain(type!);
    }
    for (const p of ['app.html', 'engineering.html']) {
      const html = readFileSync(join(publicDir, p), 'utf8');
      expect(html, p).toContain('/static/guide.js');
      expect(html, p).toContain('/static/guide.css');
    }
  });

  it('only talks to BuildA+ itself, never to an outside service', () => {
    const urls = [...source.matchAll(/fetch\('([^']+)'/g)].map((m) => m[1]);
    expect(urls.sort()).toEqual(['/api/guide/ask', '/static/guide-content.json']);
    expect(source.replace("'http://www.w3.org/2000/svg'", '')).not.toMatch(/https?:\/\//);   // the SVG namespace is an identifier, not a request
    for (const call of ['XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource']) expect(source).not.toContain(call);
  });

  it('has help for every workspace and engineering page', () => {
    const titles = ['Overview', 'Firm details', 'Technology inventory', 'Discoveries', 'Discovery: overview', 'Discovery: interviews', 'Discovery: journey',
      'Discovery: evidence', 'Discovery: findings', 'A finding', 'Discovery: review', 'Opportunities', 'An opportunity', 'Implementation', 'Impact',
      'Engineering queue', 'An engineering submission', 'Solution templates'];
    const have = Object.values(content.pages).map((p) => p.title);
    for (const t of titles) expect(have, t).toContain(t);
  });

  it('chats naturally: Enter sends, greetings are instant, suggestion clicks keep the panel open', () => {
    expect(source).toContain('Hi! I’m Plus');
    expect(source).toContain("onsubmit: (e) => { e.preventDefault(); send(input.value); }");
    expect(source).not.toContain("'Ask'))");                                   // no separate Ask button
    expect(source).toContain('composedPath()');
  });

  it('says it uses AI, and respects reduced motion', () => {
    expect(source).toContain('worded by AI');
    expect(content.global[0]!.a).toMatch(/OpenAI/);
    expect(readFileSync(join(publicDir, 'guide.css'), 'utf8')).toContain('prefers-reduced-motion: reduce');
  });
});
