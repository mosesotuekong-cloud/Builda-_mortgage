import { describe, expect, it } from 'vitest';
import { firmContextBrief, parseProfile } from '../src/interview/firmContext';
import { questionPrompt } from '../src/interview/prompts';
import { SEED_PLAYBOOK, cardsForStage } from '../src/knowledge/playbook';
import { STAGES, ROLES } from '../src/domain/journey';

// The interviewer gets the firm's context (from the profile) and a fuller mortgage playbook.
const profile = parseProfile({
  advisers: 4, monthlyApplications: 60, typicalWeeksEnquiryToOffer: 5,
  businessStructure: 'One office; four advisers hand cases to a shared case team.',
  staffRoles: [{ role: 'case_manager', count: 2 }, { role: 'administrator', count: 1 }], systems: [],
  authorisation: 'directly_authorised', operationalChallenges: 'Chasing documents and updating solicitors.', loadedHourlyCostGBP: 22,
  website: 'https://harbourlane.example', location: 'Bristol', businessFocus: ['residential_purchase', 'buy_to_let'], operatingModel: 'advisers_with_case_managers',
  technology: [{ name: 'Example CRM', category: 'crm_mortgage', purpose: 'Client records and case notes', teams: ['advisers'], notes: 'secret note' }],
});

describe('firm context for the interviewer', () => {
  const brief = firmContextBrief(profile)!;

  it('describes the firm in a few plain lines, using its own system names', () => {
    expect(brief).toContain('4 mortgage advisers, 2 case managers, 1 administrator');
    expect(brief).toContain('About 60 mortgage applications a month');
    expect(brief).toContain('Main business: residential purchase, buy-to-let');
    expect(brief).toContain('advisers supported by dedicated case managers');
    expect(brief).toContain('Example CRM (CRM / mortgage platform): Client records and case notes');
  });

  it('leaves out what it doesn’t need: website, location, hourly cost and system notes', () => {
    expect(brief).not.toMatch(/harbourlane|Bristol|22|secret note/);
  });

  it('marks the firm lead’s own view as private', () => {
    expect(brief).toMatch(/PRIVATE: never mention, quote or hint at this\): Chasing documents and updating solicitors\./);
  });

  it('has nothing to say when there is no profile yet', () => {
    expect(parseProfile({})).toBeNull();
    expect(parseProfile(null)).toBeNull();
    expect(firmContextBrief(null)).toBeNull();
  });

  it('reaches the question prompt, with the rules about using it', () => {
    const p = questionPrompt({ role: 'adviser', focusStage: 'documents', reason: 'continue', cards: [], alreadyKnown: [], firmContext: brief });
    expect(p).toContain('About this firm');
    expect(p).toContain('Example CRM');
    expect(p).toMatch(/never suggest a problem the participant hasn't raised/);
    expect(questionPrompt({ role: 'adviser', focusStage: 'documents', reason: 'continue', cards: [], alreadyKnown: [] })).not.toContain('About this firm');
  });
});

describe('mortgage playbook', () => {
  it('has 15 cards with unique ids, real stages and real roles', () => {
    expect(SEED_PLAYBOOK.cards).toHaveLength(15);
    const ids = SEED_PLAYBOOK.cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of SEED_PLAYBOOK.cards) {
      expect(STAGES[c.stageId], c.id).toBeDefined();
      for (const r of c.roles) expect(ROLES, c.id).toContain(r);
      expect(c.interviewQuestions.length, c.id).toBeGreaterThan(0);
    }
  });

  it('every card at a regulated stage states its limits and keeps the advice with people', () => {
    for (const c of SEED_PLAYBOOK.cards.filter((x) => STAGES[x.stageId].regulatedJudgement)) {
      expect(c.regulatoryLimits.length, c.id).toBeGreaterThan(0);
      expect(c.humanApproval.length, c.id).toBeGreaterThan(0);
    }
  });

  it('now gives the interviewer questions for most stages', () => {
    const covered = Object.keys(STAGES).filter((s) => cardsForStage(SEED_PLAYBOOK, s as never).length > 0);
    expect(covered.length).toBeGreaterThanOrEqual(12);
  });
});
