// Seed the local SQLite store (data/app.db) with two known accounts and a spread
// of fake rolls, so a fresh checkout has something to log into and look at.
//
//   admin / 1234   (is_admin = 1, email_verified = 1)
//   user  / 1234   (email_verified = 1)
//
// Rolls are built through the REAL server scoring (buildRollPayload) and saved
// through the REAL store helper (insertRoll) — so scores, tiers, total_score and
// the leaderboard are all internally consistent, exactly as a live roll would be.
//
// Usage (from the project root):
//   node .claude/skills/run-vehic-le/seed.js            # accounts + rolls
//   node .claude/skills/run-vehic-le/seed.js --no-rolls # accounts only
//
// Re-running is safe: it deletes the two seed accounts first (rolls cascade), so
// the seed is idempotent. It never touches other accounts you created by hand.

const bcrypt = require("bcryptjs");
const db = require("../../../server/db");
const { buildRollPayload } = require("../../../server/scoring");

const SEED_RNG_SEED = 1337;
const skipRolls = process.argv.includes("--no-rolls");

// ── Accounts ──────────────────────────────────────────────────────────────────

function resetUser({ username, email, password, isAdmin }) {
  const existing = db.findUserByUsername(username);
  if (existing) db.deleteUser(existing.id); // rolls + tokens cascade
  const user = db.createUser({
    username,
    email,
    passwordHash: bcrypt.hashSync(password, 12),
    emailVerified: true, // so password login works without the email step
  });
  if (isAdmin) db.setUserAdmin(user.id, true);
  return db.findUserById(user.id);
}

const admin = resetUser({ username: "admin", email: "admin@example.com", password: "1234", isAdmin: true });
const user = resetUser({ username: "user", email: "user@example.com", password: "1234", isAdmin: false });
console.log(`✓ accounts: admin (#${admin.id}, is_admin=${admin.is_admin}) | user (#${user.id})`);

if (skipRolls) {
  console.log("✓ --no-rolls: skipped fake rolls");
  process.exit(0);
}

// ── Fake rolls ──────────────────────────────────────────────────────────────────

// Tiny deterministic PRNG so the seed is reproducible run-to-run.
let _s = SEED_RNG_SEED;
function rand() {
  _s = (_s * 1103515245 + 12345) & 0x7fffffff;
  return _s / 0x7fffffff;
}
const randPlate = () =>
  Array.from({ length: 8 }, () => Math.floor(rand() * 10)).join("");

// "Profiles" are partial dataset records (the same Hebrew field names the live
// data.gov.il registry returns). We feed them through buildRollPayload — the real
// scorer — and brute-force the plate digits until the resulting tier matches the
// band we want. S is pinned to a monodigit plate so it stacks many plate perks.
const TODAY_YEAR = new Date().getFullYear();

function recordFor(profile, digits) {
  return {
    mispar_rechev: digits,
    tozeret_nm: profile.tozeret,
    kinuy_mishari: profile.kinuy,
    shnat_yitzur: String(profile.year),
    tzeva_rechev: profile.color,
    sug_delek_nm: profile.fuel,
    moed_aliya_lakvish: `${profile.year}-01-01`,
    tokef_dt: `${TODAY_YEAR + 1}-01-01`,
  };
}

// Search a plate whose finished payload lands in [min,max] for this profile.
function payloadForTier(profile, [min, max], { fixedPlate = null, wantPerks = null } = {}) {
  if (fixedPlate) return buildRollPayload(recordFor(profile, fixedPlate));
  for (let i = 0; i < 200000; i++) {
    const p = buildRollPayload(recordFor(profile, randPlate()));
    if (p.score < min || p.score > max) continue;
    if (wantPerks === 0 && p.platePerks.length !== 0) continue;
    if (wantPerks === "many" && p.platePerks.length < 3) continue;
    return p;
  }
  throw new Error(`could not find a plate for tier band ${min}-${max} (${profile.tozeret})`);
}

// S (≥90) with a pile of perks → monodigit 77777777 (monodigit, runs, all-odd,
// all-prime, quad-7, etc.) on an exotic car. A (60-89), B (30-59), C (15-29),
// D (<15) descend in rarity; D is pinned to a perk-less plate and a common car.
const PLAN = [
  { owner: user,  profile: { tozeret: "פרארי",  kinuy: "FERRARI 488",   year: 1992, color: "ורוד",  fuel: "בנזין" },       band: [90, 9999], opts: { fixedPlate: "77777777" } },
  { owner: admin, profile: { tozeret: "ב מ וו",  kinuy: "M3 COMPETITION", year: 2014, color: "כחול",  fuel: "חשמל/בנזין" }, band: [60, 89] },
  { owner: user,  profile: { tozeret: "מרצדס",   kinuy: "GLC",           year: 2017, color: "אדום",  fuel: "דיזל" },       band: [30, 59] },
  { owner: admin, profile: { tozeret: "מזדה",    kinuy: "MAZDA 3",        year: 2021, color: "כסף",   fuel: "בנזין" },      band: [15, 29] },
  { owner: user,  profile: { tozeret: "טויוטה",  kinuy: "COROLLA",        year: TODAY_YEAR, color: "לבן", fuel: "בנזין" },  band: [0, 14], opts: { wantPerks: 0 } },
];

for (const { owner, profile, band, opts } of PLAN) {
  const payload = payloadForTier(profile, band, opts);
  db.insertRoll(owner.id, payload);
  const perks = payload.platePerks.map((p) => p.name).join(", ") || "—";
  console.log(
    `✓ ${owner.username.padEnd(5)} ${payload.tier}  ${String(payload.score).padStart(3)}pt  ${payload.plate.display}  [${perks}]`
  );
}

console.log("\nDone. Log in at http://localhost:3000 with admin/1234 or user/1234.");
