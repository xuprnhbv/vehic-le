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

// Global top scores across all users. ?period=today|7days|30days|all (default: today)
router.get("/leaderboard", (req, res, next) => {
  try {
    const VALID = new Set(["today", "7days", "30days", "all"]);
    const period = VALID.has(req.query.period) ? req.query.period : "today";
    const rows = db.getLeaderboard(100, period).map((r, i) => ({
      rank: i + 1,
      username: r.username,
      plate: r.plate_display,
      score: r.score,
      bestScore: r.best_score ?? null,
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
