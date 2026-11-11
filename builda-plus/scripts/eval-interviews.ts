// Interview evaluation (design phase 0): the real interviewer talks to made-up participants played by a
// second AI from fixed fact sheets, and the result is scored, so "more intelligent" is a number.
//   npx tsx scripts/eval-interviews.ts <engine: classic|knowledge> <persona: case_manager|administrator> [maxTurns]
// Uses OPENAI_API_KEY / OPENAI_MODEL from .env. Costs real tokens. Everything is fictional; no database.
import 'dotenv/config';
import { z } from 'zod';
import { OpenAIProvider } from '../src/llm/openai';
import { startInterview, handleParticipantMessage, type InterviewState } from '../src/interview/orchestrator';
import { SEED_PLAYBOOK } from '../src/knowledge/playbook';
import { MORTGAGE_PACK } from '../src/understanding/packs/mortgage';
import type { KnowledgeContext } from '../src/understanding/engine';
import { firmContextBrief, parseProfile } from '../src/interview/firmContext';
import type { Role } from '../src/domain/journey';

interface Persona { role: Role; opening: string; sheet: string; facts: [string, RegExp][] }
const PERSONAS: Record<string, Persona> = {
  case_manager: {
    role: 'case_manager',
    opening: 'I pick cases up from the advisers once the application is ready. I chase clients for documents, deal with lender and underwriter queries, keep clients, solicitors and introducers updated, and chase solicitors through to exchange and completion. I don’t do enquiries, fact finds or advice.',
    sheet: `You are Casey, a case manager at a small UK mortgage broker.
- You pick cases up from advisers once the application is ready. You don't do enquiries, fact finds, DIPs or advice.
- Handover from advisers is the big problem: about 45 minutes per case filling gaps because details are missing; there is no handover template.
- Chasing clients for documents: about 20 minutes per case, around 40 cases a month need chasing, manual emails and calls, tracked in a spreadsheet.
- Underwriter queries: another round of chasing on about a third of cases, roughly 30 minutes extra.
- Progress updates to clients, solicitors and introducers: about 2 hours a day across the two of you, all phone and email.
- Solicitors are slow; you chase weekly, about 10 minutes per case. Completion is fine.`,
    facts: [['handover 45 min', /\b45\b/], ['no handover template', /template/i], ['documents 20 min', /\b20\b/], ['40 cases a month', /\b40\b/],
      ['tracked in a spreadsheet', /spreadsheet/i], ['underwriter queries on a third', /third|33|1\/3/i], ['30 min extra', /\b30\b/],
      ['updates 2 hours a day', /two hours|2 hours|\b120\b|\b2\b.*hour/i], ['solicitors chased weekly', /week/i]],
  },
  administrator: {
    role: 'administrator',
    opening: 'Once the adviser completes the fact-find, I check the information and enter it into the CRM. Sometimes I have to chase them for missing documents.',
    sheet: `You are Alex, an administrator at a small UK mortgage broker.
- After the adviser completes a fact-find, you check it against the client's documents. (Advisers type the fact-find into the CRM themselves now; you used to.)
- When documents are missing you email the client; last week payslips were missing and the case sat for three days.
- You note chases in your own spreadsheet, not the CRM, so the case manager sometimes rings the client again for the same document.
- About 25 fact-finds a month; each check takes about 15 minutes. You don't know how often documents are missing.
- You also log new web enquiries into the CRM, about 10 minutes each; duplicates are common.`,
    facts: [['checks the fact-find', /check/i], ['chases the client', /client/i], ['payslips', /payslip/i], ['three-day delay', /three days|\b3\b/i],
      ['chases noted in a spreadsheet', /spreadsheet/i], ['case manager rings again', /again|twice|repeat/i], ['advisers enter the fact-find now', /adviser/i],
      ['25 fact-finds a month', /\b25\b/], ['check takes 15 min', /\b15\b/]],
  },
};

