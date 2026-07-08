// Emoji reactions on rolls. rolls.js stays read-only (rows are written only in the
// /api/roll handler), so the one mutating endpoint lives here. Reactions never touch a
// roll's score/tier — they're purely social — so there's no anti-cheat concern in
// exposing roll ids or letting the client toggle them.

const express = require("express");
const db = require("./db");
const { requireAuth } = require("./auth");

// Curated reaction set — MUST stay in sync with REACTION_EMOJIS in public/reactions.js.
const REACTION_EMOJIS = ["🔥", "❤️", "😂", "😮", "👏", "💀", "😭", "🤡"];
const ALLOWED = new Set(REACTION_EMOJIS);

// Build { [rollId]: { counts: { emoji: n }, mine: [emoji] } } for a set of rolls.
// `mine` is empty for anonymous viewers (userId null/undefined). Shared with rolls.js
// so the leaderboard/profile reads embed reactions in a single response.
function buildReactions(rollIds, userId) {
  const counts = db.getReactionsForRolls(rollIds);
  const mine = userId ? db.getUserReactionsForRolls(rollIds, userId) : {};
  const out = {};
  for (const id of rollIds) {
    out[id] = { counts: counts[id] || {}, mine: mine[id] || [] };
  }
  return out;
}

const router = express.Router();

// Toggle one emoji on one roll for the logged-in user; returns this roll's updated
// { counts, mine } so the client can refresh the bar in place.
router.post("/rolls/:rollId/reactions", requireAuth, (req, res, next) => {
  try {
    const rollId = Number(req.params.rollId);
    if (!Number.isInteger(rollId)) return res.status(400).json({ error: "invalid roll" });
    const emoji = String(req.body?.emoji ?? "");
    if (!ALLOWED.has(emoji)) return res.status(400).json({ error: "invalid emoji" });
    if (!db.rollExists(rollId)) return res.status(404).json({ error: "roll not found" });

    db.toggleReaction(rollId, req.user.id, emoji);
    res.json({ reactions: buildReactions([rollId], req.user.id)[rollId] });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, REACTION_EMOJIS, buildReactions };
