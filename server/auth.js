// Authentication: Passport strategies (local + Google) and the /api/auth routes.
// Local accounts must verify their email before they can log in; Google accounts
// are trusted as verified. Sessions are cookie-based (configured in index.js).

const express = require("express");
const passport = require("passport");
const bcrypt = require("bcryptjs");
const { Strategy: LocalStrategy } = require("passport-local");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");

const db = require("./db");
const { sendVerificationEmail } = require("./mailer");

const APP_BASE_URL = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

// ── Passport session (de)serialization ───────────────────────────────────────

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  try {
    done(null, db.findUserById(id) || false);
  } catch (err) {
    done(err);
  }
});

// ── Local strategy: username OR email + password ──────────────────────────────

passport.use(
  new LocalStrategy({ usernameField: "identifier", passwordField: "password" }, (identifier, password, done) => {
    try {
      const id = String(identifier || "").trim();
      const user = id.includes("@") ? db.findUserByEmail(id) : db.findUserByUsername(id);
      if (!user || !user.password_hash) {
        return done(null, false, { message: "שם משתמש או סיסמה שגויים" });
      }
      if (!bcrypt.compareSync(password, user.password_hash)) {
        return done(null, false, { message: "שם משתמש או סיסמה שגויים" });
      }
      if (!user.email_verified) {
        return done(null, false, { message: "יש לאמת את כתובת המייל לפני ההתחברות" });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

// ── Google strategy (only registered if credentials are present) ──────────────

const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${APP_BASE_URL}/api/auth/google/callback`,
      },
      (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase();
          let user = db.findUserByGoogleId(profile.id);
          if (user) return done(null, user);

          // Link to an existing account with the same verified email, if any.
          if (email) {
            const existing = db.findUserByEmail(email);
            if (existing) {
              db.setGoogleId(existing.id, profile.id);
              if (!existing.email_verified) db.verifyUserEmail(existing.id);
              return done(null, db.findUserById(existing.id));
            }
          }

          // Fresh Google account — derive a unique username.
          const base = (profile.displayName || email?.split("@")[0] || "user")
            .replace(/\s+/g, "")
            .slice(0, 20) || "user";
          let username = base;
          let n = 1;
          while (db.findUserByUsername(username)) username = `${base}${n++}`;

          user = db.createUser({
            username,
            email: email || `${profile.id}@google.local`,
            googleId: profile.id,
            emailVerified: true,
          });
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

// ── Tiny in-memory rate limiter (slows brute force on register/login) ─────────

function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now > entry.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      return res.status(429).json({ error: "יותר מדי נסיונות, נסה שוב מאוחר יותר" });
    }
    entry.count++;
    next();
  };
}

// ── Validation helpers ────────────────────────────────────────────────────────

const USERNAME_RE = /^[A-Za-z0-9_֐-׿]{3,20}$/; // letters/digits/underscore/Hebrew
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    isAdmin: Boolean(user.is_admin),
  };
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post("/register", authLimiter, async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: "שם משתמש לא תקין (3-20 תווים)" });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "כתובת מייל לא תקינה" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "הסיסמה חייבת להכיל לפחות 8 תווים" });
    }
    if (db.findUserByUsername(username)) {
      return res.status(409).json({ error: "שם המשתמש כבר תפוס" });
    }
    if (db.findUserByEmail(email)) {
      return res.status(409).json({ error: "כתובת המייל כבר רשומה" });
    }

    const passwordHash = bcrypt.hashSync(password, 12);
    const user = db.createUser({ username, email, passwordHash, emailVerified: false });
    const token = db.createVerifyToken(user.id);

    // Sending must not orphan the account: if SMTP fails, the user already exists,
    // so we log the error + a usable verify link instead of returning a 500.
    try {
      await sendVerificationEmail(user, token);
    } catch (mailErr) {
      console.error(`[register] verification email failed for ${user.email}: ${mailErr.message}`);
      console.error(
        `[register] fallback verify link: ${APP_BASE_URL}/api/auth/verify?token=${token}`
      );
    }

    res.status(201).json({ message: "נרשמת בהצלחה! נשלח אליך מייל לאימות החשבון." });
  } catch (err) {
    next(err);
  }
});

router.get("/verify", (req, res, next) => {
  try {
    const userId = db.consumeVerifyToken(String(req.query.token || ""));
    if (!userId) return res.redirect("/?verified=invalid");
    db.verifyUserEmail(userId);
    // Log the freshly verified user into this browser session so they don't
    // have to type their credentials again. If login fails for any reason we
    // still redirect with the success flag — they can log in manually.
    const user = db.findUserById(userId);
    if (!user) return res.redirect("/?verified=1");
    req.login(user, (loginErr) => {
      if (loginErr) return res.redirect("/?verified=1");
      res.redirect("/?verified=1");
    });
  } catch (err) {
    next(err);
  }
});

router.post("/login", authLimiter, (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info?.message || "ההתחברות נכשלה" });
    req.login(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      res.json({ user: publicUser(user) });
    });
  })(req, res, next);
});

router.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});

router.get("/me", (req, res) => {
  res.json({ user: publicUser(req.user), googleEnabled });
});

if (googleEnabled) {
  router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
  router.get(
    "/google/callback",
    passport.authenticate("google", { failureRedirect: "/?auth=google_failed" }),
    (req, res) => res.redirect("/")
  );
}

// Guard for protected routes (used by history endpoint).
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "נדרשת התחברות" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated() || req.user.is_admin !== 1) {
    return res.status(403).json({ error: "גישה אסורה" });
  }
  next();
}

module.exports = { router, requireAuth, requireAdmin, publicUser };