const engine = (process.argv[2] ?? 'knowledge') as 'classic' | 'knowledge';
const persona = PERSONAS[process.argv[3] ?? 'case_manager']!;
const maxTurns = Number(process.argv[4] ?? 14);
const llm = new OpenAIProvider();
const firmContext = firmContextBrief(parseProfile({
  advisers: 4, monthlyApplications: 60, typicalWeeksEnquiryToOffer: 5, businessStructure: 'One office; four advisers hand cases to a shared case team of two.',
  staffRoles: [{ role: 'case_manager', count: 2 }, { role: 'administrator', count: 1 }], systems: [], authorisation: 'directly_authorised',
  operationalChallenges: 'Chasing documents and keeping solicitors updated.', loadedHourlyCostGBP: null,
  businessFocus: ['residential_purchase', 'remortgage_product_transfer', 'buy_to_let'], operatingModel: 'advisers_with_case_managers',
  technology: [{ name: 'Example CRM', category: 'crm_mortgage', purpose: 'Client records and case progress', teams: [], notes: '' },
    { name: 'Document tracker spreadsheet', category: 'productivity', purpose: 'Which documents each client still owes', teams: [], notes: '' }],
}));
const knowledge: KnowledgeContext | undefined = engine === 'knowledge' ? { snapshot: { nodes: [], claims: [], evidence: [] }, pack: MORTGAGE_PACK, variationProbed: new Set() } : undefined;

const reply = async (log: string[]) => (await llm.generateStructured({
  task: 'eval.persona', schemaName: 'reply', schema: z.object({ reply: z.string() }),
  system: `${persona.sheet}\nAnswer an interviewer in a chat in 1-3 short sentences, like a busy person typing. Only reveal what is asked. If asked something not in your notes, say you're not sure. Never invent client names.`,
  messages: [{ role: 'user', content: `Conversation so far:\n${log.join('\n')}\n\nWrite your next reply.` }], maxOutputTokens: 300,
})).data.reply;

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
const jaccard = (a: string, b: string) => { const x = words(a), y = words(b); const i = [...x].filter((w) => y.has(w)).length; return i / Math.max(1, new Set([...x, ...y]).size); };

let { state }: { state: InterviewState } = startInterview({ discoveryId: 'eval', participantRef: 'P1', role: persona.role });
const log = [`INTERVIEWER: ${state.transcript[0]!.content}`];
const questions: string[] = [], answers: string[] = [], seconds: number[] = [];
for (let i = 0; i < maxTurns && state.status === 'in_progress'; i++) {
  const answer = i === 0 ? persona.opening : await reply(log);
  answers.push(answer); log.push(`PARTICIPANT: ${answer}`);
  const t = Date.now();
  const out = await handleParticipantMessage(state, answer, { llm, playbook: SEED_PLAYBOOK, firmContext, knowledge });
  seconds.push((Date.now() - t) / 1000);
  state = out.state;
  questions.push(out.reply); log.push(`INTERVIEWER: ${out.reply}`);
}

const captured = engine === 'knowledge'
  ? JSON.stringify({ labels: knowledge!.snapshot.nodes.map((n) => [n.label, ...n.aliases]), claims: knowledge!.snapshot.claims.filter((c) => c.status === 'active').map((c) => [c.objectRef, c.objectValue, c.scope]), evidence: state.evidence })
  : JSON.stringify(state.evidence);
const asked = questions.slice(0, -1);
const doubleQuestions = asked.filter((q) => (q.match(/\?/g) ?? []).length > 1).length;
let repeats = 0;
for (let i = 0; i < asked.length; i++) for (let j = i + 1; j < asked.length; j++) if (jaccard(asked[i]!, asked[j]!) >= 0.6) repeats++;
let reaskAfterUnsure = 0;
for (let i = 1; i < questions.length; i++) if (/not sure|don.t know|no idea/i.test(answers[i] ?? '') && jaccard(questions[i - 1]!, questions[i]!) >= 0.45) reaskAfterUnsure++;
const facts = persona.facts.map(([name, re]) => ({ name, captured: re.test(captured) }));
const result = {
  engine, persona: process.argv[3] ?? 'case_manager', turns: answers.length, finished: state.status,
  factsCaptured: `${facts.filter((f) => f.captured).length}/${facts.length}`, missed: facts.filter((f) => !f.captured).map((f) => f.name),
  doubleQuestions, repeats, reaskAfterUnsure, avgSecondsPerTurn: Math.round((seconds.reduce((a, b) => a + b, 0) / Math.max(1, seconds.length)) * 10) / 10,
  ...(engine === 'knowledge' ? { nodes: knowledge!.snapshot.nodes.filter((n) => !n.mergedInto).length, claims: knowledge!.snapshot.claims.length, plan: state.knowledge?.plan.map((p) => `${p.type}: ${p.about ?? ''}`) } : {}),
};
console.log(log.join('\n\n'));
console.log('\nRESULT ' + JSON.stringify(result));
