import { describe, expect, it } from 'vitest';
import { ingestTurn, normaliseMeasure } from '../src/understanding/ingest';
import { computeFacts, factKey } from '../src/understanding/facts';
import { planNextMove, type PlannerSession } from '../src/understanding/planner';
import { candidateNodes, ownFacts } from '../src/understanding/context';
import { MORTGAGE_PACK as pack } from '../src/understanding/packs/mortgage';
import type { KnowledgeSnapshot, KnGap } from '../src/understanding/core';
import type { ClaimDraft, KnowledgeTurn, MentionDraft } from '../src/understanding/schema';

// The knowledge layer, without AI or database: the worked example from the design doc, the fact rules
// (corroboration, confirmation, variation, contradiction), the planner, and what the prompts may see.
const noFlags = { clientInformation: false, complaintOrCompliance: false, employmentIssue: false, adviceRequest: false, outOfScope: false };
const turn = (mentions: MentionDraft[], claims: ClaimDraft[], over: Partial<KnowledgeTurn> = {}): KnowledgeTurn =>
  ({ mentions, claims, stagesConfirmedNotInvolved: [], flags: noFlags, wantsToPause: false, answerWasVague: false, participantUnsure: false, ...over });
const m = (ref: string, kind: MentionDraft['kind'], label: string, over: Partial<MentionDraft> = {}): MentionDraft =>
  ({ ref, kind, label, words: label, match: null, typeRef: null, stage: null, ...over });
const c = (subject: string, predicate: string, quote: string, over: Partial<ClaimDraft> = {}): ClaimDraft =>
  ({ subject, predicate, objectMention: null, objectRef: null, value: null, impactCategory: null, text: null, scope: null, negated: false, quote, stated: true, note: null, ...over });
let seq = 0;
const ids = () => `id-${++seq}`;
const meta = (pseudonym: string, role: 'adviser' | 'administrator' | 'case_manager', turnIndex = 1) =>
  ({ sessionId: `s-${pseudonym}`, turnIndex, pseudonym, role, interpretedBy: 'ai:test', focusStage: null });
const empty: KnowledgeSnapshot = { nodes: [], claims: [], evidence: [] };

