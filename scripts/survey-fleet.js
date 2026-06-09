// survey-fleet.js — standalone fleet-distribution survey.
//
// Pages through the SAME data.gov.il vehicle registry the game rolls from, in
// reasonably sized chunks, and tallies how often each car detail appears across
// a large sample (default 1,000,000 rows). It reuses the game's own scoring
// (server/scoring.js) so it can also count how often each plate perk fires and
// how scores/tiers are distributed.
//
// The output is a single JSON file (survey-result.json) shaped for Claude to
// read later and re-balance the scoring tables in server/scoring.js. For every
// categorical field and every perk it reports both raw counts and the share of
// the sample (percentage) — which is exactly the signal the point tables are
// supposed to track ("rarer ⇒ more points").
//
// It is fully standalone: no build step, no extra deps, just Node >= 22.5 (for
// global fetch). Run it locally and leave it overnight:
//
//     node scripts/survey-fleet.js            # survey the ENTIRE registry
//     node scripts/survey-fleet.js 500000     # survey a 500k-row sample
//
// The first argument is how many cars to query. Omit it (or pass "all") to
// survey the whole database — at ~4.1M rows that's the all-nighter case.
//
// Options (env vars):
//     SURVEY_TARGET    rows to sample        (default: entire DB; arg overrides)
//     SURVEY_CHUNK     rows per request      (default 10000)
//     SURVEY_OUT       output file path      (default scripts/survey-result.json)
//     SURVEY_DELAY_MS  pause between requests (default 250)
//
// Resilience: progress is checkpointed to the output file every few chunks and
// on Ctrl+C, so a long run is never lost. Re-running starts fresh (it does not
// resume) — the checkpoint is there so you always have the latest partial result.
//
// Representativeness: the registry is stored in a fixed order, so the first N
// rows are NOT a fair picture of the fleet. To get a representative sample we
// spread the chunks EVENLY across the entire dataset (offsets 0, stride, 2·stride…)
// rather than reading from offset 0. The game dodges the same bias by rolling a
// random offset per plate — this is the bulk equivalent.

const fs = require("fs");
const path = require("path");
const { buildRollPayload } = require("../server/scoring.js");

// Same datastore the game reads. Keep these in sync with server/dataset.js.
const RESOURCE_ID = "053cea08-09bc-40ec-8f7a-156f0677aff3";
const API = "https://data.gov.il/api/3/action/datastore_search";

// How many cars to query. Priority: CLI arg > SURVEY_TARGET env > entire DB.
// "all"/"0"/omitted ⇒ Infinity, which main() caps at the real dataset size.
function parseTarget() {
  const raw = process.argv[2] ?? process.env.SURVEY_TARGET;
  if (raw === undefined || raw === "" || /^(all|full)$/i.test(raw)) return Infinity;
  const n = Number(String(raw).replace(/[_,]/g, "")); // allow 1_000_000 / 1,000,000
  if (!Number.isFinite(n) || n <= 0) return Infinity;
  return Math.floor(n);
}
const TARGET = parseTarget();
const CHUNK = Number(process.env.SURVEY_CHUNK) || 10_000;
const DELAY_MS = Number(process.env.SURVEY_DELAY_MS) || 250;
const OUT = process.env.SURVEY_OUT || path.join(__dirname, "survey-result.json");

