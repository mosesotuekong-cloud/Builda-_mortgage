// Sets up or updates the database. Works on Windows, macOS and Linux.
//   npm run migrate
// Uses DATABASE_ADMIN_URL (an administrator connection) from .env, applies each file in db/ once,
// then sets the app's own database password from DATABASE_URL so you don't have to.
import 'dotenv/config';
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('Set DATABASE_ADMIN_URL in .env (an administrator connection, e.g. the postgres user).');

const db = new pg.Client({ connectionString: adminUrl });
await db.connect();
await db.query('create table if not exists schema_migrations (file text primary key, applied_at timestamptz not null default now())');
const done = new Set((await db.query('select file from schema_migrations')).rows.map((r) => r.file));
const files = readdirSync('db').filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
for (const f of files) {
  if (done.has(f)) { console.log(`already applied  ${f}`); continue; }
  try {
    await db.query('begin');
    await db.query(readFileSync(join('db', f), 'utf8'));
    await db.query('insert into schema_migrations (file) values ($1)', [f]);
    await db.query('commit');
    console.log(`applied          ${f}`);
  } catch (err) {
    await db.query('rollback');
    console.error(`FAILED           ${f}: ${(err as Error).message}`);
    process.exit(1);
  }
}
// Production never needs the push-button sign-in's list of every firm's accounts (R2).
if (process.env.NODE_ENV === 'production') {
  await db.query('revoke execute on function signin_directory() from builda_app');
  console.log('production: the sign-in directory function is not available to the app');
}
// The app connects as builda_app (so row-level security applies). Give it the password in DATABASE_URL.
if (appUrl) {
  const u = new URL(appUrl);
  if (u.username === 'builda_app' && u.password) {
    await db.query(`alter role builda_app with login password ${pg.escapeLiteral(decodeURIComponent(u.password))}`);
    console.log('set the password for builda_app from DATABASE_URL');
  } else {
    console.log('Note: DATABASE_URL should connect as builda_app, e.g. postgres://builda_app:<password>@localhost:5432/builda');
  }
}
// The daily retention job connects as builda_retention (R3). Give it the password in RETENTION_DATABASE_URL.
const retentionUrl = process.env.RETENTION_DATABASE_URL;
if (retentionUrl) {
  const u = new URL(retentionUrl);
  if (u.username === 'builda_retention' && u.password) {
    await db.query(`alter role builda_retention with login password ${pg.escapeLiteral(decodeURIComponent(u.password))}`);
    console.log('set the password for builda_retention from RETENTION_DATABASE_URL');
  } else console.log('Note: RETENTION_DATABASE_URL should connect as builda_retention');
}
await db.end();
console.log('Database ready.');
