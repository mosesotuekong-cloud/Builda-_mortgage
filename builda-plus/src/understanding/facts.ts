import { PREDICATES, normLabel, rootOf, type FactStatus, type KnClaim, type KnNode, type KnowledgeSnapshot, type MeasureValue, type Predicate } from './core';

// Layer 3 (design decision D3): facts are computed by code from active claims. Nothing here calls the AI,
// and nothing is stored: a fact is always recomputed, so a correction or a new account is reflected at once.

export interface FactValue {
  key: string;                 // comparable form of the value
  display: string;
  scope: string | null;
  polarity: 'asserted' | 'negated';
  supporters: string[];        // distinct pseudonyms
  roles: string[];
  stated: boolean;             // at least one claim states it in so many words
  claimIds: string[];
}
export interface Fact { subjectId: string; predicate: Predicate; status: FactStatus; values: FactValue[] }

export const factKey = (subjectId: string, predicate: string) => `${subjectId}|${predicate}`;
const scopeKey = (s: string | null) => (s ? normLabel(s) : '*');

function valueOf(c: KnClaim, nodes: Map<string, KnNode>): { key: string; display: string; measure: number | null } {
  if (c.objectNodeId) { const id = rootOf(nodes, c.objectNodeId); return { key: `node:${id}`, display: nodes.get(id)?.label ?? id, measure: null }; }
  if (c.objectRef) return { key: `ref:${c.objectRef}`, display: c.objectRef, measure: null };
  const v = c.objectValue as (Partial<MeasureValue> & { category?: string; text?: string | null }) | null;
  if (v && typeof v.normalised === 'number') return { key: `num:${v.normalised}`, display: v.raw ?? String(v.normalised), measure: v.normalised };
  if (v && typeof v.raw === 'string') return { key: `raw:${normLabel(v.raw)}`, display: v.raw, measure: null };
  if (v && v.category) return { key: `impact:${v.category}`, display: v.text ? `${v.category}: ${v.text}` : v.category, measure: null };
  if (v && v.text) return { key: `text:${normLabel(v.text)}`, display: v.text, measure: null };
  return { key: 'none', display: '', measure: null };
}

// Two measures agree when they are within a factor of two (the rule today's findDisagreements uses).
const close = (a: number, b: number) => Math.max(a, b) <= 2 * Math.min(a, b) || Math.abs(a - b) < 1e-9;

// variationProbed: nodes where someone has already been asked whether the difference is variation (D2).
export function computeFacts(snap: KnowledgeSnapshot, opts: { variationProbed?: Set<string> } = {}): Map<string, Fact> {
  const nodes = new Map(snap.nodes.map((n) => [n.id, n]));
  const groups = new Map<string, KnClaim[]>();
  for (const c of snap.claims) {
    if (c.status !== 'active' || c.predicate === 'confirms' || c.predicate === 'possibly_same_as') continue;
    const k = factKey(rootOf(nodes, c.subjectId), c.predicate);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const confirmed = new Set(snap.claims.filter((c) => c.status === 'active' && c.predicate === 'confirms')
    .map((c) => factKey(rootOf(nodes, c.subjectId), (c.objectValue as { text: string } | null)?.text ?? '')));

  const facts = new Map<string, Fact>();
  for (const [k, claims] of groups) {
    const [subjectId, predicate] = k.split('|') as [string, Predicate];
    // Group into values. Measures cluster when they are close; everything else by exact value.
    const values: (FactValue & { measure: number | null })[] = [];
    for (const c of claims) {
      const v = valueOf(c, nodes);
      const found = values.find((x) => x.scope === (c.scope ?? null) && x.polarity === c.polarity
        && (x.key === v.key || (x.measure !== null && v.measure !== null && close(x.measure, v.measure))));
      const target = found ?? (() => { const nv = { key: v.key, display: v.display, scope: c.scope ?? null, polarity: c.polarity, supporters: [] as string[], roles: [] as string[], stated: false, claimIds: [] as string[], measure: v.measure }; values.push(nv); return nv; })();
      if (c.pseudonym && !target.supporters.includes(c.pseudonym)) target.supporters.push(c.pseudonym);
      if (c.roleRef && !target.roles.includes(c.roleRef)) target.roles.push(c.roleRef);
      target.stated ||= c.stated;
      target.claimIds.push(c.id);
    }
    const def = PREDICATES[predicate];
    let status: FactStatus;
    // A difference: the same value asserted and negated, or (single facts) two values in the same scope.
    // Only different people's accounts can disagree: one person's two figures in one answer ("40 a month,
    // about 10 a week") are their own wording, not a difference between accounts.
    const otherPeople = (a: FactValue, b: FactValue) => a.supporters.some((p) => !b.supporters.includes(p)) || b.supporters.some((p) => !a.supporters.includes(p));
    const sameScopeConflict = values.some((a) => values.some((b) => a !== b && scopeKey(a.scope) === scopeKey(b.scope) && otherPeople(a, b)
      && ((a.key === b.key && a.polarity !== b.polarity) || (def.cardinality === 'single' && a.polarity === 'asserted' && b.polarity === 'asserted'))));
    const scopes = new Set(values.map((v) => scopeKey(v.scope)));
    if (sameScopeConflict) status = opts.variationProbed?.has(subjectId) ? 'contradicted' : 'unexplained_difference';
    else if (def.cardinality === 'single' && values.length > 1 && scopes.size > 1) status = 'varies';
    else if (confirmed.has(k)) status = 'confirmed';
    else if (values.every((v) => !v.stated)) status = 'inferred_only';
    else if (values.some((v) => v.supporters.length >= 2)) status = 'corroborated';
    else status = 'observed';
    facts.set(k, { subjectId, predicate, status, values: values.map(({ measure: _m, ...v }) => v) });
  }
  return facts;
}

export const factStatus = (facts: Map<string, Fact>, subjectId: string, predicate: string): FactStatus =>
  facts.get(factKey(subjectId, predicate))?.status ?? 'unknown';
