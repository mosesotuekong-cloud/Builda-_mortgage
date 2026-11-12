// R2: the definer functions take identity from the transaction, never from a parameter; pick-up only
// accepts a waiting discovery; release ends access at once; rows can't point at another firm's rows.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { withJadaContext } from '../src/db/pool';
import { JadaService } from '../src/implementation/service';

const APP = process.env.TEST_DATABASE_URL, ADMIN = process.env.TEST_ADMIN_DATABASE_URL;

describe.skipIf(!APP || !ADMIN)('database authorisation (R2)', () => {
  const db = new pg.Pool({ connectionString: APP });
  const admin = new pg.Pool({ connectionString: ADMIN });
  const jada = new JadaService(db);
  const engineer = randomUUID(), second = randomUUID(), editor = randomUUID();
  const orgA = randomUUID(), orgB = randomUUID();
  let waiting = '', notWaiting = '', otherFirm = '';
  const asUser = (user: string, sql: string, params: unknown[] = []) => withJadaContext(db, user, (tx) => tx.query(sql, params));
  const seesDiscovery = async (user: string, id: string) => (await asUser(user, 'select id from discoveries where id = $1', [id])).rowCount === 1;

  beforeAll(async () => {
    for (const u of [engineer, second]) await admin.query("insert into jada_staff_roles (user_id, role) values ($1, 'engineer')", [u]);
    await admin.query("insert into jada_staff_roles (user_id, role) values ($1, 'knowledge_editor')", [editor]);
    await admin.query("insert into organisations (id, name) values ($1, 'R2 Firm A'), ($2, 'R2 Firm B')", [orgA, orgB]);
    const disc = async (org: string, status: string) => (await admin.query(
      `insert into discoveries (org_id, status, playbook_version, scoring_config_version, created_by) values ($1,$2,'x','x',gen_random_uuid()) returning id`, [org, status])).rows[0].id as string;
    waiting = await disc(orgA, 'priorities_approved');
    notWaiting = await disc(orgA, 'interviews');
    otherFirm = await disc(orgB, 'interviews');
  });
  afterAll(async () => { await db.end(); await admin.end(); });

  it('gives nothing to a caller with no identity', async () => {
    expect((await db.query('select * from jada_queue()')).rows).toEqual([]);
    expect((await db.query('select jada_pick_up($1) as r', [waiting])).rows[0].r).toBe('no_identity');
    expect((await db.query('select jada_release($1) as r', [waiting])).rows[0].r).toBe(false);
    expect((await db.query('select * from knowledge_candidates($1)', [[]])).rows).toEqual([]);
  });

  it('no longer accepts a user id as a parameter', async () => {
    await expect(db.query('select * from jada_queue($1)', [engineer])).rejects.toThrow(/does not exist/);
    await expect(db.query('select jada_pick_up($1, $2)', [engineer, waiting])).rejects.toThrow(/does not exist/);
  });

  it('pick-up refuses a non-engineer and a discovery that isn’t waiting', async () => {
    expect((await asUser(editor, 'select jada_pick_up($1) as r', [waiting])).rows[0].r).toBe('not_engineer');
    expect((await asUser(engineer, 'select jada_pick_up($1) as r', [notWaiting])).rows[0].r).toBe('not_waiting');
    expect((await asUser(engineer, 'select jada_pick_up($1) as r', [randomUUID()])).rows[0].r).toBe('not_found');
    expect(await seesDiscovery(engineer, notWaiting)).toBe(false);
  });

  it('pick-up assigns a waiting discovery once, and another engineer can’t take it', async () => {
    expect((await jada.queue(engineer)).map((q) => q.discoveryId)).toContain(waiting);
    await jada.pickUp(engineer, waiting);
    expect(await seesDiscovery(engineer, waiting)).toBe(true);
    expect((await asUser(second, 'select jada_pick_up($1) as r', [waiting])).rows[0].r).toBe('taken');
    expect(await seesDiscovery(second, waiting)).toBe(false);
  });

  it('release ends access immediately and is audited', async () => {
    await expect(jada.release(second, waiting)).rejects.toThrow(/aren’t assigned/);
    await jada.release(engineer, waiting);
    expect(await seesDiscovery(engineer, waiting)).toBe(false);
    const audit = await admin.query("select action from audit_log where discovery_id = $1 order by id", [waiting]);
    expect(audit.rows.map((r) => r.action)).toEqual(['jada.picked_up', 'jada.released']);
  });

  it('a row can’t point at another firm’s discovery or person', async () => {
    await expect(admin.query(
      `insert into participants (org_id, discovery_id, display_name, pseudonym, role) values ($1,$2,'Someone','P1','adviser')`, [orgA, otherFirm]))
      .rejects.toThrow(/same_firm/);
    const p = (await admin.query(
      `insert into participants (org_id, discovery_id, display_name, pseudonym, role) values ($1,$2,'Someone','P1','adviser') returning id`, [orgB, otherFirm])).rows[0].id;
    await expect(admin.query(
      `insert into invitations (org_id, discovery_id, participant_id, token_hash, expires_at) values ($1,$2,$3,$4, now() + interval '1 day')`,
      [orgA, notWaiting, p, randomUUID()])).rejects.toThrow(/same_firm/);
  });
});