describe('ingest: the worked example (two people, one fact-find process)', () => {
  // P2, an adviser, interviewed first.
  const t2 = "I do the fact-find with the client. I re-key my fact-find notes into the CRM, about 15 minutes.";
  const p2 = ingestTurn(turn(
    [m('a1', 'activity', 'Complete fact-find with client', { stage: 'fact_find', typeRef: 'complete_fact_find' }),
     m('a2', 'activity', 'Type fact-find notes into the CRM', { stage: 'fact_find', typeRef: 'record_fact_find' }),
     m('s1', 'system', 'Example CRM', { words: 'the CRM' })],
    [c('a1', 'performed_by', 'I do the fact-find with the client', { objectRef: 'adviser' }),
     c('a2', 'performed_by', 'I re-key my fact-find notes into the CRM', { objectRef: 'adviser' }),
     c('a2', 'uses', 'I re-key my fact-find notes into the CRM', { objectMention: 's1' }),
     c('a2', 'duration', 'about 15 minutes', { value: { number: 15, unit: 'minutes', per: null, raw: 'about 15 minutes' } }),
     c('a2', 'frequency', 'every day, invented', { value: { number: 5, unit: null, per: 'day', raw: '5 a day' } })]),   // quote not in the text: dropped
    t2, empty, pack, meta('P2', 'adviser'), ids);
  const A1 = p2.snapshot.nodes.find((n) => n.label.startsWith('Complete'))!.id;
  const A2 = p2.snapshot.nodes.find((n) => n.label.startsWith('Type'))!.id;
  const S1 = p2.snapshot.nodes.find((n) => n.kind === 'system')!.id;

  it('keeps only claims whose quote is real, and converts figures in code', () => {
    expect(p2.dropped).toBe(1);
    const dur = p2.writes.claims.find((x) => x.predicate === 'duration')!;
    expect(dur.objectValue).toMatchObject({ raw: 'about 15 minutes', normalised: 15, normalisedUnit: 'minutes' });
    expect(p2.writes.evidence.every((e) => t2.includes(e.quote))).toBe(true);
    expect(p2.writes.claims.filter((x) => x.predicate === 'classified_as').map((x) => x.objectRef).sort()).toEqual(['complete_fact_find', 'record_fact_find']);
  });

  // P4, an administrator: turn 1.
  const t4a = 'Once the adviser completes the fact-find, I check the information and enter it into the CRM. Sometimes I have to chase them for missing documents.';
  const p4a = ingestTurn(turn(
    [m('m1', 'activity', 'Complete fact-find with client', { match: A1 }),
     m('m2', 'activity', 'Check fact-find information', { stage: 'fact_find', typeRef: 'check_fact_find' }),
     m('m3', 'activity', 'Enter fact-find data into the CRM', { stage: 'fact_find', typeRef: 'record_fact_find', match: A2 }),
     m('m4', 'system', 'Example CRM', { words: 'the CRM', match: S1 }),
     m('m5', 'problem', 'Missing documents at the fact-find check', { typeRef: 'document_chasing' })],
    [c('m1', 'performed_by', 'Once the adviser completes the fact-find', { objectRef: 'adviser' }),
     c('m1', 'followed_by', 'Once the adviser completes the fact-find, I check the information', { objectMention: 'm2' }),
     c('m2', 'performed_by', 'I check the information', { objectRef: 'administrator' }),
     c('m2', 'followed_by', 'I check the information and enter it into the CRM', { objectMention: 'm3' }),
     c('m3', 'performed_by', 'enter it into the CRM', { objectRef: 'administrator' }),
     c('m3', 'uses', 'enter it into the CRM', { objectMention: 'm4' }),
     c('m5', 'affects', 'Sometimes I have to chase them for missing documents', { objectMention: 'm2', stated: false, note: 'same sentence as the check' }),
     c('m5', 'frequency', 'Sometimes I have to chase them', { value: { number: null, unit: null, per: null, raw: 'Sometimes' } })]),
    t4a, p2.snapshot, pack, meta('P4', 'administrator', 1), ids);
  const A4 = p4a.writes.nodes.find((n) => n.label.startsWith('Enter'))!.id;

  it('matches the same activity, but keeps different people’s work apart (D1)', () => {
    expect(p4a.writes.nodes.map((n) => n.label)).not.toContain('Complete fact-find with client');   // joined A1
    expect(A4).not.toBe(A2);                                                                         // a different performer: not merged
    expect(p4a.writes.claims.find((x) => x.predicate === 'possibly_same_as')).toMatchObject({ subjectId: A4, objectNodeId: A2, stated: false });
  });

  it('two independent people agreeing is corroboration, not confirmation (D2)', () => {
    const facts = computeFacts(p4a.snapshot);
    expect(facts.get(factKey(A1, 'performed_by'))!.status).toBe('corroborated');
    expect(facts.get(factKey(A1, 'performed_by'))!.values[0]!.supporters.sort()).toEqual(['P2', 'P4']);
    expect(facts.get(factKey(A4, 'performed_by'))!.status).toBe('observed');
  });

  it('projects the problem into an evidence row for the existing analysis, linked to its node', () => {
    expect(p4a.projection).toHaveLength(1);
    expect(p4a.projection[0]).toMatchObject({ painPointKey: 'document_chasing', taskDescription: 'Missing documents at the fact-find check', responsibleRole: 'administrator', stageId: 'fact_find' });
    expect(p4a.projection[0]!.nodeId).toBe(p4a.writes.nodes.find((n) => n.kind === 'problem')!.id);
  });

  // P4, turn 4: "the advisers type the fact-find into the CRM themselves now".
  const t4b = 'In my spreadsheet. To be honest, the advisers type the fact-find into the CRM themselves now, I just check it against the documents.';
  const p4b = ingestTurn(turn(
    [m('x1', 'activity', 'Type fact-find notes into the CRM', { match: A2 })],
    [c('x1', 'performed_by', 'the advisers type the fact-find into the CRM themselves now', { objectRef: 'adviser' })]),
    t4b, p4a.snapshot, pack, meta('P4', 'administrator', 7), ids);

  it('a person correcting themselves supersedes their own earlier claim and joins the two nodes (reversibly)', () => {
    expect(p4b.superseded).toHaveLength(1);
    expect(p4b.writes.nodeUpdates).toContainEqual({ id: A4, mergedInto: A2 });
    const old = p4b.snapshot.claims.find((x) => x.id === p4b.superseded[0])!;
    expect(old).toMatchObject({ predicate: 'performed_by', objectRef: 'administrator', status: 'superseded', pseudonym: 'P4' });
    // Nothing is deleted: the old claim, its quote and its speaker are all still there.
    expect(p4b.snapshot.evidence.some((e) => e.quote === 'enter it into the CRM')).toBe(true);
    const facts = computeFacts(p4b.snapshot);
    expect(facts.get(factKey(A2, 'performed_by'))!.status).toBe('corroborated');
  });
});

