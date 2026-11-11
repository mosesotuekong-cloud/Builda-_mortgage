import { randomUUID } from 'node:crypto';
import { DEFAULT_STAGES_BY_ROLE, STAGE_IDS, type Role, type StageId } from '../domain/journey';
import { NextQuestionSchema, TurnInterpretationSchema, type EvidenceDraft, type VerifiedEvidence } from '../domain/schemas';
import type { LLMMessage, LLMProvider } from '../llm/provider';
import { scanForClientData } from '../guards/clientData';
import { ESCALATION_MESSAGES, flagEscalation, keywordEscalation, type EscalationReason } from '../guards/escalation';
import { cardsForStage, type Playbook } from '../knowledge/playbook';
import { OPENING_MESSAGE, interpretPrompt, questionPrompt } from './prompts';
import { knowledgeTurn, type KnowledgeContext, type SessionKnowledge, type KnowledgeOutcome } from '../understanding/engine';

// The orchestrator is a state machine. Code decides what happens next;
// the LLM only interprets answers and words questions (brief §3.5, §8.2).

export type SessionStatus = 'in_progress' | 'paused' | 'completed' | 'escalated';
// unsure: how many times they said they didn't know something on this stage (older sessions don't have it).
export interface StageCoverage { evidenceCount: number; questionsAsked: number; notInvolved: boolean; unsure?: number }

export interface InterviewState {
  sessionId: string;
  discoveryId: string;
  participantRef: string; // pseudonym such as "P3" — the participant's name never reaches the LLM
  role: Role;
  stagesInScope: StageId[];
  coverage: Record<StageId, StageCoverage>;
  transcript: LLMMessage[];
  evidence: VerifiedEvidence[];
  status: SessionStatus;
  focusStage: StageId | null;
  turnCount: number;
  droppedEvidenceCount: number;
  escalation: { reason: EscalationReason } | null;
  // Follow-up mode (milestone 5): code-written questions from cross-role comparison.
  mode?: 'main' | 'follow_up';
  followUpQueue?: FollowUpItem[];
  currentFollowUp?: FollowUpItem | null;
  // Set once the open "anything else?" question has been asked, just before finishing.
  closingAsked?: boolean;
  // Knowledge engine only: gaps asked in this interview, the last move and the planner's log.
  knowledge?: SessionKnowledge;
}

export interface FollowUpItem { id: string; painPointKey: string; stageId: StageId; question: string }

export type InterviewEvent =
  | { type: 'client_data_blocked'; kinds: string[]; severity: 'definite' | 'possible' }
  | { type: 'evidence_added'; ids: string[] }
  | { type: 'evidence_dropped'; count: number; reason: 'quote_not_found' }
  | { type: 'escalated'; reason: EscalationReason }
  | { type: 'focus_changed'; stage: StageId }
  | { type: 'paused' } | { type: 'resumed' } | { type: 'completed'; reason: 'all_stages_covered' | 'turn_limit' };

export interface TurnOutcome { state: InterviewState; reply: string; events: InterviewEvent[] }
export const COMPLETED_MESSAGE = "That's everything I needed — thank you. Your answers will be combined with others' by role, and the firm lead will review the findings before any recommendations are made.";

export const CLOSING_QUESTION = "Before we finish: is there anything else that slows your work down, or that you'd change if you could, that we haven't talked about?";
export const LIMITS = { maxTurns: 40, maxQuestionsPerStage: 3, evidenceToCoverStage: 2, contextMessages: 8 };
const WORKING_DAYS_PER_MONTH = 21;

export function startInterview(p: { discoveryId: string; participantRef: string; role: Role; stagesInScope?: StageId[] }): { state: InterviewState; reply: string } {
  const coverage = Object.fromEntries(STAGE_IDS.map((s) => [s, { evidenceCount: 0, questionsAsked: 0, notInvolved: false }])) as Record<StageId, StageCoverage>;
  const state: InterviewState = {
    sessionId: randomUUID(), discoveryId: p.discoveryId, participantRef: p.participantRef, role: p.role,
    stagesInScope: p.stagesInScope ?? DEFAULT_STAGES_BY_ROLE[p.role], coverage,
    transcript: [{ role: 'assistant', content: OPENING_MESSAGE }], evidence: [],
    status: 'in_progress', focusStage: null, turnCount: 0, droppedEvidenceCount: 0, escalation: null,
  };
  return { state, reply: OPENING_MESSAGE };
}

