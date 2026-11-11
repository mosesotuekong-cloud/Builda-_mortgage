import { PREDICATES, rootOf, type KnowledgeSnapshot, type Predicate } from './core';
import { computeFacts, type Fact } from './facts';
import { roleLabel, stageName, type DomainPack } from './pack';

// A read-only summary of what a discovery has understood, for JADA staff (phase 2). By role, never by
// person: supporters are counted, not named, and no quotes are shown here.
export interface NodeView {
  id: string; kind: string; label: string; stage: string | null; type: string | null; aliases: string[];
  facts: { about: string; status: Fact['status']; values: { value: string; scope: string | null; negated: boolean; people: number; roles: string[]; interpretation: boolean }[] }[];
}

export function knowledgeView(snap: KnowledgeSnapshot, pack: DomainPack, variationProbed: Set<string> = new Set()): { nodes: NodeView[]; counts: Record<string, number> } {
  const facts = computeFacts(snap, { variationProbed });
  const byNode = new Map<string, Fact[]>();
  for (const f of facts.values()) byNode.set(f.subjectId, [...(byNode.get(f.subjectId) ?? []), f]);
  const nodesById = new Map(snap.nodes.map((n) => [n.id, n]));
  const label = (key: string) => key.startsWith('node:') ? nodesById.get(key.slice(5))?.label ?? key : key.startsWith('ref:') ? roleLabel(pack, key.slice(4)) : key;
  const nodes = snap.nodes.filter((n) => !n.mergedInto).map((n): NodeView => ({
    id: n.id, kind: n.kind, label: n.label, stage: n.stageRef ? stageName(pack, n.stageRef) : null, type: n.typeRef, aliases: n.aliases,
    facts: (byNode.get(rootOf(nodesById, n.id)) ?? []).filter((f) => !['classified_as'].includes(f.predicate)).map((f) => ({
      about: PREDICATES[f.predicate as Predicate].label, status: f.status,
      values: f.values.map((v) => ({ value: v.key.startsWith('node:') || v.key.startsWith('ref:') ? label(v.key) : v.display, scope: v.scope,
        negated: v.polarity === 'negated', people: v.supporters.length, roles: v.roles.map((r) => roleLabel(pack, r)), interpretation: !v.stated })),
    })),
  }));
  const counts: Record<string, number> = {};
  for (const n of nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  for (const f of facts.values()) counts[`fact_${f.status}`] = (counts[`fact_${f.status}`] ?? 0) + 1;
  return { nodes, counts };
}