describe('compact interpreter output', () => {
  it('expands to the full form: refs vs ids, figures, interpretations, flags', async () => {
    const { expandTurn } = await import('../src/understanding/schema');
    const t = expandTurn({ m: [{ r: 'm1', k: 'activity', l: 'Chase documents' }, { r: 'm2', k: 'problem', l: 'Missing payslips', w: 'payslips missing' }],
      c: [{ s: 'm1', p: 'performed_by', q: 'I chase', o: 'case_manager' }, { s: 'm2', p: 'affects', q: 'payslips missing', o: 'm1', inf: 'same sentence' },
          { s: 'm1', p: 'frequency', q: '40 a month', n: 40, per: 'month', raw: '40 a month' }], flags: noFlags, unsure: true });
    expect(t.mentions[0]).toMatchObject({ ref: 'm1', words: 'Chase documents', match: null, typeRef: null });
    expect(t.claims[0]).toMatchObject({ objectRef: 'case_manager', objectMention: null, stated: true });
    expect(t.claims[1]).toMatchObject({ objectMention: 'm1', objectRef: null, stated: false, note: 'same sentence' });
    expect(t.claims[2]!.value).toEqual({ number: 40, unit: null, per: 'month', raw: '40 a month' });
    expect(t).toMatchObject({ participantUnsure: true, answerWasVague: false, wantsToPause: false, stagesConfirmedNotInvolved: [] });
  });
});

describe('fact statuses (D2, D3)', () => {
  const snap = (claims: [string, string, string | null, boolean][]): KnowledgeSnapshot => ({
    nodes: [{ id: 'A', kind: 'activity', label: 'Hand the case over', aliases: [], stageRef: 'full_application', typeRef: null, typeVersion: null, partOf: null, mergedInto: null }],
    evidence: [],
    claims: claims.map(([who, role, scope, stated], i) => ({ id: `c${i}`, subjectId: 'A', predicate: 'performed_by', objectNodeId: null, objectRef: role, objectValue: null,
      scope, polarity: 'asserted', stated, inferenceNote: null, interpretedBy: 'ai:test', status: 'active', supersededBy: null, evidenceIds: [], pseudonym: who, roleRef: role, createdAt: '' })),
  });
  const status = (s: KnowledgeSnapshot, probed = new Set<string>()) => computeFacts(s, { variationProbed: probed }).get(factKey('A', 'performed_by'))!.status;

  it('different values with different scopes are variation, never a contradiction', () => {
    expect(status(snap([['P1', 'adviser', 'for buy-to-let', true], ['P2', 'case_manager', 'for residential', true]]))).toBe('varies');
  });
  it('an unexplained difference becomes a contradiction only after the variation probe', () => {
    const s = snap([['P1', 'adviser', null, true], ['P2', 'case_manager', null, true]]);
    expect(status(s)).toBe('unexplained_difference');
    expect(status(s, new Set(['A']))).toBe('contradicted');
  });
  it('one person giving two figures is their own wording, not a disagreement', () => {
    expect(status(snap([['P1', 'adviser', null, true], ['P1', 'case_manager', null, true]]))).toBe('observed');
  });
  it('only interpretations stay "inferred only"; one stated source is "observed"', () => {
    expect(status(snap([['P1', 'adviser', null, false]]))).toBe('inferred_only');
    expect(status(snap([['P1', 'adviser', null, true]]))).toBe('observed');
  });
  it('confirmation is an explicit act, recorded as its own claim', () => {
    const s = snap([['P1', 'adviser', null, true]]);
    s.claims.push({ ...s.claims[0]!, id: 'conf', predicate: 'confirms', objectRef: null, objectValue: { text: 'performed_by' } });
    expect(status(s)).toBe('confirmed');
  });
});

