import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { LLMProvider } from '../llm/provider';
import { scanForClientData } from '../guards/clientData';

// Plus, the in-app guide: answers questions about using BuildA+, grounded ONLY in the help written into
// BuildA+ (public/guide-content.json). The model never sees firm data: just the help text, the page the
// person is on, the next step that page already shows, and the last couple of exchanges.
// Questions are not stored or logged. Anything that looks like client data is refused or redacted first.

export interface GuideContent {
  version: number;
  global: { q: string; a: string }[];
  pages: Record<string, { title: string; purpose: string; check: string[]; how: string[]; next: string; faqs: { q: string; a: string }[]; href?: string }>;
  // Plain definitions of the options and words used on BuildA+'s pages (business types, roles, FCA status…).
  terms?: { term: string; meaning: string }[];
}
export const loadGuideContent = (publicDir: string): GuideContent => JSON.parse(readFileSync(join(publicDir, 'guide-content.json'), 'utf8'));

// Where Plus may send people. The browser turns each key into a link (discovery tabs use the current discovery).
export const FIRM_PLACES = ['overview', 'profile', 'technology', 'discovery', 'interviews', 'journey', 'evidence', 'findings', 'review', 'opportunities', 'implementation', 'impact', 'account'] as const;
export const JADA_PLACES = ['eng-queue', 'eng-templates', 'escalations'] as const;
// Help pages and places for the parked later stages: left out of the AI's context and destinations while they're off.
export const LATER_STAGE_GUIDE_KEYS = ['implementation', 'impact', 'eng-queue', 'eng-detail', 'eng-templates'];
const PLACE_NAMES: Record<string, string> = {
  overview: 'Overview', profile: 'Firm details', technology: 'Technology inventory', discovery: 'Discovery (current)', interviews: 'Interviews tab: invite people, links',
  journey: 'Journey tab', evidence: 'Evidence tab', findings: 'Findings tab', review: 'Review tab', opportunities: 'Opportunities', implementation: 'Implementation',
  impact: 'Impact', account: 'Account settings', 'eng-queue': 'Engineering queue', 'eng-templates': 'Solution templates', escalations: 'Escalations and earlier packs',
};

export const GuideAskSchema = z.object({
  question: z.string().trim().min(1).max(500),
  pageKey: z.string().max(40).default(''),
  nextStep: z.string().trim().max(200).default(''),
  history: z.array(z.object({ q: z.string().max(500), a: z.string().max(1200) })).max(3).default([]),
});
const ReplySchema = z.object({
  answer: z.string().min(1).max(1200),
  goTo: z.string().nullable(),
  suggestions: z.array(z.string().max(90)).max(3),
  grounded: z.boolean(),
});
export type GuideReply = { answer: string; goTo: string | null; suggestions: string[]; grounded: boolean };

export class GuideUnavailableError extends Error { constructor() { super('The guide’s AI isn’t available right now.'); } }
export class GuideRateLimitError extends Error { statusCode = 429; constructor() { super('You’ve asked a lot of questions in a short time. Please wait a minute and try again.'); } }

const SYSTEM = `You are Plus, the friendly built-in guide for BuildA+, an operational-intelligence product for mortgage brokerage firms, delivered with JADA (the implementation partner).
Answer questions about USING BuildA+: what pages are for, what to check, how to do things, what happens next.
Rules:
- Use ONLY the BuildA+ help provided. Never invent features, buttons, figures, timescales or policies. If the help doesn't cover it, say so plainly, set grounded=false, and suggest asking JADA (firm users: the "Ask JADA for help" button on their discovery; JADA staff: their engineering lead).
- Never give mortgage, financial, legal or compliance advice, and never comment on a client or a specific case. Politely decline and point to the right person.
- Explaining what a word or an option on a BuildA+ page means is NOT advice: answer it from TERMS in a sentence or two (e.g. what "Later life lending" means on the business focus list). Advice is telling someone what they or a client should do.
- Be warm, plain and brief: usually 1–3 short sentences, British English, no markdown headings. Answer greetings and thanks naturally in one line.
- If the person wants to go somewhere, or the answer is on another page, set goTo to ONE key from the allowed list; otherwise null. Don't paste links.
- suggestions: up to 3 short follow-up questions the help can answer, phrased as the user would ask them. Empty for greetings.
- If they ask what to do next and a "next step shown on their page" is given, use it.`;