export function startFollowUp(p: { discoveryId: string; participantRef: string; role: Role; items: FollowUpItem[] }): { state: InterviewState; reply: string } {
  if (p.items.length === 0) throw new Error('No follow-up questions');
  const { state } = startInterview({ discoveryId: p.discoveryId, participantRef: p.participantRef, role: p.role, stagesInScope: [] });
  const [first, ...rest] = p.items;
  const intro = `Thanks again for your earlier interview. After comparing answers across the team, there ${p.items.length === 1 ? 'is one short question' : `are ${p.items.length} short questions`} where a little more detail would help. As before, please leave out client names and case details.`;
  const reply = `${intro}\n\n${first!.question}`;
  state.mode = 'follow_up';
  state.followUpQueue = rest;
  state.currentFollowUp = first!;
  state.focusStage = first!.stageId;
  state.transcript = [{ role: 'assistant', content: reply }];
  return { state, reply };
}

export async function handleParticipantMessage(
  prev: InterviewState, text: string, deps: { llm: LLMProvider; playbook: Playbook; firmContext?: string | null; knowledge?: KnowledgeContext },
): Promise<KnowledgeOutcome> {
  const s = structuredClone(prev);
  const events: InterviewEvent[] = [];
  if (s.status === 'completed' || s.status === 'escalated') throw new Error(`Session is ${s.status}`);
  if (s.status === 'paused') { s.status = 'in_progress'; events.push({ type: 'resumed' }); }

  // 1. Client-data guard runs before anything is sent to the model.
  const scan = scanForClientData(text);
  if (scan.definite) {
    s.transcript.push({ role: 'user', content: scan.redacted });
    events.push({ type: 'client_data_blocked', kinds: scan.findings.map((f) => f.kind), severity: 'definite' });
    return escalate(s, 'client_information', events);
  }
  if (scan.possible) {
    s.transcript.push({ role: 'user', content: scan.redacted });
    events.push({ type: 'client_data_blocked', kinds: scan.findings.map((f) => f.kind), severity: 'possible' });
    const reply = "Your message may include something that identifies a client or case (such as a postcode, account number or date). Could you say that again without those details? Approximate, general descriptions are perfect.";
    s.transcript.push({ role: 'assistant', content: reply });
    return { state: s, reply, events };
  }
  const kw = keywordEscalation(text);
  if (kw) { s.transcript.push({ role: 'user', content: text }); return escalate(s, kw, events); }

  s.transcript.push({ role: 'user', content: text });
  s.turnCount += 1;
  const turnIndex = s.transcript.length - 1;

  // Knowledge engine (design: knowledge-driven interviewing). Same guards above; follow-up sessions stay
  // on the code-written questions below.
  if (deps.knowledge && s.mode !== 'follow_up') {
    return knowledgeTurn(s, text, turnIndex, events, { llm: deps.llm, firmContext: deps.firmContext, knowledge: deps.knowledge,
      closingQuestion: CLOSING_QUESTION, completedMessage: COMPLETED_MESSAGE, escalate });
  }

  // 2. Interpret the answer.
  const { data: interp } = await deps.llm.generateStructured({
    task: 'interview.interpret',
    schemaName: 'turn_interpretation',
    schema: TurnInterpretationSchema,
    system: interpretPrompt({ role: s.role, participantRef: s.participantRef, focusStage: s.focusStage, playbookKeys: deps.playbook.cards.map((c) => c.id), followUpKey: s.currentFollowUp?.painPointKey }),
    messages: recentContext(s.transcript),
  });

  const flagged = flagEscalation(interp.flags);
  if (flagged) return escalate(s, flagged, events);

  // 3. Keep only evidence whose quote really appears in what the participant wrote.
  const added: string[] = [];
  let dropped = 0;
  for (const draft of interp.evidence) {
    if (!quoteAppearsIn(draft.supportingQuote, text)) { dropped++; continue; }
    const ev = normaliseEvidence(draft, { sessionId: s.sessionId, participantRef: s.participantRef, turnIndex });
    // In follow-up mode the topic is known, so code assigns the key rather than trusting the model.
    if (s.currentFollowUp && ev.stageId === s.currentFollowUp.stageId) ev.painPointKey = s.currentFollowUp.painPointKey;
    s.evidence.push(ev);
    s.coverage[ev.stageId].evidenceCount += 1;
    added.push(ev.id);
  }
  if (added.length) events.push({ type: 'evidence_added', ids: added });
  if (dropped) { s.droppedEvidenceCount += dropped; events.push({ type: 'evidence_dropped', count: dropped, reason: 'quote_not_found' }); }
  for (const stage of interp.stagesConfirmedNotInvolved) s.coverage[stage].notInvolved = true;
  const unsure = !!interp.participantUnsure;
  if (unsure && s.focusStage) s.coverage[s.focusStage].unsure = (s.coverage[s.focusStage].unsure ?? 0) + 1;

  if (interp.wantsToPause) {
    s.status = 'paused';
    events.push({ type: 'paused' });
    const reply = "No problem — your progress is saved. Use the same link whenever you're ready and we'll pick up where we left off.";
    s.transcript.push({ role: 'assistant', content: reply });
    return { state: s, reply, events };
  }

  // 4a. Follow-up mode: next queued question, written by code, no model call.
  if (s.mode === 'follow_up') {
    const nextItem = s.followUpQueue?.shift() ?? null;
    s.currentFollowUp = nextItem;
    if (!nextItem) {
      s.status = 'completed';
      events.push({ type: 'completed', reason: 'all_stages_covered' });
      const reply = 'Thank you — that clears it up. Your answers will be combined with the rest of the team’s by role.';
      s.transcript.push({ role: 'assistant', content: reply });
      return { state: s, reply, events };
    }
    s.focusStage = nextItem.stageId;
    s.transcript.push({ role: 'assistant', content: nextItem.question });
    return { state: s, reply: nextItem.question, events };
  }

  // 4. Code decides where the interview goes next.
  const next = s.turnCount >= LIMITS.maxTurns ? null : chooseFocus(s, interp.answerWasVague && !unsure);
  // Before finishing, one open question, so people can raise what the stages didn't cover.
  // (Their answer is interpreted like any other; if it opens a topic in scope, the interview follows it.)
  if (!next && !s.closingAsked && s.turnCount < LIMITS.maxTurns && s.turnCount >= 3) {
    s.closingAsked = true;
    const reply = CLOSING_QUESTION;
    s.transcript.push({ role: 'assistant', content: reply });
    return { state: s, reply, events };
  }
  if (!next) {
    s.status = 'completed';
    events.push({ type: 'completed', reason: s.turnCount >= LIMITS.maxTurns ? 'turn_limit' : 'all_stages_covered' });
    const reply = COMPLETED_MESSAGE;
    s.transcript.push({ role: 'assistant', content: reply });
    return { state: s, reply, events };
  }
  if (next.stage !== s.focusStage) events.push({ type: 'focus_changed', stage: next.stage });
  s.focusStage = next.stage;

  // 5. The model words the question; it does not choose the topic.
  const { data: q } = await deps.llm.generateStructured({
    task: 'interview.next_question',
    schemaName: 'next_question',
    schema: NextQuestionSchema,
    system: questionPrompt({
      role: s.role, focusStage: next.stage, reason: next.reason,
      cards: cardsForStage(deps.playbook, next.stage),
      alreadyKnown: s.evidence.filter((e) => e.stageId === next.stage).map((e) => e.taskDescription),
      firmContext: deps.firmContext ?? null,
      ...stageGaps(s, next.stage),
      lastAnswerUnsure: unsure && next.stage === prev.focusStage,
    }),
    messages: recentContext(s.transcript),
    maxOutputTokens: 1000,
  });
  s.coverage[next.stage].questionsAsked += 1;
  s.transcript.push({ role: 'assistant', content: q.question });
  return { state: s, reply: q.question, events };
}

