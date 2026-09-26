// SQLite-backed persistence for the user system. This is the app's *own* store
// (accounts, sessions, saved rolls) — distinct from the remote data.gov.il
// registry that dataset.js reads. One local file, created/migrated on boot.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite"); // built-in (Node >= 22.5)

const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "app.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// ── Roll "days" reset at midnight Israel time, not UTC ─────────────────────────
// created_at is stored as UTC (datetime('now')). To bucket rolls by the Israel
// calendar day, we shift both 'now' and created_at by Israel's current UTC offset
// before calling date(). The offset is computed live so it follows DST (UTC+2 in
// winter, UTC+3 in summer). A roll made in a different DST period than "now" can
// be mislabeled by an hour right at the midnight boundary — a rare edge we accept.
const ISRAEL_TZ = "Asia/Jerusalem";

function israelOffsetMinutes(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ISRAEL_TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
    .formatToParts(at)
    .reduce((o, p) => ((o[p.type] = p.value), o), {});
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}

// A SQLite date() modifier string (e.g. "+180 minutes") that converts a UTC
// timestamp to the Israel wall clock. Fully derived from Intl numeric output, so
// it is safe to embed directly into SQL.
function israelOffset() {
  const m = israelOffsetMinutes();
  return `${m >= 0 ? "+" : "-"}${Math.abs(m)} minutes`;
}

// Today's date as a 'YYYY-MM-DD' string on the Israel calendar (matches
// date('now', israelOffset()) in SQL).
function israelToday() {
  return new Date(Date.now() + israelOffsetMinutes() * 60000).toISOString().slice(0, 10);
}

// Idempotent schema — safe to run on every boot.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,            -- null for Google-only accounts
    google_id     TEXT UNIQUE,     -- null for password-only accounts
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_tokens (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL DEFAULT 'verify',
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rolls (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plate_display TEXT NOT NULL,
    score         INTEGER NOT NULL,
    tier          TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_rolls_user ON rolls(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_rolls_score ON rolls(score DESC);

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint           TEXT NOT NULL UNIQUE,
    p256dh             TEXT NOT NULL,
    auth               TEXT NOT NULL,
    last_notified_date TEXT,                                   -- UTC date string of last reminder sent
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL, -- null = anonymous
    email      TEXT,            -- optional reply-to, stored lowercased/trimmed
    body       TEXT NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(is_read, created_at DESC);

  CREATE TABLE IF NOT EXISTS announcements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    body       TEXT NOT NULL,                              -- markdown source (see public/markdown.js)
    starts_at  TEXT NOT NULL DEFAULT (datetime('now')),
    ends_at    TEXT NOT NULL,                              -- popup hidden once datetime('now') passes this
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    roll_id    INTEGER NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(roll_id, user_id, emoji)                        -- one user, one of each emoji per roll
  );

  CREATE INDEX IF NOT EXISTS idx_reactions_roll ON reactions(roll_id);
`);

// Additive migration: add is_admin column if this is an existing database.
try {
  db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`);
} catch { /* column already exists — safe to ignore on every restart after first */ }

// Additive migration: add total_score column and backfill from existing rolls.
try {
  db.exec(`ALTER TABLE users ADD COLUMN total_score INTEGER NOT NULL DEFAULT 0`);
  // Backfill for pre-existing rows — no-op when the column was just created fresh.
  db.exec(`
    UPDATE users
    SET total_score = (SELECT COALESCE(SUM(score), 0) FROM rolls WHERE user_id = users.id)
  `);
} catch { /* column already exists — safe to ignore on every restart after first */ }

// Additive migration: per-roll streak count + bonus. Existing rows default to a
// bonus of 0, so total_score (= SUM(score)) stays consistent — no re-backfill needed.
try {
  db.exec(`ALTER TABLE rolls ADD COLUMN streak INTEGER NOT NULL DEFAULT 1`);
} catch { /* column already exists — safe to ignore on every restart after first */ }
try {
  db.exec(`ALTER TABLE rolls ADD COLUMN streak_bonus INTEGER NOT NULL DEFAULT 0`);
} catch { /* column already exists — safe to ignore on every restart after first */ }

