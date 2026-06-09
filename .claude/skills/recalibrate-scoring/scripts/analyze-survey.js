#!/usr/bin/env node
// analyze-survey.js — compare the fleet-survey result against the live scoring
// tables and propose rarity-based point updates.
//
// It mirrors exactly how server/scoring.js scores a record: lookupPoints walks a
// table in insertion order and returns the FIRST key that is a case-insensitive
// substring of the value. So to learn the real-world weight behind each key we
// attribute every surveyed value to the first key it would match, then sum the
// fleet share (pct) landing on that key. Rarer key ⇒ should score higher.
//
// Usage:
//   node analyze-survey.js [survey-result.json] [scoring.js]
// Defaults: scripts/survey-result.json and server/scoring.js relative to repo root
// (inferred as two levels above this script's .claude/skills/... location, but you
// can always pass explicit paths).
//
// Output is a human-readable report. Nothing is written — applying the changes is
// a judgement call left to the caller (see SKILL.md).

const fs = require("fs");
const path = require("path");

// ── Resolve inputs ─────────────────────────────────────────────────────────────
const argSurvey = process.argv[2];
const argScoring = process.argv[3];

// Best-effort repo root: this file lives at <root>/.claude/skills/recalibrate-scoring/scripts/
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const surveyPath = argSurvey || path.join(repoRoot, "scripts", "survey-result.json");
const scoringPath = argScoring || path.join(repoRoot, "server", "scoring.js");

function die(msg) {
  console.error("ERROR: " + msg);
  process.exit(1);
}
if (!fs.existsSync(surveyPath)) die(`survey JSON not found: ${surveyPath}`);
if (!fs.existsSync(scoringPath)) die(`scoring.js not found: ${scoringPath}`);

const survey = JSON.parse(fs.readFileSync(surveyPath, "utf8"));
const scoringSrc = fs.readFileSync(scoringPath, "utf8");

// ── Extract the lookup tables from scoring.js without executing the whole file ──
// We grab each literal (object `{...}` or array `[...]`) and eval just that snippet.
function extractLiteral(name, open, close) {
  const re = new RegExp(`const ${name} = \\${open}[\\s\\S]*?\\n\\${close};`);
  const m = scoringSrc.match(re);
  if (!m) return null;
  const sb = {};
  // eslint-disable-next-line no-eval
  eval(m[0] + `\nsb.value = ${name};`);
  return sb.value;
}

const MANUFACTURER_POINTS = extractLiteral("MANUFACTURER_POINTS", "{", "}");
const COLOR_POINTS = extractLiteral("COLOR_POINTS", "{", "}");
const FUEL_POINTS = extractLiteral("FUEL_POINTS", "{", "}");
const MODEL_SCORES = extractLiteral("MODEL_SCORES", "[", "]");

// ── Rarity → points buckets (defaults). [minPctInclusive, points], first hit wins.
// These reproduce the calibration used historically; treat them as a STARTING
// POINT, not gospel. Different tables have different point ceilings.
const BUCKETS = {
  // manufacturer: 1..40
  MANUFACTURER_POINTS: [
    [10, 1], [6, 2], [4, 3], [2.5, 4], [1.5, 5], [1, 6],
    [0.6, 8], [0.4, 9], [0.2, 11], [0.12, 13], [0.07, 14], [0.04, 16], [0, 18],
  ],
  // color: 1..25
  COLOR_POINTS: [
    [10, 1], [8, 2], [3, 4], [1.5, 5], [1, 7], [0.5, 9], [0.3, 11],
    [0.2, 13], [0.15, 14], [0.1, 16], [0.07, 18], [0.05, 19], [0, 22],
  ],
  // fuel: 1..30
  FUEL_POINTS: [
    [10, 1], [5, 4], [2, 5], [1, 8], [0.3, 12], [0.05, 18], [0, 24],
  ],
};

function bucketize(pct, buckets) {
  for (const [thr, pts] of buckets) if (pct >= thr) return pts;
  return buckets[buckets.length - 1][1];
}

// Below this fleet share a key is too rare to calibrate from frequency, so we do
// NOT propose a change — these are the curated near-absent prestige entries
// (Ferrari, Bentley…) and the intentional alt-spelling synonyms (חשמלי, גפמ…).
// They keep their hand-set value; a genuine missing/misspelled key is caught
// instead via the "Top unmatched values" list, not by nudging these.
const FLOORS = {
  MANUFACTURER_POINTS: 0.04,
  COLOR_POINTS: 0, // every color in the table is a real, measurable shade
  FUEL_POINTS: 0.001,
};

