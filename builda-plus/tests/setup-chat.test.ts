// Setup by chat: the AI suggests, code decides. Numbers only if the firm lead typed them; options only from
// the allowed lists; client details never reach the AI; nothing is saved by the chat itself.
import { describe, expect, it } from 'vitest';
import { applyTurn, SetupChatService, statedNumbers, ClientDetailsError, SETUP_SYSTEM, type SetupTurn } from '../src/firm/setupChat';
import { ScriptedProvider } from '../src/llm/mock';

const turn = (over: Partial<SetupTurn>): SetupTurn => ({ reply: 'How many applications a month?', updates: [], systems: [], skipped: [], ...over });

describe('setup by chat', () => {
  it('reads the numbers the firm lead typed, in digits or words', () => {
    const n = statedNumbers(['We have four advisers and 2 case managers', 'about 1,200 a year, so 100 a month', 'roughly 2.5 weeks']);
    for (const x of [4, 2, 1200, 100, 2.5]) expect(n.has(x)).toBe(true);
    expect(n.has(1)).toBe(false);            // "a" and "an" are not numbers
  });

  it('accepts only numbers that were typed, so the AI can never estimate one', () => {
    const r = applyTurn({}, turn({ updates: [
      { field: 'advisers', value: '4' }, { field: 'caseManagers', value: '2' },
      { field: 'monthlyApplications', value: '150' },          // never said
      { field: 'loadedHourlyCostGBP', value: '28' },           // never said: refused, whatever the AI thinks is typical
    ] }), ['We have four advisers and two case managers']);
    expect(r.draft).toEqual({ advisers: 4, caseManagers: 2 });
    expect(r.refused).toEqual(['monthlyApplications', 'loadedHourlyCostGBP']);
  });

  it('takes the hourly cost when the firm lead states it', () => {
    const r = applyTurn({}, turn({ updates: [{ field: 'loadedHourlyCostGBP', value: '£32.50' }] }), ['An administrator costs us about £32.50 an hour']);
    expect(r.draft.loadedHourlyCostGBP).toBe(32.5);
  });

  it('keeps options to the allowed lists and merges systems by name', () => {
    const r = applyTurn({ technology: [{ name: 'Acre', category: 'crm_mortgage', purpose: '', teams: [], notes: '' }] }, turn({
      updates: [{ field: 'authorisation', value: 'directly_authorised' }, { field: 'operatingModel', value: 'robots_do_it' },
        { field: 'businessFocus', value: 'buy_to_let, residential_purchase, yachts' }, { field: 'website', value: 'example.co.uk' }],
      systems: [{ name: 'acre', category: 'crm_mortgage', purpose: 'Case management' }, { name: 'Outlook', category: 'email_communication', purpose: 'Email' }],
    }), []);
    expect(r.draft).toMatchObject({ authorisation: 'directly_authorised', businessFocus: ['buy_to_let', 'residential_purchase'], website: 'https://example.co.uk' });
    expect(r.draft.operatingModel).toBeUndefined();
    expect(r.draft.technology!.map((t) => t.name)).toEqual(['acre', 'Outlook']);
  });

  it('runs a turn through the AI and returns the checked draft', async () => {
    const llm = new ScriptedProvider({ 'setup.chat': [turn({ updates: [{ field: 'advisers', value: '6' }, { field: 'administrators', value: '3' }] })] });
    const svc = new SetupChatService({ providerFor: () => llm });
    const r = await svc.turn({ orgId: 'o' }, 'd', { messages: [{ role: 'assistant', content: 'How many advisers?' }, { role: 'user', content: 'Six advisers, no admins' }], draft: {} });
    expect(r.draft).toEqual({ advisers: 6 });               // "3" was never said
    expect(r.reply).toMatch(/applications/);
    expect(llm.calls[0]!.system).toMatch(/Never suggest or estimate the hourly staff cost/);
  });

  it('remembers what was skipped, tells the AI, and clears it once answered', async () => {
    const llm = new ScriptedProvider({ 'setup.chat': [turn({ skipped: ['monthlyApplications', 'systems'] }), turn({ updates: [{ field: 'monthlyApplications', value: '90' }] })] });
    const svc = new SetupChatService({ providerFor: () => llm });
    const first = await svc.turn({ orgId: 'o' }, 'd', { messages: [{ role: 'user', content: 'not sure' }], draft: {} });
    expect(first.skipped).toEqual(['monthlyApplications', 'systems']);
    const second = await svc.turn({ orgId: 'o' }, 'd', { messages: [{ role: 'user', content: 'not sure' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'actually about 90 a month' }],
      draft: first.draft, skipped: first.skipped });
    expect(second.skipped).toEqual(['systems']);
    expect(second.draft.monthlyApplications).toBe(90);
    expect(String(llm.calls[1]!.messages.at(-1)!.content)).toMatch(/Left blank on purpose, don't ask again: monthlyApplications, systems/);
  });

  it('asks for an adviser’s hourly cost when there are no support staff, and not to re-ask', () => {
    expect(SETUP_SYSTEM).toMatch(/no administrators or case team, ask what an hour of an adviser's time costs/);
    expect(SETUP_SYSTEM).toMatch(/Never ask again about anything already in the profile or already skipped/);
  });

  it('takes other roles (counts only if typed) and notes', () => {
    const r = applyTurn({}, turn({ updates: [
      { field: 'otherRoles', value: 'Paraplanner: 1; Protection adviser: 2; Compliance officer: 3' },
      { field: 'notes', value: 'Two advisers work part-time. Moving CRM next spring.' },
    ] }), ['We also have a paraplanner, 1 of them, and two protection advisers']);
    expect(r.draft.otherRoles).toEqual([{ name: 'Paraplanner', count: 1 }, { name: 'Protection adviser', count: 2 }]);   // "3" was never said
    expect(r.draft.notes).toBe('Two advisers work part-time. Moving CRM next spring.');
  });

  it('keeps other roles from a draft sent back by the browser', async () => {
    const llm = new ScriptedProvider({ 'setup.chat': [turn({})] });
    const r = await new SetupChatService({ providerFor: () => llm }).turn({ orgId: 'o' }, 'd',
      { messages: [{ role: 'user', content: 'ok' }], draft: { otherRoles: [{ name: 'Paraplanner', count: 1 }], notes: 'Part-time staff' } });
    expect(r.draft).toEqual({ otherRoles: [{ name: 'Paraplanner', count: 1 }], notes: 'Part-time staff' });
  });

  it('stops a message with client details before it reaches the AI', async () => {
    const llm = new ScriptedProvider({});
    const svc = new SetupChatService({ providerFor: () => llm });
    await expect(svc.turn({ orgId: 'o' }, 'd', { messages: [{ role: 'user', content: 'Our client Mrs Henderson-Blake complained' }], draft: {} }))
      .rejects.toBeInstanceOf(ClientDetailsError);
    expect(llm.calls).toHaveLength(0);
  });

  it('re-checks a draft sent back by the browser', async () => {
    const llm = new ScriptedProvider({ 'setup.chat': [turn({})] });
    const svc = new SetupChatService({ providerFor: () => llm });
    const r = await svc.turn({ orgId: 'o' }, 'd', { messages: [{ role: 'user', content: 'ok' }], draft: { advisers: 5, authorisation: 'made_up', operatingModel: 'mixed', advisersX: 1 } });
    expect(r.draft).toEqual({ advisers: 5, operatingModel: 'mixed' });
  });
});
