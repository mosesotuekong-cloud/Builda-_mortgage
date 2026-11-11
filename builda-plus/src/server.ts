import 'dotenv/config';
import { createPool } from './db/pool';
import { buildApp } from './http/app';
import { DevCookieAuth } from './http/auth';
import { InterviewService } from './interview/service';
import { FirmService, ParticipantAccessService } from './firm/service';
import { AnalysisService } from './analysis/service';
import { OpenAIProvider } from './llm/openai';
import { BudgetedProvider } from './llm/budget';
import { PgUsageLedger } from './db/usageLedger';
import { SEED_PLAYBOOK } from './knowledge/playbook';
import { assertConsentConfigReady } from './participant/consent';
import { DecisionService, JadaService } from './implementation/service';
import { KnowledgeService } from './knowledge/service';
import { SigninService } from './http/signin';
import { BrevoMailer } from './firm/mailer';
import { MORTGAGE_PACK } from './understanding/packs/mortgage';
import pg from 'pg';
import { AdminService } from './admin/service';

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`${k} is not set`);
  return v;
};

const sessionSecret = env('SESSION_SECRET');
if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
const appBaseUrl = env('APP_BASE_URL', 'http://localhost:3000');
const consent = {
  retentionMonths: process.env.RETENTION_MONTHS ? Number(process.env.RETENTION_MONTHS) : null,
  jadaContact: process.env.JADA_CONTACT ?? null,
};
assertConsentConfigReady({ ...consent, firmName: '' });

// BuildA+ uses the push-button sign-in (choose an account). Whoever hosts it sets SIGNIN_PASSWORD, and the
// sign-in page asks for it before showing any account. Required anywhere but this computer.
// (DEMO_ACCESS_PASSWORD, the older site-wide password, is still read so existing deployments keep working.)
const signinPassword = (process.env.SIGNIN_PASSWORD ?? process.env.DEMO_ACCESS_PASSWORD)?.trim() || null;
const onThisComputer = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(appBaseUrl).hostname);
if (!onThisComputer && !signinPassword) {
  throw new Error(`APP_BASE_URL is ${appBaseUrl}, which isn't this computer. Set SIGNIN_PASSWORD (at least 12 characters) so only people you give it to can sign in.`);
}
if (signinPassword && signinPassword.length < 12) throw new Error('SIGNIN_PASSWORD must be at least 12 characters.');

// "Book a demo" requests are emailed to the JADA team through Brevo (brevo.com) when BREVO_API_KEY and
// DEMO_REQUEST_FROM (a sender verified in Brevo) are both set. Otherwise they're only in the JADA console.
const DEMO_REQUEST_TO = (process.env.DEMO_REQUEST_TO || 'moses.otuekong@jadasquad.com,azeez@jadasquad.com').split(',').map((x) => x.trim()).filter(Boolean);
const brevoKey = process.env.BREVO_API_KEY?.trim(), demoFrom = process.env.DEMO_REQUEST_FROM?.trim();
const demoNotify = brevoKey && demoFrom ? { mailer: new BrevoMailer(brevoKey, demoFrom), to: DEMO_REQUEST_TO } : undefined;
if (!demoNotify) console.log(brevoKey ? 'Demo requests: BREVO_API_KEY is set but DEMO_REQUEST_FROM isn’t, so no email is sent. Set it to a sender verified in Brevo.'
  : 'Demo requests: no BREVO_API_KEY, so they are saved and shown in the JADA console only (no email).');
else console.log(`Demo requests: emailed to ${DEMO_REQUEST_TO.join(', ')} through Brevo.`);

// Which interviewer runs main interviews: 'knowledge' (the default: builds a connected understanding and
// plans each question from it) or 'classic' (stage by stage). Follow-ups and the analysis are the same.
const requestedEngine = (process.env.INTERVIEW_ENGINE || 'knowledge').trim();
if (!['knowledge', 'classic'].includes(requestedEngine)) throw new Error('INTERVIEW_ENGINE must be "knowledge" or "classic".');

const db = createPool();
// The knowledge engine needs migration 008. If it hasn't been run, fall back rather than fail every interview.
let interviewEngine = requestedEngine;
if (interviewEngine === 'knowledge') {
  const r = await db.query(`select to_regclass('public.kn_claims') is not null as ready`).catch(() => ({ rows: [{ ready: false }] }));
  if (!r.rows[0]?.ready) {
    interviewEngine = 'classic';
    console.warn('Interviews: the knowledge engine needs migration 008 (run "npm run migrate"). Using the classic engine until then.');
  }
}
console.log(`Interviews: ${interviewEngine} engine.`);
// No email for now: the firm lead copies each person's link and shares it themselves.
const mailer = null;
const model = new OpenAIProvider();
const maxTokens = Number(env('MAX_TOKENS_PER_DISCOVERY', '300000'));
const providerFor = ({ orgId, discoveryId }: { orgId: string; discoveryId: string }) =>
  new BudgetedProvider(model, new PgUsageLedger(db, orgId), { discoveryId, maxTokensPerDiscovery: maxTokens });

// Unreviewed seed cards are allowed only outside production, and are labelled wherever they're used.
const knowledge = new KnowledgeService(db, { allowUnreviewedSeed: process.env.NODE_ENV !== 'production' });
const playbookFor = knowledge.forDiscovery;
const firms = new FirmService(db, mailer, { appBaseUrl, invitationDays: 30, playbookVersion: SEED_PLAYBOOK.version, currentPlaybookVersion: () => knowledge.currentVersion() });
const analysis = new AnalysisService(db, { providerFor, playbook: SEED_PLAYBOOK, playbookFor, mailer, appBaseUrl });
// The JADA admin page uses the administrator connection: never in production.
const adminUrl = process.env.DATABASE_ADMIN_URL?.trim();
const admin = adminUrl && process.env.NODE_ENV !== 'production'
  ? new AdminService(db, new pg.Pool({ connectionString: adminUrl, max: 2 }), { appBaseUrl, llmFor: providerFor }) : undefined;
console.log(admin ? 'JADA admin page: on (/jada/admin).' : 'JADA admin page: off (needs DATABASE_ADMIN_URL, and never in production).');
const devAuth = new DevCookieAuth(sessionSecret); // replace with Builda's auth and JADA's SSO adapters
const app = buildApp({
  db, firms, analysis,
  interviews: new InterviewService(db, { providerFor, playbook: SEED_PLAYBOOK, playbookFor, ...(interviewEngine === 'knowledge' ? { knowledge: { pack: MORTGAGE_PACK } } : {}) }),
  knowledge,
  signin: new SigninService(db, firms),
  guide: { llm: model },
  participants: new ParticipantAccessService(db),
  decisions: new DecisionService(db, { analysis, firms, playbook: SEED_PLAYBOOK, llmFor: providerFor }),
  jada: new JadaService(db),
  firmAuth: devAuth,
  jadaAuth: devAuth,
  sessionSecret,
  consent,
  secureCookies: appBaseUrl.startsWith('https://'),
  ...(signinPassword ? { signinPassword } : {}),
  trustProxy: !onThisComputer,
  ...(demoNotify ? { demoNotify } : {}),
  // Engineering, implementation, impact and the knowledge editor are parked. LATER_STAGES=on brings them back.
  laterStages: process.env.LATER_STAGES === 'on',
  ...(admin ? { admin } : {}),
});

const port = Number(env('PORT', '3000'));
app.listen({ port, host: '0.0.0.0' }).then(() => console.log(`BuildA+ listening on ${appBaseUrl}`));