// Categorical fields we tally verbatim (raw dataset values, before any scoring).
// These map 1:1 to the lookup tables in server/scoring.js the survey informs.
const FIELDS = [
  "tozeret_nm", // manufacturer  → MANUFACTURER_POINTS
  "kinuy_mishari", // model       → MODEL_SCORES
  "tzeva_rechev", // color        → COLOR_POINTS
  "sug_delek_nm", // fuel         → FUEL_POINTS
  "shnat_yitzur", // build year   → shnat_yitzur scorer
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Accumulators ─────────────────────────────────────────────────────────────
const counts = Object.fromEntries(FIELDS.map((f) => [f, new Map()]));
const perkCounts = new Map(); // perk name → times it fired
const tierCounts = new Map(); // S/A/B/C/D → count
const scoreBuckets = new Map(); // "0-9","10-19",… → count
let sampled = 0;

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function record(row) {
  for (const f of FIELDS) {
    const v = row[f];
    bump(counts[f], v === null || v === undefined || v === "" ? "(empty)" : String(v).trim());
  }
  // Reuse the game's authoritative scoring so perk/tier/score tallies match what
  // players actually see. mispar_rechev is the plate number used to score perks.
  if (row.mispar_rechev !== undefined && row.mispar_rechev !== null) {
    try {
      const payload = buildRollPayload(row);
      for (const p of payload.platePerks) bump(perkCounts, p.name);
      bump(tierCounts, payload.tier);
      const lo = Math.floor(payload.score / 10) * 10;
      bump(scoreBuckets, `${lo}-${lo + 9}`);
    } catch {
      // A malformed row shouldn't abort an overnight run.
    }
  }
  sampled++;
}

// ── HTTP with retry ──────────────────────────────────────────────────────────
async function fetchTotal() {
  const result = await fetchChunk(0, 0);
  return result.total || 0;
}

async function fetchChunk(offset, limit) {
  const url = `${API}?resource_id=${RESOURCE_ID}&offset=${offset}&limit=${limit}`;
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.success) throw new Error("API reported failure");
      return json.result; // { records: [...], total }
    } catch (err) {
      lastErr = err;
      const backoff = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      process.stdout.write(`\n  retry ${attempt}/5 after ${err.message} — waiting ${backoff / 1000}s\n`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// ── Progress bar ─────────────────────────────────────────────────────────────
const startTime = Date.now();
function drawBar(done, total) {
  const frac = total ? Math.min(1, done / total) : 0;
  const width = 30;
  const filled = Math.round(frac * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const pct = (frac * 100).toFixed(1).padStart(5);
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = done / Math.max(elapsed, 0.001); // rows/sec
  const etaSec = rate > 0 ? (total - done) / rate : 0;
  const eta = fmtDuration(etaSec);
  const line = `  [${bar}] ${pct}%  ${done.toLocaleString()}/${total.toLocaleString()}  ETA ${eta}   `;
  process.stdout.write("\r" + line);
}

function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

// ── Output shaping ───────────────────────────────────────────────────────────
function mapToSorted(map) {
  // [{ value, count, pct }] sorted by count desc — ready for Claude to read.
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({
      value,
      count,
      pct: Number(((count / sampled) * 100).toFixed(4)),
    }));
}

function buildOutput(datasetTotal) {
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      resourceId: RESOURCE_ID,
      sampled,
      datasetTotal,
      chunkSize: CHUNK,
      note:
        "pct = share of the sampled fleet. Rarer values should generally score " +
        "higher in server/scoring.js. Fields map: tozeret_nm→MANUFACTURER_POINTS, " +
        "kinuy_mishari→MODEL_SCORES, tzeva_rechev→COLOR_POINTS, sug_delek_nm→FUEL_POINTS.",
    },
    fields: Object.fromEntries(FIELDS.map((f) => [f, mapToSorted(counts[f])])),
    platePerks: mapToSorted(perkCounts),
    tiers: mapToSorted(tierCounts),
    scoreHistogram: [...scoreBuckets.entries()]
      .sort((a, b) => Number(a[0].split("-")[0]) - Number(b[0].split("-")[0]))
      .map(([range, count]) => ({ range, count, pct: Number(((count / sampled) * 100).toFixed(4)) })),
  };
}

let lastDatasetTotal = 0;
function checkpoint() {
  const out = buildOutput(lastDatasetTotal);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  return out;
}

// Save partial work on Ctrl+C before exiting.
let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) process.exit(1); // second Ctrl+C forces quit
  interrupted = true;
  process.stdout.write("\n\nInterrupted — saving partial result…\n");
  checkpoint();
  console.log(`Saved ${sampled.toLocaleString()} rows to ${OUT}`);
  process.exit(0);
});

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Surveying the plate registry → ${OUT}`);

  lastDatasetTotal = await fetchTotal();
  if (!lastDatasetTotal) throw new Error("could not read dataset row count");

  // Cap the target at the dataset size and lay the chunks out evenly across the
  // whole registry so the sample is representative (see the header note).
  const goal = Math.min(TARGET, lastDatasetTotal);
  const numChunks = Math.ceil(goal / CHUNK);
  // stride ≥ CHUNK guarantees the evenly-spaced windows never overlap. When the
  // goal approaches the full dataset, stride collapses to CHUNK (a full scan).
  const stride = Math.max(CHUNK, Math.floor(lastDatasetTotal / numChunks));

  console.log(
    `Dataset has ${lastDatasetTotal.toLocaleString()} rows. ` +
      `Sampling ${goal.toLocaleString()} across ${numChunks} chunks of ${CHUNK.toLocaleString()} ` +
      `(every ${stride.toLocaleString()} rows).\n`
  );

  for (let chunkIndex = 0; chunkIndex < numChunks && !interrupted; chunkIndex++) {
    const offset = chunkIndex * stride;
    if (offset >= lastDatasetTotal) break;
    const limit = Math.min(CHUNK, goal - sampled, lastDatasetTotal - offset);
    if (limit <= 0) break;

    const result = await fetchChunk(offset, limit);
    const rows = result.records || [];
    if (rows.length === 0) break;
    for (const row of rows) record(row);

    drawBar(sampled, goal);

    // Checkpoint every 10 chunks so an all-night run survives a crash.
    if ((chunkIndex + 1) % 10 === 0) checkpoint();

    await sleep(DELAY_MS);
  }

  const out = checkpoint();
  process.stdout.write("\n\n");
  console.log(`Done. Sampled ${sampled.toLocaleString()} of ${lastDatasetTotal.toLocaleString()} rows.`);
  console.log(`Wrote ${OUT}`);
  console.log(
    `Top manufacturers: ${out.fields.tozeret_nm
      .slice(0, 5)
      .map((e) => `${e.value} ${e.pct}%`)
      .join(", ")}`
  );
}

main().catch((err) => {
  process.stdout.write("\n\n");
  console.error("Survey failed:", err.message);
  console.error("Partial result (if any) is at", OUT);
  checkpoint();
  process.exit(1);
});
