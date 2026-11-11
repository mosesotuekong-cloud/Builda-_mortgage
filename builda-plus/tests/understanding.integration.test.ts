import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { InterviewService } from '../src/interview/service';
import { withFirmContext } from '../src/db/pool';
import { ScriptedProvider } from '../src/llm/mock';
import { SEED_PLAYBOOK } from '../src/knowledge/playbook';
import { MORTGAGE_PACK } from '../src/understanding/packs/mortgage';
import { loadKnowledge } from '../src/understanding/store';
import { knowledgeView } from '../src/understanding/view';

// The knowledge engine end to end with Postgres: each turn writes evidence, claims, nodes and gaps in the
// same transaction as the session; a second participant builds on the first's nodes without seeing their
// words; the existing analysis still gets its evidence rows; and another firm sees none of it.
const APP = process.env.TEST_DATABASE_URL, ADMIN = process.env.TEST_ADMIN_DATABASE_URL;
const ORG = '00000000-0000-0000-0000-0000000000c1', OTHER = '00000000-0000-0000-0000-0000000000c2';
const DISC = '10000000-0000-0000-0000-0000000000c1', DISC2 = '10000000-0000-0000-0000-0000000000c2';
const PA = '20000000-0000-0000-0000-0000000000c1', PB = '20000000-0000-0000-0000-0000000000c2';
const noFlags = { clientInformation: false, complaintOrCompliance: false, employmentIssue: false, adviceRequest: false, outOfScope: false };
// The interpreter's compact output (see CompactTurnSchema): short keys, empty fields left out.
const claim = (s: string, p: string, q: string, over: Record<string, unknown> = {}) => ({ s, p, q, ...over });
const base = { flags: noFlags };

