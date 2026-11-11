import { PREDICATES, rootOf, type KnClaim, type KnNode, type KnowledgeSnapshot, type MeasureValue } from './core';
import { roleLabel, stageName, type DomainPack } from './pack';

// Context assembly (design section 8): each AI call gets a small, task-specific slice, assembled here.
// The rule that matters most: other participants' words never reach a prompt. The interpreter sees node
// LABELS (so it can match "the CRM" to the same system), never anyone's quotes; the question writer sees
// only what THIS participant said.

export const MAX_CANDIDATES = 40;

export function candidateNodes(snap: KnowledgeSnapshot, pack: DomainPack, p: { pseudonym: string; stagesInScope: string[]; focusNode: string | null }): string[] {
  const nodes = new Map(snap.nodes.map((n) => [n.id, n]));
  const mine = new Set(snap.claims.filter((c) => c.pseudonym === p.pseudonym && c.status === 'active').map((c) => rootOf(nodes, c.subjectId)));
  const live = snap.nodes.filter((n) => !n.mergedInto);
  const score = (n: KnNode) => (n.id === p.focusNode ? 4 : 0) + (mine.has(n.id) ? 3 : 0) + (n.stageRef && p.stagesInScope.includes(n.stageRef) ? 2 : 0)
    + (n.kind === 'system' || n.kind === 'information' ? 1 : 0);
  return live.sort((a, b) => score(b) - score(a)).slice(0, MAX_CANDIDATES)
    .map((n) => `${n.id} | ${n.kind} | ${n.label}${n.stageRef ? ` | ${stageName(pack, n.stageRef)}` : ''}${n.aliases.length ? ` | also called: ${n.aliases.slice(0, 3).join(', ')}` : ''}`);
}

function describe(c: KnClaim, nodes: Map<string, KnNode>, pack: DomainPack): string {
  const subject = nodes.get(rootOf(nodes, c.subjectId))?.label ?? '?';
  const def = PREDICATES[c.predicate];
  const v = c.objectValue as (Partial<MeasureValue> & { category?: string; text?: string | null }) | null;
  const object = c.objectNodeId ? nodes.get(rootOf(nodes, c.objectNodeId))?.label
    : c.objectRef ? (def.object === 'role' ? roleLabel(pack, c.objectRef) : pack.parties.find((x) => x.id === c.objectRef)?.label ?? c.objectRef)
    : v?.raw ?? (v?.category ? `${v.category}${v.text ? ` (${v.text})` : ''}` : v?.text) ?? '';
  return `- ${subject}: ${def.label} = ${c.polarity === 'negated' ? 'NOT ' : ''}${object}${c.scope ? ` (when: ${c.scope})` : ''}${c.stated ? '' : ' [our interpretation]'}`;
}

// What this participant has told us about the focus node and its neighbours (one hop). Their own words only.
export function ownFacts(snap: KnowledgeSnapshot, pack: DomainPack, pseudonym: string, focusNode: string | null, limit = 12): string[] {
  if (!focusNode) return [];
  const nodes = new Map(snap.nodes.map((n) => [n.id, n]));
  const focus = rootOf(nodes, focusNode);
  return snap.claims
    .filter((c) => c.status === 'active' && c.pseudonym === pseudonym && !['classified_as', 'possibly_same_as', 'confirms'].includes(c.predicate)
      && (rootOf(nodes, c.subjectId) === focus || (c.objectNodeId && rootOf(nodes, c.objectNodeId) === focus)))
    .slice(-limit).map((c) => describe(c, nodes, pack));
}
