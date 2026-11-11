import { randomUUID } from 'node:crypto';
import { quoteAppearsIn } from '../interview/quotes';
import type { Role, StageId } from '../domain/journey';
import type { VerifiedEvidence } from '../domain/schemas';
import {
  PREDICATES, normLabel, rootOf, type KnClaim, type KnEvidence, type KnNode, type KnowledgeSnapshot, type MeasureValue, type NodeKind, type Predicate,
} from './core';
import { isParty, isRole, isStage, typeById, type DomainPack } from './pack';
import type { ClaimDraft, KnowledgeTurn, MentionDraft } from './schema';

// Turns one interpreted answer into knowledge (design sections 5 and 7). The AI suggested the mentions,
// matches and claims; this code decides: quotes must be real, numbers are converted here, a mention joins
// an existing node only when the rules allow (D1), a person's own correction supersedes their earlier
// claim, and nothing already stored is edited.

export interface TurnMeta { sessionId: string; turnIndex: number; pseudonym: string; role: Role; interpretedBy: string; focusStage: StageId | null }
export interface KnowledgeWrites {
  nodes: KnNode[];
  nodeUpdates: { id: string; aliases?: string[]; mergedInto?: string }[];
  evidence: KnEvidence[];
  claims: KnClaim[];
  supersede: { id: string; by: string }[];
}
export interface IngestResult {
  writes: KnowledgeWrites;
  snapshot: KnowledgeSnapshot;     // the snapshot with this turn applied
  touched: string[];               // node ids this answer was about
  superseded: string[];            // claims this person corrected this turn
  dropped: number;                 // claims dropped (quote not found, wrong shape)
  projection: VerifiedEvidence[];  // problem rows for the existing analysis (evidence_records)
}

const WORKING_DAYS_PER_MONTH = 21;
const MEASURES: Predicate[] = ['frequency', 'duration', 'delay'];

export function normaliseMeasure(predicate: Predicate, v: NonNullable<ClaimDraft['value']>): MeasureValue {
  const base = { raw: v.raw, number: v.number, unit: v.unit ?? v.per };
  if (v.number === null) return { ...base, normalised: null, normalisedUnit: null };
  if (predicate === 'frequency') {
    const per = v.per ?? 'month';
    const monthly = per === 'day' ? v.number * WORKING_DAYS_PER_MONTH : per === 'week' ? (v.number * 52) / 12 : per === 'year' ? v.number / 12 : v.number;
    return { ...base, normalised: Math.round(monthly * 10) / 10, normalisedUnit: 'per_month', ...(per === 'day' ? { assumption: `Assumed ${WORKING_DAYS_PER_MONTH} working days per month` } : {}) };
  }
  if (predicate === 'duration') {
    const mins = v.unit === 'hours' ? v.number * 60 : v.unit === 'days' ? v.number * 60 * 8 : v.unit === 'weeks' ? v.number * 60 * 40 : v.number;
    return { ...base, normalised: mins, normalisedUnit: 'minutes', ...(v.unit === 'days' || v.unit === 'weeks' ? { assumption: 'Assumed an 8-hour working day' } : {}) };
  }
  const days = v.unit === 'hours' ? v.number / 24 : v.unit === 'weeks' ? v.number * 7 : v.unit === 'minutes' ? v.number / 1440 : v.number;
  return { ...base, normalised: Math.round(days * 100) / 100, normalisedUnit: 'days' };
}

const slug = (s: string) => normLabel(s).replace(/ /g, '_').slice(0, 48) || 'item';

