require("./logger"); // must be first — patches console before any other module loads
require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const SqliteStore = require("./session-store")(session);
const passport = require("passport");

const { startRefreshTimer, rollRecord } = require("./dataset");
const { buildRollPayload } = require("./scoring");
const { insertRoll, hasRolledToday, getTodayRank } = require("./db");
const auth = require("./auth");
const rolls = require("./rolls");
const admin = require("./admin");
const push = require("./push");

const app = express();
const PORT = process.env.PORT || 3000;

// Fly.io (and most reverse proxies) terminate TLS and forward requests over
// plain HTTP. Without this, Express sees req.secure=false and won't set the
// session cookie when secure:true is configured, logging users out on every request.
app.set("trust proxy", 1);

app.use(express.json());

// Cookie session, persisted in the same SQLite file as everything else.
app.use(
  session({
    store: new SqliteStore(),
    secret: process.env.SESSION_SECRET || "dev-insecure-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use((req, _res, next) => {
  console.log(`[http] ${req.method} ${req.path}`);
  next();
});

// Auth + user-data routes.
app.use("/api/auth", auth.router);
app.use("/api", rolls.router);
app.use("/api/admin", admin.router);
app.use("/api/push", push.router);

app.use(express.static(path.join(__dirname, "..", "public")));

// The one endpoint that matters: the server rolls a random record, scores it,
// and hands the client a finished payload it can only animate — not influence.
// For a logged-in user we also persist the roll (using the server's own score).
app.get("/api/roll", async (req, res) => {
  if (req.user && hasRolledToday(req.user.id)) {
    return res.status(429).json({ error: "daily_limit" });
  }
  try {
    const record = await rollRecord();
    const payload = buildRollPayload(record);
    let rank = null;
    if (req.user) {
      try {
        insertRoll(req.user.id, payload);
        rank = getTodayRank(req.user.id);
      } catch (err) {
        // Saving is best-effort; never fail the roll because history write failed.
        console.error(`[roll] history save failed: ${err.message}`);
      }
    }
    res.json({ ...payload, rank });
  } catch (err) {
    console.error(`[roll] failed: ${err.message}`);
    res.status(502).json({ error: "roll failed" });
  }
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[error] ${err.stack || err.message}`);
  res.status(500).json({ error: "server error" });
});

startRefreshTimer();
push.startReminderTimer();
app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
