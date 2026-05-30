// Talks to the data.gov.il datastore. We cache only the total row COUNT and
// refresh it every few hours; the per-roll record is fetched fresh at a random
// offset chosen here on the server (the anti-cheat core).

const RESOURCE_ID = "053cea08-09bc-40ec-8f7a-156f0677aff3";
const API = "https://data.gov.il/api/3/action/datastore_search";
const REFRESH_MS = 6 * 60 * 60 * 1000; // every 6 hours

const randInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;

let cachedTotal = null;

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
  refreshTotal();
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

async function rollRecord() {
  // Lazily populate the cache if the startup refresh hasn't landed yet.
  if (cachedTotal === null) await refreshTotal();
  if (!cachedTotal) throw new Error("no dataset row count available");
  const offset = randInt(0, cachedTotal - 1);
  const record = await fetchRecordAt(offset);
  if (!record) throw new Error(`no record at offset ${offset}`);
  return record;
}

module.exports = { startRefreshTimer, rollRecord };