export function ingestTurn(parsed: KnowledgeTurn, text: string, snap: KnowledgeSnapshot, pack: DomainPack, meta: TurnMeta,
  newId: () => string = randomUUID): IngestResult {
  const nodes = new Map(snap.nodes.map((n) => [n.id, { ...n }]));
  const claims = snap.claims.map((c) => ({ ...c }));
  const writes: KnowledgeWrites = { nodes: [], nodeUpdates: [], evidence: [], claims: [], supersede: [] };
  const now = new Date().toISOString();
  let dropped = 0;

  const activeRoots = (kind: NodeKind) => [...nodes.values()].filter((n) => n.kind === kind && !n.mergedInto);
  const performersOf = (id: string) => new Set(claims.filter((c) => c.status === 'active' && c.predicate === 'performed_by' && c.polarity === 'asserted'
    && rootOf(nodes, c.subjectId) === id && c.objectRef).map((c) => c.objectRef!));
  // Roles this answer says perform each mention (used to keep different people's work apart, D1).
  const turnPerformers = (ref: string) => new Set(parsed.claims.filter((c) => c.subject === ref && c.predicate === 'performed_by' && !c.negated && isRole(pack, c.objectRef)).map((c) => c.objectRef!));

  const addClaim = (c: Omit<KnClaim, 'id' | 'status' | 'supersededBy' | 'createdAt'>): KnClaim => {
    const full: KnClaim = { ...c, id: newId(), status: 'active', supersededBy: null, createdAt: now };
    claims.push(full); writes.claims.push(full); return full;
  };
  const evidenceFor = new Map<string, KnEvidence>();
  const evidence = (quote: string): KnEvidence => {
    const k = normLabel(quote);
    const hit = evidenceFor.get(k);
    if (hit) return hit;
    const e: KnEvidence = { id: newId(), sessionId: meta.sessionId, turnIndex: meta.turnIndex, pseudonym: meta.pseudonym, roleRef: meta.role, source: 'firm_said', quote: quote.trim().slice(0, 2000) };
    evidenceFor.set(k, e); writes.evidence.push(e); return e;
  };

  // ---------- 1. Resolve mentions to nodes
  const nodeFor = new Map<string, string>();
  const possiblySame: [string, string][] = [];
  const compatible = (existing: KnNode, m: MentionDraft) => {
    if (existing.kind === 'activity') {
      if (existing.stageRef && isStage(pack, m.stage) && m.stage !== existing.stageRef) return false;
      const mine = turnPerformers(m.ref), theirs = performersOf(existing.id);
      if (mine.size && theirs.size && ![...mine].some((r) => theirs.has(r))) return false;   // different people's work
    }
    return true;
  };
  for (const m of parsed.mentions) {
    const label = m.label.trim();
    if (!label) continue;
    const pool = activeRoots(m.kind);
    const type = m.typeRef && typeById(pack, m.typeRef) ? m.typeRef : (m.kind === 'problem' && pack.problemPatterns.some((p) => p.id === m.typeRef) ? m.typeRef : null);
    const byAi = m.match && nodes.get(m.match) && nodes.get(m.match)!.kind === m.kind ? nodes.get(rootOf(nodes, m.match))! : null;
    const byLabel = pool.find((n) => normLabel(n.label) === normLabel(label) || n.aliases.some((a) => normLabel(a) === normLabel(m.words)));
    const byType = type && (m.kind === 'activity' || m.kind === 'information')
      ? pool.find((n) => n.typeRef === type && (!n.stageRef || !isStage(pack, m.stage) || n.stageRef === m.stage)) : undefined;
    const candidate = byAi ?? byLabel ?? byType ?? null;
    if (candidate && compatible(candidate, m)) {
      nodeFor.set(m.ref, candidate.id);
      const alias = m.words.trim();
      if (alias && normLabel(alias) !== normLabel(candidate.label) && !candidate.aliases.some((a) => normLabel(a) === normLabel(alias)) && alias.length <= 120) {
        candidate.aliases = [...candidate.aliases, alias];
        writes.nodeUpdates.push({ id: candidate.id, aliases: candidate.aliases });
      }
      continue;
    }
    const stage = isStage(pack, m.stage) ? m.stage : (typeById(pack, type)?.stage ?? null);
    const node: KnNode = { id: newId(), kind: m.kind, label: label.slice(0, 200), aliases: [], stageRef: stage, typeRef: type, typeVersion: type ? pack.version : null, partOf: null, mergedInto: null };
    nodes.set(node.id, node); writes.nodes.push(node); nodeFor.set(m.ref, node.id);
    if (candidate) possiblySame.push([node.id, candidate.id]);
    if (type) addClaim({ subjectId: node.id, predicate: 'classified_as', objectNodeId: null, objectRef: type, objectValue: null, scope: null, polarity: 'asserted',
      stated: false, inferenceNote: `matched to the ${pack.name} pack type`, interpretedBy: meta.interpretedBy, evidenceIds: [], pseudonym: meta.pseudonym, roleRef: meta.role });
  }
  for (const [a, b] of possiblySame) addClaim({ subjectId: a, predicate: 'possibly_same_as', objectNodeId: b, objectRef: null, objectValue: null, scope: null, polarity: 'asserted',
    stated: false, inferenceNote: 'similar, but described with a different performer or stage', interpretedBy: 'rule:resolver', evidenceIds: [], pseudonym: meta.pseudonym, roleRef: meta.role });

  // ---------- 2. Claims: shape, quote, numbers
  const touched = new Set<string>();
  const added: KnClaim[] = [];
  for (const d of parsed.claims) {
    const def = PREDICATES[d.predicate as Predicate];
    const subjectId = nodeFor.get(d.subject);
    const subject = subjectId ? nodes.get(subjectId) : null;
    if (!def || !subject || !(def.subject as readonly string[]).includes(subject.kind) || !quoteAppearsIn(d.quote, text)) { dropped++; continue; }
    let objectNodeId: string | null = null, objectRef: string | null = null, objectValue: KnClaim['objectValue'] = null;
    if (def.object === 'node') {
      const o = d.objectMention ? nodeFor.get(d.objectMention) : null;
      const okKinds = 'objectKinds' in def ? (def.objectKinds as readonly string[]) : null;
      if (!o || (okKinds && !okKinds.includes(nodes.get(o)!.kind)) || o === subjectId) { dropped++; continue; }
      objectNodeId = o;
    } else if (def.object === 'role') { if (!isRole(pack, d.objectRef)) { dropped++; continue; } objectRef = d.objectRef; }
    else if (def.object === 'party') { if (!isParty(pack, d.objectRef)) { dropped++; continue; } objectRef = d.objectRef; }
    else if (def.object === 'value') { if (!d.value || !d.value.raw.trim()) { dropped++; continue; } objectValue = normaliseMeasure(d.predicate as Predicate, d.value); }
    else if (def.object === 'impact') { if (!d.impactCategory) { dropped++; continue; } objectValue = { category: d.impactCategory, text: d.text?.trim() || null }; }
    else if (def.object === 'text') { const t = (d.text ?? d.quote).trim(); if (!t) { dropped++; continue; } objectValue = { text: t.slice(0, 500) }; }
    const ev = evidence(d.quote);
    const c = addClaim({ subjectId: subjectId!, predicate: d.predicate as Predicate, objectNodeId, objectRef, objectValue,
      scope: d.scope?.trim() || null, polarity: d.negated ? 'negated' : 'asserted', stated: d.stated, inferenceNote: d.stated ? null : (d.note?.trim() || 'interpretation'),
      interpretedBy: meta.interpretedBy, evidenceIds: [ev.id], pseudonym: meta.pseudonym, roleRef: meta.role });
    added.push(c); touched.add(subjectId!); if (objectNodeId) touched.add(objectNodeId);
  }

  // ---------- 3. A person's own correction supersedes their earlier claim (never someone else's)
  const superseded: string[] = [];
  const supersede = (old: KnClaim, by: KnClaim) => { old.status = 'superseded'; old.supersededBy = by.id; writes.supersede.push({ id: old.id, by: by.id }); superseded.push(old.id); };
  for (const c of added) {
    if (PREDICATES[c.predicate].cardinality !== 'single' || c.polarity !== 'asserted') continue;
    const root = rootOf(nodes, c.subjectId);
    const sameScope = (x: KnClaim) => normLabel(x.scope ?? '') === normLabel(c.scope ?? '');
    const valueKey = (x: KnClaim) => x.objectRef ?? x.objectNodeId ?? JSON.stringify((x.objectValue as MeasureValue | null)?.normalised ?? x.objectValue);
    for (const old of claims) {
      if (old === c || old.status !== 'active' || old.pseudonym !== c.pseudonym || old.predicate !== c.predicate || !sameScope(old)) continue;
      if (rootOf(nodes, old.subjectId) === root && valueKey(old) !== valueKey(c) && !added.includes(old)) supersede(old, c);
    }
    // Their earlier account of what may be the same activity, with a different performer: they have now
    // described it differently, so the two nodes are one and their earlier claim is superseded (reversible).
    if (c.predicate === 'performed_by') {
      const linked = claims.filter((x) => x.status === 'active' && x.predicate === 'possibly_same_as' && x.objectNodeId
        && (rootOf(nodes, x.subjectId) === root || rootOf(nodes, x.objectNodeId) === root))
        .map((x) => (rootOf(nodes, x.subjectId) === root ? rootOf(nodes, x.objectNodeId!) : rootOf(nodes, x.subjectId)));
      for (const other of linked) {
        const mineThere = claims.filter((x) => x.status === 'active' && x.predicate === 'performed_by' && x.pseudonym === c.pseudonym && rootOf(nodes, x.subjectId) === other && x.objectRef !== c.objectRef);
        if (!mineThere.length || other === root) continue;
        nodes.get(other)!.mergedInto = root;
        writes.nodeUpdates.push({ id: other, mergedInto: root });
        for (const old of mineThere) supersede(old, c);
      }
    }
  }

  // ---------- 4. Problem rows for the existing analysis (evidence_records), one per problem per answer
  const projection: VerifiedEvidence[] = [];
  const problems = [...new Set(added.map((c) => rootOf(nodes, c.subjectId)))].map((id) => nodes.get(id)!).filter((n) => n.kind === 'problem');
  for (const p of problems) {
    const mine = added.filter((c) => rootOf(nodes, c.subjectId) === p.id);
    const affected = mine.filter((c) => c.predicate === 'affects').map((c) => nodes.get(rootOf(nodes, c.objectNodeId!))!).filter(Boolean);
    const onAffected = (pred: Predicate) => added.find((c) => affected.some((a) => rootOf(nodes, c.subjectId) === a.id) && c.predicate === pred);
    const measure = (pred: Predicate) => ((mine.find((c) => c.predicate === pred) ?? onAffected(pred))?.objectValue as MeasureValue | undefined)?.normalised ?? null;
    const cause = added.find((c) => c.predicate === 'contributes_to' && c.objectNodeId && rootOf(nodes, c.objectNodeId) === p.id && c.stated);
    const impact = mine.filter((c) => c.predicate === 'impact').map((c) => { const v = c.objectValue as { category: string; text: string | null }; return v.text ?? v.category; });
    const improvement = mine.find((c) => c.predicate === 'improvement_idea');
    const systems = affected.flatMap((a) => claims.filter((c) => c.status === 'active' && c.predicate === 'uses' && rootOf(nodes, c.subjectId) === a.id).map((c) => nodes.get(rootOf(nodes, c.objectNodeId!))?.label ?? '')).filter(Boolean);
    const quoteClaim = mine.find((c) => c.stated) ?? mine[0]!;
    const stage = (p.stageRef ?? affected.find((a) => a.stageRef)?.stageRef ?? meta.focusStage ?? pack.stages[0]!.id) as StageId;
    const assumptions = mine.concat(affected.flatMap((a) => added.filter((c) => rootOf(nodes, c.subjectId) === a.id)))
      .map((c) => (c.objectValue as MeasureValue | null)?.assumption).filter((x): x is string => !!x);
    projection.push({
      id: newId(), sessionId: meta.sessionId, participantRef: meta.pseudonym, turnIndex: meta.turnIndex, source: 'firm_said',
      painPointKey: p.typeRef ?? slug(p.label), stageId: stage, taskDescription: p.label, responsibleRole: meta.role,
      monthlyVolume: measure('frequency'), minutesPerOccurrence: measure('duration'), peopleInvolved: null, systems: [...new Set(systems)],
      operationalImpact: impact.join('; ') || 'reported as a problem', reportedCause: cause ? nodes.get(rootOf(nodes, cause.subjectId))?.label ?? null : null,
      potentialImprovement: (improvement?.objectValue as { text: string } | undefined)?.text ?? null,
      supportingQuote: writes.evidence.find((e) => quoteClaim.evidenceIds.includes(e.id))?.quote ?? text.slice(0, 300),
      outstandingQuestions: [], conversionAssumptions: [...new Set(assumptions)], nodeId: p.id,
    });
  }

  return {
    writes, touched: [...touched], superseded, dropped, projection,
    snapshot: { nodes: [...nodes.values()], claims, evidence: [...snap.evidence, ...writes.evidence] },
  };
}