describe('planner', () => {
  const nodes: KnowledgeSnapshot['nodes'] = [
    { id: 'MY', kind: 'activity', label: 'Check fact-find information', aliases: [], stageRef: 'fact_find', typeRef: null, typeVersion: null, partOf: null, mergedInto: null },
    { id: 'THEIRS', kind: 'activity', label: 'Ring the client again', aliases: [], stageRef: 'documents', typeRef: null, typeVersion: null, partOf: null, mergedInto: null },
    { id: 'PROB', kind: 'problem', label: 'Missing documents', aliases: [], stageRef: null, typeRef: null, typeVersion: null, partOf: null, mergedInto: null },
  ];
  const claim = (id: string, subjectId: string, predicate: string, by: string, over: Record<string, unknown> = {}) => ({ id, subjectId, predicate, objectNodeId: null, objectRef: null,
    objectValue: null, scope: null, polarity: 'asserted', stated: true, inferenceNote: null, interpretedBy: 'ai', status: 'active', supersededBy: null, evidenceIds: [], pseudonym: by, roleRef: null, createdAt: '', ...over }) as KnowledgeSnapshot['claims'][number];
  const base: KnowledgeSnapshot = { nodes, evidence: [], claims: [
    claim('c1', 'MY', 'performed_by', 'P4', { objectRef: 'administrator' }),
    claim('c2', 'THEIRS', 'performed_by', 'P4', { objectRef: 'case_manager' }),
    claim('c3', 'PROB', 'affects', 'P4', { objectNodeId: 'MY' }),
  ] };
  const session = (over: Partial<PlannerSession> = {}): PlannerSession => ({ pseudonym: 'P4', role: 'administrator', stagesInScope: ['enquiry', 'disclosure_id', 'documents', 'full_application', 'offer', 'completion', 'aftercare_renewal'],
    notInvolved: new Set(), gaps: new Map(), lastFocusNode: null, lastAnswerVague: false, touched: [], supersededThisTurn: [], turnCount: 3, ...over });
  const plan = (snap: KnowledgeSnapshot, s: PlannerSession) => planNextMove(snap, computeFacts(snap), pack, s);

  it('investigates a raised problem before routine gaps, and says why', () => {
    const move = plan(base, session())!;
    expect(move.type).toBe('investigate_problem');
    expect(move.nodeId).toBe('PROB');
    expect(move.reason).toMatch(/Missing documents/);
  });
  it('opens each part of their work with how it goes, before systems or figures', () => {
    const quiet = { ...base, claims: base.claims.filter((x) => x.subjectId !== 'PROB') };
    const mv = plan(quiet, session())!;
    expect(mv).toMatchObject({ type: 'explore_activity', nodeId: 'MY' });
  });
  it('a vague answer gets a request for a concrete example, not the same question again', () => {
    expect(plan(base, session({ lastAnswerVague: true, lastFocusNode: 'MY' }))!.type).toBe('example_request');
  });
  it('never asks again what they said they don’t know, and never asks about another role’s work', () => {
    const gaps = new Map<string, KnGap>([['PROB|impact', { subjectId: 'PROB', predicate: 'impact', status: 'unsure', timesAsked: 1 }]]);
    const moves: string[] = [];
    for (let i = 0; i < 25; i++) {
      const mv = plan(base, session({ gaps }));
      if (!mv) break;
      moves.push(`${mv.nodeId ?? `stage:${mv.stage}`}|${mv.predicate}`);
      gaps.set(mv.nodeId ? `${mv.nodeId}|${mv.predicate}` : `stage:${mv.stage}|open`, { subjectId: mv.nodeId ?? '', predicate: mv.predicate, status: 'answered', timesAsked: 1 });
    }
    expect(moves).not.toContain('PROB|impact');
    expect(moves.filter((x) => x.startsWith('THEIRS|'))).toEqual([]);
    expect(new Set(moves).size).toBe(moves.length);    // nothing asked twice
  });
  it('a difference on their own work is probed as possible variation first', () => {
    const snap = { ...base, claims: [...base.claims, claim('c9', 'MY', 'performed_by', 'P6', { objectRef: 'case_manager' })] };
    expect(plan(snap, session())!.type).toBe('probe_variation');
  });
  it('moves on from a topic that has been explored, or that they keep saying "not sure" about', () => {
    const asked = [1, 2, 3, 4].map(() => ({ nodeId: 'PROB', unsure: false }));
    const mv = plan(base, session({ history: asked }))!;
    expect(mv.nodeId === 'PROB' || mv.nodeId === 'MY').toBe(false);     // PROB's topic is MY (it affects MY)
    const unsure = [{ nodeId: 'PROB', unsure: true }, { nodeId: 'PROB', unsure: true }];
    expect(plan(base, session({ history: unsure }))!.nodeId).not.toBe('PROB');
  });
  it('a cause of another problem is part of that story, not a new thread', () => {
    const snap = { ...base, nodes: [...base.nodes, { id: 'CAUSE', kind: 'problem' as const, label: 'No handover template', aliases: [], stageRef: null, typeRef: null, typeVersion: null, partOf: null, mergedInto: null }],
      claims: [...base.claims, claim('c8', 'CAUSE', 'contributes_to', 'P4', { objectNodeId: 'PROB' })] };
    const gaps = new Map<string, KnGap>();
    const moves: string[] = [];
    for (let i = 0; i < 20; i++) {
      const mv = plan(snap, session({ gaps }));
      if (!mv) break;
      if (mv.nodeId === 'CAUSE') moves.push(String(mv.predicate));
      gaps.set(mv.nodeId ? `${mv.nodeId}|${mv.predicate}` : `stage:${mv.stage}|open`, { subjectId: mv.nodeId ?? '', predicate: mv.predicate, status: 'answered', timesAsked: 1 });
    }
    expect(moves.every((p) => p === 'improvement_idea')).toBe(true);
  });
  it('never asks about work they said they don’t do', () => {
    const snap = { ...base, nodes: [...base.nodes, { id: 'NOPE', kind: 'activity' as const, label: 'Handle enquiries', aliases: [], stageRef: 'enquiry', typeRef: null, typeVersion: null, partOf: null, mergedInto: null }],
      claims: [...base.claims, claim('c7', 'NOPE', 'performed_by', 'P4', { objectRef: 'administrator', polarity: 'negated' })] };
    const gaps = new Map<string, KnGap>();
    for (let i = 0; i < 25; i++) {
      const mv = plan(snap, session({ gaps }));
      if (!mv) break;
      expect(mv.nodeId).not.toBe('NOPE');
      gaps.set(mv.nodeId ? `${mv.nodeId}|${mv.predicate}` : `stage:${mv.stage}|open`, { subjectId: mv.nodeId ?? '', predicate: mv.predicate, status: 'answered', timesAsked: 1 });
    }
  });
  it('stages they are not involved in are never opened', () => {
    const moves = [];
    const gaps = new Map<string, KnGap>();
    for (let i = 0; i < 25; i++) {
      const mv = plan(base, session({ gaps, notInvolved: new Set(['enquiry', 'completion']) }));
      if (!mv) break;
      moves.push(mv);
      gaps.set(mv.nodeId ? `${mv.nodeId}|${mv.predicate}` : `stage:${mv.stage}|open`, { subjectId: mv.nodeId ?? '', predicate: mv.predicate, status: 'answered', timesAsked: 1 });
    }
    expect(moves.filter((x) => x.type === 'open_area').map((x) => x.stage)).not.toContain('enquiry');
    expect(moves.filter((x) => x.type === 'open_area').map((x) => x.stage)).not.toContain('completion');
  });
});

