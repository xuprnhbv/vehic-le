// Daily roll reminders via the Web Push API. The browser holds a push
// subscription (created only when a logged-in user opts in); this module stores
// it and, every morning, sends a notification to anyone who hasn't rolled yet
// today. Like Google sign-in, the whole feature silently disables itself when its
// keys are absent — so the app runs fine with no VAPID config.

const express = require("express");
const webpush = require("web-push");
const db = require("./db");
const { requireAuth, requireAdmin } = require("./auth");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

const REMINDER_HOUR = Number(process.env.REMINDER_HOUR ?? 9);
const REMINDER_TZ = process.env.REMINDER_TZ || "Asia/Jerusalem";
const CHECK_MS = 15 * 60 * 1000; // re-check the wall clock every 15 minutes

const enabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (enabled) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.log("[push] disabled — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to enable reminders");
}

const router = express.Router();

// Public: the client needs the VAPID public key to subscribe, and `enabled`
// tells it whether to show the opt-in UI at all.
router.get("/config", (_req, res) => {
  res.json({ enabled, vapidPublicKey: enabled ? VAPID_PUBLIC_KEY : null });
});

const WELCOME_NOTIFICATION = {
  title: "ההתראות הופעלו! 🔔",
  body: "מעכשיו תקבל תזכורת יומית לגלגל לוחית 🎲",
  url: "/",
};

// Confirm a subscription by pushing a notification straight back to it.
// Best-effort: the subscription is already saved, so a delivery hiccup here must
// not fail the request. A 404/410 means the endpoint is already dead — prune it.
// High urgency so Android delivers immediately even in Doze/battery-saver — the
// user is looking at their phone waiting for this; a deferred send reads as broken.
async function sendSubscriptionConfirmation(sub) {
  const payload = JSON.stringify(WELCOME_NOTIFICATION);
  try {
    await webpush.sendNotification(sub, payload, { urgency: "high", TTL: 600 });
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      db.deleteSubscription(sub.endpoint);
    } else {
      console.error(`[push] confirmation send failed (${err.statusCode || "?"}): ${err.message}`);
    }
  }
}

// Store (or refresh) the current user's push subscription.
router.post("/subscribe", requireAuth, async (req, res) => {
  const sub = req.body;
  if (!enabled) return res.status(503).json({ error: "push disabled" });
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return res.status(400).json({ error: "invalid subscription" });
  }
  try {
    db.saveSubscription(req.user.id, sub);
  } catch (err) {
    console.error(`[push] subscribe failed: ${err.message}`);
    return res.status(500).json({ error: "subscribe failed" });
  }
  res.json({ ok: true });
  // The client only POSTs here on an explicit bell toggle, so every call is a
  // deliberate opt-in — always confirm, even when the browser handed back an
  // endpoint we already know (Chrome reuses endpoints across re-subscribes).
  await sendSubscriptionConfirmation(sub);
});

// Drop a subscription (user toggled reminders off / unsubscribed in the browser).
router.post("/unsubscribe", requireAuth, (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: "missing endpoint" });
  try {
    db.deleteSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[push] unsubscribe failed: ${err.message}`);
    res.status(500).json({ error: "unsubscribe failed" });
  }
});

// Admin-only: fire a test notification to the caller's own devices right now,
// bypassing the "rolled today / already notified" gating. For sanity-checking the
// whole delivery path without waiting for the morning send.
router.post("/test", requireAdmin, async (req, res) => {
  if (!enabled) return res.status(503).json({ error: "push disabled" });
  const subs = db.getUserSubscriptions(req.user.id);
  if (subs.length === 0) return res.status(404).json({ error: "no subscriptions for this user" });
  const payload = JSON.stringify({ title: "בדיקת התראה", body: "ההתראות עובדות! 🎲", url: "/" });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) db.deleteSubscriptionById(s.id);
      else console.error(`[push] test send failed (${err.statusCode || "?"}): ${err.message}`);
    }
  }
  res.json({ ok: true, sent });
});

const NOTIFICATION = {
  title: "הגיע הזמן לגלגל!",
  body: "עדיין לא גילגלת לוחית היום 🎲",
  url: "/",
};

// Send the daily reminder to every subscription that's due. The per-row
// last_notified_date guard makes this safe to call repeatedly (multiple ticks in
// the 09:00 hour, a restart mid-window): each subscription gets at most one a day.
async function sendReminders() {
  if (!enabled) return;
  const subs = db.getSubscriptionsToRemind();
  if (subs.length === 0) return;
  console.log(`[push] sending ${subs.length} roll reminder(s)`);
  const payload = JSON.stringify(NOTIFICATION);
  for (const s of subs) {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subscription, payload);
      db.markSubscriptionNotified(s.id);
    } catch (err) {
      // 404/410 mean the subscription is dead (unsubscribed / expired) — prune it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.deleteSubscriptionById(s.id);
      } else {
        console.error(`[push] send failed (${err.statusCode || "?"}): ${err.message}`);
      }
    }
  }
}

// Current hour (0-23) in the reminder timezone, DST-aware.
function hourInTz(tz) {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).format(new Date());
  return Number(h);
}

function startReminderTimer() {
  if (!enabled) return;
  const tick = () => {
    try {
      if (hourInTz(REMINDER_TZ) === REMINDER_HOUR) sendReminders();
    } catch (err) {
      console.error(`[push] reminder tick failed: ${err.message}`);
    }
  };
  const timer = setInterval(tick, CHECK_MS);
  timer.unref(); // don't keep the process alive just for the reminder timer
  tick(); // also check immediately at boot in case we start during the send hour
}

module.exports = { router, startReminderTimer, sendReminders, enabled };
