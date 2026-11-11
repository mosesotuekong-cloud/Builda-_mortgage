import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildApp, isLaterStagePath, type AppDeps } from '../src/http/app';
import { DevCookieAuth } from '../src/http/auth';
import { ScriptedProvider } from '../src/llm/mock';
import type { LLMProvider } from '../src/llm/provider';

// What we sell first is the discovery. Engineering, implementation, impact and the knowledge editor are
// parked behind one switch (LATER_STAGES=on): off by default, nothing deleted.
const publicDir = join(__dirname, '..', 'public');
const SECRET = 'discovery-first-secret-discovery-first-1';
const auth = new DevCookieAuth(SECRET);
const ORG = '00000000-0000-0000-0000-0000000000d2', LEAD = '00000000-0000-0000-0000-0000000000d1', ENGINEER = '00000000-0000-0000-0000-0000000000d3';
const firm = { cookie: `bp_dev=${auth.cookieFor({ userId: LEAD, orgId: ORG })}` };
const app = (over: Partial<AppDeps> = {}, llm: LLMProvider | null = null) => buildApp({
  db: {} as any, interviews: {} as any, participants: {} as any, analysis: {} as any, decisions: {} as any, jada: {} as any,
  firms: { isFirmLead: async () => true, workspace: async () => ({ firmName: 'Synthetic', discoveries: [] }) } as any,
  signin: { find: async (id: string) => (id === ENGINEER ? { userId: ENGINEER, kind: 'jada', name: 'Engineer', orgId: null, orgName: null, roles: ['engineer'] } : null), directory: async () => [] } as any,
  firmAuth: auth, jadaAuth: auth, guide: { llm }, sessionSecret: SECRET, consent: { retentionMonths: 12, jadaContact: 'test' }, secureCookies: false, publicDir,
  ...over,
} as AppDeps);

const PARKED = ['/jada/engineering', '/jada/engineering/templates', '/knowledge', '/api/jada/engineering', '/api/jada/engineering/templates', '/api/knowledge',
  '/api/jada/packs/x/markdown', '/api/firm/discoveries/d/engineering', '/api/firm/discoveries/d/implementation', '/api/firm/discoveries/d/opportunities/p/brief.md'];

describe('discovery first: later stages parked by default', () => {
  it('answers 404 for every parked page and API, before anything else runs', async () => {
    const a = app();
    for (const url of PARKED) expect((await a.inject({ method: 'GET', url, headers: firm })).statusCode, url).toBe(404);
    expect((await a.inject({ method: 'POST', url: '/api/firm/discoveries/d/opportunities/p/engineering-review', headers: firm, payload: {} })).statusCode).toBe(404);
    expect((await a.inject({ method: 'POST', url: '/api/jada/engineering/x/record_design', payload: {} })).statusCode).toBe(404);
  });

  it('leaves the discovery journey alone', () => {
    for (const url of ['/api/firm/discoveries/d/opportunities', '/api/firm/discoveries/d/opportunities/p/decision', '/api/firm/discoveries/d/reports', '/api/firm/discoveries/d/approve',
      '/api/firm/discoveries/d/workspace', '/api/jada/queue', '/api/jada/discoveries', '/jada', '/app/opportunities', '/interview', '/api/guide/ask']) expect(isLaterStagePath(url), url).toBe(false);
  });

  it('tells the workspace which mode it is in', async () => {
    expect((await app().inject({ method: 'GET', url: '/api/firm/workspace', headers: firm })).json().features).toEqual({ laterStages: false });
    expect((await app({ laterStages: true }).inject({ method: 'GET', url: '/api/firm/workspace', headers: firm })).json().features).toEqual({ laterStages: true });
  });

  it('signs JADA engineers in to the JADA page, not the parked engineering workspace', async () => {
    expect((await app().inject({ method: 'POST', url: '/api/signin', payload: { userId: ENGINEER } })).json().next).toBe('/jada');
    expect((await app({ laterStages: true }).inject({ method: 'POST', url: '/api/signin', payload: { userId: ENGINEER } })).json().next).toBe('/jada/engineering');
  });

  it('Plus never sends people to a parked page, and its AI isn’t told about them', async () => {
    const llm = new ScriptedProvider({ 'guide.ask': [{ answer: 'Impact shows results.', goTo: 'impact', suggestions: [], grounded: true }] });
    const r = await app({}, llm).inject({ method: 'POST', url: '/api/guide/ask', headers: firm, payload: { question: 'where are results?', pageKey: 'overview' } });
    expect(r.json().goTo).toBeNull();
    const sent = JSON.stringify(llm.calls[0]);
    expect(sent).not.toContain('[Impact]');
    expect(sent).not.toMatch(/impact = Impact/);
    expect(sent).toContain('opportunities = Opportunities');
  });

  it('keeps the parked pages out of the workspace menu and next steps', async () => {
    const src = (await app().inject({ method: 'GET', url: '/static/workspace.js' })).body;
    expect(src).toContain("const LATER_STAGE_KEYS = ['implementation', 'impact']");
    expect(src).toContain("title: 'Discovery complete'");
    expect(src).toContain('FEATURES.laterStages = !!ws.features?.laterStages');
  });
});
