import { GuideService, GuideUnavailableError, loadGuideContent, LATER_STAGE_GUIDE_KEYS } from '../guide/service';
import type { LLMProvider } from '../llm/provider';
import { EngineeringService, ENGINEERING_GROUPS } from '../implementation/engineering';
import { readiness, SOLUTION_TEMPLATES } from '../knowledge/solutionTemplates';
import { briefToMarkdown, handoverBrief } from '../analysis/opportunityAssessment';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { RateLimiter } from './rateLimit';
import { DemoRequestService, type DemoNotify } from '../demo/requests';
import { ZodError } from 'zod';
import { withJadaContext, type Db } from '../db/pool';
import { loadKnowledge } from '../understanding/store';
import { knowledgeView } from '../understanding/view';
import { MORTGAGE_PACK } from '../understanding/packs/mortgage';
import { NotFoundError, ConcurrencyError } from '../db/repositories';
import { InterviewService, ConsentRequiredError, SessionClosedError, InterviewTurnFailedError, MessageTooLongError } from '../interview/service';
import { FirmService, ParticipantAccessService, ConsentVersionError } from '../firm/service';
import { AnalysisService } from '../analysis/service';
import { CONSENT_VERSION, consentSections, type ConsentConfig } from '../participant/consent';
import { signParticipant, verifyParticipant, type ParticipantPrincipal } from './tokens';
import type { AdminService } from '../admin/service';
import { DevCookieAuth, type FirmLeadAuth, type FirmLeadIdentity, type JadaAuth } from './auth';
import { DecisionService, JadaService } from '../implementation/service';
import { renderReportPdf } from '../report/pdf';
import { SigninService } from './signin';
import { KnowledgeService, KnowledgeForbiddenError, ReleaseBlockedError, NoApprovedReleaseError } from '../knowledge/service';

export interface AppDeps {
  db: Db;
  interviews: InterviewService;
  firms: FirmService;
  participants: ParticipantAccessService;
  analysis: AnalysisService;
  firmAuth: FirmLeadAuth;
  jadaAuth: JadaAuth;
  decisions: DecisionService;
  engineering?: EngineeringService;
  jada: JadaService;
  knowledge?: KnowledgeService;
  signin?: SigninService;
  // Plus, the in-app guide. llm null (or absent) = no AI: the browser falls back to its written answers.
  guide?: { llm: LLMProvider | null };
  sessionSecret: string;
  consent: Omit<ConsentConfig, 'firmName'>;
  secureCookies: boolean;
  publicDir?: string;
  // Set by whoever hosts BuildA+. The sign-in page asks for it before showing any account; the public
  // pages (landing, book a demo) and interview links stay open. Without it, sign-in is open (this computer only).
  signinPassword?: string;
  // Behind a hosting proxy (Railway): read the visitor's address from X-Forwarded-For, for rate limiting.
  trustProxy?: boolean;
  // Emails the JADA team about each "Book a demo" request. Optional.
  demoNotify?: DemoNotify;
  // What we sell first is the discovery: it ends at the report and the opportunities. Everything after
  // that (engineering workspace, implementation, impact, knowledge editor) is parked behind this switch,
  // not deleted. Off unless set.
  laterStages?: boolean;
  // The JADA admin page (all firms, the saved demo firm, deleting a firm). Only outside production, and only
  // when the administrator connection is configured.
  admin?: AdminService;
}

// Pages and API routes that belong to the parked later stages. They answer 404 while the switch is off.
// (/app/implementation and /app/impact are workspace pages: the workspace shows its own "Page not found" for them.)
const LATER_STAGE_PATHS = [
  /^\/(jada\/engineering|knowledge)(\/|$)/,
  /^\/api\/(jada\/(engineering|packs)|knowledge)(\/|$)/,
  /^\/api\/firm\/discoveries\/[^/]+\/(engineering|implementation)(\/|$)/,
  /^\/api\/firm\/discoveries\/[^/]+\/opportunities\/[^/]+\/(engineering-review|brief\.md)$/,
];
export const isLaterStagePath = (url: string) => { const path = url.split('?')[0]!; return LATER_STAGE_PATHS.some((re) => re.test(path)); };