export function pauseInterview(prev: InterviewState): InterviewState {
  if (prev.status !== 'in_progress') return prev;
  return { ...structuredClone(prev), status: 'paused' };
}

function escalate(s: InterviewState, reason: EscalationReason, events: InterviewEvent[]): TurnOutcome {
  s.status = 'escalated';
  s.escalation = { reason };
  events.push({ type: 'escalated', reason });
  const reply = ESCALATION_MESSAGES[reason];
  s.transcript.push({ role: 'assistant', content: reply });
  return { state: s, reply, events };
}

const isProblem = (e: VerifiedEvidence) => !!(e.operationalImpact || e.reportedCause);

// What is still missing on a stage. A problem someone raised isn't understood until we know roughly how
// often it happens and how long it takes, so the interviewer stays on it (unless they've said they don't know).
export function stageGaps(s: InterviewState, stage: StageId): { stillUnknown: string[]; raisedProblems: string[] } {
  const ev = s.evidence.filter((e) => e.stageId === stage);
  const problems = ev.filter(isProblem);
  const stillUnknown: string[] = [];
  if (!ev.length) stillUnknown.push('what they do here and what, if anything, gets in the way');
  if (ev.length && !problems.length && !ev.some((e) => e.monthlyVolume !== null || e.minutesPerOccurrence !== null)) stillUnknown.push('roughly how often it happens or how long it takes');
  if (problems.length) {
    if (!ev.some((e) => e.monthlyVolume !== null)) stillUnknown.push('roughly how often it happens');
    if (!ev.some((e) => e.minutesPerOccurrence !== null)) stillUnknown.push('roughly how long it takes each time');
    if (!problems.some((e) => e.reportedCause)) stillUnknown.push('why it happens');
    if (!problems.some((e) => e.potentialImprovement)) stillUnknown.push('what would make it easier');
  }
  return { stillUnknown, raisedProblems: [...new Set(problems.map((e) => e.taskDescription))].slice(0, 3) };
}

