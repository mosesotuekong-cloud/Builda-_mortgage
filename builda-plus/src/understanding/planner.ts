import { PREDICATES, rootOf, type KnClaim, type KnGap, type KnNode, type KnowledgeSnapshot, type Predicate } from './core';
import { factKey, type Fact } from './facts';
import type { DomainPack } from './pack';

// The question planner (design section 6). Pure code: it lists every move the accumulated knowledge
// suggests, scores each, and returns the best one with its reason. The AI only words the chosen move.

export type MoveType = 'probe_variation' | 'clarify_conflict' | 'example_request' | 'investigate_problem' | 'explore_handoff' | 'explore_activity' | 'fill_gap' | 'confirm_inference' | 'open_area';
export type GapPredicate = Predicate | 'cause' | 'variation' | 'clarify' | 'example' | 'open' | 'explore';
export interface Move { type: MoveType; nodeId: string | null; stage: string | null; predicate: GapPredicate; score: number; reason: string; ask: string }

export interface PlannerSession {
  pseudonym: string;
  role: string;
  stagesInScope: string[];
  notInvolved: Set<string>;
  gaps: Map<string, KnGap>;          // key: `${nodeId}|${predicate}` (or `stage:<id>|open`)
  lastFocusNode: string | null;
  lastAnswerVague: boolean;
  touched: string[];                 // nodes the last answer was about
  supersededThisTurn: string[];      // claims this person just corrected
  turnCount: number;
  turnBudget?: number;
  // What has been asked in this interview, in order, and whether they said "not sure". Used for the topic
  // budget: a good interviewer moves on from a thread that has been explored, or that they can't answer.
  history?: { nodeId: string | null; unsure: boolean; predicate?: string; label?: string }[];
}

