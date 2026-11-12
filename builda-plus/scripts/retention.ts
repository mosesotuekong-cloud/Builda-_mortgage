// The retention job (R3). Run it once a day (for example a Railway cron or a scheduled task).
// It connects as builda_retention, a database role that can do nothing except the purge and withdrawal
// functions, never as the web app or an administrator.
//
//   Remove content whose retention period has ended:   npm run retention
//   Show what is due without removing anything:        npm run retention -- --dry-run
//   Withdraw one person on a request JADA took:        npm run retention -- withdraw <participant id> --requested-by "Jo Smith"
//
// Needs RETENTION_DATABASE_URL (postgres://builda_retention:<password>@…) and RETENTION_MONTHS.
// Every purge and withdrawal is recorded in retention_events, with counts and no content.
import 'dotenv/config';
import pg from 'pg';

const url = process.env.RETENTION_DATABASE_URL;
const months = Number(process.env.RETENTION_MONTHS);
if (!url) throw new Error('Set RETENTION_DATABASE_URL (the builda_retention connection).');
if (!Number.isInteger(months) || months <= 0) throw new Error('Set RETENTION_MONTHS: the retention job refuses to run without it.');
if (new URL(url).username !== 'builda_retention') throw new Error('RETENTION_DATABASE_URL must connect as builda_retention.');

const args = process.argv.slice(2);
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  if (args[0] === 'withdraw') {
    const participantId = args[1];
    const i = args.indexOf('--requested-by');
    const who = i > 0 ? (args[i + 1] ?? '').trim() : '';
    if (!participantId || !who) throw new Error('Usage: npm run retention -- withdraw <participant id> --requested-by "<who at JADA took the request>"');
    const r = await db.query('select withdraw_participant($1, $2) as counts', [participantId, `jada:${who}`]);
    console.log(r.rows[0].counts ? `Withdrawn: ${JSON.stringify(r.rows[0].counts)}` : 'Nothing to do: no such participant, or already withdrawn.');
    console.log('Ask the firm lead to re-analyse the interviews so the findings no longer count this person.');
  } else {
    const due = (await db.query('select * from retention_due($1)', [months])).rows;
    console.log(`${due.length} discover${due.length === 1 ? 'y' : 'ies'} past ${months} months of retention.`);
    for (const d of due) {
      if (args.includes('--dry-run')) { console.log(`due  ${d.discovery_id}  (retention counted from ${d.retention_from.toISOString().slice(0, 10)})`); continue; }
      const r = await db.query('select purge_discovery_content($1) as counts', [d.discovery_id]);
      console.log(`purged  ${d.discovery_id}  ${JSON.stringify(r.rows[0].counts)}`);
    }
  }
} finally {
  await db.end();
}
