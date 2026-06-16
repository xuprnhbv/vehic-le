// Read-only endpoints over the saved rolls: the logged-in user's own history and
// the global leaderboard. Rolls are *written* in index.js's /api/roll handler —
// only there, using the server-authoritative score, so the client can't fake one.

const express = require("express");
const db = require("./db");
const { requireAuth } = require("./auth");
const { getPerkDescriptions } = require("./scoring");

const router = express.Router();

// Perk name → description list, so the client can explain perk chips on tap. Read-only
// and static for the process lifetime; computed once.
const PERK_DESCRIPTIONS = getPerkDescriptions();
router.get("/perks", (_req, res) => {
  res.json({ perks: PERK_DESCRIPTIONS });
});

// The currently-active site popup, if any. Admins create these in the dashboard with a
// markdown body and a duration; this returns the newest one whose window is still open.
// The client renders the markdown and shows it at most once per browser, keyed by id.
router.get("/announce", (_req, res, next) => {
  try {
    const a = db.getActiveAnnouncement();
    res.json({ announcement: a ? { id: a.id, body: a.body } : null });
  } catch (err) {
    next(err);
  }
});

// Today's roll for the current user, if any (full payload so the client can display it).
router.get("/me/today", requireAuth, (req, res, next) => {
  try {
    const row = db.getTodayRoll(req.user.id);
    if (!row) return res.status(404).json({ payload: null });
    const rank = db.getTodayRank(req.user.id);
    res.json({ payload: JSON.parse(row.payload_json), rank });
  } catch (err) {
    next(err);
  }
});

// Current user's recent rolls.
router.get("/me/history", requireAuth, (req, res, next) => {
  try {
    const rows = db.getUserHistory(req.user.id, 50).map((r) => ({
      plate: r.plate_display,
      score: r.score,
      tier: r.tier,
      createdAt: r.created_at,
      payload: r.payload_json ? JSON.parse(r.payload_json) : null,
    }));
    const totalScore = db.getUserTotalScore(req.user.id);
    res.json({ rolls: rows, totalScore });
  } catch (err) {
    next(err);
  }
});

// Global leaderboard. ?period=today|30days|alltime|overall|streaks (default: today).
// today/30days/alltime are per-roll best-roll contests; overall sums each user's score;
// streaks ranks users by their current live consecutive-day streak.
router.get("/leaderboard", (req, res, next) => {
  try {
    const VALID = new Set(["today", "30days", "alltime", "overall", "streaks"]);
    const period = VALID.has(req.query.period) ? req.query.period : "today";

    if (period === "streaks") {
      const rows = db.getStreakLeaderboard(100).map((r, i) => ({
        rank: i + 1,
        username: r.username,
        streak: r.streak,
      }));
      return res.json({ leaderboard: rows });
    }

    const rows = db.getLeaderboard(100, period).map((r, i) => ({
      rank: i + 1,
      username: r.username,
      plate: r.plate_display,
      score: r.score,
      tier: r.tier,
      createdAt: r.created_at,
      payload: r.payload_json ? JSON.parse(r.payload_json) : null,
    }));
    res.json({ leaderboard: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