// Rough word overlap of two labels, to catch the same thing asked about under two slightly different names.
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
export function similar(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

export const THRESHOLD = 0.3;
const VALUE: Record<MoveType, number> = {
  clarify_conflict: 1.0, probe_variation: 1.0, investigate_problem: 0.9, explore_handoff: 0.8, explore_activity: 0.75, example_request: 0.7, fill_gap: 0.6, confirm_inference: 0.5, open_area: 0.4,
};
export const gapKey = (nodeId: string, predicate: GapPredicate) => `${nodeId}|${predicate}`;

export function planNextMove(snap: KnowledgeSnapshot, facts: Map<string, Fact>, pack: DomainPack, s: PlannerSession): Move | null {
  const nodes = new Map(snap.nodes.map((n) => [n.id, n]));
  const live = snap.nodes.filter((n) => !n.mergedInto);
  const active = snap.claims.filter((c) => c.status === 'active');
  const root = (id: string) => rootOf(nodes, id);
  const about = (id: string) => active.filter((c) => root(c.subjectId) === id);
  const has = (id: string, p: Predicate) => (facts.get(factKey(id, p))?.values.some((v) => v.polarity === 'asserted') ?? false);
  const mineIds = new Set(active.filter((c) => c.pseudonym === s.pseudonym).flatMap((c) => [root(c.subjectId), ...(c.objectNodeId ? [root(c.objectNodeId)] : [])]));
  const performers = (id: string) => (facts.get(factKey(id, 'performed_by'))?.values ?? []).filter((v) => v.polarity === 'asserted').map((v) => v.key.replace(/^ref:/, ''));
  // Work they said they don't do ("I don't do fact finds") is never treated as theirs.
  const notMine = (id: string) => (facts.get(factKey(id, 'performed_by'))?.values ?? []).some((v) => v.polarity === 'negated' && v.key === `ref:${s.role}`);
  const iDo = (id: string) => !notMine(id) && (performers(id).includes(s.role) || (mineIds.has(id) && performers(id).length === 0));
  const stageOf = (n: KnNode): string | null => n.stageRef
    ?? (n.kind === 'problem' ? about(n.id).filter((c) => c.predicate === 'affects').map((c) => nodes.get(root(c.objectNodeId!))?.stageRef).find(Boolean) ?? null : null);
  const inScope = (stage: string | null) => !stage || (s.stagesInScope.includes(stage) && !s.notInvolved.has(stage));

  // How relevant a node is to THIS person: their own work counts most; other roles' work they only
  // reported is a boundary, not a gap in the firm.
  const relevance = (n: KnNode): number => {
    const stage = stageOf(n);
    if (stage && s.notInvolved.has(stage)) return 0;
    if (n.kind === 'activity' && notMine(n.id)) return 0;
    if (n.kind === 'activity') {
      if (iDo(n.id)) return 1;
      if (performers(n.id).length && !performers(n.id).includes(s.role)) return mineIds.has(n.id) ? 0.3 : 0;
    }
    if (mineIds.has(n.id)) return 1;
    return inScope(stage) ? 0.5 : 0;
  };
  const answerable = (key: string) => {
    const g = s.gaps.get(key);
    if (!g) return 1;
    if (g.status === 'unsure' || g.status === 'answered') return 0;
    return g.timesAsked >= 2 ? 0 : g.timesAsked === 1 ? 0.5 : 1;
  };
  const near = (id: string | null) => (id && (id === s.lastFocusNode || s.touched.includes(id)) ? 0.2 : 0);
  const pressure = Math.max(0, s.turnCount - (s.turnBudget ?? 18)) * 0.05;

  // A topic = an activity together with the problems that affect it and their causes. Asking about one
  // keeps counting against the same topic, so a raised problem can't swallow the whole interview.
  const topicOf = (id: string): string => {
    let cur = root(id);
    for (let i = 0; i < 6; i++) {
      const n = nodes.get(cur);
      if (!n || n.kind !== 'problem') break;
      const effect = active.find((c) => c.predicate === 'contributes_to' && root(c.subjectId) === cur && c.objectNodeId);
      if (effect) { cur = root(effect.objectNodeId!); continue; }
      const affected = active.find((c) => c.predicate === 'affects' && root(c.subjectId) === cur && c.objectNodeId);
      if (affected) cur = root(affected.objectNodeId!);
      break;
    }
    return cur;
  };
  const topicStats = new Map<string, { asks: number; unsure: number }>();
  for (const h of s.history ?? []) {
    if (!h.nodeId || !nodes.get(h.nodeId)) continue;
    const t = topicOf(h.nodeId), st = topicStats.get(t) ?? { asks: 0, unsure: 0 };
    st.asks += 1; if (h.unsure) st.unsure += 1; topicStats.set(t, st);
  }
  const saturation = (id: string) => {
    const st = topicStats.get(topicOf(id));
    if (!st) return 1;
    const byAsks = st.asks <= 2 ? 1 : st.asks === 3 ? 0.45 : st.asks === 4 ? 0.2 : 0.05;
    return byAsks * (st.unsure >= 2 ? 0.25 : st.unsure === 1 ? 0.6 : 1);
  };
  const isCause = (id: string) => active.some((c) => c.predicate === 'contributes_to' && root(c.subjectId) === id && c.objectNodeId);

  const moves: Move[] = [];
  const push = (type: MoveType, n: KnNode | null, predicate: GapPredicate, weight: number, reason: string, ask: string) => {
    const key = n ? gapKey(n.id, predicate) : `stage:${predicate}`;
    const rel = n ? relevance(n) : 1;
    // Never the same kind of question about something with a near-identical name.
    if (n && (s.history ?? []).some((h) => h.predicate === predicate && h.label && h.nodeId !== n.id && similar(h.label, n.label))) return;
    const sat = n && type !== 'clarify_conflict' && type !== 'probe_variation' ? saturation(n.id) : 1;
    const score = VALUE[type] * weight * rel * answerable(key) * sat + (sat === 1 ? near(n?.id ?? null) : 0) - pressure;
    if (score > 0) moves.push({ type, nodeId: n?.id ?? null, stage: n ? stageOf(n) : null, predicate, score: Math.round(score * 100) / 100, reason, ask });
  };

  for (const n of live) {
    // Differences first: never resolved silently, always asked about neutrally.
    for (const p of Object.keys(PREDICATES) as Predicate[]) {
      const f = facts.get(factKey(n.id, p));
      if (!f) continue;
      if (f.status === 'unexplained_difference' && f.values.some((v) => v.supporters.includes(s.pseudonym) || iDo(n.id)))
        push('probe_variation', n, 'variation', 1, `accounts of ${PREDICATES[p].label} for "${n.label}" differ, with nothing yet explaining why`,
          `whether ${PREDICATES[p].label} for "${n.label}" differs from case to case, or between people`);
      if (f.status === 'contradicted' && f.values.some((v) => v.supporters.includes(s.pseudonym)))
        push('clarify_conflict', n, 'clarify', 1, `accounts of ${PREDICATES[p].label} for "${n.label}" still conflict`, `${PREDICATES[p].label} for "${n.label}", neutrally, to get it right`);
    }
  }
  // Their own correction this turn: one light check that we have it right now.
  for (const id of s.supersededThisTurn) {
    const c = snap.claims.find((x) => x.id === id);
    const n = c ? nodes.get(root(c.subjectId)) : null;
    const target = c?.supersededBy ? snap.claims.find((x) => x.id === c.supersededBy) : null;
    const tn = target ? nodes.get(root(target.subjectId)) ?? n : n;
    if (tn && c) push('clarify_conflict', tn, 'clarify', 1, `they corrected their own account of ${PREDICATES[c.predicate].label} for "${tn.label}"`,
      `${PREDICATES[c.predicate].label} for "${tn.label}" as it is now, to be sure it's right`);
  }
  // A vague answer: ask for a concrete example rather than repeating the question.
  if (s.lastAnswerVague && s.lastFocusNode && nodes.get(s.lastFocusNode)) {
    const n = nodes.get(root(s.lastFocusNode))!;
    push('example_request', n, 'example', 1, `the last answer about "${n.label}" was too general`, `a concrete example: the last time "${n.label}" happened, what happened`);
  }

  for (const n of live) {
    const rel = relevance(n);
    if (!rel) continue;
    if (n.kind === 'problem') {
      const claimsOn = about(n.id);
      const people = new Set(claimsOn.map((c) => c.pseudonym)).size;
      const sig = 1 + (has(n.id, 'frequency') || has(n.id, 'duration') ? 0.2 : 0) + (people >= 2 ? 0.2 : 0) + (n.typeRef ? 0.1 : 0);
      const causeKnown = active.some((c) => c.predicate === 'contributes_to' && c.objectNodeId && root(c.objectNodeId) === n.id);
      // A cause of another problem is part of that problem's story, not a new thread to investigate.
      const cause = isCause(n.id);
      const steps: [GapPredicate, number, boolean, string][] = cause ? [
        ['improvement_idea', 0.6, has(n.id, 'improvement_idea'), `what would help with "${n.label}"`],
      ] : [
        ['affects', 0.6, has(n.id, 'affects'), `which part of the work "${n.label}" holds up`],
        ['impact', 0.95, has(n.id, 'impact'), `what happens as a result of "${n.label}": delay, rework, chasing again`],
        ['cause', 0.95, causeKnown, `why "${n.label}" happens, in their own words`],
        ['frequency', 0.9, has(n.id, 'frequency'), `roughly how often "${n.label}" happens`],
        ['duration', 0.85, has(n.id, 'duration') || has(n.id, 'delay'), `roughly how much time "${n.label}" costs each time`],
        ['improvement_idea', 0.6, has(n.id, 'improvement_idea'), `what would make "${n.label}" easier`],
      ];
      for (const [p, w, known, ask] of steps) if (!known) push('investigate_problem', n, p, w * sig, `"${n.label}" was raised; ${p === 'cause' ? 'its cause' : PREDICATES[p as Predicate]?.label ?? p} is unknown`, ask);
    }
    if (n.kind === 'activity' && iDo(n.id)) {
      const fine = has(n.id, 'works_well');
      // Handoffs into or out of their work (derived wherever the performing role changes).
      for (const c of active.filter((x) => x.predicate === 'followed_by' && x.objectNodeId)) {
        const from = root(c.subjectId), to = root(c.objectNodeId!);
        if (to === n.id && performers(from).some((r) => r !== s.role) && !has(n.id, 'needs'))
          push('explore_handoff', n, 'needs', 1, `"${n.label}" starts from work handed over by another role; what arrives is unknown`, `what they need to have from the previous step before they can start "${n.label}"`);
        if (from === n.id && performers(to).some((r) => r !== s.role) && !has(n.id, 'produces'))
          push('explore_handoff', n, 'produces', 0.9, `"${n.label}" hands work to another role; what goes with it is unknown`, `what they pass on when "${n.label}" is done`);
      }
      // Figures matter most for work a problem affects, or that has come up more than once; a passing
      // mention of a minor step is not worth a figure.
      const matters = active.some((c) => c.predicate === 'affects' && c.objectNodeId && root(c.objectNodeId) === n.id) || about(n.id).length >= 3;
      const fig = fine ? 0.5 : matters ? 1 : 0.55;
      // First, an open question about how this work goes: that is where problems surface. Systems and
      // figures come after.
      const known = active.some((c) => (c.predicate === 'affects' && c.objectNodeId && root(c.objectNodeId) === n.id) || (c.predicate === 'works_well' && root(c.subjectId) === n.id));
      if (!known) push('explore_activity', n, 'explore', 1, `"${n.label}" is their work; how it goes is unknown`, `how "${n.label}" usually goes for them, and what, if anything, gets in the way`);
      const gaps: [Predicate, number, string][] = [
        ['uses', 0.7, `which system they use for "${n.label}"`],
        ['followed_by', 0.9, `what happens after "${n.label}"`],
        ['frequency', fig, `roughly how often they do "${n.label}"`],
        ['duration', fig, `roughly how long "${n.label}" takes each time`],
        ['needs', 0.8, `what they need before they can do "${n.label}"`],
      ];
      for (const [p, w, ask] of gaps) if (!has(n.id, p)) push('fill_gap', n, p, w, `"${n.label}" is their work; ${PREDICATES[p].label} is unknown`, ask);
    }
    for (const p of ['performed_by', 'affects'] as Predicate[]) {
      if (facts.get(factKey(n.id, p))?.status === 'inferred_only')
        push('confirm_inference', n, p, 1, `${PREDICATES[p].label} for "${n.label}" is only inferred`, `whether ${PREDICATES[p].label} for "${n.label}" is as we understood it`);
    }
  }
  // Stages in their scope they haven't talked about yet.
  for (const stage of s.stagesInScope) {
    if (s.notInvolved.has(stage)) continue;
    const touchedStage = live.some((n) => mineIds.has(n.id) && stageOf(n) === stage);
    if (touchedStage) continue;
    const key = `stage:${stage}`;
    const g = s.gaps.get(`${key}|open`);
    const ans = !g ? 1 : g.status === 'unsure' || g.status === 'answered' || g.timesAsked >= 1 ? 0 : 1;
    const name = pack.stages.find((x) => x.id === stage)?.name ?? stage;
    const score = VALUE.open_area * ans - pressure;
    if (score > 0) moves.push({ type: 'open_area', nodeId: null, stage, predicate: 'open', score: Math.round(score * 100) / 100, reason: `nothing yet from them about ${name}`, ask: `what they do around ${name}, and what gets in the way` });
  }

  moves.sort((a, b) => b.score - a.score || (a.nodeId === s.lastFocusNode ? -1 : 0));
  const best = moves[0];
  return best && best.score >= THRESHOLD ? best : null;
}

// For tests and the JADA view: the full ranked list.
export function rankMoves(snap: KnowledgeSnapshot, facts: Map<string, Fact>, pack: DomainPack, s: PlannerSession, n = 5): Move[] {
  const out: Move[] = [];
  const gaps = new Map(s.gaps);
  for (let i = 0; i < n; i++) {
    const m = planNextMove(snap, facts, pack, { ...s, gaps });
    if (!m) break;
    out.push(m);
    gaps.set(m.nodeId ? gapKey(m.nodeId, m.predicate) : `stage:${m.stage}|open`, { subjectId: m.nodeId ?? '', predicate: m.predicate, status: 'answered', timesAsked: 1 });
  }
  return out;
}

export type { KnClaim };
