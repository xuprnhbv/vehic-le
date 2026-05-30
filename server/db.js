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
  const row = db
    .prepare(`SELECT 1 FROM rolls WHERE user_id = ? AND date(created_at) = date('now') LIMIT 1`)
    .get(userId);
  return row != null;
}

function getTodayRoll(userId) {
  return db
    .prepare(
      `SELECT payload_json FROM rolls WHERE user_id = ? AND date(created_at) = date('now') ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId);
}

function insertRoll(userId, payload) {
  const insertStmt = db.prepare(
    `INSERT INTO rolls (user_id, plate_display, score, tier, payload_json) VALUES (?, ?, ?, ?, ?)`
  );
  const addScore = db.prepare(`UPDATE users SET total_score = total_score + ? WHERE id = ?`);
  db.exec("BEGIN");
  try {
    insertStmt.run(userId, payload.plate.display, payload.score, payload.tier, JSON.stringify(payload));
    addScore.run(payload.score, userId);
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

function getTodayRank(userId) {
  const myRow = db
    .prepare(`SELECT score FROM rolls WHERE user_id = ? AND date(created_at) = date('now') ORDER BY created_at DESC LIMIT 1`)
    .get(userId);
  if (!myRow) return null;
  const { rank } = db
    .prepare(`SELECT COUNT(*) + 1 AS rank FROM rolls WHERE date(created_at) = date('now') AND score > ?`)
    .get(myRow.score);
  return rank;
}

// Top rolls across all users, one row per roll, joined to the owner's username.
function getLeaderboard(limit = 50, period = 'today') {
  const where = {
    today:   `WHERE date(r.created_at) = date('now')`,
    '7days': `WHERE r.created_at >= datetime('now', '-7 days')`,
    '30days':`WHERE r.created_at >= datetime('now', '-30 days')`,
    all:     '',
  }[period] ?? `WHERE date(r.created_at) = date('now')`;

  return db
    .prepare(
      `SELECT u.username, r.plate_display, r.score, r.tier, r.created_at, r.payload_json
       FROM rolls r JOIN users u ON u.id = r.user_id
       ${where}
       ORDER BY r.score DESC, r.created_at ASC LIMIT ?`
    )
    .all(limit);
}

// ── Admin helpers ─────────────────────────────────────────────────────────────

function getAdminStats() {
  const totalUsers  = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
  const newToday    = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE date(created_at) = date('now')`).get().n;
  const newLast7    = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-7 days')`).get().n;
  const newLast30   = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-30 days')`).get().n;
  const totalRolls  = db.prepare(`SELECT COUNT(*) AS n FROM rolls`).get().n;
  const rollsToday  = db.prepare(`SELECT COUNT(*) AS n FROM rolls WHERE date(created_at) = date('now')`).get().n;
  const rollsLast7  = db.prepare(`SELECT COUNT(*) AS n FROM rolls WHERE created_at >= datetime('now', '-7 days')`).get().n;
  const activeToday = db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM rolls WHERE date(created_at) = date('now')`).get().n;
  const tierDist    = db.prepare(`SELECT tier, COUNT(*) AS cnt FROM rolls GROUP BY tier`).all();
  return { totalUsers, newToday, newLast7, newLast30, totalRolls, rollsToday, rollsLast7, activeToday, tierDist };
}

function getAllUsers() {
  return db.prepare(`
    SELECT u.id, u.username, u.email, u.email_verified, u.is_admin, u.created_at,
           COUNT(r.id) AS roll_count,
           EXISTS(SELECT 1 FROM rolls t WHERE t.user_id = u.id AND date(t.created_at) = date('now')) AS rolled_today
    FROM users u
    LEFT JOIN rolls r ON r.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
}

function searchUsers(query) {
  const like = `%${query}%`;
  return db.prepare(`
    SELECT u.id, u.username, u.email, u.email_verified, u.is_admin, u.created_at,
           COUNT(r.id) AS roll_count,
           EXISTS(SELECT 1 FROM rolls t WHERE t.user_id = u.id AND date(t.created_at) = date('now')) AS rolled_today
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
  const roll = db.prepare(`SELECT user_id, score FROM rolls WHERE id = ?`).get(rollId);
  if (!roll) return;
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM rolls WHERE id = ?`).run(rollId);
    db.prepare(`UPDATE users SET total_score = MAX(0, total_score - ?) WHERE id = ?`).run(roll.score, roll.user_id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function deleteTodayRoll(userId) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(score), 0) AS s FROM rolls WHERE user_id = ? AND date(created_at) = date('now')`
  ).get(userId);
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM rolls WHERE user_id = ? AND date(created_at) = date('now')`).run(userId);
    if (row.s > 0) {
      db.prepare(`UPDATE users SET total_score = MAX(0, total_score - ?) WHERE id = ?`).run(row.s, userId);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
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
  insertRoll,
  getUserHistory,
  getUserTotalScore,
  getLeaderboard,
  getAdminStats,
  getAllUsers,
  searchUsers,
  setUserAdmin,
  deleteUser,
  getAllRolls,
  deleteRoll,
  deleteTodayRoll,
};
