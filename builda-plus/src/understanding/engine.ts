import type { LLMMessage, LLMProvider } from '../llm/provider';
import type { StageId } from '../domain/journey';
import { NextQuestionSchema } from '../domain/schemas';
import { flagEscalation, type EscalationReason } from '../guards/escalation';
import type { InterviewEvent, InterviewState, TurnOutcome } from '../interview/orchestrator';
import { rootOf, type KnGap, type KnowledgeSnapshot } from './core';
import { computeFacts } from './facts';
import { ingestTurn, type KnowledgeWrites } from './ingest';
import { gapKey, planNextMove, type Move } from './planner';
import { candidateNodes, ownFacts } from './context';
import { knowledgeInterpretPrompt, knowledgeQuestionPrompt, PROMPT_VERSION } from './prompts';
import { isStage, roleLabel, stageName, type DomainPack } from './pack';
import { CompactTurnSchema, expandTurn } from './schema';

// One interview turn on the knowledge engine (design sections 6-8). The orchestrator has already run the
// client-data and keyword guards and recorded the message; this interprets it into evidence and claims,
// updates the facts, lets the planner pick the next move, and has the AI word it.

export interface SessionKnowledge {
  gaps: Record<string, KnGap & { stage?: string | null }>;
  lastMove: (Pick<Move, 'type' | 'nodeId' | 'predicate' | 'stage'> & { key: string }) | null;
  lastFocusNode: string | null;
  plan: { turn: number; type: string; about: string | null; ask: string; score: number; reason: string }[];
  history?: { nodeId: string | null; unsure: boolean; predicate?: string; label?: string }[];
}
export interface KnowledgeContext {
  snapshot: KnowledgeSnapshot;
  pack: DomainPack;
  variationProbed: Set<string>;     // nodes where a variation probe has already been answered (any interview)
}
export interface GapWrite { subjectId: string; predicate: string; status: KnGap['status']; timesAsked: number }
export type KnowledgeOutcome = TurnOutcome & { knowledge?: KnowledgeWrites & { gaps: GapWrite[] } };

const RECENT = 4;
const recent = (t: LLMMessage[]) => t.slice(-RECENT);