// Additive migration: streak savers. users.streak_savers is the unspent balance;
// rolls.saver_earned marks the roll that awarded one (so deleting that roll takes it
// back and a re-roll can't farm it). streak_saves records each missed Israel day a
// saver covered; outage_grants makes the free "rolling is down" saver once per day.
try {
  db.exec(`ALTER TABLE users ADD COLUMN streak_savers INTEGER NOT NULL DEFAULT 0`);
} catch { /* column already exists — safe to ignore on every restart after first */ }
try {
  db.exec(`ALTER TABLE rolls ADD COLUMN saver_earned INTEGER NOT NULL DEFAULT 0`);
} catch { /* column already exists — safe to ignore on every restart after first */ }
db.exec(`
  CREATE TABLE IF NOT EXISTS streak_saves (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day        TEXT NOT NULL,                              -- Israel calendar date 'YYYY-MM-DD'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, day)
  );

  CREATE TABLE IF NOT EXISTS outage_grants (
    day        TEXT PRIMARY KEY,                           -- Israel calendar date of the outage
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Users ─────────────────────────────────────────────────────────────────────

const normEmail = (email) => String(email).trim().toLowerCase();

function createUser({ username, email, passwordHash = null, googleId = null, emailVerified = false }) {
  const info = db
    .prepare(
      `INSERT INTO users (username, email, password_hash, google_id, email_verified)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(username, normEmail(email), passwordHash, googleId, emailVerified ? 1 : 0);
  return findUserById(info.lastInsertRowid);
}

function findUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

function findUserByEmail(email) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(normEmail(email));
}

function findUserByUsername(username) {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
}

function findUserByGoogleId(googleId) {
  return db.prepare(`SELECT * FROM users WHERE google_id = ?`).get(googleId);
}

function setGoogleId(userId, googleId) {
  db.prepare(`UPDATE users SET google_id = ? WHERE id = ?`).run(googleId, userId);
}

function verifyUserEmail(userId) {
  db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(userId);
}

// ── Email verification tokens ───────────────────────────────────────────────

function createVerifyToken(userId, ttlMs = 24 * 60 * 60 * 1000) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  db.prepare(
    `INSERT INTO email_tokens (token, user_id, purpose, expires_at) VALUES (?, ?, 'verify', ?)`
  ).run(token, userId, expiresAt);
  return token;
}

// Returns the user_id if the token is valid & unexpired, else null. Single-use:
// a valid token is consumed (deleted) here.
function consumeVerifyToken(token) {
  const row = db
    .prepare(`SELECT user_id, expires_at FROM email_tokens WHERE token = ? AND purpose = 'verify'`)
    .get(token);
  if (!row) return null;
  db.prepare(`DELETE FROM email_tokens WHERE token = ?`).run(token);
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.user_id;
}

// ── Rolls (history & leaderboard) ─────────────────────────────────────────────

function hasRolledToday(userId) {
  const off = israelOffset();
  const row = db
    .prepare(`SELECT 1 FROM rolls WHERE user_id = ? AND date(created_at, '${off}') = date('now', '${off}') LIMIT 1`)
    .get(userId);
  return row != null;
}

