import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { FirmService } from '../src/firm/service';
import { AnalysisService } from '../src/analysis/service';
import { keysThatAreNotProblems, stillOpen, type AnalysisEvidence } from '../src/analysis/consolidate';
import { SEED_PLAYBOOK } from '../src/knowledge/playbook';
import type { LLMProvider, StructuredRequest, StructuredResult } from '../src/llm/provider';

// Findings quality (found in a full new-firm run): one handover described from both sides became three
// findings; plain "who does what" descriptions became findings; answered questions still counted as open.

describe('which questions are still open', () => {
  it('drops a question once the finding has the figure it asks for', () => {
    const qs = ['How long does the handover take?', 'How many handovers a week?', 'Which systems are involved?'];
    expect(stillOpen(qs, false, false)).toEqual(qs);
    expect(stillOpen(qs, false, true)).toEqual(['How many handovers a week?', 'Which systems are involved?']);
    expect(stillOpen(qs, true, true)).toEqual(['Which systems are involved?']);
  });
});

describe('what is not a problem', () => {
  const e = (key: string, extra: Partial<AnalysisEvidence> = {}): AnalysisEvidence => ({ id: randomUUID(), participantRef: 'P2', role: 'adviser', source: 'firm_said', painPointKey: key,
    stageId: 'fact_find', taskDescription: 'Carries out the fact find', monthlyVolume: null, minutesPerOccurrence: null, systems: [], reportedCause: null, potentialImprovement: null,
    supportingQuote: 'I do the fact find', outstandingQuestions: [], conversionAssumptions: [], createdAt: new Date(), ...extra });
  it('only drops a key the AI flagged, never a playbook pain point, and never one with a stated cause', () => {
    const ev = [e('fact_find'), e('document_chasing'), e('portal_logins', { reportedCause: 'sessions time out' }), e('enquiry_calls')];
    const out = keysThatAreNotProblems(ev, ['fact_find', 'document_chasing', 'portal_logins'], [], SEED_PLAYBOOK);
    expect([...out]).toEqual(['fact_find']);
  });
  it('treats a merged group as a problem unless every key in it was flagged', () => {
    const ev = [e('handover'), e('handover', { participantRef: 'P4', role: 'case_manager' })];
    const merges = [{ canonicalKey: 'handover', mergedKeys: ['received_handover'], reason: 'same work' }];
    expect([...keysThatAreNotProblems(ev, ['handover'], merges, SEED_PLAYBOOK)]).toEqual([]);
    expect([...keysThatAreNotProblems(ev, ['handover', 'received_handover'], merges, SEED_PLAYBOOK)]).toEqual(['handover']);
  });
});

const APP = process.env.TEST_DATABASE_URL, ADMIN = process.env.TEST_ADMIN_DATABASE_URL;

// The AI's review of the keys is scripted per analysis run.
let review: { merges: { canonicalKey: string; mergedKeys: string[]; reason: string }[]; notProblems: string[] } = { merges: [], notProblems: [] };
class ReviewProvider implements LLMProvider {
  readonly name = 'review';
  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const usage = { inputTokens: 0, outputTokens: 0, model: 'review' };
    if (req.task === 'analysis.merge_keys') return { data: req.schema.parse(review), usage };
    const quote = /"([^"]+)"/.exec(String(req.messages[0]!.content))?.[1] ?? '';
    return { data: req.schema.parse({ classification: 'fix', rationale: 'Synthetic test classification for the findings test.', supportingQuotes: [quote], humanElements: [] }), usage };
  }
}