describe('context: what the AI may see', () => {
  const t1 = 'I do the fact-find and it takes about an hour.';
  const a = ingestTurn(turn([m('a', 'activity', 'Complete the fact-find', { stage: 'fact_find' })],
    [c('a', 'performed_by', 'I do the fact-find', { objectRef: 'adviser' }), c('a', 'duration', 'it takes about an hour', { value: { number: 1, unit: 'hours', per: null, raw: 'about an hour' } })]),
    t1, empty, pack, meta('P2', 'adviser'), ids);
  const node = a.snapshot.nodes[0]!.id;
  const b = ingestTurn(turn([m('b', 'activity', 'Complete the fact-find', { match: node })],
    [c('b', 'duration', 'my fact finds take three hours', { value: { number: 3, unit: 'hours', per: null, raw: 'three hours' } })]),
    'Honestly my fact finds take three hours.', a.snapshot, pack, meta('P3', 'adviser'), ids);

  it('the question writer sees only this participant’s own words', () => {
    const mine = ownFacts(b.snapshot, pack, 'P3', node).join('\n');
    expect(mine).toContain('three hours');
    expect(mine).not.toContain('about an hour');
  });
  it('the interpreter sees node labels to match against, never anyone’s quotes', () => {
    const lines = candidateNodes(b.snapshot, pack, { pseudonym: 'P3', stagesInScope: ['fact_find'], focusNode: null }).join('\n');
    expect(lines).toContain('Complete the fact-find');
    expect(lines).not.toMatch(/about an hour|three hours|I do the fact-find/);
  });
  it('figures are normalised in code', () => {
    expect(normaliseMeasure('frequency', { number: 35, unit: null, per: 'week', raw: '35 a week' }).normalised).toBe(151.7);
    expect(normaliseMeasure('duration', { number: 2, unit: 'hours', per: null, raw: 'two hours' }).normalised).toBe(120);
    expect(normaliseMeasure('delay', { number: 3, unit: 'days', per: null, raw: 'three days' }).normalised).toBe(3);
  });
});
