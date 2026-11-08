# Hosting a private demo

A private demo is builda+ on a web address you can open from another device or share with a few people,
using **synthetic data only**. It is not a pilot: no real firm, no real staff, no real client details
(see `pilot-go-no-go.md` for what a pilot needs).

## The safeguard

builda+ still uses the demo sign-in, where anyone can pick any account. So online it sits behind one
shared password:

- Set `DEMO_ACCESS_PASSWORD` (at least 12 characters). Every page, API call and interview link then asks for
  it first, through the browser's own password prompt (any user name; only the password counts).
- The server **refuses to start** if `APP_BASE_URL` isn't this computer and no password is set.
- Search engines are asked not to index anything (`X-Robots-Tag: noindex, nofollow`).
- Share the password separately from the link (for example, the link by email and the password by text message).
- Change the password after each demo, or whenever someone shouldn't have access any more.

## Recommended: a tunnel from this computer

The app and the demo database stay on this computer; a tunnel gives it a temporary `https://` address.
This needs no hosting account and no copy of the database anywhere else. This computer must stay on
and awake during the demo, and the address changes each time you start the tunnel.

1. Install Cloudflare's tunnel tool (once):
   `winget install --id Cloudflare.cloudflared`
2. Make sure the local database is running, and that `builda_demo` has the synthetic firm
   (`scripts/demo-seed.ts`; see `demo-runbook.md`).
3. Start the tunnel and leave it running. It prints an address like `https://<random-words>.trycloudflare.com`:
   `cloudflared tunnel --url http://localhost:3005`
4. In a second terminal, from `builda-plus`, start builda+ with that address and your password
   (PowerShell; the AI uses the key in `.env`):
   ```powershell
   $env:DATABASE_URL='postgres://builda_app:<password>@localhost:5433/builda_demo'; $env:PORT='3005'; $env:APP_BASE_URL='https://<random-words>.trycloudflare.com'; $env:DEMO_ACCESS_PASSWORD='<choose 12+ characters>'; npm start
   ```
   `APP_BASE_URL` must be the tunnel address, so that interview links point to it.
5. Open the tunnel address, enter the password, and sign in as the synthetic firm lead.
6. When you've finished, stop both terminals (Ctrl+C). The address stops working straight away.

Cloudflare describes quick tunnels as being for testing, without an uptime guarantee. That's fine for a demo,
but have the local copy (`http://localhost:3002`) ready as a fallback.

## Cloud host: Railway

The demo stays up when this computer is off. Railway runs the container (`Dockerfile`) and a PostgreSQL
database side by side. Its database user can create the `builda_app` role that the migrations need, which
some managed databases don't allow. Railway's command-line tool uploads this folder directly, so nothing
has to be committed or pushed first. Railway is a paid service after its trial; check its current pricing.

What's in the folder for this:
- `Dockerfile`: builds the app (Node 22, runs as a non-root user). `.dockerignore` keeps `.env`, tests and docs out of the image.
- `railway.json`: build with the Dockerfile, run `npm run migrate` before each deploy, health check on `/healthz`
  (the only path outside the demo password; it returns `{"ok":true}` and nothing else).

### One-time setup

1. Create a Railway account at railway.com (you do this; it needs your email and, after the trial, a card).
2. Install the tool and sign in: `npm install -g @railway/cli`, then `railway login`.
3. From `builda-plus`: `railway init` and name the project (for example `builda-plus-demo`).
4. In the Railway dashboard: **Create → Database → PostgreSQL**.
5. Create the app service: from `builda-plus`, run `railway up` once (the first deploy fails until the variables
   below exist; that's expected). Then in the dashboard open that service → **Settings → Networking →
   Generate Domain**. Note the `https://….up.railway.app` address.
6. In the app service → **Variables**, add (`${{Postgres.…}}` references are filled in by Railway):

   | Variable | Value |
   |---|---|
   | `DATABASE_ADMIN_URL` | `${{Postgres.DATABASE_URL}}` |
   | `DATABASE_URL` | `postgres://builda_app:<a new random password>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` |
   | `SESSION_SECRET` | 64 random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `APP_BASE_URL` | the `https://….up.railway.app` address from step 5 |
   | `DEMO_ACCESS_PASSWORD` | the shared demo password, 12+ characters |
   | `OPENAI_API_KEY`, `OPENAI_MODEL` | as in your `.env` (ideally a separate key with a low spending limit) |
   | `RETENTION_MONTHS`, `JADA_CONTACT` | as in your `.env` |

   Don't set `NODE_ENV=production`: this is a demo, and the demo seed refuses to run in production.
7. Deploy: `railway up`. The pre-deploy step applies the migrations and sets `builda_app`'s password.
8. Load the synthetic firm (once): `railway ssh`, then inside the container run
   `DEMO_SEED=yes node_modules/.bin/tsx scripts/demo-seed.ts`, then `exit`. (It ends by mentioning
   `localhost:3000`; ignore that and use your Railway address.)
9. Open the address, enter the demo password, and sign in as the synthetic firm lead.

### Afterwards

- To update the demo after changes here: `railway up` from `builda-plus`.
- To change the password: edit `DEMO_ACCESS_PASSWORD` in Variables (Railway redeploys).
- To stop paying for it: delete the project in the Railway dashboard. That deletes the demo database too.

The same container runs on other hosts (Render, Fly.io and so on) if their PostgreSQL lets the admin user
create roles and the `pgcrypto` extension. Check that first.

## Before every demo

- Only synthetic data: the seeded "Synthetic Demo Mortgages (not a real firm)". Anyone who does a practice
  interview should make up their answers and leave out real names, clients and colleagues.
- Interviews and Plus send text to OpenAI using the key in `.env`. Check your OpenAI usage limit.
- The demo sign-in screen lists every account in that database, so don't put anything else in it.
