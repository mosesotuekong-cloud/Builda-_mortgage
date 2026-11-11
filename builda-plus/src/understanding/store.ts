import type { Tx } from '../db/pool';
import type { KnClaim, KnEvidence, KnGap, KnNode, KnowledgeSnapshot, Predicate } from './core';
import type { KnowledgeWrites } from './ingest';
import type { GapWrite } from './engine';

// Reads and writes the knowledge layer (migration 008). Always inside withFirmContext, so row-level
// security keeps every firm's knowledge to itself. Evidence and links are append-only; claims change
// only their status; nodes only their aliases and merge pointer.

export async function loadKnowledge(tx: Tx, discoveryId: string): Promise<KnowledgeSnapshot & { gaps: (KnGap & { sessionId: string })[] }> {
  const [n, e, c, g] = await Promise.all([
    tx.query('select * from kn_nodes where discovery_id = $1 order by created_at', [discoveryId]),
    tx.query('select * from kn_evidence where discovery_id = $1 order by created_at', [discoveryId]),
    tx.query(`select c.*, coalesce(array_agg(ce.evidence_id) filter (where ce.evidence_id is not null), '{}') as evidence_ids,
                     min(ev.participant_pseudonym) as pseudonym, min(ev.participant_role_ref) as role_ref
                from kn_claims c
                left join kn_claim_evidence ce on ce.claim_id = c.id
                left join kn_evidence ev on ev.id = ce.evidence_id
               where c.discovery_id = $1 group by c.id order by c.created_at`, [discoveryId]),
    tx.query('select session_id, subject_id, predicate, status, times_asked from kn_gaps where discovery_id = $1', [discoveryId]),
  ]);
  return {
    nodes: n.rows.map((r): KnNode => ({ id: r.id, kind: r.kind, label: r.label, aliases: r.aliases, stageRef: r.stage_ref, typeRef: r.type_ref, typeVersion: r.type_version, partOf: r.part_of, mergedInto: r.merged_into })),
    evidence: e.rows.map((r): KnEvidence => ({ id: r.id, sessionId: r.session_id, turnIndex: r.turn_index, pseudonym: r.participant_pseudonym, roleRef: r.participant_role_ref, source: r.source, quote: r.quote })),
    claims: c.rows.map((r): KnClaim => ({
      id: r.id, subjectId: r.subject_id, predicate: r.predicate as Predicate, objectNodeId: r.object_node_id, objectRef: r.object_ref, objectValue: r.object_value,
      scope: r.scope, polarity: r.polarity, stated: r.stated, inferenceNote: r.inference_note, interpretedBy: r.interpreted_by, status: r.status, supersededBy: r.superseded_by,
      evidenceIds: r.evidence_ids, pseudonym: r.pseudonym, roleRef: r.role_ref, createdAt: new Date(r.created_at).toISOString(),
    })),
    gaps: g.rows.map((r) => ({ sessionId: r.session_id, subjectId: r.subject_id, predicate: r.predicate, status: r.status, timesAsked: r.times_asked })),
  };
}

export async function saveKnowledge(tx: Tx, p: { orgId: string; discoveryId: string; sessionId: string }, w: KnowledgeWrites & { gaps: GapWrite[] }): Promise<void> {
  for (const n of w.nodes) {
    await tx.query(`insert into kn_nodes (id, org_id, discovery_id, kind, label, aliases, stage_ref, type_ref, type_version, part_of, merged_into)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null)`,
      [n.id, p.orgId, p.discoveryId, n.kind, n.label, n.aliases, n.stageRef, n.typeRef, n.typeVersion, n.partOf]);
  }
  for (const e of w.evidence) {
    await tx.query(`insert into kn_evidence (id, org_id, discovery_id, session_id, turn_index, participant_pseudonym, participant_role_ref, source, quote)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [e.id, p.orgId, p.discoveryId, e.sessionId, e.turnIndex, e.pseudonym, e.roleRef, e.source, e.quote]);
  }
  // Node updates after inserts: a merge may point at a node created this turn.
  for (const u of w.nodeUpdates) {
    if (u.aliases) await tx.query('update kn_nodes set aliases = $1 where id = $2', [u.aliases, u.id]);
    if (u.mergedInto) await tx.query('update kn_nodes set merged_into = $1 where id = $2', [u.mergedInto, u.id]);
  }
  for (const c of w.claims) {
    await tx.query(`insert into kn_claims (id, org_id, discovery_id, subject_id, predicate, object_node_id, object_ref, object_value, scope, polarity,
                       stated, inference_note, interpreted_by, status, superseded_by)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',null)`,
      [c.id, p.orgId, p.discoveryId, c.subjectId, c.predicate, c.objectNodeId, c.objectRef, c.objectValue === null ? null : JSON.stringify(c.objectValue),
       c.scope, c.polarity, c.stated, c.inferenceNote, c.interpretedBy]);
    for (const ev of c.evidenceIds) {
      await tx.query('insert into kn_claim_evidence (claim_id, evidence_id, org_id, discovery_id) values ($1,$2,$3,$4)', [c.id, ev, p.orgId, p.discoveryId]);
    }
  }
  for (const s of w.supersede) await tx.query(`update kn_claims set status = 'superseded', superseded_by = $1 where id = $2`, [s.by, s.id]);
  for (const g of w.gaps) {
    await tx.query(`insert into kn_gaps (org_id, discovery_id, session_id, subject_id, predicate, status, times_asked)
                    values ($1,$2,$3,$4,$5,$6,$7)
                    on conflict (session_id, subject_id, predicate) do update set status = excluded.status, times_asked = excluded.times_asked, updated_at = now()`,
      [p.orgId, p.discoveryId, p.sessionId, g.subjectId, g.predicate, g.status, g.timesAsked]);
  }
}