function getTodayRoll(userId) {
  const off = israelOffset();
  return db
    .prepare(
      `SELECT id, payload_json FROM rolls WHERE user_id = ? AND date(created_at, '${off}') = date('now', '${off}') ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId);
}

// ── Streak days ──────────────────────────────────────────────────────────────
// A streak is a chain of consecutive Israel days, each either *rolled* or *saved*
// (covered by a streak saver). Saved days bridge the chain but don't add to the
// count — a 10-day streak that burns a saver and rolls the next day becomes 11.

const shiftDay = (day, n) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function rolledDays(userId) {
  const off = israelOffset();
  const rows = db
    .prepare(`SELECT DISTINCT date(created_at, '${off}') AS d FROM rolls WHERE user_id = ?`)
    .all(userId);
  return new Set(rows.map((r) => r.d));
}

function savedDays(userId) {
  const rows = db.prepare(`SELECT day FROM streak_saves WHERE user_id = ?`).all(userId);
  return new Set(rows.map((r) => r.day));
}

// Count rolled days walking back from `start` across rolled-or-saved days.
function walkStreak(start, rolled, saved) {
  let streak = 0;
  for (let d = start; rolled.has(d) || saved.has(d); d = shiftDay(d, -1)) {
    if (rolled.has(d)) streak++;
  }
  return streak;
}

// Live streak as of now: alive only if today or yesterday is rolled/saved.
function liveStreakFrom(rolled, saved) {
  const today = israelToday();
  const yesterday = shiftDay(today, -1);
  const covered = (d) => rolled.has(d) || saved.has(d);
  if (covered(today)) return walkStreak(today, rolled, saved);
  if (covered(yesterday)) return walkStreak(yesterday, rolled, saved);
  return 0; // streak broken
}

// Consecutive Israel-calendar days the user has rolled, counting today's roll
// (which is about to be inserted, so it is not yet in `rolls` when this is called
// from /api/roll). Walks backward from yesterday, bridging saver-covered days —
// call settleStreakSavers first so a just-missed day is covered.
function getCurrentStreak(userId) {
  return 1 + walkStreak(shiftDay(israelToday(), -1), rolledDays(userId), savedDays(userId));
}

// ── Streak savers ────────────────────────────────────────────────────────────

// Spend the user's savers on each fully-missed day since their last covered day,
// oldest first, up to yesterday (today isn't missed yet). Each missed day costs one
// saver; if they run out, the rest of the gap breaks the streak and the spent savers
// stay spent (one is used automatically per missed day). Users who never rolled have
// no streak to save. Returns how many savers were spent.
function settleStreakSavers(userId) {
  const balance = getStreakSavers(userId);
  if (balance <= 0) return 0;
  const rolled = rolledDays(userId);
  if (rolled.size === 0) return 0;
  let last = null;
  for (const d of [...rolled, ...savedDays(userId)]) if (!last || d > last) last = d;

  const yesterday = shiftDay(israelToday(), -1);
  const days = [];
  for (let d = shiftDay(last, 1); d <= yesterday && days.length < balance; d = shiftDay(d, 1)) {
    days.push(d);
  }
  if (days.length === 0) return 0;

  const insert = db.prepare(`INSERT OR IGNORE INTO streak_saves (user_id, day) VALUES (?, ?)`);
  db.exec("BEGIN");
  try {
    for (const d of days) insert.run(userId, d);
    db.prepare(`UPDATE users SET streak_savers = MAX(0, streak_savers - ?) WHERE id = ?`)
      .run(days.length, userId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return days.length;
}

// Settle every user holding savers. Run on a timer so passive views (profile, streak
// leaderboard) show a saved streak even before the user rolls again.
function settleAllStreakSavers() {
  let spent = 0;
  for (const { id } of db.prepare(`SELECT id FROM users WHERE streak_savers > 0`).all()) {
    spent += settleStreakSavers(id);
  }
  return spent;
}

// Missed days covered by savers since the user's last actual roll — what the roll
// reveal reports as "your streak was saved". Call before inserting today's roll.
function countSavesSinceLastRoll(userId) {
  const off = israelOffset();
  const last = db
    .prepare(`SELECT MAX(date(created_at, '${off}')) AS d FROM rolls WHERE user_id = ?`)
    .get(userId)?.d;
  if (!last) return 0;
  return db
    .prepare(`SELECT COUNT(*) AS n FROM streak_saves WHERE user_id = ? AND day > ?`)
    .get(userId, last).n;
}

function getStreakSavers(userId) {
  return db.prepare(`SELECT streak_savers FROM users WHERE id = ?`).get(userId)?.streak_savers ?? 0;
}

// Free saver for every user when rolling is broken (e.g. data.gov.il is down), at
// most once per Israel day. Returns true only for the call that actually granted it.
function grantOutageSaver() {
  const info = db.prepare(`INSERT OR IGNORE INTO outage_grants (day) VALUES (?)`).run(israelToday());
  if (info.changes === 0) return false;
  db.prepare(`UPDATE users SET streak_savers = streak_savers + 1`).run();
  return true;
}

function insertRoll(userId, payload) {
  const streak = payload.streak ?? 1;
  const bonus = payload.streakBonus ?? 0;
  const saverEarned = payload.saverEarned ? 1 : 0;
  const insertStmt = db.prepare(
    `INSERT INTO rolls (user_id, plate_display, score, tier, payload_json, streak, streak_bonus, saver_earned)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Streak bonus lands in the overall total (and cumulative leaderboards) but never
  // in the plate score (rolls.score) or tier.
  const addScore = db.prepare(
    `UPDATE users SET total_score = total_score + ?, streak_savers = streak_savers + ? WHERE id = ?`
  );
  db.exec("BEGIN");
  try {
    insertStmt.run(
      userId, payload.plate.display, payload.score, payload.tier, JSON.stringify(payload), streak, bonus, saverEarned
    );
    addScore.run(payload.score + bonus, saverEarned, userId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function getUserHistory(userId, limit = 50) {
  return db
    .prepare(
      `SELECT plate_display, score, tier, payload_json, created_at
       FROM rolls WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, limit);
}

function getUserTotalScore(userId) {
  return db.prepare(`SELECT total_score FROM users WHERE id = ?`).get(userId)?.total_score ?? 0;
}

// Highest-scoring roll a user has ever made (ties broken by the earliest one).
function getUserBestRoll(userId) {
  return db
    .prepare(
      `SELECT id, plate_display, score, tier, payload_json, created_at
       FROM rolls WHERE user_id = ? ORDER BY score DESC, created_at ASC LIMIT 1`
    )
    .get(userId);
}

function getUserRollCount(userId) {
  return db.prepare(`SELECT COUNT(*) AS cnt FROM rolls WHERE user_id = ?`).get(userId)?.cnt ?? 0;
}

// The user's current streak *as of now* — returns 0 when broken (no roll today or
// yesterday, counting saver-covered days). Unlike getCurrentStreak, this does NOT assume
// a roll is being made right now, so it's the honest value for a passive profile view.
function getLiveStreak(userId) {
  return liveStreakFrom(rolledDays(userId), savedDays(userId));
}

function getTodayRank(userId) {
  const off = israelOffset();
  const myRow = db
    .prepare(`SELECT score FROM rolls WHERE user_id = ? AND date(created_at, '${off}') = date('now', '${off}') ORDER BY created_at DESC LIMIT 1`)
    .get(userId);
  if (!myRow) return null;
  const { rank } = db
    .prepare(`SELECT COUNT(*) + 1 AS rank FROM rolls WHERE date(created_at, '${off}') = date('now', '${off}') AND score > ?`)
    .get(myRow.score);
  return rank;
}

// Leaderboard. The per-roll scopes ('today', '30days', 'alltime') return one row per
// roll, ranked by individual plate score, differing only in the date window. The
// 'overall' scope returns one row per user, ranked by their summed score (streak bonuses
// included, matching users.total_score). Streak rankings live in getStreakLeaderboard.
function getLeaderboard(limit = 50, period = 'today') {
  const PER_ROLL = new Set(['today', '30days', 'alltime']);
  if (PER_ROLL.has(period)) {
    const off = israelOffset();
    const where = {
      today:   `WHERE date(r.created_at, '${off}') = date('now', '${off}')`,
      '30days': `WHERE r.created_at >= datetime('now', '-30 days')`,
      alltime: '',
    }[period];
    return db
      .prepare(
        `SELECT r.id, u.username, r.plate_display, r.score, r.tier, r.created_at, r.payload_json
         FROM rolls r JOIN users u ON u.id = r.user_id
         ${where}
         ORDER BY r.score DESC, r.created_at ASC LIMIT ?`
      )
      .all(limit);
  }

  // 'overall': cumulative per-user total. No best-roll columns — the client shows only
  // the username and total score for this scope.
  return db
    .prepare(
      `SELECT u.username, SUM(r.score) + SUM(r.streak_bonus) AS score
       FROM rolls r JOIN users u ON u.id = r.user_id
       GROUP BY u.id
       ORDER BY score DESC, u.username ASC LIMIT ?`
    )
    .all(limit);
}

// Streak leaderboard: rank users by their *current live* consecutive-day streak. A streak
// is only alive if the user rolled today or yesterday (Israel calendar); otherwise it's
// broken and the user is excluded. Unlike getCurrentStreak (which assumes a roll is being
// made right now and never returns 0), this reflects each user's real standing.
function getStreakLeaderboard(limit = 50) {
  const off = israelOffset();
  const rows = db
    .prepare(
      `SELECT u.id, u.username, date(r.created_at, '${off}') AS d
       FROM rolls r JOIN users u ON u.id = r.user_id
       GROUP BY u.id, d`
    )
    .all();

  // Group distinct Israel-date strings per user.
  const byUser = new Map();
  for (const { id, username, d } of rows) {
    let entry = byUser.get(id);
    if (!entry) {
      entry = { username, rolled: new Set(), saved: new Set() };
      byUser.set(id, entry);
    }
    entry.rolled.add(d);
  }
  for (const { user_id, day } of db.prepare(`SELECT user_id, day FROM streak_saves`).all()) {
    byUser.get(user_id)?.saved.add(day);
  }

  const result = [];
  for (const { username, rolled, saved } of byUser.values()) {
    const streak = liveStreakFrom(rolled, saved);
    if (streak > 0) result.push({ username, streak });
  }

  result.sort((a, b) => b.streak - a.streak || a.username.localeCompare(b.username));
  return result.slice(0, limit);
}

// ── Reactions (emoji reactions on rolls) ──────────────────────────────────────

// Toggle one emoji for one user on one roll. Returns { reacted } — true when the
// reaction was just added, false when it was removed. The UNIQUE(roll_id, user_id,
// emoji) constraint keeps a user to one of each emoji per roll.
function toggleReaction(rollId, userId, emoji) {
  const existing = db
    .prepare(`SELECT 1 FROM reactions WHERE roll_id = ? AND user_id = ? AND emoji = ? LIMIT 1`)
    .get(rollId, userId, emoji);
  if (existing) {
    db.prepare(`DELETE FROM reactions WHERE roll_id = ? AND user_id = ? AND emoji = ?`)
      .run(rollId, userId, emoji);
    return { reacted: false };
  }
  db.prepare(`INSERT INTO reactions (roll_id, user_id, emoji) VALUES (?, ?, ?)`)
    .run(rollId, userId, emoji);
  return { reacted: true };
}

// Aggregate emoji counts for a set of rolls in one query. Returns
// { [rollId]: { emoji: count } }. Empty (and empty input) yields {}.
function getReactionsForRolls(rollIds) {
  if (!rollIds.length) return {};
  const placeholders = rollIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT roll_id, emoji, COUNT(*) AS count
       FROM reactions WHERE roll_id IN (${placeholders})
       GROUP BY roll_id, emoji`
    )
    .all(...rollIds);
  const out = {};
  for (const { roll_id, emoji, count } of rows) {
    (out[roll_id] ||= {})[emoji] = count;
  }
  return out;
}

// The emojis a single user has reacted with, across a set of rolls. Returns
// { [rollId]: [emoji, ...] }.
function getUserReactionsForRolls(rollIds, userId) {
  if (!rollIds.length) return {};
  const placeholders = rollIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT roll_id, emoji FROM reactions
       WHERE user_id = ? AND roll_id IN (${placeholders})`
    )
    .all(userId, ...rollIds);
  const out = {};
  for (const { roll_id, emoji } of rows) {
    (out[roll_id] ||= []).push(emoji);
  }
  return out;
}

// True if a roll exists (used to reject reactions on unknown rolls).
function rollExists(rollId) {
  return db.prepare(`SELECT 1 FROM rolls WHERE id = ? LIMIT 1`).get(rollId) != null;
}

// ── Push subscriptions (daily roll reminders) ─────────────────────────────────

// Upsert by endpoint: a browser hands back the same endpoint when re-subscribing,
// and a shared device can change owner, so we key on the endpoint and refresh the
// owner/keys. last_notified_date is left untouched on update. Returns true when a
// brand-new subscription was inserted (vs. an existing endpoint refreshed), so
// callers can greet only first-time subscribers.
function saveSubscription(userId, sub) {
  const existing = db
    .prepare(`SELECT 1 FROM push_subscriptions WHERE endpoint = ?`)
    .get(sub.endpoint);
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh  = excluded.p256dh,
       auth    = excluded.auth`
  ).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
  return !existing;
}

function deleteSubscription(endpoint) {
  db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
}

function deleteSubscriptionById(id) {
  db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).run(id);
}

// Subscriptions whose owner has not rolled today and who haven't already been
// reminded today. "Today" is the Israel calendar day, matching the roll daily-limit.
function getSubscriptionsToRemind() {
  const off = israelOffset();
  return db
    .prepare(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth
       FROM push_subscriptions s
       WHERE NOT EXISTS (
               SELECT 1 FROM rolls r
               WHERE r.user_id = s.user_id AND date(r.created_at, '${off}') = date('now', '${off}'))
         AND (s.last_notified_date IS NULL OR s.last_notified_date <> date('now', '${off}'))`
    )
    .all();
}

function markSubscriptionNotified(id) {
  const off = israelOffset();
  db.prepare(`UPDATE push_subscriptions SET last_notified_date = date('now', '${off}') WHERE id = ?`).run(id);
}

function getUserSubscriptions(userId) {
  return db
    .prepare(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`)
    .all(userId);
}

// ── Admin helpers ─────────────────────────────────────────────────────────────

function getAdminStats() {
  const off = israelOffset();
  const totalUsers  = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  const newToday    = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE date(created_at, '${off}') = date('now', '${off}')`).get().n;
  const newLast7    = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-7 days')`).get().n;
  const newLast30   = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-30 days')`).get().n;
  const totalRolls  = db.prepare(`SELECT COUNT(*) AS n FROM rolls`).get().n;
  const rollsToday  = db.prepare(`SELECT COUNT(*) AS n FROM rolls WHERE date(created_at, '${off}') = date('now', '${off}')`).get().n;
  const rollsLast7  = db.prepare(`SELECT COUNT(*) AS n FROM rolls WHERE created_at >= datetime('now', '-7 days')`).get().n;
  const activeToday = db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM rolls WHERE date(created_at, '${off}') = date('now', '${off}')`).get().n;
  const tierDist    = db.prepare(`SELECT tier, COUNT(*) AS cnt FROM rolls GROUP BY tier`).all();
  return { totalUsers, newToday, newLast7, newLast30, totalRolls, rollsToday, rollsLast7, activeToday, tierDist };
}

function getAllUsers() {
  const off = israelOffset();
  return db.prepare(`
    SELECT u.id, u.username, u.email, u.email_verified, u.is_admin, u.created_at,
           COUNT(r.id) AS roll_count,
           EXISTS(SELECT 1 FROM rolls t WHERE t.user_id = u.id AND date(t.created_at, '${off}') = date('now', '${off}')) AS rolled_today
    FROM users u
    LEFT JOIN rolls r ON r.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
}

function searchUsers(query) {
  const off = israelOffset();
  const like = `%${query}%`;
  return db.prepare(`
    SELECT u.id, u.username, u.email, u.email_verified, u.is_admin, u.created_at,
           COUNT(r.id) AS roll_count,
           EXISTS(SELECT 1 FROM rolls t WHERE t.user_id = u.id AND date(t.created_at, '${off}') = date('now', '${off}')) AS rolled_today
    FROM users u
    LEFT JOIN rolls r ON r.user_id = u.id
    WHERE u.username LIKE ? OR u.email LIKE ?
    GROUP BY u.id
    ORDER BY u.created_at DESC
    LIMIT 100
  `).all(like, like);
}

function setUserAdmin(userId, isAdmin) {
  db.prepare(`UPDATE users SET is_admin = ? WHERE id = ?`).run(isAdmin ? 1 : 0, userId);
}

function deleteUser(userId) {
  db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
}

function getAllRolls(limit = 100) {
  return db.prepare(`
    SELECT r.id, r.plate_display, r.score, r.tier, r.created_at, u.username
    FROM rolls r
    JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(limit);
}

function deleteRoll(rollId) {
  const roll = db
    .prepare(`SELECT user_id, score, streak_bonus, saver_earned FROM rolls WHERE id = ?`)
    .get(rollId);
  if (!roll) return;
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM rolls WHERE id = ?`).run(rollId);
    db.prepare(
      `UPDATE users SET total_score = MAX(0, total_score - ?), streak_savers = MAX(0, streak_savers - ?)
       WHERE id = ?`
    ).run(roll.score + roll.streak_bonus, roll.saver_earned, roll.user_id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function deleteTodayRoll(userId) {
  const off = israelOffset();
  const row = db.prepare(
    `SELECT COALESCE(SUM(score) + SUM(streak_bonus), 0) AS s, COALESCE(SUM(saver_earned), 0) AS savers
     FROM rolls WHERE user_id = ? AND date(created_at, '${off}') = date('now', '${off}')`
  ).get(userId);
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM rolls WHERE user_id = ? AND date(created_at, '${off}') = date('now', '${off}')`).run(userId);
    if (row.s > 0 || row.savers > 0) {
      db.prepare(
        `UPDATE users SET total_score = MAX(0, total_score - ?), streak_savers = MAX(0, streak_savers - ?)
         WHERE id = ?`
      ).run(row.s, row.savers, userId);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ── Contact messages ──────────────────────────────────────────────────────────

function createMessage({ userId = null, email = null, body }) {
  const cleanEmail = email ? normEmail(email) : null;
  db.prepare(
    `INSERT INTO messages (user_id, email, body) VALUES (?, ?, ?)`
  ).run(userId, cleanEmail, body);
}

function getMessages(limit = 200) {
  return db.prepare(`
    SELECT m.id, m.email, m.body, m.is_read, m.created_at, u.username
    FROM messages m
    LEFT JOIN users u ON u.id = m.user_id
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(limit);
}

function countUnreadMessages() {
  return db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE is_read = 0`).get().n;
}

function setMessageRead(messageId, isRead) {
  db.prepare(`UPDATE messages SET is_read = ? WHERE id = ?`).run(isRead ? 1 : 0, messageId);
}

function deleteMessage(messageId) {
  db.prepare(`DELETE FROM messages WHERE id = ?`).run(messageId);
}

// ── Announcements (site popups) ─────────────────────────────────────────────────

// Window stored as [starts_at, ends_at]. starts_at defaults to now; ends_at is now +
// the admin-chosen duration. Times use SQLite's datetime() (UTC, 'YYYY-MM-DD HH:MM:SS')
// so they compare directly against datetime('now') — same convention as the rest of the
// schema. The duration arrives as whole minutes so it survives the SQL modifier cleanly.
function createAnnouncement({ body, minutes }) {
  const info = db
    .prepare(`INSERT INTO announcements (body, ends_at) VALUES (?, datetime('now', ?))`)
    .run(body, `+${minutes} minutes`);
  return getAnnouncementById(info.lastInsertRowid);
}

function getAnnouncementById(id) {
  return db.prepare(`SELECT id, body, starts_at, ends_at, created_at FROM announcements WHERE id = ?`).get(id);
}

// The single announcement to show right now: the newest whose window is currently open.
function getActiveAnnouncement() {
  return db
    .prepare(
      `SELECT id, body FROM announcements
       WHERE datetime('now') BETWEEN starts_at AND ends_at
       ORDER BY id DESC LIMIT 1`
    )
    .get();
}

function getAllAnnouncements(limit = 100) {
  return db
    .prepare(
      `SELECT id, body, starts_at, ends_at, created_at,
              (datetime('now') BETWEEN starts_at AND ends_at) AS active
       FROM announcements ORDER BY id DESC LIMIT ?`
    )
    .all(limit);
}

function deleteAnnouncement(id) {
  db.prepare(`DELETE FROM announcements WHERE id = ?`).run(id);
}

module.exports = {
  db,
  createUser,
  findUserById,
  findUserByEmail,
  findUserByUsername,
  findUserByGoogleId,
  setGoogleId,
  verifyUserEmail,
  createVerifyToken,
  consumeVerifyToken,
  hasRolledToday,
  getTodayRoll,
  getTodayRank,
  getCurrentStreak,
  settleStreakSavers,
  settleAllStreakSavers,
  countSavesSinceLastRoll,
  getStreakSavers,
  grantOutageSaver,
  insertRoll,
  getUserHistory,
  getUserTotalScore,
  getUserBestRoll,
  getUserRollCount,
  getLiveStreak,
  getLeaderboard,
  getStreakLeaderboard,
  toggleReaction,
  getReactionsForRolls,
  getUserReactionsForRolls,
  rollExists,
  saveSubscription,
  deleteSubscription,
  deleteSubscriptionById,
  getSubscriptionsToRemind,
  markSubscriptionNotified,
  getUserSubscriptions,
  getAdminStats,
  getAllUsers,
  searchUsers,
  setUserAdmin,
  deleteUser,
  getAllRolls,
  deleteRoll,
  deleteTodayRoll,
  createMessage,
  getMessages,
  countUnreadMessages,
  setMessageRead,
  deleteMessage,
  createAnnouncement,
  getActiveAnnouncement,
  getAllAnnouncements,
  deleteAnnouncement,
};
