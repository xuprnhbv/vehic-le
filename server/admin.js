const express = require("express");
const db = require("./db");
const { requireAdmin } = require("./auth");
const { getLogs } = require("./logger");

const router = express.Router();

router.use(requireAdmin);

router.get("/stats", (req, res, next) => {
  try {
    res.json(db.getAdminStats());
  } catch (err) { next(err); }
});

router.get("/users", (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const users = q ? db.searchUsers(q) : db.getAllUsers();
    res.json({ users });
  } catch (err) { next(err); }
});

router.patch("/users/:id/admin", (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "מזהה משתמש לא תקין" });
    }
    if (userId === req.user.id) {
      return res.status(400).json({ error: "לא ניתן לשנות הרשאות מנהל לעצמך" });
    }
    db.setUserAdmin(userId, Boolean(req.body.isAdmin));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete("/users/:id/today-roll", (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "מזהה משתמש לא תקין" });
    }
    db.deleteTodayRoll(userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete("/users/:id", (req, res, next) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: "מזהה משתמש לא תקין" });
    }
    if (userId === req.user.id) {
      return res.status(400).json({ error: "לא ניתן למחוק את עצמך" });
    }
    db.deleteUser(userId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get("/rolls", (req, res, next) => {
  try {
    let rolls = db.getAllRolls(100);
    const userFilter = String(req.query.user || "").trim().toLowerCase();
    const tierFilter = String(req.query.tier || "").trim().toUpperCase();
    if (userFilter) rolls = rolls.filter(r => r.username.toLowerCase().includes(userFilter));
    if (tierFilter) rolls = rolls.filter(r => r.tier === tierFilter);
    res.json({ rolls });
  } catch (err) { next(err); }
});

router.delete("/rolls/:id", (req, res, next) => {
  try {
    const rollId = Number(req.params.id);
    if (!Number.isInteger(rollId) || rollId <= 0) {
      return res.status(400).json({ error: "מזהה גלגול לא תקין" });
    }
    db.deleteRoll(rollId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get("/messages", (req, res, next) => {
  try {
    const messages = db.getMessages(200);
    const unread = db.countUnreadMessages();
    res.json({ messages, unread });
  } catch (err) { next(err); }
});

router.patch("/messages/:id/read", (req, res, next) => {
  try {
    const messageId = Number(req.params.id);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return res.status(400).json({ error: "מזהה הודעה לא תקין" });
    }
    db.setMessageRead(messageId, Boolean(req.body.isRead));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete("/messages/:id", (req, res, next) => {
  try {
    const messageId = Number(req.params.id);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return res.status(400).json({ error: "מזהה הודעה לא תקין" });
    }
    db.deleteMessage(messageId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Announcements (site popups) ────────────────────────────────────────────────

router.get("/announcements", (req, res, next) => {
  try {
    res.json({ announcements: db.getAllAnnouncements(100) });
  } catch (err) { next(err); }
});

router.post("/announcements", (req, res, next) => {
  try {
    const body = String(req.body.body || "").trim();
    const hours = Number(req.body.hours);
    if (!body) return res.status(400).json({ error: "טקסט ההודעה ריק" });
    if (body.length > 2000) return res.status(400).json({ error: "טקסט ההודעה ארוך מדי (עד 2000 תווים)" });
    if (!Number.isFinite(hours) || hours <= 0 || hours > 8760) {
      return res.status(400).json({ error: "משך הזמן חייב להיות בין שעה אחת לשנה" });
    }
    // Store whole minutes so the SQLite datetime modifier stays clean.
    const minutes = Math.max(1, Math.round(hours * 60));
    const announcement = db.createAnnouncement({ body, minutes });
    res.json({ ok: true, announcement });
  } catch (err) { next(err); }
});

router.delete("/announcements/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "מזהה הודעה לא תקין" });
    }
    db.deleteAnnouncement(id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get("/logs", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  res.json({ logs: getLogs(limit) });
});

module.exports = { router };
