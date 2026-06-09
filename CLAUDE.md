# CLAUDE.md

Guidance for working in this repo. For a user-facing overview see [README.md](README.md).

## What this is

A small Node + Express web app. The browser rolls a random Israeli license plate; the
**server** picks the record from the public data.gov.il vehicle registry, scores it, and
returns a finished payload. The client only plays the reveal animation. This split is the
whole point — it stops users from picking their own rare plate or faking a score.

It also has a **user system**: register (username/email/password with email verification)
or sign in with Google, plus per-user saved roll history and a global leaderboard. Accounts,
sessions, and saved rolls live in a local SQLite file (the app's *own* store, separate from
the remote registry it reads to roll plates).

## Layout

```
package.json     deps + "npm start" → node server/index.js, engines node>=22.5
.env             runtime config (gitignored — copy from .env.example, fill in values)
.env.example     config template with all supported keys documented
server/
  index.js       Express app: session+passport wiring, static, GET /api/roll (+ saves roll)
  dataset.js     data.gov.il client: cached row count + random-offset record fetch
  scoring.js     all scoring tables/logic + buildRollPayload (the client-ready shape)
  db.js          node:sqlite store — schema bootstrap + all query helpers
  session-store.js  custom express-session store backed by the same node:sqlite db
  auth.js        passport (local + Google) strategies and /api/auth/* routes
  mailer.js      nodemailer SMTP verification email; falls back to console log in dev
  rolls.js       GET /api/me/history, /api/leaderboard, /api/perks (read-only)
public/          static client, served as-is
  index.html     roll page + login/register modal (Hebrew, RTL)
  styles.css     all styles: slot-reel/count-up animations + auth/table UI
  app.js         roll animation only — fetches /api/roll and plays it back
  perks.js       shared perk-chip factory + tap-to-show description popover (uses /api/perks)
  auth.js        auth header, modal tabs, verification/OAuth redirect notices
  history.html   logged-in user's saved rolls, newest first
  leaderboard.html  global top-50 rolls, sorted by score desc
data/app.db      SQLite file, auto-created on first boot (directory + file are gitignored)
```

There is no build step and no framework on the client. The app's own data lives in SQLite
via Node's **built-in `node:sqlite`** (no native addon to compile). The remote data.gov.il
datastore is the source of plate records only. No automated test suite.

## How a roll flows

1. Client click handler ([public/app.js](public/app.js)) calls `GET /api/roll`.
2. [`rollRecord`](server/dataset.js) picks `randInt(0, cachedTotal-1)` **server-side** and
   fetches that single record. This random offset is the anti-cheat core — never move it
   to the client.
3. [`buildRollPayload`](server/scoring.js) scores the record and returns
   `{ plate, fields, platePerks, score, tier }`.
4. Client animates: `revealPlate` (slot reels) then `revealScoring` (count-up + tier badge).
5. If a user is logged in, the **server** also persists the roll inside the `/api/roll`
   handler using its own authoritative payload — the client never submits a score.

## How auth flows

- **Register:** `POST /api/auth/register` validates input, hashes the password with bcryptjs,
  creates the user with `email_verified = 0`, generates a single-use token in `email_tokens`,
  and calls `sendVerificationEmail`. The account exists immediately; login is blocked until
  verification. If SMTP send fails, the account is still created and the verify link is logged
  to the console so you can verify manually.
- **Verify:** `GET /api/auth/verify?token=...` consumes the token (deletes it), sets
  `email_verified = 1`, then redirects to `/?verified=1`. Tokens expire after 24h.
- **Login:** `POST /api/auth/login` (Passport LocalStrategy) accepts username or email,
  checks the bcrypt hash, and rejects unverified accounts with a clear message.
- **Google OAuth:** `GET /api/auth/google` → Google consent → `GET /api/auth/google/callback`.
  On callback, if a `users` row with the same Google ID exists, it's used. If an existing
  account shares the same email, the Google ID is linked to it. Otherwise a new account is
  created with a derived username and `email_verified = 1` (Google is trusted).
- **Session:** cookie-based via `express-session`. The store is a tiny custom class in
  `session-store.js` backed by the `sessions` table in `data/app.db`. Sessions expire after
  30 days; a cleanup timer runs every 15 minutes.

## Database structure (`data/app.db`)

All tables are created idempotently on boot in [`server/db.js`](server/db.js).

### `users`
| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | auto-increment |
| `username` | TEXT UNIQUE | 3-20 chars, letters/digits/underscore/Hebrew |
| `email` | TEXT UNIQUE | always stored lowercase |
| `email_verified` | INTEGER | 0 = unverified, 1 = verified |
| `password_hash` | TEXT | bcryptjs hash; NULL for Google-only accounts |
| `google_id` | TEXT UNIQUE | NULL for password-only accounts |
| `created_at` | TEXT | ISO datetime (SQLite default) |