describe.skipIf(!APP || !ADMIN)('knowledge engine with Postgres', () => {
  const db = new pg.Pool({ connectionString: APP });
  const admin = new pg.Pool({ connectionString: ADMIN });
  let llm: ScriptedProvider;
  const service = () => new InterviewService(db, { providerFor: () => llm, playbook: SEED_PLAYBOOK, knowledge: { pack: MORTGAGE_PACK } });
  const ctx = { orgId: ORG };

  beforeAll(async () => {
    await admin.query('truncate organisations cascade');
    await admin.query(`insert into organisations (id, name) values ($1,'Knowledge Firm'), ($2,'Other Firm')`, [ORG, OTHER]);
    await admin.query(`insert into discoveries (id, org_id, playbook_version, scoring_config_version, created_by) values ($1,$2,'0.1.0-draft','v1',gen_random_uuid()), ($3,$4,'0.1.0-draft','v1',gen_random_uuid())`, [DISC, ORG, DISC2, OTHER]);
    await admin.query(`insert into participants (id, org_id, discovery_id, display_name, pseudonym, role, consent_version, consented_at) values
      ($1,$3,$4,'Ada Adviser (made up)','P1','adviser','v1',now()), ($2,$3,$4,'Cam Case (made up)','P2','case_manager','v1',now())`, [PA, PB, ORG, DISC]);
  });
  afterAll(async () => { await db.end(); await admin.end(); });

  it('a turn writes evidence, claims, nodes, gaps and the analysis row together', async () => {
    llm = new ScriptedProvider({
      'interview.interpret': [{ ...base,
        m: [{ r: 'h', k: 'activity', l: 'Hand the case to the case team', w: 'hand it to the case team', t: 'hand_over_case', s: 'full_application' },
            { r: 'p', k: 'problem', l: 'Handover details missing', w: 'details get missed', s: 'full_application' }],
        c: [claim('h', 'performed_by', 'I hand it to the case team', { o: 'adviser' }),
            claim('h', 'duration', 'takes me ten minutes', { n: 10, u: 'minutes', raw: 'ten minutes' }),
            claim('p', 'affects', 'details get missed', { o: 'h' })] }],
      'interview.next_question': [{ question: 'When details get missed, what happens next?' }],
    });
    await service().startOrResume(ctx, PA);
    const out = await service().submitForParticipant(ctx, PA, 'Once it is ready I hand it to the case team, takes me ten minutes, but details get missed.');
    expect(out.reply).toBe('When details get missed, what happens next?');
    const count = async (t: string) => (await admin.query(`select count(*)::int as n from ${t} where discovery_id = $1`, [DISC])).rows[0].n;
    expect(await count('kn_nodes')).toBe(2);
    expect(await count('kn_evidence')).toBe(3);
    expect(await count('kn_claims')).toBe(4);            // three stated + one classification
    expect(await count('kn_claim_evidence')).toBe(3);
    expect((await admin.query('select predicate, status, times_asked from kn_gaps where discovery_id = $1', [DISC])).rows).toEqual([{ predicate: 'impact', status: 'asked', times_asked: 1 }]);
    const ev = (await admin.query('select pain_point_key, node_id, turn_index, minutes_per_occurrence from evidence_records where discovery_id = $1', [DISC])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].node_id).not.toBeNull();
    expect(ev[0].turn_index).toBe(1);
    expect(Number(ev[0].minutes_per_occurrence)).toBe(10);   // the affected activity's figure carried into the analysis row
  });

  it('a second participant builds on the same node; their accounts stay attributed', async () => {
    const k0 = await withFirmContext(db, ctx, (tx) => loadKnowledge(tx, DISC));
    const handover = k0.nodes.find((n) => n.label.startsWith('Hand'))!.id;
    llm = new ScriptedProvider({
      'interview.interpret': [{ ...base,
        m: [{ r: 'h', k: 'activity', l: 'Pick up cases from advisers', w: 'pick up the case', id: handover, t: 'hand_over_case', s: 'full_application' }],
        c: [claim('h', 'duration', 'it takes me 45 minutes', { n: 45, u: 'minutes', raw: '45 minutes' })] }],
      'interview.next_question': [{ question: 'What do you need from the adviser before you can start?' }],
    });
    await service().startOrResume(ctx, PB);
    await service().submitForParticipant(ctx, PB, 'When I pick up the case it takes me 45 minutes to fill the gaps.');
    // The interpreter was shown the node's label to match, never the adviser's words.
    expect(llm.calls[0]!.system).toContain('Hand the case to the case team');
    expect(llm.calls[0]!.system).not.toContain('takes me ten minutes');
    expect(llm.calls[1]!.system).not.toContain('ten minutes');
    const k = await withFirmContext(db, ctx, (tx) => loadKnowledge(tx, DISC));
    expect(k.nodes.filter((n) => n.kind === 'activity')).toHaveLength(1);          // one handover, not two
    expect(k.nodes.find((n) => n.id === handover)!.aliases).toContain('pick up the case');
    const view = knowledgeView(k, MORTGAGE_PACK);
    const dur = view.nodes.find((n) => n.id === handover)!.facts.find((f) => f.about.startsWith('roughly how long'))!;
    expect(dur.status).toBe('unexplained_difference');                              // 10 vs 45 minutes, nothing explains it yet
    expect(dur.values.map((v) => v.roles[0]).sort()).toEqual(['Case manager', 'Mortgage adviser']);
    expect(JSON.stringify(view)).not.toMatch(/"P1"|"P2"|takes me ten minutes|45 minutes to fill/);   // by role, no pseudonyms, no quotes
  });

  it('another firm cannot read this knowledge', async () => {
    const theirs = await withFirmContext(db, { orgId: OTHER }, (tx) => loadKnowledge(tx, DISC));
    expect(theirs.nodes).toEqual([]);
    expect(theirs.claims).toEqual([]);
    expect(theirs.evidence).toEqual([]);
  });

  it('the classic engine is untouched when the switch is off', async () => {
    const classic = new InterviewService(db, { providerFor: () => llm, playbook: SEED_PLAYBOOK });
    expect(classic).toBeInstanceOf(InterviewService);
    const before = (await admin.query('select count(*)::int as n from kn_claims')).rows[0].n;
    await admin.query(`insert into participants (id, org_id, discovery_id, display_name, pseudonym, role, consent_version, consented_at) values ($1,$2,$3,'Al Admin (made up)','P3','administrator','v1',now())`,
      ['20000000-0000-0000-0000-0000000000c3', ORG, DISC]);
    llm = new ScriptedProvider({ 'interview.interpret': [{ evidence: [], stagesConfirmedNotInvolved: [], flags: noFlags, wantsToPause: false, answerWasVague: false }],
      'interview.next_question': [{ question: 'How do new enquiries reach you?' }] });
    await classic.startOrResume(ctx, '20000000-0000-0000-0000-0000000000c3');
    await classic.submitForParticipant(ctx, '20000000-0000-0000-0000-0000000000c3', 'I log enquiries.');
    expect((await admin.query('select count(*)::int as n from kn_claims')).rows[0].n).toBe(before);
  });
});
