// A tiny express-session store backed by the same node:sqlite database. We roll
// our own (instead of a package) because the popular SQLite session stores all
// depend on the native better-sqlite3, which can't compile in this environment.

const { db } = require("./db");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid        TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

const stmts = {
  get: db.prepare(`SELECT data, expires_at FROM sessions WHERE sid = ?`),
  set: db.prepare(
    `INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`
  ),
  destroy: db.prepare(`DELETE FROM sessions WHERE sid = ?`),
  touch: db.prepare(`UPDATE sessions SET expires_at = ? WHERE sid = ?`),
  purge: db.prepare(`DELETE FROM sessions WHERE expires_at < ?`),
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function expiryOf(sess) {
  const cookieMaxAge = sess?.cookie?.maxAge;
  return Date.now() + (cookieMaxAge != null ? cookieMaxAge : DEFAULT_TTL_MS);
}

module.exports = function (session) {
  class SqliteStore extends session.Store {
    constructor() {
      super();
      // Periodically drop expired rows so the table doesn't grow unbounded.
      const timer = setInterval(() => {
        try {
          stmts.purge.run(Date.now());
        } catch (err) {
          this.emit("error", err);
        }
      }, 15 * 60 * 1000);
      timer.unref();
    }

    get(sid, cb) {
      try {
        const row = stmts.get.get(sid);
        if (!row) return cb(null, null);
        if (row.expires_at < Date.now()) {
          stmts.destroy.run(sid);
          return cb(null, null);
        }
        cb(null, JSON.parse(row.data));
      } catch (err) {
        cb(err);
      }
    }

    set(sid, sess, cb) {
      try {
        stmts.set.run(sid, JSON.stringify(sess), expiryOf(sess));
        cb && cb(null);
      } catch (err) {
        cb && cb(err);
      }
    }

    destroy(sid, cb) {
      try {
        stmts.destroy.run(sid);
        cb && cb(null);
      } catch (err) {
        cb && cb(err);
      }
    }

    touch(sid, sess, cb) {
      try {
        stmts.touch.run(expiryOf(sess), sid);
        cb && cb(null);
      } catch (err) {
        cb && cb(err);
      }
    }
  }

  return SqliteStore;
};
