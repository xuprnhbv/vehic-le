#!/usr/bin/env node
// Estimate how often each plate perk fires, by Monte-Carlo sampling random plates
// through the REAL scoring code. Two jobs:
//   1. Calibrate points for a new perk — see where its hit-rate lands among the
//      existing perks (the table is sorted by frequency) and match its neighbours.
//   2. Safety check — every sample runs buildRollPayload, so a check() that throws
//      on 7-digit plates (or anything else) is reported instead of silently breaking
//      a real roll.
//
// Usage:
//   node estimate-perk-rarity.js [path/to/scoring.js] [--samples N] [--seven-pct F] [--name SUBSTR]
//
//   --samples   how many random plates to draw (default 300000)
//   --seven-pct fraction that are 7-digit plates, rest are 8-digit (default 0.15)
//   --name      only highlight perks whose Hebrew name contains this substring
//
// Note: this samples *uniform random digits*, which is the right universe for
// digit-pattern perks (the only thing perks look at). It cannot measure perks rarer
// than ~1/samples (e.g. a single hard-coded plate) — compute those by hand.

const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const SAMPLES = Number(flag("--samples", "300000"));
const SEVEN_PCT = Number(flag("--seven-pct", "0.15"));
const NAME_FILTER = flag("--name", null);

function resolveScoring() {
  const explicit = args.find((a) => a.endsWith("scoring.js"));
  const candidates = [
    explicit,
    path.join(process.cwd(), "server", "scoring.js"),
    path.resolve(__dirname, "../../../../server/scoring.js"),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("Could not find server/scoring.js — pass its path as the first argument.");
}

const scoringPath = resolveScoring();
const { buildRollPayload } = require(scoringPath);

function randomPlate() {
  const len = Math.random() < SEVEN_PCT ? 7 : 8;
  let d = "";
  for (let i = 0; i < len; i++) d += Math.floor(Math.random() * 10);
  return d;
}

// Loose rarity→points starting buckets, anchored to a few existing perks. This is a
// hint, not an authority — prefer matching the points of real perks at a similar
// frequency (visible in the sorted table below).
function suggestPts(p) {
  if (p >= 0.15) return 2;
  if (p >= 0.07) return 4;
  if (p >= 0.03) return 6;
  if (p >= 0.012) return 9;
  if (p >= 0.004) return 11;
  if (p >= 0.0015) return 14;
  if (p >= 0.0005) return 18;
  if (p >= 0.0001) return 24;
  if (p >= 0.00001) return 32;
  return 45;
}

const counts = new Map(); // name -> { hits, pts }
let throwSample = null;
let throwErr = null;

for (let i = 0; i < SAMPLES; i++) {
  const digits = randomPlate();
  let payload;
  try {
    payload = buildRollPayload({ mispar_rechev: digits });
  } catch (e) {
    if (!throwErr) { throwErr = e; throwSample = digits; }
    continue;
  }
  for (const perk of payload.platePerks) {
    const rec = counts.get(perk.name) || { hits: 0, pts: perk.pts };
    rec.hits++;
    rec.pts = perk.pts;
    counts.set(perk.name, rec);
  }
}

if (throwErr) {
  console.log("⚠️  A check() THREW on at least one plate — this would break a real roll.");
  console.log(`    Example plate: ${throwSample}`);
  console.log(`    Error: ${throwErr.message}\n`);
}

const rows = [...counts.entries()]
  .map(([name, { hits, pts }]) => ({ name, pct: (hits / SAMPLES) * 100, hits, pts }))
  .sort((a, b) => b.pct - a.pct);

console.log(`Sampled ${SAMPLES.toLocaleString()} random plates (${Math.round((1 - SEVEN_PCT) * 100)}% 8-digit, ${Math.round(SEVEN_PCT * 100)}% 7-digit) through ${path.relative(process.cwd(), scoringPath)}\n`);
console.log("  rate%    hits   pts  suggest   name");
console.log("  " + "─".repeat(56));
for (const r of rows) {
  const p = r.hits / SAMPLES;
  const mark = NAME_FILTER && r.name.includes(NAME_FILTER) ? " ◄ NEW" : "";
  const sug = String(suggestPts(p)).padStart(4);
  console.log(
    `  ${r.pct.toFixed(3).padStart(6)}  ${String(r.hits).padStart(6)}  ${String(r.pts).padStart(4)}  ${sug}     ${r.name}${mark}`
  );
}

if (NAME_FILTER && !rows.some((r) => r.name.includes(NAME_FILTER))) {
  console.log(`\nNo perk named like "${NAME_FILTER}" fired in ${SAMPLES.toLocaleString()} samples.`);
  console.log("Either it is rarer than this sample can measure, or its check never matches — verify by hand.");
}
