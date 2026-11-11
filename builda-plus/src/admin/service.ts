import pg from 'pg';
import type { Db } from '../db/pool';
import type { LLMProvider } from '../llm/provider';
import { createDemoFirm, DEMO_FIRM, DEMO_LEAD } from './demoFirm';

// The JADA admin page: every firm in this database, the saved demo firm, and deleting a firm.
// It uses the administrator connection, because the app itself can never see across firms or delete audit
// history (by design). The server only creates this service outside production, and every route is for
// signed-in JADA staff. Deleting cannot be undone, so it needs the firm's exact name typed back.

export interface FirmRow { id: string; name: string; createdAt: string; discoveries: number; people: number; reports: number; isDemo: boolean }

export class AdminService {
  private creating = false;
  constructor(private db: Db, private admin: pg.Pool, private opts: { appBaseUrl: string; llmFor?: (s: { orgId: string; discoveryId: string }) => LLMProvider }) {}

  async firms(): Promise<FirmRow[]> {
    const r = await this.admin.query(`select o.id, o.name, o.created_at,
        (select count(*)::int from discoveries d where d.org_id = o.id) as discoveries,
        (select count(*)::int from participants p where p.org_id = o.id) as people,
        (select count(*)::int from reports x where x.org_id = o.id) as reports
      from organisations o order by o.created_at desc`);
    return r.rows.map((f) => ({ id: f.id, name: f.name, createdAt: f.created_at.toISOString(), discoveries: f.discoveries, people: f.people, reports: f.reports, isDemo: f.name === DEMO_FIRM }));
  }

  // The saved demonstration firm, with the complete flow up to the report and approved priorities.
  async createDemo(): Promise<{ name: string; signInAs: string }> {
    if (this.creating) throw Object.assign(new Error('The demo firm is already being created. Give it a minute.'), { statusCode: 409 });
    this.creating = true;
    try {
      await createDemoFirm(this.db, this.admin, this.opts);
      return { name: DEMO_FIRM, signInAs: DEMO_LEAD };
    } finally { this.creating = false; }
  }

  // First start on a new server: no JADA accounts yet, so nobody could reach this page. Create the demo firm,
  // which brings its "Demo Engineer (synthetic)" JADA account with it. Once any JADA account exists this does
  // nothing, so deleting the demo firm later never brings it back on a restart.
  async bootstrap(): Promise<'created' | 'skipped'> {
    const jada = (await this.admin.query("select count(*)::int as n from app_users where kind = 'jada'")).rows[0].n;
    if (jada > 0) return 'skipped';
    if ((await this.admin.query('select 1 from organisations where name = $1', [DEMO_FIRM])).rowCount) return 'skipped';
    await this.createDemo();
    return 'created';
  }

  async deleteFirm(orgId: string, confirmName: unknown, actor: string): Promise<{ deleted: string }> {
    if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw Object.assign(new Error('That firm doesn’t exist.'), { statusCode: 404 });
    const org = (await this.admin.query('select id, name from organisations where id = $1', [orgId])).rows[0];
    if (!org) throw Object.assign(new Error('That firm doesn’t exist (it may already have been deleted).'), { statusCode: 404 });
    if (typeof confirmName !== 'string' || confirmName.trim() !== org.name) {
      throw Object.assign(new Error('Type the firm’s name exactly as shown to confirm.'), { statusCode: 400 });
    }
    // Every table holding this firm's rows: all tables with an org_id, plus JADA assignments to its discoveries.
    const tables = (await this.admin.query(`select distinct table_name from information_schema.columns where table_schema = 'public' and column_name = 'org_id'
      and table_name <> 'organisations' and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
      order by table_name`)).rows.map((r) => r.table_name as string);
    const client = await this.admin.connect();
    try {
      await client.query('begin');
      // Its people's sign-in accounts, unless they also belong to another firm or are JADA staff.
      const users = (await client.query(`select id from app_users where id in (select user_id from org_members where org_id = $1)
        and id not in (select user_id from org_members where org_id <> $1) and id not in (select user_id from jada_staff_roles)`, [org.id])).rows.map((r) => r.id);
      // Foreign keys between these tables are checked as a whole at the end, so the order doesn't matter.
      await client.query("set local session_replication_role = 'replica'");
      await client.query('delete from jada_assignments where discovery_id in (select id from discoveries where org_id = $1)', [org.id]);
      for (const t of tables) await client.query(`delete from ${pg.escapeIdentifier(t)} where org_id = $1`, [org.id]);
      await client.query('delete from app_users where id = any($1::uuid[])', [users]);
      await client.query('delete from organisations where id = $1', [org.id]);
      await client.query("set local session_replication_role = 'origin'");
      if ((await client.query('select count(*)::int as n from discoveries where org_id = $1', [org.id])).rows[0].n) throw new Error('Something was left behind; nothing was deleted.');
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally { client.release(); }
    console.log(`JADA admin: ${actor} deleted the firm “${org.name}” (${org.id}).`);
    return { deleted: org.name };
  }
}