export async function knowledgeTurn(
  s: InterviewState, text: string, turnIndex: number, events: InterviewEvent[],
  deps: { llm: LLMProvider; firmContext?: string | null; knowledge: KnowledgeContext; closingQuestion: string; completedMessage: string;
    escalate: (s: InterviewState, reason: EscalationReason, events: InterviewEvent[]) => TurnOutcome },
): Promise<KnowledgeOutcome> {
  const { pack } = deps.knowledge;
  const k: SessionKnowledge = s.knowledge ?? { gaps: {}, lastMove: null, lastFocusNode: null, plan: [] };
  s.knowledge = k;
  const roleText = roleLabel(pack, s.role);

  // 1. Interpret: mentions and quoted claims, with existing node labels to match against.
  const topic = k.lastMove ? `${k.lastMove.type.replace('_', ' ')}${k.lastMove.stage ? ` (${stageName(pack, k.lastMove.stage)})` : ''}` : 'which parts of the work they do';
  const { data: compact, usage } = await deps.llm.generateStructured({
    task: 'interview.interpret', schemaName: 'knowledge_turn', schema: CompactTurnSchema, effort: 'low',
    system: knowledgeInterpretPrompt(pack, { roleLabel: roleText, pseudonym: s.participantRef, topic,
      candidates: candidateNodes(deps.knowledge.snapshot, pack, { pseudonym: s.participantRef, stagesInScope: s.stagesInScope, focusNode: k.lastFocusNode }),
      stagesInScope: s.stagesInScope }),
    messages: recent(s.transcript), maxOutputTokens: 2500,
  });
  const parsed = expandTurn(compact);
  const flagged = flagEscalation(parsed.flags);
  if (flagged) return deps.escalate(s, flagged, events);

  // 2. Ingest: code verifies quotes, converts numbers, resolves nodes, applies corrections.
  const result = ingestTurn(parsed, text, deps.knowledge.snapshot, pack, {
    sessionId: s.sessionId, turnIndex, pseudonym: s.participantRef, role: s.role, interpretedBy: `ai:${usage.model}:${PROMPT_VERSION}`, focusStage: s.focusStage,
  });
  deps.knowledge.snapshot = result.snapshot;
  for (const e of result.projection) s.evidence.push(e);
  if (result.projection.length) events.push({ type: 'evidence_added', ids: result.projection.map((e) => e.id) });
  if (result.dropped) { s.droppedEvidenceCount += result.dropped; events.push({ type: 'evidence_dropped', count: result.dropped, reason: 'quote_not_found' }); }
  for (const id of result.touched) {
    const stage = result.snapshot.nodes.find((n) => n.id === id)?.stageRef;
    if (stage && stage in s.coverage) s.coverage[stage as StageId].evidenceCount += 1;
  }
  for (const stage of parsed.stagesConfirmedNotInvolved) if (isStage(pack, stage) && stage in s.coverage) s.coverage[stage as StageId].notInvolved = true;

  // 3. Close the gap the last question was about: answered, still open (vague), or "not sure" (never asked again).
  const gapWrites: GapWrite[] = [];
  const unsure = parsed.participantUnsure, vague = parsed.answerWasVague && !unsure;
  if (k.lastMove) {
    const g = k.gaps[k.lastMove.key];
    if (g) {
      g.status = unsure ? 'unsure' : vague ? 'asked' : 'answered';
      if (k.lastMove.nodeId) gapWrites.push({ subjectId: k.lastMove.nodeId, predicate: g.predicate, status: g.status, timesAsked: g.timesAsked });
      if (g.predicate === 'variation' && g.status === 'answered' && k.lastMove.nodeId) deps.knowledge.variationProbed.add(k.lastMove.nodeId);
    }
  }
  if (unsure && s.focusStage) s.coverage[s.focusStage].unsure = (s.coverage[s.focusStage].unsure ?? 0) + 1;
  k.history = k.history ?? [];
  if (unsure && k.history.length) k.history[k.history.length - 1]!.unsure = true;

  const writes = { ...result.writes, gaps: gapWrites };
  if (parsed.wantsToPause) {
    s.status = 'paused';
    events.push({ type: 'paused' });
    const reply = "No problem — your progress is saved. Use the same link whenever you're ready and we'll pick up where we left off.";
    s.transcript.push({ role: 'assistant', content: reply });
    return { state: s, reply, events, knowledge: writes };
  }

  // 4. Plan: the most useful next move, from what is now known.
  const snap = result.snapshot;
  const facts = computeFacts(snap, { variationProbed: deps.knowledge.variationProbed });
  const nodes = new Map(snap.nodes.map((n) => [n.id, n]));
  const notInvolved = new Set(Object.entries(s.coverage).filter(([, c]) => c.notInvolved).map(([id]) => id));
  const move = s.turnCount >= 40 ? null : planNextMove(snap, facts, pack, {
    pseudonym: s.participantRef, role: s.role, stagesInScope: s.stagesInScope, notInvolved,
    gaps: new Map(Object.entries(k.gaps)), lastFocusNode: k.lastFocusNode ? rootOf(nodes, k.lastFocusNode) : null,
    lastAnswerVague: vague, touched: result.touched, supersededThisTurn: result.superseded, turnCount: s.turnCount, history: k.history,
  });

  if (!move) {
    if (!s.closingAsked && s.turnCount >= 3 && s.turnCount < 40) {
      s.closingAsked = true;
      k.lastMove = null;
      s.transcript.push({ role: 'assistant', content: deps.closingQuestion });
      return { state: s, reply: deps.closingQuestion, events, knowledge: writes };
    }
    s.status = 'completed';
    events.push({ type: 'completed', reason: s.turnCount >= 40 ? 'turn_limit' : 'all_stages_covered' });
    s.transcript.push({ role: 'assistant', content: deps.completedMessage });
    return { state: s, reply: deps.completedMessage, events, knowledge: writes };
  }

  // 5. Word the move. The AI gets the move, this person's own facts about the node, a few playbook ideas.
  const key = move.nodeId ? gapKey(move.nodeId, move.predicate) : `stage:${move.stage}|open`;
  const gap = k.gaps[key] ?? { subjectId: move.nodeId ?? '', predicate: move.predicate, status: 'open', timesAsked: 0, stage: move.stage };
  gap.timesAsked += 1; gap.status = 'asked'; k.gaps[key] = gap;
  if (move.nodeId) gapWrites.push({ subjectId: move.nodeId, predicate: move.predicate, status: 'asked', timesAsked: gap.timesAsked });
  const node = move.nodeId ? nodes.get(move.nodeId) ?? null : null;
  const ideas = pack.problemPatterns.filter((c) => (node?.typeRef && c.id === node.typeRef) || (!node?.typeRef && c.stageId === (move.stage ?? '')))
    .flatMap((c) => c.interviewQuestions).slice(0, 3);
  const { data: q } = await deps.llm.generateStructured({
    task: 'interview.next_question', schemaName: 'next_question', schema: NextQuestionSchema, effort: 'low',
    system: knowledgeQuestionPrompt(pack, { roleLabel: roleText, move, nodeLabel: node?.label ?? null, ownFacts: ownFacts(snap, pack, s.participantRef, move.nodeId),
      ideas, firmContext: deps.firmContext, lastAnswerUnsure: unsure,
      recentOpenings: s.transcript.filter((m) => m.role === 'assistant').slice(-2).map((m) => m.content.split(/\s+/).slice(0, 4).join(' ')) }),
    messages: recent(s.transcript), maxOutputTokens: 1000,
  });

  const stage = move.stage && move.stage in s.coverage ? (move.stage as StageId) : s.focusStage;
  if (stage && stage !== s.focusStage) events.push({ type: 'focus_changed', stage });
  s.focusStage = stage;
  if (stage) s.coverage[stage].questionsAsked += 1;
  k.lastMove = { type: move.type, nodeId: move.nodeId, predicate: move.predicate, stage: move.stage, key };
  k.lastFocusNode = move.nodeId ?? k.lastFocusNode;
  k.history = [...k.history, { nodeId: move.nodeId, unsure: false, predicate: move.predicate, label: node?.label }].slice(-60);
  k.plan = [...k.plan, { turn: s.turnCount, type: move.type, about: node?.label ?? (move.stage ? stageName(pack, move.stage) : null), ask: move.ask, score: move.score, reason: move.reason }].slice(-60);
  s.transcript.push({ role: 'assistant', content: q.question });
  return { state: s, reply: q.question, events, knowledge: writes };
}
