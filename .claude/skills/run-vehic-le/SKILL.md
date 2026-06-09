---
name: run-vehic-le
description: Set up and run the vehic-le app on a local test server with seeded accounts and fake rolls. Use when asked to "run vehic-le locally", "set up the local/test server", "seed the database", "create test accounts", "add an admin/user account", "log in locally", or to get a working local instance to click around in. Creates admin/1234 and user/1234 plus a spread of fake rolls (S→D tier).
---

# Run vehic-le locally (seeded test server)

A small Node + Express app backed by a local SQLite file (`data/app.db`, auto-created
on boot). This skill stands up a **local test server** with two known accounts and a
spread of fake rolls so you can log in and see history/leaderboard immediately.

- **Seed driver:** [.claude/skills/run-vehic-le/seed.js](.claude/skills/run-vehic-le/seed.js)
  — creates `admin/1234` (admin) + `user/1234`, then builds fake rolls through the
  **real** scorer (`buildRollPayload`) and saves them via the **real** store
  (`insertRoll`), so scores, tiers, `total_score`, history, and leaderboard are all
  consistent — exactly as a live roll would be.
- **Server:** plain `npm start` (no build step).

Paths below are relative to the project root.

## Prerequisites

- **Node ≥ 22.5** — required for global `fetch` and the built-in `node:sqlite` module
  (this repo has no native SQLite addon). Verified here on `v24.14.1`.
- No `.env` is needed for local dev: the app boots with all-default config (push and
  Google sign-in silently disable themselves; email verification logs to console).

## Setup

```bash
npm install
```

## Run (agent path)

Start the server and seed it. The seed talks to the same `data/app.db` the server uses,
so order doesn't matter — seed before or after `npm start`.

```bash
# 1. seed accounts + fake rolls (idempotent — deletes & recreates the two seed accounts)
node .claude/skills/run-vehic-le/seed.js

# 2. start the server (foreground; Ctrl-C to stop)
npm start
```

Expected seed output (a full S→D spread; plates/perks are deterministic):

```
✓ accounts: admin (#1, is_admin=1) | user (#2)
✓ user  S  286pt  777-77-777  [ספרה בודדה, שלשה ברצף, 777, ... 16 perks]
✓ admin A   89pt  122-22-361  [שלשה ברצף, בלי אפסים, רביעיה ברצף, רביעייה, קצוות זהים]
✓ user  B   36pt  779-43-912  [סכום מתחלק בשבע, בלי אפסים]
✓ admin C   24pt  796-23-145  [ללא מספרים חוזרים, בלי אפסים, פאי]
✓ user  D    9pt  779-95-509  [—]
```

Accounts only, no fake rolls:

```bash
node .claude/skills/run-vehic-le/seed.js --no-rolls
```

### Verify it works (curl smoke test)

With the server running (replace `3000` with the actual port if it auto-picked another):

```bash
# log in as admin and keep the session cookie
curl -s -c /tmp/cj.txt -X POST "http://localhost:3000/api/auth/login" \
  -H "Content-Type: application/json" -d '{"identifier":"admin","password":"1234"}'

# the seeded leaderboard — should list S, A, B, C, D rows for user/admin
curl -s "http://localhost:3000/api/leaderboard?period=today"
```

A successful login returns `{"user":{...,"isAdmin":true}}`. The leaderboard lists the
five seeded rolls. Log in through the browser the same way at `/` → top-right login.

## Run (human path)

```bash
npm start          # → http://localhost:3000
```

Open the page, click the plate to roll, or log in with `admin/1234` / `user/1234`.
Identical to the agent path minus the seed — without seeding, history/leaderboard
start empty and password login requires a verified account.

## Gotchas

- **Seed accounts use password `1234` (4 chars).** The `/api/auth/register` endpoint
  enforces 8+ chars, but the seed writes straight to the store via `db.createUser`, so
  it bypasses that — intentional, for a memorable test login. Don't expect to *register*
  these through the UI.
- **Seed sets `email_verified = 1` directly.** Password login is otherwise blocked until
  email verification (and there's no SMTP in dev — the link only logs to console). The
  seed skips that so you can log in instantly.
- **Re-running the seed deletes & recreates `admin` and `user`** (their rolls cascade).
  Their numeric `id`s change each run, which invalidates any open browser session for
  those accounts — just log in again. Other hand-made accounts are untouched.
- **Daily roll limit doesn't block the seed.** `/api/roll` allows one roll/user/day, but
  the seed calls `insertRoll` directly, so it can stack a full S→D spread dated today.
- **Tiers are found by brute-forcing plate digits** through the real scorer until the
  score lands in each band (S≥90, A 60-89, B 30-59, C 15-29, D<15). The PRNG is seeded,
  so the plates above are reproducible. If you edit `server/scoring.js` substantially and
  a band can't be hit, the seed throws `could not find a plate for tier band ...`.
- **`ExperimentalWarning: SQLite is an experimental feature`** on every Node invocation is
  expected (`node:sqlite`), not an error.

## Troubleshooting

- **Port 3000 in use** → the server (or `preview_start`) auto-picks a free port; read the
  actual port from the `[server] listening on http://localhost:PORT` log line and use it
  in the curl commands.
- **`Cannot find module '../../../server/db'`** → run the seed from the **project root**
  (`node .claude/skills/run-vehic-le/seed.js`), not from inside the skill directory; the
  `require` paths are relative to the script's location and resolve against the repo.
- **Login returns 401 `יש לאמת...`** → you're hitting an account created through the UI
  (unverified), not a seeded one. Re-run the seed, or log in as `admin`/`user`.
