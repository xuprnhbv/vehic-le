// Read-only endpoints over the saved rolls: the logged-in user's own history and
// the global leaderboard. Rolls are *written* in index.js's /api/roll handler —
// only there, using the server-authoritative score, so the client can't fake one.

const express = require("express");
const db = require("./db");
const { requireAuth } = require("./auth");
const { getPerkDescriptions, tierFor } = require("./scoring");
const { buildReactions } = require("./reactions");

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

    const PER_ROLL = new Set(["today", "30days", "alltime"]);
    if (PER_ROLL.has(period) && req.query.excludePerks === "1") {
      const pool = db.getLeaderboard(500, period);
      const top = pool
        .map((r) => {
          const payload = r.payload_json ? JSON.parse(r.payload_json) : null;
          const perkPts = payload?.platePerks?.reduce((s, p) => s + p.pts, 0) ?? 0;
          const vehicleScore = r.score - perkPts;
          return { ...r, score: vehicleScore, tier: tierFor(vehicleScore), payload };
        })
        .sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at))
        .slice(0, 100);
      const reactions = buildReactions(top.map((r) => r.id), req.user?.id);
      const reranked = top.map((r, i) => ({
        rank: i + 1,
        id: r.id,
        username: r.username,
        plate: r.plate_display,
        score: r.score,
        tier: r.tier,
        createdAt: r.created_at,
        payload: r.payload,
        reactions: reactions[r.id],
      }));
      return res.json({ leaderboard: reranked });
    }

    const raw = db.getLeaderboard(100, period);
    // Reactions only make sense for per-roll scopes (each row is a real roll with an id);
    // the 'overall' scope aggregates per user and has no roll id.
    const reactions = PER_ROLL.has(period)
      ? buildReactions(raw.map((r) => r.id), req.user?.id)
      : {};
    const rows = raw.map((r, i) => ({
      rank: i + 1,
      username: r.username,
      plate: r.plate_display,
      score: r.score,
      tier: r.tier,
      createdAt: r.created_at,
      payload: r.payload_json ? JSON.parse(r.payload_json) : null,
      ...(PER_ROLL.has(period) ? { id: r.id, reactions: reactions[r.id] } : {}),
    }));
    res.json({ leaderboard: rows });
  } catch (err) {
    next(err);
  }
});

// Public profile for a user, keyed by username (profiles are reached by clicking other
// players' names on the leaderboard, so no auth). Returns the headline stats plus the
// best-ever and today's rolls (full payloads so the client renders the same breakdown as
// the leaderboard). bestRoll/todayRoll are null when absent.
router.get("/profile/:username", (req, res, next) => {
  try {
    const user = db.findUserByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: "user not found" });

    const toRoll = (row) => {
      if (!row) return null;
      const payload = JSON.parse(row.payload_json);
      return {
        id: row.id,
        plate: payload.plate.display,
        score: payload.score,
        tier: payload.tier,
        createdAt: row.created_at ?? null,
        payload,
        reactions: buildReactions([row.id], req.user?.id)[row.id],
      };
    };

    res.json({
      username: user.username,
      memberSince: user.created_at,
      totalScore: db.getUserTotalScore(user.id),
      rollCount: db.getUserRollCount(user.id),
      currentStreak: db.getLiveStreak(user.id),
      bestRoll: toRoll(db.getUserBestRoll(user.id)),
      todayRoll: toRoll(db.getTodayRoll(user.id)),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { router };
