require("./logger"); // must be first — patches console before any other module loads
require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const SqliteStore = require("./session-store")(session);
const passport = require("passport");

const { startRefreshTimer, rollRecord, fetchRecordByPlate } = require("./dataset");
const { buildRollPayload } = require("./scoring");
const { insertRoll, hasRolledToday, getTodayRank, createMessage } = require("./db");
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

// Public contact form. Anyone (logged-in or anonymous) may send a message; it
// lands in the admin dashboard. Tiny in-memory rate limiter slows spam per IP.
const contactHits = new Map();
const CONTACT_WINDOW_MS = 15 * 60 * 1000;
const CONTACT_MAX = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post("/api/contact", (req, res, next) => {
  const now = Date.now();
  const entry = contactHits.get(req.ip);
  if (!entry || now > entry.reset) {
    contactHits.set(req.ip, { count: 1, reset: now + CONTACT_WINDOW_MS });
  } else if (entry.count >= CONTACT_MAX) {
    return res.status(429).json({ error: "יותר מדי הודעות, נסו שוב מאוחר יותר" });
  } else {
    entry.count++;
  }

  try {
    const body = String(req.body.body || "").trim();
    let email = String(req.body.email || "").trim().toLowerCase();
    if (!body) {
      return res.status(400).json({ error: "לא ניתן לשלוח הודעה ריקה" });
    }
    if (body.length > 2000) {
      return res.status(400).json({ error: "ההודעה ארוכה מדי (עד 2000 תווים)" });
    }
    if (email && !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "כתובת מייל לא תקינה" });
    }
    let userId = null;
    if (req.user) {
      userId = req.user.id;
      if (!email) email = req.user.email;
    }
    createMessage({ userId, email: email || null, body });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

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

// "Rate my plate": look up a specific plate the user typed and score it with the
// exact same scoring as a roll. This is read-only — it NEVER writes to `rolls`
// (saving stays exclusive to /api/roll's random, authoritative payload), so a
// manual lookup can't be ranked. A tiny per-IP limiter slows scraping of the
// external registry.
const rateHits = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 30;

app.get("/api/rate", async (req, res) => {
  const now = Date.now();
  const entry = rateHits.get(req.ip);
  if (!entry || now > entry.reset) {
    rateHits.set(req.ip, { count: 1, reset: now + RATE_WINDOW_MS });
  } else if (entry.count >= RATE_MAX) {
    return res.status(429).json({ error: "יותר מדי בקשות, נסו שוב מאוחר יותר" });
  } else {
    entry.count++;
  }

  const digits = String(req.query.plate || "").replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 8) {
    return res.status(400).json({ error: "מספר רכב לא תקין" });
  }
  try {
    const record = await fetchRecordByPlate(digits);
    if (!record) {
      return res.status(404).json({ error: "הרכב לא נמצא במאגר הרכבים" });
    }
    res.json(buildRollPayload(record));
  } catch (err) {
    console.error(`[rate] failed: ${err.message}`);
    res.status(502).json({ error: "rate failed" });
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