// ── Core: attribute fleet share to each key the way lookupPoints would ─────────
function attribute(values, table) {
  const entries = Array.isArray(table) ? table : Object.entries(table);
  const share = new Map();
  for (const [k] of entries) share.set(k, 0);
  const unmatched = []; // surveyed values that hit no key → fall to fallback
  for (const e of values) {
    if (e.value === "(empty)") continue;
    const v = String(e.value).trim().toLowerCase();
    let hit = null;
    for (const [k] of entries) {
      if (v.includes(String(k).toLowerCase())) { hit = k; break; }
    }
    if (hit === null) unmatched.push(e);
    else share.set(hit, share.get(hit) + e.pct);
  }
  return { share, unmatched };
}

// ── Reporting ──────────────────────────────────────────────────────────────────
function reportObjectTable(title, fieldKey, table, bucketName) {
  const values = survey.fields[fieldKey];
  if (!values) { console.log(`\n[skip] ${title}: field "${fieldKey}" absent from survey`); return; }
  const { share, unmatched } = attribute(values, table);
  const buckets = BUCKETS[bucketName];

  const floor = FLOORS[bucketName] ?? 0;
  const rows = Object.entries(table).map(([k, cur]) => {
    const pct = share.get(k) || 0;
    // Below the calibration floor we keep the curated value (no proposal).
    const suggested = pct < floor ? cur : bucketize(pct, buckets);
    return { k, cur, pct, suggested };
  }).sort((a, b) => b.pct - a.pct);

  const unmatchedPct = unmatched.reduce((s, e) => s + e.pct, 0);
  console.log(`\n${"=".repeat(72)}\n${title}  (field: ${fieldKey})`);
  console.log(`fallback share (values matching NO key, scored by the fallback): ${unmatchedPct.toFixed(3)}%`);
  console.log(`${"pct".padStart(9)} | cur -> sug | key`);
  console.log("-".repeat(72));
  for (const r of rows) {
    const changed = r.suggested !== r.cur;
    const arrow = `${String(r.cur).padStart(3)} -> ${String(r.suggested).padStart(3)}`;
    const flag = changed ? "  <== CHANGE" : "";
    // Dead key: defined in the table but ~nothing matches it → likely a spelling
    // bug or an obsolete entry. These silently never fire.
    const dead = r.pct < 0.0005 ? "  [DEAD KEY — matches ~0%]" : "";
    console.log(`${r.pct.toFixed(4).padStart(9)} | ${arrow} | ${r.k}${flag}${dead}`);
  }

  // Surface the biggest values that fell through to the fallback. This is how you
  // catch a popular brand/color that the table is MISSING or has misspelled
  // (e.g. Volvo stored as "וולבו" while the key said "וולוו").
  if (unmatched.length) {
    const top = [...unmatched].sort((a, b) => b.pct - a.pct).slice(0, 12);
    console.log(`\n  Top unmatched values (candidates for a new/renamed key):`);
    for (const e of top) console.log(`    ${e.pct.toFixed(4).padStart(9)}%  ${e.value}`);
  }
}

function reportModelInfo() {
  if (!MODEL_SCORES || !survey.fields.kinuy_mishari) return;
  const { share, unmatched } = attribute(survey.fields.kinuy_mishari, MODEL_SCORES);
  const matchedPct = [...share.values()].reduce((s, v) => s + v, 0);
  console.log(`\n${"=".repeat(72)}\nMODEL_SCORES  (field: kinuy_mishari) — INFO ONLY`);
  console.log(`MODEL_SCORES is a curated performance/prestige ladder, not a pure`);
  console.log(`frequency table. ${(100 - matchedPct).toFixed(1)}% of models match no fragment by design.`);
  console.log(`Only adjust a fragment if the data clearly contradicts it (e.g. a`);
  console.log(`fragment meant to be rare that actually matches a large share). Skip`);
  console.log(`it otherwise — see SKILL.md.`);
}

console.log(`Survey: ${surveyPath}`);
console.log(`Scoring: ${scoringPath}`);
console.log(`Sampled ${survey.meta?.sampled?.toLocaleString?.() || "?"} of ${survey.meta?.datasetTotal?.toLocaleString?.() || "?"} rows, generated ${survey.meta?.generatedAt || "?"}`);

if (MANUFACTURER_POINTS) reportObjectTable("MANUFACTURER_POINTS", "tozeret_nm", MANUFACTURER_POINTS, "MANUFACTURER_POINTS");
if (COLOR_POINTS) reportObjectTable("COLOR_POINTS", "tzeva_rechev", COLOR_POINTS, "COLOR_POINTS");
if (FUEL_POINTS) reportObjectTable("FUEL_POINTS", "sug_delek_nm", FUEL_POINTS, "FUEL_POINTS");
reportModelInfo();

console.log(`\n${"=".repeat(72)}`);
console.log(`Reminder: 'sug' is a SUGGESTION from default rarity buckets. Apply with`);
console.log(`judgement — preserve key ORDER (specific substrings before general ones),`);
console.log(`keep the curated near-absent prestige tier, and fix DEAD KEYS by renaming`);
console.log(`them to the spelling the survey actually uses. See SKILL.md.`);
