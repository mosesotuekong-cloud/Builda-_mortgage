import { describe, expect, it } from 'vitest';
import { startInterview, handleParticipantMessage, chooseFocus, stageGaps, CLOSING_QUESTION, type InterviewState } from '../src/interview/orchestrator';
import { questionPrompt } from '../src/interview/prompts';
import { ScriptedProvider } from '../src/llm/mock';
import { SEED_PLAYBOOK } from '../src/knowledge/playbook';
import type { VerifiedEvidence } from '../src/domain/schemas';
import type { StageId } from '../src/domain/journey';

// The interviewer should feel like a conversation, not a form: follow what the person raised, accept
// "not sure", ask one thing at a time, and end with an open "anything else?".
const noFlags = { clientInformation: false, complaintOrCompliance: false, employmentIssue: false, adviceRequest: false, outOfScope: false };
const interp = (over: Record<string, unknown> = {}) => ({ evidence: [], stagesConfirmedNotInvolved: [], flags: noFlags, wantsToPause: false, answerWasVague: false, participantUnsure: false, ...over });
let n = 0;
const ev = (stageId: string, over: Partial<VerifiedEvidence> = {}): VerifiedEvidence => ({
  id: `e${n++}`, sessionId: 's', participantRef: 'P1', turnIndex: 1, source: 'firm_said', painPointKey: 'k', stageId: stageId as never, taskDescription: `Task at ${stageId}`,
  responsibleRole: 'case_manager', monthlyVolume: null, minutesPerOccurrence: null, peopleInvolved: null, systems: [], operationalImpact: null, reportedCause: null,
  potentialImprovement: null, supportingQuote: 'q', outstandingQuestions: [], conversionAssumptions: [], ...over,
});
const caseManager = (): InterviewState => startInterview({ discoveryId: 'd', participantRef: 'P1', role: 'case_manager' }).state;
const asked = (s: InterviewState, stage: StageId, k = 1) => { s.coverage[stage].questionsAsked = k; };

describe('where the interview goes next', () => {
  it('follows a problem the person already raised before going back to journey order', () => {
    const s = caseManager();
    s.evidence.push(ev('full_application', { taskDescription: 'Filling gaps in adviser handovers', reportedCause: 'no handover template' }));
    s.coverage.full_application.evidenceCount = 1;
    expect(chooseFocus(s, false)).toEqual({ stage: 'full_application', reason: 'new_stage' });
  });

  it('a passing mention doesn’t cover a stage, unless it already gave the figures', () => {
    const s = caseManager();
    for (const st of ['disclosure_id', 'documents', 'dip'] as const) s.coverage[st].notInvolved = true;
    s.evidence.push(ev('full_application'), ev('full_application'));
    s.coverage.full_application.evidenceCount = 2;
    expect(chooseFocus(s, false)?.stage).toBe('full_application');
    s.evidence.push(ev('full_application', { monthlyVolume: 40, minutesPerOccurrence: 45 }));
    expect(chooseFocus(s, false)?.stage).not.toBe('full_application');
  });

  it('stays on a raised problem until it has figures, but stops pressing once they say they don’t know', () => {
    const s = caseManager();
    s.focusStage = 'documents'; asked(s, 'documents');
    s.evidence.push(ev('documents', { operationalImpact: 'cases stall' }), ev('documents'));
    s.coverage.documents.evidenceCount = 2;
    expect(chooseFocus(s, false)).toEqual({ stage: 'documents', reason: 'continue' });
    s.coverage.documents.unsure = 1;
    expect(chooseFocus(s, false)?.stage).not.toBe('documents');
  });

  it('tells the interviewer what is still unknown about a raised problem', () => {
    const s = caseManager();
    s.evidence.push(ev('documents', { taskDescription: 'Chasing clients for documents', operationalImpact: 'cases stall', minutesPerOccurrence: 20 }));
    const g = stageGaps(s, 'documents');
    expect(g.raisedProblems).toEqual(['Chasing clients for documents']);
    expect(g.stillUnknown).toContain('roughly how often it happens');
    expect(g.stillUnknown).not.toContain('roughly how long it takes each time');
    expect(g.stillUnknown).toContain('why it happens');
  });
});

describe('how the interviewer talks', () => {
  it('asks for one thing, without announcing stages, and accepts "not sure"', () => {
    const p = questionPrompt({ role: 'case_manager', focusStage: 'documents', reason: 'new_stage', cards: [], alreadyKnown: [], lastAnswerUnsure: true,
      raisedProblems: ['Chasing clients for documents'], stillUnknown: ['roughly how often it happens'] });
    expect(p).toMatch(/exactly ONE question/);
    expect(p).toMatch(/never announce it like "Let's move on to X"/);
    expect(p).toMatch(/do NOT ask for the same thing again/);
    expect(p).toContain('Problems they have already raised on this topic (explore these before anything new): Chasing clients for documents.');
    expect(p).toContain('Still to find out on this topic (pick the one that follows most naturally): roughly how often it happens.');
  });

  it('when they say they don’t know, it stays on topic but is told not to ask again', async () => {
    const llm = new ScriptedProvider({
      'interview.interpret': [interp({ participantUnsure: true, answerWasVague: true })],
      'interview.next_question': [{ question: 'That’s fine. How do you find out a client has sent something?' }],
    });
    const s = caseManager(); s.focusStage = 'documents'; s.turnCount = 2;
    const out = await handleParticipantMessage(s, 'I am not sure', { llm, playbook: SEED_PLAYBOOK });
    expect(out.state.coverage.documents.unsure).toBe(1);
    expect(llm.calls[1]!.system).toMatch(/do NOT ask for the same thing again/);
    expect(llm.calls[1]!.system).not.toMatch(/too general to use/);   // not treated as vague: no pressing
  });

  it('ends with one open "anything else?" question, then finishes', async () => {
    const llm = new ScriptedProvider({ 'interview.interpret': [interp(), interp()] });
    const s = caseManager(); s.stagesInScope = []; s.turnCount = 5;
    const first = await handleParticipantMessage(s, 'That is all for that part.', { llm, playbook: SEED_PLAYBOOK });
    expect(first.reply).toBe(CLOSING_QUESTION);
    expect(first.state.status).toBe('in_progress');
    const last = await handleParticipantMessage(first.state, 'No, nothing else.', { llm, playbook: SEED_PLAYBOOK });
    expect(last.state.status).toBe('completed');
  });
});
