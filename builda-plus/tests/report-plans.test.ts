import { describe, expect, it } from 'vitest';
import { playbookPlan, systemsInPlan, timelineFor, writePlan, type PlanInput } from '../src/report/plans';
import { ScriptedProvider } from '../src/llm/mock';
import { SEED_PLAYBOOK } from '../src/knowledge/playbook';

// Each top opportunity gets a concrete plan: what we build, how, before/after, how we measure it, and a
// day-by-day timeline that is JADA's fixed offer per kind of change.
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  title: 'Manual chasing of outstanding client documents', stage: 'Documents', classification: 'automate', regulated: false,
  roles: ['Case manager'], causes: ['No checklist is sent at the start'], improvements: [], quotes: [{ role: 'Case manager', quote: 'I chase by email every day' }],
  monthlyVolume: 40, minutesEach: 20, hoursRecovered: null, systems: ['Example CRM (synthetic)', 'Outlook'],
  card: SEED_PLAYBOOK.cards.find((c) => c.id === 'document_chasing') ?? null, ...over,
});

describe('timeline offer', () => {
  it('automate is live in 3 working days, a fix in 2, an overhaul starts in 3', () => {
    expect(timelineFor('automate', ['Outlook'])!.headline).toBe('Live in 3 working days');
    expect(timelineFor('automate', ['Outlook'])!.steps.map((s) => s.when)).toEqual(['Day 1', 'Day 2', 'Day 3']);
    expect(timelineFor('automate', ['Outlook'])!.steps[0]!.what).toContain('Outlook');
    expect(timelineFor('fix', [])!.headline).toBe('In place in 2 working days');
    expect(timelineFor('fix', [])!.steps[1]!.what).toContain('your existing systems');
    expect(timelineFor('overhaul', [])!.headline).toMatch(/3 days/);
    expect(timelineFor('keep_human', [])).toBeNull();
  });
  it('names only the systems the plan itself uses', () => {
    const plan = { ...playbookPlan(input()), build: { ...playbookPlan(input()).build, connections: ['Outlook: shared mailbox'] }, headline: 'Reminders for outstanding documents.', whatWeBuild: ['A checklist and reminder drafts'], howItWorks: ['Reminders are prepared in Outlook for staff approval.', 'Staff send them.'], needFromYou: ['An hour with the case manager'] };
    expect(systemsInPlan(plan, ['Example CRM (synthetic)', 'Outlook', 'Lender portals'])).toEqual(['Outlook']);
  });
});

describe('plan writing', () => {
  it('the AI is given the firm’s own evidence and systems, and told not to invent figures', async () => {
    const plan = { headline: 'Staff-approved reminders for outstanding documents, sent from Outlook.', whatWeBuild: ['A checklist and reminder drafts'],
      howItWorks: ['The case manager approves the checklist', 'Reminders are drafted for approval'], staysWithPeople: ['Approving every message'],
      before: ['Chasing by email every day'], after: ['Reminders drafted automatically'], measures: ['Chasing time a week'], needFromYou: ['Access to Outlook'],
      build: { approach: 'Rules and templates, no AI: a scheduled job drafts reminders from the checklist.', components: ['Checklist template', 'Reminder drafts'],
        connections: ['Outlook: connection method confirmed on Day 1 (API, export or mailbox)'], aiRole: 'None: rules and templates only.', testing: ['Sample cases with no real client data'] } };
    const llm = new ScriptedProvider({ 'report.plan': [plan] });
    expect(await writePlan(llm, input())).toEqual(plan);
    const sent = String(llm.calls[0]!.messages[0]!.content);
    expect(sent).toContain('about 40 a month');
    expect(sent).toContain('Outlook');
    expect(sent).toContain('I chase by email every day');
    expect(llm.calls[0]!.system).toMatch(/Never invent a number/);
    expect(llm.calls[0]!.system).toMatch(/a person approves/);
    // How we build it: honest about connections, and says plainly where AI is (or isn't) used.
    expect(llm.calls[0]!.system).toMatch(/Never claim a system has an API/);
    expect(llm.calls[0]!.system).toMatch(/aiRole/);
  });
  it('without the AI, a plainer plan comes from the playbook pattern', () => {
    const p = playbookPlan(input());
    expect(p.whatWeBuild.length).toBeGreaterThan(0);
    expect(p.staysWithPeople.join(' ')).toMatch(/approve/i);
    expect(p.needFromYou.join(' ')).toContain('Example CRM');
    expect(p.build.approach).toMatch(/Conventional automation/);
    expect(p.build.connections).toEqual(['Example CRM (synthetic): connection method confirmed on Day 1 (API, export or mailbox)', 'Outlook: connection method confirmed on Day 1 (API, export or mailbox)']);
    expect(p.build.aiRole).toMatch(/^None/);
    expect(playbookPlan(input({ classification: 'fix' })).build.approach).toMatch(/nothing new is built or bought/);
  });
});
