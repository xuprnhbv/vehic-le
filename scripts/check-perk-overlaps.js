// Dev tool: statistically flags plate-perk pairs where matching perk A always seems to
// imply matching perk B, but that overlap isn't yet declared via `subsumes` in
// PLATE_PERKS (server/scoring.js). Run this after adding a new perk (e.g. via the
// add-perk skill) to catch new redundant-scoring overlaps early.
//
// This is a large random sample, not exhaustive proof — a clean run means "no overlap
// found in N samples", not a mathematical guarantee. Treat any hit as a lead to verify
// by hand (and check it's safe to encode: a subsumer with no `spans` covers the WHOLE
// plate unconditionally, so only list it if the implication holds regardless of any
// other independent pattern elsewhere on the same plate — see the comments around
// `blockxxxyyy`/`mult10000` in scoring.js for the failure mode this can hit).
//
// Usage: node scripts/check-perk-overlaps.js [samplesPerLength]

const { PLATE_PERKS } = require("../server/scoring.js");

const SAMPLES_PER_LENGTH = Number(process.argv[2]) || 1_500_000;
const LENGTHS = [7, 8];

function randomDigits(len) {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
}

const ids = PLATE_PERKS.map((p) => p.id);
const idx = new Map(ids.map((id, i) => [id, i]));
const n = ids.length;

// impliesOK[a][b] starts true, flips false the first time we see A matched & B not matched.
const impliesOK = Array.from({ length: n }, () => new Array(n).fill(true));
const matchCount = new Array(n).fill(0);
let totalSamples = 0;

function processSample(d) {
  totalSamples++;
  const matched = [];
  for (let i = 0; i < n; i++) {
    if (PLATE_PERKS[i].check(d)) {
      matched.push(i);
      matchCount[i]++;
    }
  }
  if (matched.length === 0) return;
  const matchedSet = new Set(matched);
  for (const a of matched) {
    const row = impliesOK[a];
    for (let b = 0; b < n; b++) {
      if (b !== a && row[b] && !matchedSet.has(b)) row[b] = false;
    }
  }
}

for (const len of LENGTHS) {
  for (let i = 0; i < SAMPLES_PER_LENGTH; i++) processSample(randomDigits(len));
}

// Transitive closure of already-DECLARED subsumes, so we don't re-report known/chained relationships.
const declared = Array.from({ length: n }, () => new Array(n).fill(false));
for (const p of PLATE_PERKS) {
  const a = idx.get(p.id);
  for (const id of p.subsumes || []) {
    const b = idx.get(id);
    if (b !== undefined) declared[a][b] = true;
  }
}
for (let k = 0; k < n; k++) {
  for (let i = 0; i < n; i++) {
    if (!declared[i][k]) continue;
    for (let j = 0; j < n; j++) if (declared[k][j]) declared[i][j] = true;
  }
}

let found = 0;
for (let a = 0; a < n; a++) {
  if (matchCount[a] === 0) continue; // never observed in the sample — can't conclude anything
  for (let b = 0; b < n; b++) {
    if (a === b || declared[a][b]) continue;
    if (impliesOK[a][b]) {
      found++;
      console.log(
        `${ids[a]} (pts ${PLATE_PERKS[a].pts}, seen ${matchCount[a]}x) always implied ` +
          `${ids[b]} (pts ${PLATE_PERKS[b].pts}) in this sample — not declared via subsumes`
      );
    }
  }
}

console.log(`\n${totalSamples.toLocaleString()} samples checked across lengths ${LENGTHS.join(", ")}; ${found} undeclared implication(s) found.`);
