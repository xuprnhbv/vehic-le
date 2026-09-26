// Talks to the data.gov.il datastore. We cache only the total row COUNT and
// refresh it every few hours; the per-roll record is fetched fresh at a random
// offset chosen here on the server (the anti-cheat core).

const RESOURCE_ID = "053cea08-09bc-40ec-8f7a-156f0677aff3";
const API = "https://data.gov.il/api/3/action/datastore_search";
const REFRESH_MS = 6 * 60 * 60 * 1000; // every 6 hours
// While the datastore reports 0 rows (data.gov.il empties the table while it
// re-imports), re-check the count at most this often so rolls recover on their own.
const EMPTY_RECHECK_MS = 60 * 1000;

// How many random records to keep pre-fetched for instant logged-in rolls.
// Configurable via ROLL_CACHE_SIZE; defaults to 10, floored to a positive int.
const CACHE_TARGET = Math.max(1, Math.floor(Number(process.env.ROLL_CACHE_SIZE) || 10));

const randInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;

let cachedTotal = null;
let lastCountCheck = 0;

// Background pool of pre-fetched random records. Logged-in rolls take from here
// (instant) and trigger a refill; anonymous rolls bypass it (on-demand).
const recordCache = [];
let refilling = false;

// Thrown when the upstream datastore has no rows to serve, so callers can tell a
// data.gov.il outage apart from a generic failure (503 instead of 502).
const datasetUnavailable = () =>
  Object.assign(new Error("datastore reports 0 rows"), { code: "DATASET_UNAVAILABLE" });

// True when the last successful count said the datastore is empty.
const isDatasetEmpty = () => cachedTotal === 0;

// Callbacks fired every time a count comes back empty (i.e. rolling is down). Used to
// hand out the free outage streak saver; listeners must be idempotent.
const outageListeners = [];
const onOutage = (fn) => outageListeners.push(fn);
function notifyOutage() {
  for (const fn of outageListeners) {
    try {
      fn();
    } catch (err) {
      console.error(`[dataset] outage listener failed: ${err.message}`);
    }
  }
}

async function refreshTotal() {
  const url = `${API}?resource_id=${RESOURCE_ID}&limit=0`;
  lastCountCheck = Date.now();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const total = json?.result?.total;
    if (typeof total !== "number") throw new Error("response has no row count");
    // A successful 0 is authoritative: the table really is empty. Keeping the old
    // count here would send every roll to an offset that no longer exists.
    if (total === 0) {
      if (cachedTotal !== 0) console.error("[dataset] datastore reports 0 rows — rolls unavailable");
      cachedTotal = 0;
      notifyOutage();
      return cachedTotal;
    }
    cachedTotal = total;
    console.log(`[dataset] row count refreshed: ${cachedTotal}`);
  } catch (err) {
    // Keep the previous value on a network/HTTP failure so rolls can continue.
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
  // Lazily populate the count if the startup refresh hasn't landed yet, and
  // re-check (throttled) while the datastore is empty so we recover promptly.
  if (cachedTotal === null || (cachedTotal === 0 && Date.now() - lastCountCheck > EMPTY_RECHECK_MS)) {
    await refreshTotal();
  }
  if (cachedTotal === 0) throw datasetUnavailable();
  if (!cachedTotal) throw new Error("no dataset row count available");
  const offset = randInt(0, cachedTotal - 1);
  const record = await fetchRecordAt(offset);
  if (record) return record;
  // An empty offset means our count is stale (the table shrank or was emptied):
  // refresh it and retry once before giving up.
  await refreshTotal();
  if (cachedTotal === 0) throw datasetUnavailable();
  const retry = await fetchRecordAt(randInt(0, cachedTotal - 1));
  if (!retry) throw new Error(`no record at offset ${offset}`);
  return retry;
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

module.exports = { startRefreshTimer, rollRecord, takeCachedRecord, fetchRecordByPlate, isDatasetEmpty, onOutage };
