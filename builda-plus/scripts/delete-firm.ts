// Deletes a TEST firm and everything in it: discoveries, interviews, findings, reports, audit history, its users.
// For test and demo databases only. It needs the administrator connection, because the app itself can never
// delete audit history (by design). Nothing is deleted without --yes.
//
//   List firms:            npx tsx scripts/delete-firm.ts
//   Show what would go:    npx tsx scripts/delete-firm.ts "Test Brokers (made up)"
//   Delete it:             npx tsx scripts/delete-firm.ts "Test Brokers (made up)" --yes
//
// Uses DATABASE_ADMIN_URL (from .env or the command line). This cannot be undone.
import 'dotenv/config';
import pg from 'pg';

if (process.env.NODE_ENV === 'production') throw new Error('Deleting firms is for test and demo databases only, never production.');
const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) throw new Error('Set DATABASE_ADMIN_URL (the administrator connection) for the database to clean up.');

const args = process.argv.slice(2);
const confirm = args.includes('--yes');
const name = args.filter((a) => a !== '--yes').join(' ').trim();

const db = new pg.Client({ connectionString: adminUrl });
await db.connect();
const where = new URL(adminUrl);
console.log(`Database: ${where.hostname}:${where.port || 5432}${where.pathname}\n`);

const firms = await db.query(`select o.id, o.name, to_char(o.created_at, 'DD Mon YYYY') as created,
  (select count(*)::int from discoveries d where d.org_id = o.id) as discoveries,
  (select count(*)::int from participants p where p.org_id = o.id) as people
  from organisations o order by o.created_at`);

if (!name) {
  console.log('Firms in this database:');
  for (const f of firms.rows) console.log(`  “${f.name}”  created ${f.created}, ${f.discoveries} discover${f.discoveries === 1 ? 'y' : 'ies'}, ${f.people} people  (id ${f.id})`);
  console.log('\nTo see what deleting one would remove:  npx tsx scripts/delete-firm.ts "<exact firm name>"');
  await db.end(); process.exit(0);
}

// A firm's id also works, for when two firms share a name.
const matches = firms.rows.filter((f) => f.name === name || f.id === name);
if (matches.length !== 1) {
  console.error(matches.length ? `${matches.length} firms are called “${name}”; nothing deleted. Use the firm’s id instead (run without a name to see ids).` : `No firm is called exactly “${name}”. Run without a name to list them.`);
  await db.end(); process.exit(1);
}
const org = matches[0];

// Every table holding this firm's rows: all tables with an org_id, plus JADA assignments to its discoveries.
const tables = (await db.query(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'org_id'
  and table_name not in ('organisations') order by table_name`)).rows.map((r) => r.table_name as string);
const counts: [string, number][] = [];
for (const t of tables) counts.push([t, (await db.query(`select count(*)::int as n from ${pg.escapeIdentifier(t)} where org_id = $1`, [org.id])).rows[0].n]);
counts.push(['jada_assignments', (await db.query('select count(*)::int as n from jada_assignments where discovery_id in (select id from discoveries where org_id = $1)', [org.id])).rows[0].n]);
// Its people's accounts, unless they also belong to another firm or are JADA staff.
const usersSql = `select id from app_users where id in (select user_id from org_members where org_id = $1)
  and id not in (select user_id from org_members where org_id <> $1) and id not in (select user_id from jada_staff_roles)`;
const users = (await db.query(usersSql, [org.id])).rows.map((r) => r.id);

console.log(`Firm: “${org.name}” (created ${org.created})`);
for (const [t, n] of counts) if (n) console.log(`  ${String(n).padStart(5)}  ${t}`);
console.log(`  ${String(users.length).padStart(5)}  sign-in accounts`);

if (!confirm) {
  console.log('\nNothing deleted. To delete all of the above, run the same command again with --yes at the end.');
  await db.end(); process.exit(0);
}

await db.query('begin');
try {
  // Foreign keys between these tables are checked as a whole at the end, so the order doesn't matter.
  await db.query("set local session_replication_role = 'replica'");
  await db.query('delete from jada_assignments where discovery_id in (select id from discoveries where org_id = $1)', [org.id]);
  for (const t of tables) await db.query(`delete from ${pg.escapeIdentifier(t)} where org_id = $1`, [org.id]);
  await db.query('delete from app_users where id = any($1::uuid[])', [users]);
  await db.query('delete from organisations where id = $1', [org.id]);
  await db.query("set local session_replication_role = 'origin'");
  // Make sure nothing left behind still points at the firm.
  const left = (await db.query(`select count(*)::int as n from discoveries where org_id = $1`, [org.id])).rows[0].n;
  if (left) throw new Error('Something was left behind; rolled back.');
  await db.query('commit');
  console.log(`\nDeleted “${org.name}” and everything in it.`);
} catch (err) {
  await db.query('rollback');
  console.error(`\nNothing deleted: ${(err as Error).message}`);
  process.exitCode = 1;
}
await db.end();
