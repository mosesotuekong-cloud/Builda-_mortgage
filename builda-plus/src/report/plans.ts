import { z } from 'zod';
import type { Classification } from '../domain/journey';
import type { LLMProvider } from '../llm/provider';
import type { PlaybookCard } from '../knowledge/playbook';

// A concrete plan for each top opportunity: what we build or change, how it works in the firm's own systems,
// what stays with people, before and after, how we measure it, and a day-by-day timeline. The AI writes the
// plan from the firm's own evidence; it may not invent figures. The timeline is JADA's delivery offer and is
// fixed here in code per kind of change, so it can't drift.

// How JADA will build it: the technical approach in plain words, so the firm (and its IT contact) can see
// what is actually built, how it connects to their systems, where AI is and isn't used, and how it's tested.
export const BuildSchema = z.object({
  approach: z.string().min(10).max(300),            // e.g. "Rules and templates, no AI: a scheduled job drafts reminders..."
  components: z.array(z.string()).min(1).max(4),    // the parts that are built or configured
  connections: z.array(z.string()).min(1).max(4),   // how it connects to each of the firm's systems
  aiRole: z.string().min(4).max(300),               // "None" or exactly what the AI does, and who reviews it
  testing: z.array(z.string()).min(1).max(3),       // how it is tested before it goes live
});
export type BuildText = z.infer<typeof BuildSchema>;

export const SolutionPlanSchema = z.object({
  headline: z.string().min(10).max(200),
  whatWeBuild: z.array(z.string()).min(1).max(4),
  howItWorks: z.array(z.string()).min(2).max(6),
  staysWithPeople: z.array(z.string()).max(3),
  before: z.array(z.string()).min(1).max(3),
  after: z.array(z.string()).min(1).max(3),
  measures: z.array(z.string()).min(1).max(3),
  needFromYou: z.array(z.string()).min(1).max(4),
  build: BuildSchema,
});
export type SolutionPlanText = z.infer<typeof SolutionPlanSchema>;
export interface Timeline { headline: string; steps: { when: string; what: string }[]; afterwards: string }
// Reports saved before build details existed have no `build`; readers must allow for that.
export interface SolutionPlan extends Omit<SolutionPlanText, 'build'> { build?: BuildText; timeline: Timeline; source: 'ai' | 'playbook' }

export interface PlanInput {
  title: string; stage: string; classification: Classification | null; regulated: boolean;
  roles: string[]; causes: string[]; improvements: string[]; quotes: { role: string; quote: string }[];
  monthlyVolume: number | null; minutesEach: number | null; hoursRecovered: number | null;
  systems: string[];              // the firm's own systems, from its technology inventory
  card: PlaybookCard | null;      // matching mortgage playbook pattern, if any
}

// JADA's delivery offer, per kind of change. Reviewed wording; the plan text fills in the specifics.
export function timelineFor(c: Classification | null, systems: string[]): Timeline | null {
  const where = systems.length ? systems.slice(0, 2).join(' and ') : 'your existing systems';
  if (c === 'automate') return {
    headline: 'Live in 3 working days',
    steps: [
      { when: 'Day 1', what: `Map and set up: one hour with the person who does this work today; agree the messages, the rules and who approves what; connect to ${where}.` },
      { when: 'Day 2', what: 'Build and test: build the workflow and test it with your team on sample cases (no real client data).' },
      { when: 'Day 3', what: 'Go live: switch it on for new cases, a 30-minute walkthrough for the team, and start measuring.' },
    ],
    afterwards: 'Weeks 2–4: compare against today’s figures and fine-tune with your team.',
  };
  if (c === 'fix') return {
    headline: 'In place in 2 working days',
    steps: [
      { when: 'Day 1', what: 'Agree the change with the people who do the work: the checklist, template, owner or setting that removes the problem.' },
      { when: 'Day 2', what: `Put it in place in ${where} and brief the team; nothing new to buy or install.` },
    ],
    afterwards: 'Week 2: a 20-minute check that it has stuck, and adjust if needed.',
  };
  if (c === 'overhaul') return {
    headline: 'First change in 3 days, new process in 2–3 weeks',
    steps: [
      { when: 'Days 1–3', what: 'Redesign workshop with everyone involved, and the first quick change in place so the team feels a difference straight away.' },
      { when: 'Weeks 2–3', what: 'Run the new process alongside the old one on new cases, then retire the old steps.' },
    ],
    afterwards: 'Week 4: compare against today’s figures; automate any repetitive steps that remain (a further 2–3 day build).',
  };
  return null;
}

