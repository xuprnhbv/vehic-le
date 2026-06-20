// Talks to the data.gov.il datastore. We cache only the total row COUNT and
// refresh it every few hours; the per-roll record is fetched fresh at a random
// offset chosen here on the server (the anti-cheat core).

const RESOURCE_ID = "053cea08-09bc-40ec-8f7a-156f0677aff3";
const API = "https://data.gov.il/api/3/action/datastore_search";
const REFRESH_MS = 6 * 60 * 60 * 1000; // every 6 hours

// How many random records to keep pre-fetched for instant logged-in rolls.
// Configurable via ROLL_CACHE_SIZE; defaults to 10, floored to a positive int.
const CACHE_TARGET = Math.max(1, Math.floor(Number(process.env.ROLL_CACHE_SIZE) || 10));

const randInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;

let cachedTotal = null;

// Background pool of pre-fetched random records. Logged-in rolls take from here
// (instant) and trigger a refill; anonymous rolls bypass it (on-demand).
const recordCache = [];
let refilling = false;

async function refreshTotal() {
  const url = `${API}?resource_id=${RESOURCE_ID}&limit=0`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const total = json?.result?.total ?? 0;
    if (!total) throw new Error("dataset reported 0 rows");
    cachedTotal = total;
    console.log(`[dataset] row count refreshed: ${cachedTotal}`);
  } catch (err) {
    // Keep the previous value on failure so rolls can continue.
    console.error(`[dataset] row count refresh failed: ${err.message}`);
  }
  return cachedTotal;
}

function startRefreshTimer() {
  // Warm the record pool once the row count lands, then keep the count fresh.
  refreshTotal().then(() => refillCache());
  const timer = setInterval(refreshTotal, REFRESH_MS);
  timer.unref(); // don't keep the process alive just for the timer
}

async function fetchRecordAt(offset) {
  const url = `${API}?resource_id=${RESOURCE_ID}&offset=${offset}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json?.result?.records?.[0] ?? null;
}

// Look up a single record by its plate number (mispar_rechev). Unlike rollRecord
// this is NOT random — it's the manual "rate my plate" path. Returns null when no
// vehicle matches (e.g. the plate is in a different dataset, or doesn't exist).
async function fetchRecordByPlate(plate) {
  const filters = encodeURIComponent(JSON.stringify({ mispar_rechev: plate }));
  const url = `${API}?resource_id=${RESOURCE_ID}&limit=1&filters=${filters}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json?.result?.records?.[0] ?? null;
}

async function rollRecord() {
  // Lazily populate the cache if the startup refresh hasn't landed yet.
  if (cachedTotal === null) await refreshTotal();
  if (!cachedTotal) throw new Error("no dataset row count available");
  const offset = randInt(0, cachedTotal - 1);
  const record = await fetchRecordAt(offset);
  if (!record) throw new Error(`no record at offset ${offset}`);
  return record;
}

// Fetch one record at a random offset, swallowing errors (returns null) so a
// single failed fetch never breaks a refill batch.
async function fetchOneRandom() {
  try {
    return await fetchRecordAt(randInt(0, cachedTotal - 1));
  } catch (err) {
    console.error(`[dataset] cache fetch failed: ${err.message}`);
    return null;
  }
}

// Top the record pool back up to CACHE_TARGET in the background. Guarded so only
// one refill runs at a time; fetches the shortfall in parallel and bails if a
// whole batch fails (so a datastore outage can't spin a hot loop).
async function refillCache() {
  if (refilling) return;
  refilling = true;
  try {
    if (cachedTotal === null) await refreshTotal();
    if (!cachedTotal) return;
    while (recordCache.length < CACHE_TARGET) {
      const need = CACHE_TARGET - recordCache.length;
      const batch = await Promise.all(Array.from({ length: need }, fetchOneRandom));
      const ok = batch.filter(Boolean);
      recordCache.push(...ok);
      if (ok.length === 0) break; // datastore unhealthy — stop trying for now
    }
  } finally {
    refilling = false;
  }
}

// Hand out a pre-fetched record (instant) for logged-in rolls, then kick off a
// background refill. On a cache miss, fall back to an on-demand fetch.
async function takeCachedRecord() {
  const record = recordCache.shift();
  refillCache(); // fire-and-forget; do not await
  if (record) return record;
  return rollRecord();
}

module.exports = { startRefreshTimer, rollRecord, takeCachedRecord, fetchRecordByPlate };
