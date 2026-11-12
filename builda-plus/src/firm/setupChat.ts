// Firm setup by chat. The firm lead describes the firm in conversation; the AI words the next question and
// suggests field values, and code decides what goes into the draft:
//   * every suggested value is checked against the firm-profile rules (types, ranges, allowed options);
//   * a number is accepted only if the firm lead actually typed it (digits or a word such as "four"),
//     so the AI can never estimate a figure, least of all the hourly staff cost;
//   * client details are caught before the text reaches the AI, as in the interviews.
// Nothing is saved here. The draft goes back to the browser, and the firm lead checks it on the normal form
// and presses Save.
import { z } from 'zod';
import type { LLMProvider } from '../llm/provider';
import { scanForClientData } from '../guards/clientData';
import { BUSINESS_FOCUS, OPERATING_MODELS, TECHNOLOGY_CATEGORIES } from './profile';

export const SETUP_FIELDS = ['advisers', 'caseManagers', 'administrators', 'monthlyApplications', 'typicalWeeksEnquiryToOffer', 'authorisation',
  'businessStructure', 'operationalChallenges', 'loadedHourlyCostGBP', 'website', 'location', 'businessFocus', 'operatingModel', 'otherRoles', 'notes'] as const;
type SetupField = (typeof SETUP_FIELDS)[number];

export interface SetupDraft {
  advisers?: number; caseManagers?: number; administrators?: number; monthlyApplications?: number; typicalWeeksEnquiryToOffer?: number;
  authorisation?: 'directly_authorised' | 'network_appointed_representative' | 'unsure';
  businessStructure?: string; operationalChallenges?: string; loadedHourlyCostGBP?: number; website?: string; location?: string;
  businessFocus?: (typeof BUSINESS_FOCUS)[number][]; operatingModel?: (typeof OPERATING_MODELS)[number];
  otherRoles?: { name: string; count: number }[]; notes?: string;
  technology?: { name: string; category: (typeof TECHNOLOGY_CATEGORIES)[number]; purpose: string; teams: never[]; notes: string }[];
}

// What the model returns. Values are strings; code turns them into typed, checked values.
export const SetupTurnSchema = z.object({
  reply: z.string().min(1).max(1200),
  updates: z.array(z.object({ field: z.enum(SETUP_FIELDS), value: z.string().max(4000) })).max(15),
  systems: z.array(z.object({ name: z.string().min(1).max(100), category: z.enum(TECHNOLOGY_CATEGORIES), purpose: z.string().max(300) })).max(20),
  // Questions the firm lead chose not to answer ("not sure", "skip", "leave it out"): never asked again.
  skipped: z.array(z.enum([...SETUP_FIELDS, 'systems'])).max(16),
});
const SKIPPABLE = [...SETUP_FIELDS, 'systems'] as const;
export type SetupTurn = z.infer<typeof SetupTurnSchema>;

const LABELS: Record<SetupField, string> = {
  advisers: 'number of mortgage advisers (whole number)', caseManagers: 'number of case managers (whole number)', administrators: 'number of administrators (whole number)',
  monthlyApplications: 'mortgage applications submitted a month (whole number)', typicalWeeksEnquiryToOffer: 'typical weeks from enquiry to offer (number)',
  authorisation: 'one of: directly_authorised, network_appointed_representative, unsure',
  businessStructure: 'how the firm is set up, in the firm lead’s words (one or two sentences)', operationalChallenges: 'what slows things down today, in the firm lead’s words',
  loadedHourlyCostGBP: 'hourly cost in pounds of whoever does the admin work (an administrator, or an adviser if there is no support staff), ONLY if the firm lead states a figure', website: 'website address', location: 'where the firm is based',
  businessFocus: `comma-separated, from: ${BUSINESS_FOCUS.join(', ')}`, operatingModel: `one of: ${OPERATING_MODELS.join(', ')}`,
  otherRoles: 'other roles in the team besides advisers, case managers and administrators, as "Role: count; Role: count" (count must be a number they gave)',
  notes: 'anything else useful about the firm that fits no other field, in their words (send the complete notes text each time, including earlier notes)',
};