describe.skipIf(!APP || !ADMIN)('findings quality, end to end', () => {
  const db = new pg.Pool({ connectionString: APP });
  const admin = new pg.Pool({ connectionString: ADMIN });
  const firms = new FirmService(db, null, { appBaseUrl: 'http://test', invitationDays: 30, playbookVersion: SEED_PLAYBOOK.version });
  const analysis = new AnalysisService(db, { providerFor: () => new ReviewProvider(), playbook: SEED_PLAYBOOK, mailer: null, appBaseUrl: 'http://test' });
  const a = { orgId: randomUUID(), userId: randomUUID() };
  let id = '';

  beforeAll(async () => {
    await firms.createFirm({ ...a, leadUserId: a.userId, name: 'Findings Quality Test' });
    id = await firms.createDiscovery(a);
    const ev = (p: string, key: string, stage: string, role: string, mins: number | null, quote: string, extra: { cause?: string; questions?: string[] } = {}) => admin.query(
      `insert into evidence_records (id, org_id, discovery_id, participant_pseudonym, source, pain_point_key, stage_id, task_description, responsible_role, minutes_per_occurrence, supporting_quote, reported_cause, outstanding_questions)
       values ($1,$2,$3,$4,'firm_said',$5,$6,$7,$8,$9,$10,$11,$12)`,
      [randomUUID(), a.orgId, id, p, key, stage, `Task: ${quote}`, role, mins, quote, extra.cause ?? null, extra.questions ?? []]);
    await ev('P2', 'hand_application_to_case_team', 'full_application', 'adviser', 10, 'the handover takes me about ten minutes', { questions: ['How long does the handover take?'] });
    await ev('P3', 'hand_application_to_case_team', 'full_application', 'adviser', 10, 'I send the case team a quick email');
    await ev('P4', 'incomplete_adviser_handover', 'full_application', 'case_manager', 45, 'filling the gaps takes me 45 minutes', { cause: 'details missing from the notes' });
    await ev('P2', 'fact_find', 'fact_find', 'adviser', 60, 'the fact find takes an hour, no problems', { questions: ['Which systems are involved?'] });
    await ev('P3', 'fact_find', 'fact_find', 'adviser', 60, 'a fact find is about an hour, it works fine');
  });
  afterAll(async () => { await db.end(); await admin.end(); });

  const live = async () => (await analysis.discoveryWorkspace(a, id)).findings;

  it('first analysis, with no help from the AI: three findings, as before', async () => {
    review = { merges: [], notProblems: [] };
    await analysis.analyse(a, id);
    expect((await live()).map((f) => f.key).sort()).toEqual(['fact_find', 'hand_application_to_case_team', 'incomplete_adviser_handover']);
  });

  it('re-analysis: both sides of the handover become one finding with their disagreement, and "it works fine" is not a finding', async () => {
    review = { merges: [{ canonicalKey: 'application_handover', mergedKeys: ['hand_application_to_case_team', 'incomplete_adviser_handover'], reason: 'one handover, two sides' }], notProblems: ['fact_find'] };
    await analysis.analyse(a, id);
    const findings = await live();
    expect(findings).toHaveLength(1);
    const h = findings[0]!;
    expect(h.roles.sort()).toEqual(['Case manager', 'Mortgage adviser'].sort());
    expect(JSON.stringify(h)).toMatch(/45/);                                        // the case manager's figure is kept beside the advisers'
    expect(h.outstandingQuestions).not.toContain('How long does the handover take?');  // answered: the finding has times now
    // The retired findings are gone from every view, but nothing is deleted.
    const ws = await firms.workspace(a);
    expect(ws.discoveries.find((d) => d.id === id)!.painPoints).toBe(1);
    const all = await admin.query(`select key, coalesce((evidence_summary->>'retired')::boolean, false) as retired from pain_points where discovery_id = $1 order by key`, [id]);
    // The merge keeps an existing name (the advisers' key), so the case manager's key and the fact find are retired.
    expect(h.key).toBe('hand_application_to_case_team');
    expect(all.rows.filter((r) => r.retired).map((r) => r.key).sort()).toEqual(['fact_find', 'incomplete_adviser_handover']);
    // The fact-find evidence is still there, as evidence of what advisers do.
    const factFind = (await analysis.discoveryWorkspace(a, id)).evidence.filter((e) => e.stageId === 'fact_find');
    expect(factFind).toHaveLength(2);
    expect(factFind.every((e) => e.findingId === null)).toBe(true);
  });

  it('a key that comes back is live again', async () => {
    review = { merges: [], notProblems: [] };
    await analysis.analyse(a, id);
    expect((await live()).map((f) => f.key)).toContain('fact_find');
  });
});