// Compares hashes, so the time taken says nothing about the password's length or content.
const samePassword = (given: string, want: string): boolean =>
  timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(want).digest());

const STATIC: Record<string, string> = {
  '/interview': 'interview.html', '/static/interview.js': 'interview.js',
  '/static/app.css': 'app.css', '/static/jada.js': 'jada.js', '/jada': 'jada.html', '/jada/admin': 'admin.html', '/static/admin.js': 'admin.js', '/knowledge': 'knowledge.html', '/static/knowledge.js': 'knowledge.js',
  '/signin': 'signin.html', '/static/signin.js': 'signin.js', '/static/signin.css': 'signin.css', '/static/guide.js': 'guide.js', '/static/guide.css': 'guide.css', '/static/guide-content.json': 'guide-content.json', '/static/session.js': 'session.js',
  // Public landing page and the shared design system (Phase 1).
  '/': 'landing.html', '/static/landing.css': 'landing.css', '/static/landing.js': 'landing.js',
  '/demo': 'demo.html', '/static/demo.css': 'demo.css', '/static/demo.js': 'demo.js',
  '/static/design-system.css': 'design-system.css', '/static/favicon.svg': 'favicon.svg',
  // Firm workspace (Phase 2): one shell page; workspace.js renders the section named by the path.
  '/app': 'app.html', '/static/workspace.js': 'workspace.js', '/static/workspace.css': 'workspace.css', '/static/discovery.js': 'discovery.js', '/static/opportunities.js': 'opportunities.js', '/static/engineering.js': 'engineering.js', '/jada/engineering': 'engineering.html',
};
// Internal design-system reference page: served only alongside the demo sign-in, never in production.
const DEV_STATIC: Record<string, string> = {
  '/design-system': 'design-system.html', '/static/design-system-page.css': 'design-system-page.css',
};
const FONTS = new Set(['SourceSerif4-Regular.ttf', 'SourceSerif4-Semibold.ttf', 'AtkinsonHyperlegible-Regular.ttf', 'AtkinsonHyperlegible-Bold.ttf']);
const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', json: 'application/json; charset=utf-8' };

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024, trustProxy: deps.trustProxy ?? false });
  const engineering = deps.engineering ?? new EngineeringService(deps.db, { analysis: deps.analysis, decisions: deps.decisions });
  app.register(cookie);
  // Browsers send "Content-Type: application/json" on button clicks with no body; treat that as {}.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '' || body === undefined) return done(null, {});
    try { done(null, JSON.parse(body as string)); }
    catch { done(Object.assign(new Error('The request body isn’t valid JSON.'), { statusCode: 400 }), undefined); }
  });
  const publicDir = deps.publicDir ?? join(process.cwd(), 'public');
  const guide = new GuideService(deps.guide?.llm ?? null, loadGuideContent(publicDir), { hidden: deps.laterStages ? [] : LATER_STAGE_GUIDE_KEYS });
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: deps.secureCookies };

  const demoRequests = new DemoRequestService(deps.db, deps.demoNotify ?? null);

  const laterStages = deps.laterStages ?? false;
  if (!laterStages) app.addHook('onRequest', async (req, reply) => { if (isLaterStagePath(req.url)) return reply.code(404).send({ error: 'Not found.' }); });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer'); // invitation tokens must never leak via Referer
    reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Some details are missing or invalid.', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Not found.' });
    if (err instanceof KnowledgeForbiddenError) return reply.code(403).send({ error: err.message });
    if (err instanceof ReleaseBlockedError) return reply.code(409).send({ error: err.message, problems: err.problems });
    if (err instanceof NoApprovedReleaseError) return reply.code(409).send({ error: err.message });
    if (err instanceof ConsentRequiredError) return reply.code(403).send({ error: err.message });
    if (err instanceof SessionClosedError || err instanceof ConcurrencyError || err instanceof ConsentVersionError) return reply.code(409).send({ error: err.message });
    if (err instanceof MessageTooLongError) return reply.code(400).send({ error: err.message });
    if (err instanceof InterviewTurnFailedError) return reply.code(503).send({ error: err.message });
    if ((err as any).statusCode && (err as any).statusCode < 500) return reply.code((err as any).statusCode).send({ error: (err as Error).message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong on our side. Nothing you typed was lost from this page — please try again.' });
  });

  const demoSignin = deps.firmAuth instanceof DevCookieAuth && !!deps.signin;
  const statics = deps.firmAuth instanceof DevCookieAuth ? { ...STATIC, ...DEV_STATIC } : STATIC;
  for (const [route, file] of Object.entries(statics)) {
    app.get(route, async (_req, reply) => {
      const body = readFileSync(join(publicDir, file));
      // The landing page's "Sign in" link is hidden unless a sign-in flow is actually available.
      if (file === 'landing.html' && demoSignin) {
        return reply.type(TYPES.html!).send(body.toString('utf8').replace('id="lp-signin" hidden>', 'id="lp-signin">'));
      }
      return reply.type(TYPES[file.split('.').pop()!]!).send(body);
    });
  }
  // For the host's health check: says only that the server is up.
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/app/*', async (_req, reply) => reply.type(TYPES.html!).send(readFileSync(join(publicDir, 'app.html'))));
  // Phase 6: the older firm pages duplicated the workspace in the earlier visual style. The routes stay, as redirects.
  app.get('/firm', async (_req, reply) => reply.redirect('/app'));
  app.get<{ Params: { id: string } }>('/firm/discoveries/:id', async (req, reply) =>
    reply.redirect(/^[0-9a-f-]{36}$/.test(req.params.id) ? `/app/discovery/${req.params.id}/findings` : '/app/discovery'));
  app.get('/jada/discoveries/:id', async (_req, reply) => reply.type(TYPES.html!).send(readFileSync(join(publicDir, 'jada.html'))));
  app.get('/jada/engineering/:id', async (_req, reply) => reply.type(TYPES.html!).send(readFileSync(join(publicDir, 'engineering.html'))));
  app.get<{ Params: { file: string } }>('/static/fonts/:file', async (req, reply) => {
    if (!FONTS.has(req.params.file)) return reply.code(404).send({ error: 'Not found.' });
    return reply.type('font/ttf').header('cache-control', 'public, max-age=31536000, immutable').send(readFileSync(join(publicDir, 'fonts', req.params.file)));
  });

  // ---------- participants ----------
  const participant = (req: FastifyRequest): ParticipantPrincipal => {
    const p = verifyParticipant(req.cookies['bp_p'], deps.sessionSecret);
    if (!p) throw Object.assign(new Error('Your session has expired. Please open the link from your invitation email again.'), { statusCode: 401 });
    return p;
  };
  const pctx = (p: ParticipantPrincipal) => ({ orgId: p.orgId });
  // Every participant route: refused once the person has withdrawn or the discovery's content is deleted.
  const activeParticipant = async (req: FastifyRequest): Promise<ParticipantPrincipal> => {
    const p = participant(req);
    await deps.participants.ensureActive(pctx(p), p.participantId);
    return p;
  };

  app.get<{ Params: { token: string } }>('/i/:token', async (req, reply) => {
    const resolved = await deps.participants.resolveInvitation(req.params.token);
    if (!resolved) return reply.code(404).type(TYPES.html!).send(readFileSync(join(publicDir, 'link-expired.html')));
    reply.setCookie('bp_p', signParticipant(resolved, deps.sessionSecret), cookieOpts);
    return reply.redirect('/interview', 303);
  });

  app.get('/api/me', async (req) => {
    const p = await activeParticipant(req);
    const info = await deps.participants.participantContext(pctx(p), p.participantId);
    const session = info.consented ? await deps.interviews.startOrResume(pctx(p), p.participantId) : null;
    return {
      firmName: info.firmName, role: info.role, consentRequired: !info.consented,
      consent: info.consented ? null : { version: CONSENT_VERSION, sections: consentSections({ ...deps.consent, firmName: info.firmName }) },
      session,
    };
  });
  app.post<{ Body: { version: string } }>('/api/consent', async (req) => {
    const p = await activeParticipant(req);
    await deps.participants.recordConsent(pctx(p), p.participantId, String(req.body?.version ?? ''));
    return deps.interviews.startOrResume(pctx(p), p.participantId);
  });
  app.post<{ Body: { text: string } }>('/api/interview/message', async (req) => {
    const p = await activeParticipant(req);
    const text = String(req.body?.text ?? '').trim();
    if (!text) throw Object.assign(new Error('Type an answer before sending.'), { statusCode: 400 });
    return deps.interviews.submitForParticipant(pctx(p), p.participantId, text);
  });
  app.post('/api/interview/pause', async (req) => {
    const p = await activeParticipant(req);
    return deps.interviews.pauseForParticipant(pctx(p), p.participantId);
  });
  // Withdrawal (R3): the person's interview and words are removed everywhere. If the interviews were
  // already analysed, the analysis is re-run without them in the background, so findings stop counting them.
  app.post('/api/interview/withdraw', async (req, reply) => {
    const p = await activeParticipant(req);
    const r = await deps.participants.withdraw(pctx(p), p.participantId);
    reply.clearCookie('bp_p', { path: '/' });
    if (r.reanalyse) {
      void deps.analysis.analyse({ orgId: p.orgId, userId: '', actor: 'system:withdrawal' }, r.discoveryId)
        .catch((err) => req.log.error({ err: (err as Error).message }, 're-analysis after a withdrawal failed'));
    }
    return { withdrawn: true };
  });

  // ---------- firm lead ----------
  const lead = async (req: FastifyRequest): Promise<FirmLeadIdentity> => {
    const id = await deps.firmAuth.authenticate(req);
    if (!id) throw Object.assign(new Error('Sign in to continue.'), { statusCode: 401 });
    if (!(await deps.firms.isFirmLead(id))) throw Object.assign(new Error('Only the firm lead can do this.'), { statusCode: 403 });
    return id;
  };
  type P = { Params: { id: string; pid?: string } };

  app.post('/api/firm/discoveries', async (req) => ({ discoveryId: await deps.firms.createDiscovery(await lead(req)) }));
  app.get<P>('/api/firm/discoveries/:id/profile', async (req) => ({ profile: await deps.firms.getProfile(await lead(req), req.params.id) }));
  app.put<P>('/api/firm/discoveries/:id/profile', async (req) => ({ profile: await deps.firms.saveProfile(await lead(req), req.params.id, req.body) }));
  app.post<P>('/api/firm/discoveries/:id/participants', async (req) => deps.firms.inviteParticipant(await lead(req), req.params.id, req.body));
  app.post<P>('/api/firm/discoveries/:id/participants/:pid/link', async (req) => deps.firms.newLink(await lead(req), req.params.id, req.params.pid!));
  app.get('/api/firm/discoveries', async (req) => ({ discoveries: await deps.firms.listDiscoveries(await lead(req)) }));
  app.get('/api/firm/workspace', async (req) => ({ ...(await deps.firms.workspace(await lead(req))), features: { laterStages } }));
  // Plus, the in-app guide: anyone signed in (firm lead or JADA staff). Questions are not stored.
  app.post('/api/guide/ask', async (req, reply) => {
    const firm = await deps.firmAuth.authenticate(req).catch(() => null);
    const jadaId = firm ? null : await deps.jadaAuth.authenticateJada(req).catch(() => null);
    if (!firm && !jadaId) throw Object.assign(new Error('Sign in to continue.'), { statusCode: 401 });
    try { return await guide.ask(firm ? { kind: 'firm', userId: firm.userId } : { kind: 'jada', userId: jadaId!.userId }, req.body); }
    catch (err) { if (err instanceof GuideUnavailableError) return reply.code(503).send({ error: err.message, fallback: true }); throw err; }
  });
  app.get<P>('/api/firm/discoveries/:id/progress', async (req) => { const id = await lead(req); await deps.firms.ensureDiscovery(id, req.params.id); return { participants: await deps.firms.progress(id, req.params.id) }; });
  app.post<P>('/api/firm/discoveries/:id/analyse', async (req) => { await deps.analysis.analyse(await lead(req), req.params.id); return deps.analysis.playback(await lead(req), req.params.id); });
  app.post<P>('/api/firm/discoveries/:id/follow-ups', async (req) => deps.analysis.sendFollowUps(await lead(req), req.params.id));
  app.get<P>('/api/firm/discoveries/:id/playback', async (req) => { const id = await lead(req); await deps.firms.ensureDiscovery(id, req.params.id); return deps.analysis.playback(id, req.params.id); });
  // Phase 3: discovery workspace, evidence review and completion.
  app.get<P>('/api/firm/discoveries/:id/workspace', async (req) => ({
    ...(await deps.analysis.discoveryWorkspace(await lead(req), req.params.id)), retentionMonths: deps.consent.retentionMonths }));
  app.post<P>('/api/firm/discoveries/:id/close', async (req) => deps.firms.closeDiscovery(await lead(req), req.params.id));
  app.post<P>('/api/firm/discoveries/:id/evidence/:pid/review', async (req) => {
    const id = await lead(req);
    await deps.analysis.reviewEvidence(id, req.params.id, req.params.pid!, req.body);
    return { ok: true };
  });
  app.post<P & { Body: { note?: string } }>('/api/firm/discoveries/:id/complete', async (req) =>
    deps.analysis.completeDiscovery(await lead(req), req.params.id, String((req.body as any)?.note ?? '').slice(0, 2000)));
  // Phase 4: opportunity intelligence, review decisions and the hand-over to JADA engineering review.
  app.get<P>('/api/firm/discoveries/:id/opportunities', async (req) => deps.analysis.opportunityAssessments(await lead(req), req.params.id));
  app.post<P>('/api/firm/discoveries/:id/opportunities/:pid/decision', async (req) => {
    const id = await lead(req);
    await deps.analysis.recordOpportunityDecision(id, req.params.id, req.params.pid!, req.body);
    return { ok: true };
  });
  // Phase 5: any approved, ungated opportunity (fix, overhaul or automate) becomes an engineering submission.
  app.post<P>('/api/firm/discoveries/:id/opportunities/:pid/engineering-review', async (req) =>
    engineering.submit(await lead(req), req.params.id, req.params.pid!, String((req.body as any)?.note ?? '').slice(0, 2000)));
  app.get<P>('/api/firm/discoveries/:id/engineering', async (req) => { const id = await lead(req); await deps.firms.ensureDiscovery(id, req.params.id); return { submissions: await engineering.forFirm(id, req.params.id) }; });
  app.post<P>('/api/firm/discoveries/:id/engineering/:pid/information', async (req) =>
    engineering.provideInformation(await lead(req), req.params.id, req.params.pid!, req.body));
  app.get<P>('/api/firm/discoveries/:id/opportunities/:pid/brief.md', async (req, reply) => {
    const intel = await deps.analysis.opportunityAssessments(await lead(req), req.params.id);
    const o = intel.opportunities.find((x) => x.id === req.params.pid);
    if (!o) throw Object.assign(new Error('Opportunity not found'), { statusCode: 404 });
    return reply.type('text/markdown; charset=utf-8').header('content-disposition', 'attachment; filename="opportunity-brief.md"')
      .send(briefToMarkdown(handoverBrief(o, intel.firmName)));
  });
  app.post<P>('/api/firm/discoveries/:id/pain-points/:pid/corrections', async (req) => {
    const id = await lead(req);
    await deps.analysis.correct(id, req.params.id, req.params.pid!, req.body);
    return deps.analysis.playback(id, req.params.id);
  });
  app.post<P & { Body: { note?: string } }>('/api/firm/discoveries/:id/help', async (req) => {
    const id = await lead(req);
    return { escalationId: await deps.interviews.requestHumanHelp(id, req.params.id, String((req.body as any)?.note ?? '')) };
  });

  // ---------- reports and decisions (milestones 9–10) ----------
  app.post<P>('/api/firm/discoveries/:id/reports', async (req) => {
    const r = await deps.decisions.createReport(await lead(req), req.params.id);
    return { ...r, pdfUrl: `/api/firm/discoveries/${req.params.id}/reports/${r.reportId}/pdf` };
  });
  app.get<{ Params: { id: string; rid: string } }>('/api/firm/discoveries/:id/reports/:rid/pdf', async (req, reply) => {
    const model = await deps.decisions.getReport(await lead(req), req.params.id, req.params.rid);
    const pdf = await renderReportPdf(model, { fontDir: join(publicDir, 'fonts') });
    const safe = model.firmName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'firm';
    return reply.type('application/pdf').header('content-disposition', `attachment; filename="${safe}-discovery-report-v${model.version}.pdf"`).send(pdf);
  });
  app.post<P>('/api/firm/discoveries/:id/approve', async (req) => deps.decisions.approve(await lead(req), req.params.id, req.body));
  app.get<P>('/api/firm/discoveries/:id/implementation', async (req) => { const id = await lead(req); await deps.firms.ensureDiscovery(id, req.params.id); return { packs: await deps.decisions.packStatus(id, req.params.id) }; });

  // ---------- JADA engineering ----------
  const jadaUser = async (req: FastifyRequest) => {
    const id = await deps.jadaAuth.authenticateJada(req);
    if (!id) throw Object.assign(new Error('Sign in as JADA staff to continue.'), { statusCode: 401 });
    return id.userId;
  };
  // Phase 5: JADA engineering workspace. Row-level security limits every query to discoveries assigned to this engineer.
  // Engineering controls are for JADA engineers only (other JADA roles have no engineering access).
  const engineer = async (req: FastifyRequest) => {
    const id = await jadaUser(req);
    if (!(await deps.jada.isEngineer(id))) throw Object.assign(new Error('Only JADA engineers can use the engineering workspace.'), { statusCode: 403 });
    return id;
  };
  app.get('/api/jada/engineering', async (req) => {
    const id = await engineer(req);
    return { submissions: await engineering.queue(id), unassigned: await deps.jada.queue(id), groups: ENGINEERING_GROUPS.map(({ key, label }) => ({ key, label })) };
  });
  app.get('/api/jada/engineering/templates', async (req) => { await engineer(req); return { templates: SOLUTION_TEMPLATES.map((t) => ({ ...t, readiness: readiness(t) })) }; });
  app.get<P>('/api/jada/engineering/:id', async (req) => engineering.detail(await engineer(req), req.params.id));
  app.post<{ Params: { id: string; action: string } }>('/api/jada/engineering/:id/:action', async (req) => engineering.act(await engineer(req), req.params.id, req.params.action, req.body));
  app.get('/api/jada/discoveries', async (req) => ({ discoveries: await deps.jada.assignedDiscoveries(await jadaUser(req)) }));
  app.get('/api/jada/queue', async (req) => ({ queue: await deps.jada.queue(await jadaUser(req)) }));
  app.post<P>('/api/jada/discoveries/:id/pick-up', async (req) => { await deps.jada.pickUp(await engineer(req), req.params.id); return { ok: true }; });
  app.post<P>('/api/jada/discoveries/:id/release', async (req) => { await deps.jada.release(await engineer(req), req.params.id); return { ok: true }; });
  app.get<P>('/api/jada/discoveries/:id', async (req) => deps.jada.discovery(await jadaUser(req), req.params.id));
  // What the knowledge engine has understood about an assigned discovery: by role, no quotes (read-only).
  app.get<P>('/api/jada/discoveries/:id/knowledge', async (req) => {
    const userId = await jadaUser(req);
    const k = await withJadaContext(deps.db, userId, (tx) => loadKnowledge(tx, req.params.id));
    const probed = new Set(k.gaps.filter((g) => g.predicate === 'variation' && g.status === 'answered').map((g) => g.subjectId));
    return knowledgeView({ nodes: k.nodes, claims: k.claims, evidence: k.evidence }, MORTGAGE_PACK, probed);
  });
  app.get<P>('/api/jada/packs/:id/markdown', async (req, reply) =>
    reply.type('text/markdown; charset=utf-8').header('content-disposition', `attachment; filename="implementation-pack-${req.params.id.slice(0, 8)}.md"`)
      .send(await deps.jada.packMarkdown(await jadaUser(req), req.params.id)));
  app.post<P>('/api/jada/packs/:id/reviews', async (req) => deps.jada.review(await jadaUser(req), req.params.id, req.body));
  app.post<P & { Body: { note?: string } }>('/api/jada/escalations/:id/resolve', async (req) => {
    await deps.jada.resolveEscalation(await jadaUser(req), req.params.id, String((req.body as any)?.note ?? ''));
    return { ok: true };
  });

  // ---------- knowledge base (milestone 8) ----------
  if (deps.knowledge) {
    const kn = deps.knowledge;
    type K = { Params: { id: string } };
    app.get('/api/knowledge', async (req) => kn.overview(await jadaUser(req)));
    app.get<K>('/api/knowledge/items/:id', async (req) => kn.item(await jadaUser(req), req.params.id));
    app.post('/api/knowledge/drafts', async (req) => kn.saveDraft(await jadaUser(req), req.body));
    app.post<K>('/api/knowledge/items/:id/submit', async (req) => kn.submit(await jadaUser(req), req.params.id));
    app.post<K>('/api/knowledge/items/:id/review', async (req) => kn.review(await jadaUser(req), req.params.id, req.body));
    app.get('/api/knowledge/release-preview', async (req) => {
      const { playbook, errors } = await kn.preview(await jadaUser(req));
      return { problems: errors, counts: { cards: playbook.cards.length, checks: playbook.checks?.length ?? 0, sources: playbook.sources?.length ?? 0 } };
    });
    app.post<{ Body: { notes?: string } }>('/api/knowledge/releases', async (req) => kn.publish(await jadaUser(req), String((req.body as any)?.notes ?? '')));
    app.get('/api/knowledge/candidates', async (req) => ({ candidates: await kn.candidates(await jadaUser(req)) }));
    app.post('/api/knowledge/import-seed', async (req) => ({ imported: await kn.importSeedDrafts(await jadaUser(req)) }));
  }

  // ---------- push-button sign-in (demo mode only) ----------
  app.get('/signout', async (_req, reply) => {
    // Every identity this browser holds is cleared, including an interview tested earlier (bp_p), so a new
    // firm never sees another firm's interview.
    for (const c of ['bp_dev', 'bp_jada', 'bp_p']) reply.clearCookie(c, { path: '/' });
    return reply.redirect('/', 303);
  });
  // ---------- book a demo (public) ----------
  const demoLimit = new RateLimiter(5, 60 * 60 * 1000);
  app.post<{ Body: Record<string, unknown> }>('/api/demo-requests', async (req, reply) => {
    // A hidden field people never see; bots fill it in. Pretend it worked.
    if (typeof req.body?.website === 'string' && req.body.website.trim()) return reply.code(201).send({ ok: true, name: '' });
    if (demoLimit.blocked(req.ip)) return reply.code(429).send({ error: 'We’ve had a few requests from you already. Please try again in an hour, or email JADA directly.' });
    const r = await demoRequests.create(req.body);
    demoLimit.hit(req.ip);
    return reply.code(201).send({ ok: true, name: r.name });
  });
  app.get('/api/jada/demo-requests', async (req) => { await jadaUser(req); return { requests: await demoRequests.list() }; });

  // ---------- JADA admin: every firm, the saved demo firm, deleting a firm ----------
  const adminSvc = async (req: FastifyRequest) => {
    const id = await jadaUser(req);
    if (!deps.admin) throw Object.assign(new Error('The admin tools aren’t switched on here: they need DATABASE_ADMIN_URL, and are never available in production.'), { statusCode: 404 });
    return { id, admin: deps.admin };
  };
  app.get('/api/jada/admin/firms', async (req) => { const { admin } = await adminSvc(req); return { firms: await admin.firms() }; });
  app.post('/api/jada/admin/demo-firm', async (req, reply) => { const { admin } = await adminSvc(req); return reply.code(201).send(await admin.createDemo()); });
  app.post<{ Params: { id: string }; Body: { confirmName?: unknown } }>('/api/jada/admin/firms/:id/delete', async (req) => {
    const { id, admin } = await adminSvc(req);
    return admin.deleteFirm(req.params.id, req.body?.confirmName, `jada:${id}`);
  });

  if (deps.firmAuth instanceof DevCookieAuth && deps.signin) {
    const dev = deps.firmAuth, si = deps.signin;
    // The sign-in password (set by the host). Unlocking sets a signed cookie for 12 hours; until then the
    // account list and every sign-in action answer 401.
    const password = deps.signinPassword ?? null;
    const unlockLimit = new RateLimiter(10, 15 * 60 * 1000);
    const UNLOCK = 'signin-unlocked';
    const unlocked = (req: FastifyRequest) => !password || verifyParticipant(req.cookies['bp_signin'], deps.sessionSecret)?.discoveryId === UNLOCK;
    const mustBeUnlocked = async (req: FastifyRequest) => {
      if (!unlocked(req)) throw Object.assign(new Error('Enter the sign-in password first.'), { statusCode: 401 });
    };
    app.get('/api/signin/status', async (req) => ({ passwordRequired: !!password, unlocked: unlocked(req) }));
    app.post<{ Body: { password?: unknown } }>('/api/signin/unlock', async (req, reply) => {
      if (!password) return { ok: true };
      if (unlockLimit.blocked(req.ip)) return reply.code(429).send({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
      if (typeof req.body?.password !== 'string' || !samePassword(req.body.password, password)) {
        unlockLimit.hit(req.ip);
        return reply.code(401).send({ error: 'That password isn’t right.' });
      }
      unlockLimit.clear(req.ip);
      reply.setCookie('bp_signin', signParticipant({ participantId: 'signin', orgId: '', discoveryId: UNLOCK }, deps.sessionSecret, 60 * 60 * 12), cookieOpts);
      return { ok: true };
    });
    const signInAs = (reply: FastifyReply, e: { userId: string; kind: string; orgId: string | null; roles: string[] }) => {
      // Every identity this browser holds is cleared, including an interview tested earlier (bp_p), so a new
    // firm never sees another firm's interview.
    for (const c of ['bp_dev', 'bp_jada', 'bp_p']) reply.clearCookie(c, { path: '/' });
      if (e.kind === 'firm_lead' && e.orgId) { reply.setCookie('bp_dev', dev.cookieFor({ userId: e.userId, orgId: e.orgId }), cookieOpts); return '/app'; }
      reply.setCookie('bp_jada', dev.jadaCookieFor(e.userId), cookieOpts);
      if (!laterStages) return '/jada';
      return e.roles.includes('engineer') ? '/jada/engineering' : '/knowledge';
    };
    app.get('/api/signin/directory', async (req) => { await mustBeUnlocked(req); return { accounts: await si.directory() }; });
    app.post<{ Body: { userId?: string } }>('/api/signin', async (req, reply) => {
      await mustBeUnlocked(req);
      const e = await si.find(String(req.body?.userId ?? ''));
      if (!e) throw Object.assign(new Error('That account no longer exists.'), { statusCode: 404 });
      return { next: signInAs(reply, e) };
    });
    app.post('/api/signin/new-firm', async (req, reply) => { await mustBeUnlocked(req); return { next: signInAs(reply, await si.newFirm(req.body)) }; });
    app.get('/api/whoami', async (req) => {
      const f = await deps.firmAuth.authenticate(req);
      const j = await deps.jadaAuth.authenticateJada(req);
      const e = await si.find((f ?? j)?.userId ?? '');
      return e ? { name: e.name, kind: e.kind, orgName: e.orgName, roles: e.roles } : { name: null };
    });
  }

  // ---------- development login ----------
  // Sign-in by URL, for scripts on this computer. Never when a sign-in password is set: it would get round it.
  if (deps.firmAuth instanceof DevCookieAuth && !deps.signinPassword) {
    const dev = deps.firmAuth;
    app.get<{ Querystring: { userId: string; orgId: string; next?: string } }>('/dev/login', async (req, reply) => {
      reply.setCookie('bp_dev', dev.cookieFor({ userId: req.query.userId, orgId: req.query.orgId }), cookieOpts);
      const next = req.query.next?.startsWith('/') && !req.query.next.startsWith('//') ? req.query.next : '/';
      return reply.redirect(next, 303);
    });
    app.get<{ Querystring: { userId: string; next?: string } }>('/dev/jada-login', async (req, reply) => {
      reply.setCookie('bp_jada', dev.jadaCookieFor(req.query.userId), cookieOpts);
      const next = req.query.next?.startsWith('/') && !req.query.next.startsWith('//') ? req.query.next : '/jada';
      return reply.redirect(next, 303);
    });
  }
  return app;
}

export type App = ReturnType<typeof buildApp>;
export type { FastifyReply };