export const SETUP_SYSTEM = `You help the lead of a UK mortgage brokerage fill in their firm profile by chatting, before their team is interviewed.
Ask one or two short, friendly questions at a time, in plain British English. Cover, in a natural order:
${SETUP_FIELDS.map((f) => `- ${f}: ${LABELS[f]}`).join('\n')}
- systems: the software the firm uses (CRM, email, document storage, sourcing, accounting), each with a category from ${TECHNOLOGY_CATEGORIES.join(', ')} and a short purpose.
Rules:
- Put in "updates" only what the firm lead has actually told you in this conversation. Never guess, estimate or round a number they didn't give.
- When they say they don't know or want to leave something out ("not sure", "skip", "leave it"), put that field in "skipped" and move on. If you asked about a field and they answered something else, add it to "skipped" too when you move on; don't keep chasing it.
- Read answers generously. "Directly authorised", "authorised by the FCA ourselves", "independent" or "not in a network" all mean directly_authorised; "with a network" or "appointed representative" means network_appointed_representative. "Buy to let" or a misspelling of it means buy_to_let.
- Never ask again about anything already in the profile or already skipped (both are listed for you each turn). Don't re-ask a question in different words: if an answer is unclear, ask once to clarify, then move on.
- Work out what an answer settles. "Directly authorised" already answers whether they're in a network; "advisers run their own cases" answers the operating model.
- Never suggest or estimate the hourly staff cost. Ask for it once, near the end, and say it's optional. If the firm has no administrators or case team, ask what an hour of an adviser's time costs instead, because they do the admin work.
- Text fields use the firm lead's own words, lightly tidied.
- Anything useful they mention that fits no other field (part-time staff, a planned system change, how a branch works) goes in "notes". Other roles in the team (paraplanner, protection specialist, compliance officer) go in "otherRoles". Don't ask a separate question for notes; at the end you may ask once whether there's anything else worth noting.
- Never ask for client names, case details or anything about individual clients.
- At most two questions per message. Don't start every message with "Thanks"; usually go straight to the next question, with a short acknowledgement only now and then.
- When the main details are covered (advisers, team, volume, authorisation, focus, systems, what slows things down), say they can press "Review and save" to check everything on the form, and stop asking questions.
- "reply" is your next message to the firm lead. Don't repeat back every value.`;

const WORDS: Record<string, number> = { zero: 0, none: 0, no: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, dozen: 12 };

// Every number the firm lead typed: digits (with commas, decimals or "k") and number words.
export function statedNumbers(texts: string[]): Set<number> {
  const out = new Set<number>();
  for (const t of texts) {
    for (const m of t.toLowerCase().matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/g)) {
      const n = Number(m[1]!.replace(/,/g, ''));
      if (Number.isFinite(n)) out.add(m[2] ? n * 1000 : n);
    }
    for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) if (w in WORDS && !['a', 'an'].includes(w)) out.add(WORDS[w]!);
  }
  return out;
}

const NUMBER_RULES: Partial<Record<SetupField, { max: number; decimal?: boolean; positive?: boolean }>> = {
  advisers: { max: 500 }, caseManagers: { max: 500 }, administrators: { max: 500 }, monthlyApplications: { max: 100000 },
  typicalWeeksEnquiryToOffer: { max: 104, decimal: true }, loadedHourlyCostGBP: { max: 1000, decimal: true, positive: true },
};

// Turns the model's suggestions into checked draft values. Returns the draft and what was accepted.
export function applyTurn(draft: SetupDraft, turn: SetupTurn, leadTexts: string[]): { draft: SetupDraft; accepted: string[]; refused: string[] } {
  const next: SetupDraft = { ...draft };
  const accepted: string[] = [], refused: string[] = [];
  const stated = statedNumbers(leadTexts);
  for (const { field, value } of turn.updates) {
    const v = value.trim();
    const rule = NUMBER_RULES[field];
    if (rule) {
      const n = Number(v.replace(/[£,\s]/g, ''));
      const ok = v !== '' && Number.isFinite(n) && n >= 0 && n <= rule.max && (rule.decimal || Number.isInteger(n)) && (!rule.positive || n > 0) && stated.has(n);
      if (ok) { (next as any)[field] = n; accepted.push(field); } else refused.push(field);
      continue;
    }
    if (field === 'authorisation') {
      if (['directly_authorised', 'network_appointed_representative', 'unsure'].includes(v)) { next.authorisation = v as SetupDraft['authorisation']; accepted.push(field); } else refused.push(field);
    } else if (field === 'operatingModel') {
      if ((OPERATING_MODELS as readonly string[]).includes(v)) { next.operatingModel = v as SetupDraft['operatingModel']; accepted.push(field); } else refused.push(field);
    } else if (field === 'businessFocus') {
      const list = v.split(/[,;]/).map((x) => x.trim()).filter((x) => (BUSINESS_FOCUS as readonly string[]).includes(x));
      if (list.length) { next.businessFocus = [...new Set(list)] as SetupDraft['businessFocus']; accepted.push(field); } else refused.push(field);
    } else if (field === 'otherRoles') {
      // "Paraplanner: 1; Protection adviser: 2". Each count must be a number the firm lead typed.
      const roles = v.split(/[;\n]/).map((x) => x.match(/^\s*(.{1,60}?)\s*[:\-–]\s*(\d+)\s*$/)).filter(Boolean)
        .map((m) => ({ name: m![1]!.trim(), count: Number(m![2]) })).filter((r) => r.count <= 500 && stated.has(r.count));
      if (roles.length) { next.otherRoles = roles.slice(0, 10); accepted.push(field); } else refused.push(field);
    } else if (field === 'website') {
      const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
      try { if (/\./.test(new URL(url).hostname) && url.length <= 300) { next.website = url; accepted.push(field); } else refused.push(field); } catch { refused.push(field); }
    } else {
      const max = field === 'operationalChallenges' ? 4000 : field === 'notes' ? 2000 : field === 'location' ? 200 : 1000;
      if (v) { (next as any)[field] = v.slice(0, max); accepted.push(field); } else refused.push(field);
    }
  }
  if (turn.systems.length) {
    const byName = new Map((next.technology ?? []).map((t) => [t.name.toLowerCase(), t]));
    for (const s of turn.systems) byName.set(s.name.trim().toLowerCase(), { name: s.name.trim(), category: s.category, purpose: s.purpose.trim(), teams: [], notes: '' });
    next.technology = [...byName.values()].slice(0, 50);
    accepted.push('technology');
  }
  return { draft: next, accepted, refused };
}