### `email_tokens`
| column | type | notes |
|---|---|---|
| `token` | TEXT PK | 32-byte random hex, single-use |
| `user_id` | INTEGER | FK → `users.id` (CASCADE DELETE) |
| `purpose` | TEXT | currently always `'verify'` |
| `expires_at` | TEXT | ISO datetime; token is invalid after this |

Tokens are deleted on consumption (`consumeVerifyToken`) regardless of expiry, so they are
always single-use. Expired-but-unconsumed tokens are harmless (rejected on lookup).

### `rolls`
| column | type | notes |
|---|---|---|
| `id` | INTEGER PK | auto-increment |
| `user_id` | INTEGER | FK → `users.id` (CASCADE DELETE) |
| `plate_display` | TEXT | formatted plate string e.g. `12-345-67` |
| `score` | INTEGER | server-authoritative final score |
| `tier` | TEXT | S / A / B / C / D |
| `payload_json` | TEXT | full JSON of the roll payload |
| `created_at` | TEXT | ISO datetime |

Indexed on `(user_id, created_at DESC)` for history queries and on `score DESC` for the
leaderboard. Anonymous rolls are never written here.

### `sessions`
| column | type | notes |
|---|---|---|
| `sid` | TEXT PK | session ID (from express-session) |
| `data` | TEXT | JSON-serialised session object |
| `expires_at` | INTEGER | Unix-ms timestamp; rows past this are ignored and purged |

Managed entirely by `session-store.js` — do not write to this table directly.

## Conventions & gotchas

- **Keep scoring server-only.** All tables (`MANUFACTURER_POINTS`, `MODEL_SCORES`,
  `COLOR_POINTS`, `FUEL_POINTS`, `PLATE_PERKS`, the `SCORERS` map) live in
  [server/scoring.js](server/scoring.js). Do **not** reintroduce them, the dataset URL, or
  the random roll into `public/`. The client keeps only a tiny duplicate `tierFor` used to
  animate the badge mid-count-up; the server still sends the authoritative final `tier`.
- **Lookup tables are order-sensitive.** `lookupPoints` returns the first substring match,
  so more specific keys must precede ones they contain (e.g. `"חשמל/בנזין"` before
  `"בנזין"`, `"כסף"` before `"אפור"`). Comments in the tables flag these — preserve order
  when editing.
- **`buildRollPayload` drops empty fields** (null/undefined/"") and emits `fields` in
  `FIELDS` order. The client renders the array verbatim — it no longer knows field labels
  or order, so any display change to which/how fields show happens here.
- **Hebrew + RTL.** Field labels, perk names, and UI text are Hebrew. Source strings are
  literal Hebrew, not escaped.
- **Row count is cached, not per-roll.** [`startRefreshTimer`](server/dataset.js) fetches
  the total once at boot and every 6h (`REFRESH_MS`). Don't add a count fetch to the roll
  path; `rollRecord` only lazily refreshes if the cache is still empty.
- **Node 22.5+ required** — for global `fetch` *and* the built-in `node:sqlite` module
  (declared in `package.json` engines). `node:sqlite` emits an `ExperimentalWarning` on
  boot; that's expected.
- **Saving a roll stays server-side.** Rows in `rolls` are written only inside `/api/roll`
  from the server's own payload. `rolls.js` is read-only — never add a client-driven
  "save my score" endpoint.
- **Email verification is required for password login.** Google accounts skip this (trusted
  as verified). If SMTP is not configured, `mailer.js` logs the verify link to the console
  instead — that's the intended dev workflow. If SMTP *is* configured but fails, the account
  is still created and the link is logged as a fallback (registration never 500s).
- **SMTP config:** `SMTP_HOST` must be the mail server hostname (e.g. `smtp.gmail.com`), not
  the email address. For Gmail App Passwords, remove all spaces from the 16-char password.
- **Config via `.env`** (loaded by `dotenv` at the top of `index.js`): `SESSION_SECRET`,
  `APP_BASE_URL`, `GOOGLE_CLIENT_ID/SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASS`, `MAIL_FROM`. See `.env.example`. `PORT` overrides default `3000`. Google
  sign-in is silently disabled when `GOOGLE_CLIENT_ID/SECRET` are absent.

## Resetting the database (dev)

To wipe all accounts, sessions, rolls, and tokens without dropping the schema:

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/app.db');
db.exec('PRAGMA foreign_keys=ON');
db.exec('DELETE FROM rolls');
db.exec('DELETE FROM email_tokens');
db.exec('DELETE FROM sessions');
db.exec('DELETE FROM users');
console.log('DB reset');
"
```

## Running

```bash
npm install
cp .env.example .env   # then fill in SESSION_SECRET and SMTP_* values
npm start              # http://localhost:3000
```

Manual verification: `curl http://localhost:3000/api/roll` a few times (each returns a
different scored payload), and load the page to eyeball the animation. There are no
automated tests.