const SYSTEM = `You write a short, concrete improvement plan for one finding from a UK mortgage firm's operational discovery.
The reader is the firm's owner. Plain UK English, no jargon, no hype. Specific: say what is built or changed, in which of the firm's own systems, and what each person does differently.
Rules:
- Use ONLY the facts given (what people said, the figures, the firm's systems). Never invent a number, a system or a fact. If a figure is unknown, say "we measure this in week 1" rather than guessing.
- Keep every regulated decision and every message to a client with a person: automation prepares, a person approves.
- "Automate": conventional automation first (rules, schedules, templates); suggest AI only if the work needs reading free text, and then always with staff review.
- "Fix": a process or configuration change in what they already have; nothing new to buy.
- "Overhaul": redesign the process itself; name which steps disappear.
- Never give mortgage advice or comment on a real client.
Keep it short: every list item under 25 words; each measure under 15 words; the headline under 25 words.
How we build it (the "build" field), for a reader who is not technical but may pass it to their IT contact:
- approach: one or two sentences: conventional automation (rules, schedules, templates), a configuration change, a process redesign, or an AI-assisted step, and why that fits.
- components: what is actually built or set up (e.g. "a checklist template in the CRM", "a scheduled job that drafts reminders").
- connections: for each of the firm's systems involved, how it connects (export, API, shared mailbox, manual step). If the method is not known from the facts, write "<system>: connection method confirmed on Day 1 (API, export or mailbox)". Never claim a system has an API unless the facts say so.
- aiRole: "None: rules and templates only." when no AI is needed; otherwise exactly what the AI does (e.g. reads incoming emails to suggest which document arrived) and that staff review every output.
- testing: how it is tested before going live: sample cases with no real client data, staff approval of every draft, and the check that it works.
Fields: headline (one sentence: the change in plain words); whatWeBuild (what is delivered); howItWorks (numbered steps of the new way of working, in their systems); staysWithPeople (what remains a human decision); before (today, from what people said); after (the same work after the change); measures (how we will know it worked); needFromYou (what the firm provides, e.g. access to a system, an hour with the person who does the work).`;

export async function writePlan(llm: LLMProvider, x: PlanInput): Promise<SolutionPlanText> {
  const facts = [
    `Finding: ${x.title}`, `Stage: ${x.stage}${x.regulated ? ' (involves regulated judgement: automation may only prepare information for the adviser)' : ''}`,
    `Kind of change: ${x.classification ?? 'not yet classified'}`,
    `Who described it: ${x.roles.join(', ') || 'participants'}`,
    x.causes.length ? `Causes they gave: ${x.causes.join('; ')}` : '',
    x.improvements.length ? `Improvements they suggested: ${x.improvements.join('; ')}` : '',
    `Figures: ${x.monthlyVolume !== null ? `about ${x.monthlyVolume} a month` : 'how often: unknown'}; ${x.minutesEach !== null ? `about ${x.minutesEach} minutes each time` : 'time each: unknown'}${x.hoursRecovered !== null ? `; about ${x.hoursRecovered} hours a month could be recovered` : ''}`,
    `The firm's systems: ${x.systems.join(', ') || 'not recorded'}`,
    x.card ? `Known pattern: ${x.card.title}. Typical approaches: ${x.card.automationPatterns.join('; ')}. Human approval: ${x.card.humanApproval.join('; ') || 'n/a'}. Limits: ${x.card.regulatoryLimits.join('; ') || 'none'}.` : '',
    'What people said:', ...x.quotes.slice(0, 4).map((q) => `- (${q.role}) "${q.quote}"`),
  ].filter(Boolean).join('\n');
  const { data } = await llm.generateStructured({ task: 'report.plan', schemaName: 'solution_plan', schema: SolutionPlanSchema, system: SYSTEM,
    messages: [{ role: 'user', content: facts }], maxOutputTokens: 2400, effort: 'low' });
  return data;
}