export class ClientDetailsError extends Error {
  statusCode = 422;
  constructor() { super('That message looks like it includes a client’s details (a name, email, phone number or similar). Please leave those out and send it again.'); }
}

export class SetupChatService {
  constructor(private deps: { providerFor: (x: { orgId: string; discoveryId: string }) => LLMProvider }) {}

  async turn(ctx: { orgId: string }, discoveryId: string, input: unknown): Promise<{ reply: string; draft: SetupDraft; accepted: string[]; skipped: string[] }> {
    const body = z.object({
      messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).min(1).max(80),
      draft: z.record(z.string(), z.unknown()).default({}),
      skipped: z.array(z.string()).max(20).default([]),
    }).parse(input);
    const last = body.messages[body.messages.length - 1]!;
    if (last.role !== 'user' || !last.content.trim()) throw Object.assign(new Error('Type a message first.'), { statusCode: 400 });
    // Client details never reach the AI: a definite match stops this message; possible ones are redacted.
    const messages = body.messages.slice(-30).map((m) => {
      if (m.role !== 'user') return m;
      const scan = scanForClientData(m.content);
      if (scan.definite && m === last) throw new ClientDetailsError();
      return { role: m.role, content: scan.redacted };
    });
    const draft = cleanDraft(body.draft);
    const skippedBefore = body.skipped.filter((f) => (SKIPPABLE as readonly string[]).includes(f));
    const llm = this.deps.providerFor({ orgId: ctx.orgId, discoveryId });
    const { data } = await llm.generateStructured({
      task: 'setup.chat', schemaName: 'setup_turn', schema: SetupTurnSchema, system: SETUP_SYSTEM, maxOutputTokens: 1200, effort: 'low',
      messages: [...messages, { role: 'user', content: `(For you, not the firm lead. Already in the profile: ${JSON.stringify(draft)}. Left blank on purpose, don't ask again: ${skippedBefore.join(', ') || 'nothing'}.)` }],
    });
    const leadTexts = messages.filter((m) => m.role === 'user').map((m) => m.content);
    const r = applyTurn(draft, data, leadTexts);
    // Skipped stays skipped unless the firm lead gives an answer later.
    const filled = new Set(r.accepted.map((f) => (f === 'technology' ? 'systems' : f)));
    const skipped = [...new Set([...skippedBefore, ...data.skipped])].filter((f) => !filled.has(f));
    return { reply: data.reply, draft: r.draft, accepted: r.accepted, skipped };
  }
}

// The browser sends the draft back each turn; keep only fields that pass the same checks.
function cleanDraft(raw: Record<string, unknown>): SetupDraft {
  const updates = SETUP_FIELDS.filter((f) => raw[f] !== undefined && raw[f] !== null)
    .map((f) => ({ field: f, value: f === 'otherRoles' && Array.isArray(raw[f]) ? (raw[f] as any[]).map((r) => `${r?.name}: ${r?.count}`).join('; ')
      : Array.isArray(raw[f]) ? (raw[f] as unknown[]).join(',') : String(raw[f]) }));
  const systems = Array.isArray(raw.technology) ? (raw.technology as any[]).filter((t) => t && typeof t.name === 'string' && (TECHNOLOGY_CATEGORIES as readonly string[]).includes(t.category))
    .map((t) => ({ name: String(t.name).slice(0, 100), category: t.category, purpose: String(t.purpose ?? '').slice(0, 300) })) : [];
  // Numbers in a draft were already accepted on an earlier turn, so they count as stated here.
  const numbers = updates.filter((u) => NUMBER_RULES[u.field] || u.field === 'otherRoles').map((u) => u.value);
  return applyTurn({}, { reply: '-', updates, systems, skipped: [] }, numbers).draft;
}