export class GuideService {
  private hits = new Map<string, number[]>();
  constructor(private llm: LLMProvider | null, private content: GuideContent, private opts: { perWindow?: number; windowMs?: number; hidden?: string[] } = {}) {}
  private shown = (key: string) => !(this.opts.hidden ?? []).includes(key);

  private rateLimit(who: string) {
    const now = Date.now(), win = this.opts.windowMs ?? 5 * 60_000, max = this.opts.perWindow ?? 30;
    const recent = (this.hits.get(who) ?? []).filter((t) => now - t < win);
    if (recent.length >= max) throw new GuideRateLimitError();
    recent.push(now); this.hits.set(who, recent);
  }

  private context(pageKey: string, places: readonly string[]): string {
    const c = this.content;
    const here = c.pages[pageKey];
    const lines: string[] = [];
    if (here) lines.push(`CURRENT PAGE: ${here.title}`, `Purpose: ${here.purpose}`, `What to check: ${here.check.join(' | ')}`, `How: ${here.how.join(' | ')}`, `Next: ${here.next}`,
      ...here.faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`), '');
    lines.push('GENERAL HELP:', ...c.global.map((f) => `Q: ${f.q}\nA: ${f.a}`), '');
    if (c.terms?.length) lines.push('TERMS (what the options and words on BuildA+ pages mean):', ...c.terms.map((t) => `- ${t.term}: ${t.meaning}`), '');
    lines.push('OTHER PAGES:');
    for (const [key, p] of Object.entries(c.pages)) {
      if (key === pageKey || !this.shown(key)) continue;
      lines.push(`[${p.title}] ${p.purpose} How: ${p.how.join(' | ')}`, ...p.faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`));
    }
    lines.push('', `ALLOWED goTo KEYS: ${places.map((k) => `${k} = ${PLACE_NAMES[k]}`).join('; ')}`);
    return lines.join('\n');
  }

  async ask(who: { kind: 'firm' | 'jada'; userId: string }, input: unknown): Promise<GuideReply & { redacted?: boolean }> {
    const q = GuideAskSchema.parse(input);
    const scan = scanForClientData(q.question);
    if (scan.definite) {
      return { answer: 'It looks like your question includes client details, such as a name, email address or phone number, so I haven’t sent it. Please ask again without them.', goTo: null, suggestions: [], grounded: true };
    }
    if (!this.llm) throw new GuideUnavailableError();
    this.rateLimit(`${who.kind}:${who.userId}`);
    const places = (who.kind === 'jada' ? JADA_PLACES : FIRM_PLACES).filter(this.shown);
    const history = q.history.flatMap((h) => [{ role: 'user' as const, content: scanForClientData(h.q).redacted }, { role: 'assistant' as const, content: h.a }]);
    const user = [`BUILDA+ HELP:\n${this.context(q.pageKey, places)}`, q.nextStep ? `Next step shown on their page: ${q.nextStep}` : '', `QUESTION: ${scan.redacted}`].filter(Boolean).join('\n\n');
    let data: z.infer<typeof ReplySchema>;
    try {
      ({ data } = await this.llm.generateStructured({ task: 'guide.ask', schemaName: 'guide_reply', schema: ReplySchema, system: SYSTEM,
        messages: [...history, { role: 'user', content: user }], maxOutputTokens: 600 }));
    } catch {
      throw new GuideUnavailableError();
    }
    return { answer: data.answer, goTo: data.goTo && (places as readonly string[]).includes(data.goTo) ? data.goTo : null,
      suggestions: data.suggestions.slice(0, 3), grounded: data.grounded, ...(scan.possible ? { redacted: true } : {}) };
  }
}