function needsWork(s: InterviewState, stage: StageId): boolean {
  const c = s.coverage[stage];
  if (c.notInvolved || c.questionsAsked >= LIMITS.maxQuestionsPerStage) return false;
  const ev = s.evidence.filter((e) => e.stageId === stage);
  const hasVolume = ev.some((e) => e.monthlyVolume !== null), hasTime = ev.some((e) => e.minutesPerOccurrence !== null);
  // A passing mention in another answer doesn't cover a stage, unless it already gave the figures.
  if (c.questionsAsked === 0 && !(hasVolume && hasTime)) return true;
  if (c.evidenceCount < LIMITS.evidenceToCoverStage) return true;
  if (c.unsure) return false;   // they've told us what they can; don't press
  if (ev.some(isProblem)) return !hasVolume || !hasTime;
  return !hasVolume && !hasTime && c.questionsAsked < 2;   // no figure at all yet: one more try
}

// Stay on the current topic while it needs work. When moving on, go first to a stage where they've already
// raised a problem we haven't explored (following their thread, like a person would), then in journey order.
export function chooseFocus(s: InterviewState, answerWasVague: boolean): { stage: StageId; reason: 'continue' | 'follow_up' | 'new_stage' } | null {
  if (s.focusStage && needsWork(s, s.focusStage)) {
    return { stage: s.focusStage, reason: answerWasVague ? 'follow_up' : 'continue' };
  }
  const open = STAGE_IDS.filter((id) => s.stagesInScope.includes(id) && needsWork(s, id));
  const raised = open.find((id) => s.evidence.some((e) => e.stageId === id && isProblem(e)));
  const nextStage = raised ?? open[0];
  return nextStage ? { stage: nextStage, reason: 'new_stage' } : null;
}

function recentContext(t: LLMMessage[]): LLMMessage[] {
  return t.slice(-LIMITS.contextMessages);
}

export { quoteAppearsIn } from './quotes';
import { quoteAppearsIn } from './quotes';

export function normaliseEvidence(d: EvidenceDraft, meta: { sessionId: string; participantRef: string; turnIndex: number }): VerifiedEvidence {
  const assumptions: string[] = [];
  let monthlyVolume: number | null = null;
  if (d.volume) {
    const { value, per } = d.volume;
    if (per === 'day') { monthlyVolume = value * WORKING_DAYS_PER_MONTH; assumptions.push(`Assumed ${WORKING_DAYS_PER_MONTH} working days per month to convert a daily figure`); }
    else if (per === 'week') monthlyVolume = (value * 52) / 12;
    else if (per === 'year') monthlyVolume = value / 12;
    else monthlyVolume = value;
    monthlyVolume = Math.round(monthlyVolume * 10) / 10;
  }
  const minutesPerOccurrence = d.timePerOccurrence
    ? d.timePerOccurrence.unit === 'hours' ? d.timePerOccurrence.value * 60 : d.timePerOccurrence.value
    : null;
  return {
    id: randomUUID(), sessionId: meta.sessionId, participantRef: meta.participantRef, turnIndex: meta.turnIndex,
    source: 'firm_said',
    painPointKey: d.painPointKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    stageId: d.stageId, taskDescription: d.taskDescription, responsibleRole: d.responsibleRole,
    monthlyVolume, minutesPerOccurrence, peopleInvolved: d.peopleInvolved, systems: d.systems,
    operationalImpact: d.operationalImpact, reportedCause: d.reportedCause, potentialImprovement: d.potentialImprovement,
    supportingQuote: d.supportingQuote, outstandingQuestions: d.outstandingQuestions, conversionAssumptions: assumptions,
  };
}