// The firm's systems that the plan actually uses, so the timeline never names an unrelated system.
export function systemsInPlan(plan: Omit<SolutionPlanText, 'build'> & { build?: BuildText }, systems: string[]): string[] {
  const text = [plan.headline, ...plan.whatWeBuild, ...plan.howItWorks, ...plan.needFromYou, ...(plan.build?.connections ?? [])].join(' ').toLowerCase();
  const core = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').trim();
  return systems.filter((s) => core(s) && text.includes(core(s)));
}

// Complexity in plain words, for fixes and overhauls that have no automation template.
export const COMPLEXITY_BY_KIND: Partial<Record<Classification, string>> = {
  fix: 'Low: changes to settings and ways of working you already have',
  overhaul: 'Medium: a new way of working, introduced in stages alongside the old one',
};

// When the AI isn't available: a plainer plan from the playbook pattern, still specific to the finding.
export function playbookPlan(x: PlanInput): SolutionPlanText {
  const c = x.card;
  const verb = x.classification === 'automate' ? 'Automate' : x.classification === 'fix' ? 'Fix' : x.classification === 'overhaul' ? 'Redesign' : 'Support';
  return {
    headline: `${verb} “${x.title.replace(/\.$/, '')}”${x.systems.length ? ` using ${x.systems.slice(0, 2).join(' and ')}` : ''}.`,
    whatWeBuild: c?.automationPatterns.length ? c.automationPatterns : [x.improvements[0] ?? 'A change agreed with the people who do the work.'],
    howItWorks: [...(c?.automationPatterns ?? []).map((p) => `${p}.`), 'Staff review anything that goes to a client before it is sent.'].slice(0, 6).concat(['The team uses it on new cases; we track the measures below.']).slice(0, 6),
    staysWithPeople: c?.humanApproval.length ? c.humanApproval.slice(0, 3) : ['Every message to a client and every change to a case record is approved by a person.'],
    before: [...x.causes.slice(0, 2), x.quotes[0] ? `“${x.quotes[0].quote}”` : `Reported by ${x.roles.join(', ')}.`].slice(0, 3),
    after: ['The repetitive part happens automatically or by a clear rule; the team only handles the exceptions.'],
    measures: c?.metrics.length ? c.metrics.slice(0, 3) : ['Time spent each week, measured before and after.'],
    needFromYou: [`Access to ${x.systems[0] ?? 'the system involved'} for set-up`, 'One hour with the person who does this work today'],
    build: playbookBuild(x),
  };
}

// Build details without the AI: plain and honest about what is confirmed on Day 1.
export function playbookBuild(x: PlanInput): BuildText {
  const c = x.card;
  const systems = x.systems.slice(0, 3);
  const approach = x.classification === 'fix'
    ? 'A configuration and process change in the systems you already have; nothing new is built or bought.'
    : x.classification === 'overhaul'
      ? 'A redesigned process agreed with the people involved, introduced alongside the old one; any repetitive steps left are then automated with rules and templates.'
      : 'Conventional automation: rules, schedules and approved templates prepare the work, and staff approve anything before it is sent or saved.';
  return {
    approach,
    components: c?.automationPatterns.length ? c.automationPatterns.slice(0, 4) : [x.improvements[0] ?? 'The change agreed with the people who do the work'],
    connections: systems.length ? systems.map((s) => `${s}: connection method confirmed on Day 1 (API, export or mailbox)`) : ['The systems involved are confirmed on Day 1'],
    aiRole: 'None: rules and templates only. AI is considered only where free text has to be read, and then staff review every output.',
    testing: ['Tested on sample cases with no real client data', 'Staff approve every draft during testing', 'Checked with the person who does this work before it goes live'],
  };
}
