// Server-authoritative scoring. Moved verbatim from the old client app.js so the
// browser can no longer influence which plate it gets or what score it shows.

const FIELDS = [
  ["tozeret_nm", "יצרן"],
  ["kinuy_mishari", "דגם"],
  ["shnat_yitzur", "שנת ייצור"],
  ["tzeva_rechev", "צבע"],
  ["sug_delek_nm", "סוג דלק"],
  ["moed_aliya_lakvish", "תאריך עליה לכביש"],
  ["tokef_dt", "תוקף רישיון"],
];

// Per-manufacturer points (1-40). Dataset uses Hebrew names; multiple origin
// suffixes (גרמניה, סין, הונגריה…) mean we match on the brand root only.
// Scores derived from actual fleet distribution (1,000,000-record sample, June 2026):
//   >6% → 1pt | 4-6% → 3pt | 2.5-4% → 4pt | 1-2.5% → 5-6pt | 0.5-1% → 8-9pt
//   0.1-0.5% → 11-13pt | 0.05-0.1% → 14pt | <0.05% → curated prestige ladder 14-40pt
// NOTE: keys must match the dataset's spelling — Volvo is "וולבו" (not וולוו) and
// Land/Range Rover appear as "רובר"/"לנדרובר"; the old keys matched nothing.
// Chinese/EV newcomers (MG, JAC, Geely, Xpeng, Zeekr, Deepal, Lynk & Co, SsangYong,
// Skywell, Ora, Maxus) added from the same survey; matched on brand root.
const MANUFACTURER_POINTS = {
  // Very common — dominate Israeli fleet (>6 %)
  "טויוטה": 1, "קיה": 1, "יונדאי": 2, "מזדה": 2, "סקודה": 2,
  // Common (2.5–5 %)
  "מיצובישי": 3, "סוזוקי": 3, "ניסאן": 4, "פולקסווגן": 4, "שברולט": 4, "סיאט": 4,
  // Moderately common (1–2 %)
  "סובארו": 5, "הונדה": 5, "פורד": 5, "סיטרואן": 5, "צ'רי": 5, "פיג'ו": 5,
  // "אודי" (one א) is the survey spelling for Audi-from-Mexico; keep alongside the
  // canonical "אאודי" so both spellings score the same (both also self-match safely).
  "בי ווי די": 6, "מרצדס": 6, "ב מ וו": 6, "אאודי": 6, "אודי": 6,
  "רנו": 8, "אופל": 8, "דאציה": 8, "איסוזו": 8, "פיאט": 8, "וולבו": 8,
  "לקסוס": 9, "דייהטסו": 9, "טסלה": 9, "מרוטי": 9,
  // Chinese newcomers (0.5–1 %) — match on brand root, suffix is origin (סין)
  "מ.ג": 8, "ג'אק": 9, "גילי": 9,
  // Rare (0.1–0.5 %)
  "קרייזלר": 11, "אלפא רומיאו": 13, "ג'יפ": 13, "קאדילאק": 13, "קאדילק": 13,
  "רובר": 13,
  // Rare EV / Chinese marques (0.1–0.5 %)
  "אקספנג": 11, "זיקר": 12, "דיפאל": 12, "לינק אנד קו": 13, "סאנגיונג": 13,
  // Very rare (0.05–0.1 %)
  "פורשה": 14, "דימלר": 14, "ביואיק": 14, "קופרה": 14, "סרס": 14,
  // Very rare Chinese marques (0.05–0.1 %)
  "סקיוול": 14, "אורה": 14, "מקסוס": 14,
  // Near-absent — curated prestige ladder (<0.05 %)
  "מיני": 14, "יגואר": 17, "אינפיניטי": 17, "אקורה": 18,
  "ג'נסיס": 18, "אבארת'": 18,
  // Ultra-rare (0.01–0.05 %)
  "פולסטאר": 20, "לינקולן": 22,
  // Exotic (<0.01 %)
  "לוטוס": 28, "מזראטי": 30, "אסטון מרטין": 32,
  "פרארי": 35, "בנטלי": 36, "למבורגיני": 38, "רולס רויס": 38,
  "מקלארן": 38, "בוגאטי": 40, "פאגאני": 40, "קניגסג": 40,
};

// Model-specific bonus points derived from actual dataset model names (kinuy_mishari).
// Values are LATIN UPPERCASE fragments; matched in order — put more specific patterns first.
// Points represent how much rarer/more expensive this model is relative to the base manufacturer.
const MODEL_SCORES = [
  // ── Porsche ──────────────────────────────────────────────────────
  ["911 S/T",            18], ["911 GT3",            17], ["911 TURBO S",        16],
  ["911 TURBO",          15], ["911 TARGA 4 GTS",    15], ["911 TARGA 4S",       14],
  ["911 CARRERA 4S",     13], ["911 CARRERA GTS",    13], ["911 GTS",            13],
  ["911 CARRERA S",      12], ["911 CARRERA",        10], ["CARRERA S",          11],
  ["CARRERA",             9], ["PANAMERA GTS",       12], ["PANAMERA TURBO",     13],
  ["PANAMERA 4S",        11], ["PANAMERA S",         10], ["PANAMERA",            8],
  ["CAYENNE TURB GT",    15], ["CAYENNE TURBO",      13], ["CAYENNE GTS",        11],
  ["CAYENNE S",           9], ["CAYENNE",             7],
  ["718 BOXSTER S",      10], ["718 BOXSTER",         8], ["718 CAYMAN S",       10],
  ["718 CAYMAN",          8], ["MACAN TURBO",        10], ["MACAN GTS",           9],
  ["MACAN S",             7], ["MACAN",               5],
  // ── BMW ──────────────────────────────────────────────────────────
  ["M3 CS",              16], ["M3 COMPETITION",     14], ["M3 COMP",            14],
  ["M4 COMPETITION",     14], ["M4 COMP",            14],
  ["M5 COMPETITION",     15], ["M5 CS",              16],
  ["M8 COMPETITION",     16], ["M8",                 14],
  ["M3",                 12], ["M4",                 12], ["M5",                 13],
  ["M2 COMPETITION",     13], ["M2",                 11],
  ["X7",                  8], ["X6 M",               11], ["X6",                  7],
  ["X5 M",               11], ["X5",                  7],
  ["750",                 9], ["745",                 8], ["740",                 7],
  ["730",                 6], ["640",                 7], ["630",                 6],
  ["535",                 5], ["540",                 6], ["550",                 7],
  // ── Mercedes ─────────────────────────────────────────────────────
  ["MAYBACH",            17],
  ["AMG G63",            16], ["G63 AMG",            16], ["G500",               12],
  ["AMG GT63",           15], ["AMG GT55",           14], ["AMG GT43",           12],
  ["AMG SL55",           14], ["AMG SL63",           15],
  ["AMG GLC63",          13], ["AMG GLE63",          13], ["AMG GLS63",          13],
  ["AMG E63",            13], ["AMG C63",            13],
  ["AMG E53",            12], ["AMG CLE53",          12], ["AMG EQS53",          13],
  ["AMG GLC43",          11], ["AMG GLE53",          12],
  ["AMG A45",            11], ["AMG CLA45",          11],
  ["AMG A35",             9], ["AMG CLA35",           9],
  ["AMG",                 9],
  ["S580",               12], ["S560",               11], ["S500",               10],
  ["S450",                9], ["S350",                8], ["S300",                7],
  ["CLS",                 7], ["GLE",                 5], ["GLC",                 5],
  // ── Audi ─────────────────────────────────────────────────────────
  ["RS Q8",              14], ["RS7",                14], ["RS6 AVANT",          14],
  ["RS6",                13], ["RS5",                12], ["RS4",                11],
  ["RS3",                10], ["S8",                 11], ["S7",                 10],
  ["S6",                  9], ["S5",                  8], ["S4",                  7],
  ["S3",                  6], ["R8",                 15], ["TT RS",              12],
  ["TTS",                 9], ["TT",                  7],
  ["Q8",                  7], ["Q7",                  6], ["E-TRON GT",          11],
  // ── Tesla ────────────────────────────────────────────────────────
  ["MODEL S PLAID",      13], ["MODEL S",             9],
  ["MODEL X",             8], ["MODEL 3",             4], ["MODEL Y",             3],
  // ── Jaguar ───────────────────────────────────────────────────────
  ["F-TYPE R",           14], ["F-TYPE S",           12], ["F-TYPE",             10],
  ["XJL",                 9], ["XJ",                  8], ["XF",                  6],
  ["F-PACE SVR",         12], ["F-PACE",              5],
  // ── Lexus ────────────────────────────────────────────────────────
  ["LC 500",             13], ["LC",                 11], ["LS",                 10],
  ["RC F",               12], ["GS F",               11], ["IS F",               10],
  ["LX",                  9], ["RX",                  5], ["NX",                  4],
  // ── Alfa Romeo ───────────────────────────────────────────────────
  ["GIULIA QUADRIFOGLIO",14], ["STELVIO QUADRIFOGLIO",14],
  ["GIULIA GTA",         14], ["BRERA 3.2",          12], ["BRERA",               9],
  ["GIULIA",              7], ["ALFA ROMEO GT",       8],
  // ── Honda ────────────────────────────────────────────────────────
  ["TYPE R",             14], ["NSX",                15],
  ["CIVIC TYPE",         13],
  // ── Subaru / Mitsubishi ──────────────────────────────────────────
  ["STI",                13], ["WRX",                10],
  ["LANCER EVOLUTION",   14], ["EVO",                13],
  // ── Generic performance / trim markers (catch-all) ───────────────
  ["SUPERLEGGERA",       15], ["PERFORMANTE",        15], ["TROFEO",             13],
  ["GT3",                15], ["GT4",                12], ["GTS",                 8],
  ["COMPETITION",         8], ["TURBO S",            12],
  ["TURBO",               6], ["GTI",                 7], ["RS",                  8],
];
// Per-color points (1-25).
// Scores derived from 1,000,000-record sample (June 2026). Order matters — more specific
// substrings must appear before the key they contain (e.g. "שחור פנינה" before "שחור").
// "כסף" must precede "אפור" so כסף מטלי doesn't false-match grey.
const COLOR_POINTS = {
  // Very common (>10 %) — low score
  "לבן": 1,       // שנהב לבן etc. ~40.7 %
  "כסף": 1,       // כסף מטלי, כסף etc. ~15.3 % — must precede אפור to avoid false match
  "אפור": 1,      // all grey shades combined ~16.0 %
  "שחור": 2,      // black ~12.3 %
  // Common (1–4 %)
  "כחול": 4,      // blue ~3.7 %
  "כסוף": 5,      // כסוף כהה, כסוף בהיר etc. ~2.4 %
  "אדום": 5,      // red ~1.8 %
  "בז": 5,        // beige incl. מטאלי ~1.7 %
  "תכלת": 7,      // light blue incl. מטאלי ~1.5 %
  // Uncommon (0.3–1 %)
  "ירוק": 9,      // green all shades ~0.66 %
  "ברונזה": 11,   // bronze ~0.43 %
  "קפה": 11,      // coffee/caffe metallic ~0.33 %
  "חום": 11,      // brown shades ~0.33 %
  "קרם": 11,      // cream ~0.30 %
  // Rare (0.2–0.3 %)
  "כתום": 13,     // orange ~0.28 %
  "טורקיז": 13,   // turquoise ~0.23 %
  "שן פיל": 13,   // ivory ~0.22 %
  // Rare (0.15–0.2 %)
  "צהוב": 14,     // yellow ~0.20 %
  "בורדו": 14,    // burgundy ~0.20 %
  "זהב": 14,      // gold incl. זהוב ~0.19 %
  // Very rare (0.1–0.15 %)
  "פלטינה": 16,   // platinum ~0.13 %
  "סגול": 16,     // purple ~0.11 %
  "ירקרק": 16,    // greenish ~0.10 %
  // Ultra-rare (<0.1 %)
  "רב גווני": 18, // multicolor ~0.09 %
  "נחושת": 19,    // copper ~0.07 %
  "חציל": 19,     // eggplant ~0.06 %
  "ורוד": 19,     // pink ~0.05 %
};
// Fuel-type points. ORDER IS CRITICAL — more specific strings must come first,
// otherwise "חשמל/בנזין" (hybrid) would be caught by "בנזין" and score 1pt.
// Scores from 1,000,000 sample (June 2026): בנזין 82.1 %, דיזל 9.0 %, חשמל 5.2 %,
// חשמל/בנזין 3.2 %, גפ"מ 0.42 %, חשמל/דיזל 0.03 %. Pure EVs are now common, so
// "חשמל" drops from 16 to 4 — rarer than a petrol hybrid is no longer true.
const FUEL_POINTS = {
  "חשמל/דיזל": 24,  // diesel hybrid ~0.03 % — before "דיזל" and "חשמל"
  "חשמל/בנזין": 5,  // petrol hybrid ~3.2 % — before "בנזין" and "חשמל"
  "בנזין": 1,        // petrol ~82.1 %
  "דיזל": 4,         // diesel ~9.0 %
  "סולר": 4,
  "חשמל": 4,         // pure EV ~5.2 % — now as common as a hybrid
  "חשמלי": 4,
  "גפ\"מ": 12,       // LPG ~0.42 %
  "גפמ": 12,
  "גז טבעי": 24,     // CNG — before "גז"
  "גז": 22,
  "מימן": 30,        // hydrogen — essentially absent from fleet
};

const CURRENT_YEAR = new Date().getFullYear();

function lookupPoints(value, table, fallback) {
  if (!value) return fallback;
  const v = String(value).trim().toLowerCase();
  // table can be a plain object (entries order) or an array of [fragment, pts] pairs
  const entries = Array.isArray(table) ? table : Object.entries(table);
  for (const [key, pts] of entries) {
    if (v.includes(key.toLowerCase())) return pts;
  }
  return fallback;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const SCORERS = {
  tozeret_nm(value) {
    return lookupPoints(value, MANUFACTURER_POINTS, 10);
  },
  kinuy_mishari(value) {
    const pts = lookupPoints(value, MODEL_SCORES, 0);
    if (pts > 0) return pts;
    // No known model match — small nudge so different unknown models still differ.
    if (!value) return 1;
    return 1 + clamp(Math.floor(String(value).trim().length / 6), 0, 3);
  },
  shnat_yitzur(value) {
    const y = Number(value);
    if (!Number.isFinite(y) || y <= 0) return 1;
    const age = CURRENT_YEAR - y;
    // Smooth-ish curve: 0pts for brand-new, ramps up steeply for vintage.
    // Roughly: 2025=0, 2020=2, 2015=5, 2010=8, 2000=14, 1990=22, 1980=30, <=1970=35
    const pts = Math.round(0.3 * age + 0.012 * age * age);
    return clamp(pts, 1, 35);
  },
  tzeva_rechev(value) {
    return lookupPoints(value, COLOR_POINTS, 10);
  },
  sug_delek_nm(value) {
    return lookupPoints(value, FUEL_POINTS, 5);
  },
  moed_aliya_lakvish(value, record) {
    if (!value) return 1;
    const onRoadYear = Number(String(value).slice(0, 4));
    const madeYear = Number(record.shnat_yitzur);
    if (!Number.isFinite(onRoadYear) || !Number.isFinite(madeYear)) return 1;
    const gap = onRoadYear - madeYear;
    // Linear ramp: 0 gap = 1pt; each year of gap adds ~2pts up to 15.
    return clamp(1 + gap * 2, 1, 15);
  },
  tokef_dt(value) {
    if (!value) return 1;
    const expiry = Date.parse(value);
    if (Number.isNaN(expiry)) return 1;
    const days = (expiry - Date.now()) / (24 * 60 * 60 * 1000);
    // Dataset only contains vehicles with a valid (non-expired) license, so longer
    // remaining validity is the rarer find — licenses renew for at most 1 year (365 days).
    return clamp(1 + Math.floor(days / 26), 1, 15);
  },
};

const MAX_RAW = 165;

// ── Plate number perks ────────────────────────────────────────────────────────

function isPrime(n) {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}

function isPerfectSquare(n) {
  if (n < 0) return false;
  const r = Math.round(Math.sqrt(n));
  return r * r === n;
}

function isPerfectCube(n) {
  if (n < 0) return false;
  const r = Math.round(Math.cbrt(n));
  return r * r * r === n;
}

function isTriangular(n) {
  // t(t+1)/2 = n  →  t = (-1 + sqrt(1+8n))/2
  if (n < 1) return false;
  const t = (-1 + Math.sqrt(1 + 8 * n)) / 2;
  return Number.isInteger(t);
}

function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

// Precompute Fibonacci numbers up to ~10^8 (covers all 7/8-digit plates).
const FIB_SET = (() => {
  const set = new Set();
  let a = 1, b = 1;
  while (a <= 1e8) {
    set.add(a);
    [a, b] = [b, a + b];
  }
  return set;
})();

function isFib(n) {
  return FIB_SET.has(n);
}

function countRuns(d, minLen) {
  // Returns array of distinct chars that have a run of >= minLen
  const re = new RegExp(`(.)\\1{${minLen - 1},}`, "g");
  const found = new Set();
  let m;
  while ((m = re.exec(d)) !== null) found.add(m[1]);
  return [...found];
}

function maxDigitCount(d) {
  const counts = {};
  for (const c of d) counts[c] = (counts[c] || 0) + 1;
  return Math.max(...Object.values(counts));
}

// [start,end] ranges of maximal runs of equal digits whose length is >= minLen.
// Used as perk `spans` so a longer run can suppress a shorter-run perk only where it
// actually sits (e.g. 1111222 keeps both quadrun for 1111 and triplerun for 222).
function runSpans(d, minLen) {
  const spans = [];
  let i = 0;
  while (i < d.length) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === d[i]) j++;
    if (j - i + 1 >= minLen) spans.push([i, j]);
    i = j + 1;
  }
  return spans;
}

// Single-index [i,i] spans for every position of any digit appearing >= minCount times.
// Used as count-perk `spans` so a run perk suppresses the same-digit count perk only when
// the run covers all of that digit's positions (1111234 → run accounts for the 4; 1112341 →
// the stray 1 is outside the run, so the count perk survives).
function digitPositions(d, minCount) {
  const pos = {};
  for (let i = 0; i < d.length; i++) (pos[d[i]] ??= []).push(i);
  const spans = [];
  for (const k of Object.keys(pos)) {
    if (pos[k].length >= minCount) for (const i of pos[k]) spans.push([i, i]);
  }
  return spans;
}

function digitSum(d) {
  return d.split("").reduce((s, c) => s + Number(c), 0);
}

function isAllIn(d, allowed) {
  for (const c of d) if (!allowed.includes(c)) return false;
  return true;
}

function isABAB(d) {
  if (d[0] === d[1]) return false;
  for (let i = 0; i < d.length; i++) {
    if (d[i] !== (i % 2 === 0 ? d[0] : d[1])) return false;
  }
  return true;
}

function hasConsecutiveRun(d, step) {
  for (let i = 0; i <= d.length - 3; i++) {
    if (Number(d[i + 1]) - Number(d[i]) === step &&
        Number(d[i + 2]) - Number(d[i + 1]) === step) return true;
  }
  return false;
}

// Strictly rises to a single peak, then strictly falls (a "hill"). Peak must be
// interior, so both an up-slope and a down-slope exist. Works for any length.
function isHill(d) {
  const n = d.length;
  let i = 0;
  while (i + 1 < n && Number(d[i]) < Number(d[i + 1])) i++;
  if (i === 0 || i === n - 1) return false;
  while (i + 1 < n && Number(d[i]) > Number(d[i + 1])) i++;
  return i === n - 1;
}

// Strictly falls to a single trough, then strictly rises (a "valley").
function isValley(d) {
  const n = d.length;
  let i = 0;
  while (i + 1 < n && Number(d[i]) > Number(d[i + 1])) i++;
  if (i === 0 || i === n - 1) return false;
  while (i + 1 < n && Number(d[i]) < Number(d[i + 1])) i++;
  return i === n - 1;
}

const PLATE_PERKS = [
  {
    id: "monodigit",
    name: "ספרה בודדה",
    desc: "כל ספרות הלוחית זהות",
    pts: 40,
    check: (d) => new Set(d).size === 1,
    // All identical: the ceiling of both the run and the count ladders. No spans → covers
    // the whole plate, so every repetition perk below is unconditionally redundant. Also
    // trivially satisfies same-edges and both sort orders.
    subsumes: ["quintrun", "quadrun", "triplerun", "quintdigit", "quaddigit",
      "sameedges", "nondecreasing", "nonincreasing"],
  },
  {
    id: "palindrome",
    name: "פלינדרום",
    desc: "הלוחית נקראת אותו דבר משני הכיוונים",
    pts: 22,
    check: (d) => d === d.split("").reverse().join("") && new Set(d).size > 1,
    // Reversing a palindrome preserves first==last unconditionally.
    subsumes: ["sameedges"],
  },
  {
    id: "strobogrammatic",
    name: "הפוך על הפוך",
    desc: "הלוחית נקראת אותו דבר כשמסובבים אותה ב-180° (ספרות 0,1,8,6,9 בלבד; 6↔9)",
    pts: 32,
    check: (d) => {
      if (new Set(d).size === 1) return false;
      const rot = { "0": "0", "1": "1", "8": "8", "6": "9", "9": "6" };
      let r = "";
      for (let i = d.length - 1; i >= 0; i--) {
        const m = rot[d[i]];
        if (m === undefined) return false;
        r += m;
      }
      return r === d;
    },
  },
  {
    id: "sequence",
    name: "סדרה מושלמת",
    desc: "כל הספרות ברצף עולה או יורד של 1",
    pts: 18,
    check: (d) => {
      const step = Number(d[1]) - Number(d[0]);
      if (step !== 1 && step !== -1) return false;
      for (let i = 1; i < d.length; i++) if (Number(d[i]) - Number(d[i - 1]) !== step) return false;
      return true;
    },
    // Whole-plate ±1 run: every local three-in-arithmetic is part of it. No spans → covers
    // the whole plate, so the local run perks below are redundant. A ≤10-length ±1 run also
    // never repeats a digit — but only one of nondecreasing/nonincreasing holds depending on
    // direction, never both, so those are NOT included here.
    subsumes: ["threeup", "threedown", "allunique"],
  },
  {
    id: "triplerun",
    name: "שלשה ברצף",
    desc: "שלוש ספרות זהות ברצף",
    pts: 8,
    check: (d) => /(.)\1\1/.test(d),
    spans: (d) => runSpans(d, 3),
  },
  {
    id: "sixtyseven",
    name: "שש שבע!",
    desc: "מספר לוחית מכיל 67",
    pts: 6,
    check: (d) => d.includes("67"),
  },
  {
    id: "sixtynine",
    name: "נחמד",
    desc: "מספר לוחית מכיל 69",
    pts: 6,
    check: (d) => d.includes("69"),
  },
  {
    id: "allunique",
    name: "ללא מספרים חוזרים",
    desc: "כל הספרות שונות זו מזו",
    pts: 6,
    check: (d) => new Set(d).size === d.length,
  },
  {
    id: "prime",
    name: "ראשוני",
    desc: "מספר הלוחית הוא מספר ראשוני",
    pts: 5,
    check: (d) => isPrime(Number(d)),
  },
  {
    id: "round",
    name: "עגול",
    desc: "הלוחית מסתיימת ב-000",
    pts: 5,
    check: (d) => d.endsWith("000"),
  },
  {
    id: "lucky7sum",
    name: "סכום מתחלק בשבע",
    desc: "סכום ספרות הלוחית מתחלק ב-7",
    pts: 4,
    check: (d) => d.split("").reduce((s, c) => s + Number(c), 0) % 7 === 0,
  },

  // ── Composition ────────────────────────────────────────────────────────────
  {
    id: "onlyeven",
    name: "רק ספרות זוגיות",
    desc: "כל הספרות זוגיות (0,2,4,6,8)",
    pts: 10,
    check: (d) => isAllIn(d, "02468"),
  },
  {
    id: "onlyodd",
    name: "רק ספרות אי-זוגיות",
    desc: "כל הספרות אי-זוגיות (1,3,5,7,9)",
    pts: 10,
    check: (d) => isAllIn(d, "13579"),
    // 0 is never odd, so this can never contain a zero.
    subsumes: ["nozero"],
  },
  {
    id: "nozero",
    name: "בלי אפסים",
    desc: "אין אף ספרת אפס בלוחית",
    pts: 2,
    check: (d) => !d.includes("0"),
  },
  {
    id: "twodig",
    name: "שתי ספרות שונות",
    desc: "הלוחית מורכבת משתי ספרות שונות בלבד",
    pts: 14,
    check: (d) => new Set(d).size === 2,
    // Pigeonhole: 2 values filling 7-8 slots forces some digit's count to at least 4.
    subsumes: ["quaddigit"],
  },
  {
    id: "threedig",
    name: "שלוש ספרות שונות",
    desc: "הלוחית מורכבת משלוש ספרות שונות בלבד",
    pts: 6,
    check: (d) => new Set(d).size === 3,
  },
  {
    id: "onlyprimes",
    name: "רק ספרות ראשוניות",
    desc: "כל הספרות ראשוניות (2,3,5,7)",
    pts: 9,
    check: (d) => isAllIn(d, "2357"),
    // 0 is never prime, so this can never contain a zero.
    subsumes: ["nozero"],
  },
  {
    id: "binary",
    name: "בינארי",
    desc: "הלוחית מורכבת מהספרות 0 ו-1 בלבד",
    pts: 25,
    check: (d) => isAllIn(d, "01") && new Set(d).size > 1,
    // Only 2 possible values (size>1 forces exactly 2 → twodig, hence quaddigit by pigeonhole).
    // Needs a 0 present (else it'd be all-1s, failing size>1), so digit sum ≤ length-1 ≤ 7
    // (smallsum), and the only possible nonzero digit is 1, so "divides every nonzero digit"
    // is trivially true (divbyalldigits).
    subsumes: ["twodig", "quaddigit", "smallsum", "divbyalldigits"],
  },
  {
    id: "allpairs",
    name: "הכל בזוגות",
    desc: "כל ספרה מופיעה מספר זוגי של פעמים",
    pts: 10,
    check: (d) => {
      const c = {};
      for (const ch of d) c[ch] = (c[ch] || 0) + 1;
      return Object.values(c).every((n) => n % 2 === 0);
    },
  },
  {
    id: "pandigital",
    name: "פנדיגיטלי",
    desc: "שמונה ספרות שונות ורצופות (כמו 0–7, 1–8 או 2–9)",
    pts: 18,
    check: (d) => {
      if (d.length !== 8 || new Set(d).size !== 8) return false;
      const nums = d.split("").map(Number);
      return Math.max(...nums) - Math.min(...nums) === 7;
    },
    // Own check already requires exactly 8 distinct digits — identical to allunique at length 8.
    subsumes: ["allunique"],
  },

  // ── Runs & Patterns ────────────────────────────────────────────────────────
  {
    id: "quadrun",
    name: "רביעיה ברצף",
    desc: "ארבע ספרות זהות ברצף",
    pts: 18,
    check: (d) => /(.)\1\1\1/.test(d),
    spans: (d) => runSpans(d, 4),
    subsumes: ["triplerun", "quaddigit"],
  },
  {
    id: "quintrun",
    name: "חמישיה ברצף",
    desc: "חמש ספרות זהות ברצף",
    pts: 32,
    check: (d) => /(.)\1\1\1\1/.test(d),
    spans: (d) => runSpans(d, 5),
    subsumes: ["quadrun", "triplerun", "quintdigit", "quaddigit"],
  },
  {
    id: "twotriplerun",
    name: "שתי שלשות",
    desc: "שתי קבוצות נפרדות של שלוש ספרות זהות ברצף",
    pts: 20,
    check: (d) => countRuns(d, 3).length >= 2,
    // NOT "triplerun": having ≥2 qualifying runs does always imply ≥1 exists, but this has
    // no `spans` of its own, so declaring it here would unconditionally drop triplerun even
    // when one of the runs is a quadrun+ that only *partially* covers triplerun's spans —
    // e.g. "1111222" (quadrun's span is only "1111"; triplerun must survive via "222", per
    // the documented invariant below). Confirmed as a real regression by direct testing.
  },
  {
    id: "abab",
    name: "תבנית מתחלפת",
    desc: "שתי ספרות מתחלפות לסירוגין (א-ב-א-ב)",
    pts: 20,
    check: (d) => isABAB(d),
    // Whole-plate 2-digit alternation always uses exactly 2 digits (twodig), forces some
    // digit's count ≥4 by pigeonhole (quaddigit), and its first 4/5 chars always match the
    // local ABAB/ABABA block patterns.
    subsumes: ["twodig", "quaddigit", "blockxyxy", "blockxyxyx"],
  },
  {
    id: "threeup",
    name: "שלשה עולה",
    desc: "שלוש ספרות רצופות העולות ב-1",
    pts: 4,
    check: (d) => hasConsecutiveRun(d, 1),
  },
  {
    id: "threedown",
    name: "שלשה יורדת",
    desc: "שלוש ספרות רצופות היורדות ב-1",
    pts: 4,
    check: (d) => hasConsecutiveRun(d, -1),
  },
  {
    id: "triple666",
    name: "מספר השטן",
    desc: "הרצף 666 מופיע בלוחית",
    pts: 7,
    check: (d) => d.includes("666"),
  },
  {
    id: "quaddigit",
    name: "רביעייה",
    desc: "אותה ספרה מופיעה לפחות ארבע פעמים",
    pts: 10,
    check: (d) => maxDigitCount(d) >= 4,
    spans: (d) => digitPositions(d, 4),
  },
  {
    id: "quintdigit",
    name: "חמישייה",
    desc: "אותה ספרה מופיעה לפחות חמש פעמים",
    pts: 18,
    check: (d) => maxDigitCount(d) >= 5,
    spans: (d) => digitPositions(d, 5),
    subsumes: ["quaddigit"],
  },
  {
    id: "twins",
    name: "תאומים",
    desc: "מחצית הלוחית הראשונה זהה למחצית השנייה (בלוחית בת 8 ספרות)",
    pts: 22,
    check: (d) => d.length === 8 && d.slice(0, 4) === d.slice(4),
    // Duplicating a half always doubles every digit's count (allpairs) and trivially
    // equalizes the two half-sums (balanced).
    subsumes: ["allpairs", "balanced"],
  },
  {
    id: "doublestairs",
    name: "מדרגות כפולות",
    desc: "הלוחית בנויה מזוגות של ספרות זהות (א-א-ב-ב-ג-ג…)",
    pts: 18,
    check: (d) => {
      if (d.length % 2 !== 0) return false;
      for (let i = 0; i < d.length; i += 2) if (d[i] !== d[i + 1]) return false;
      return true;
    },
    // Pairing up digits always makes every digit's total count even. At length 8, the
    // alternating-sum-of-digits divisibility rule for 11 also always nets to zero, since
    // each pair puts the same value at one odd and one even index.
    subsumes: ["allpairs", "mult11"],
  },
  // Block patterns: a contiguous run somewhere in the plate matching the shape,
  // with X≠Y enforced by the (?!\1) lookahead so they don't collapse into a run.
  {
    id: "blockxxyy",
    name: "זוג-זוג",
    desc: "שני זוגות צמודים של ספרות זהות שונות (א-א-ב-ב)",
    pts: 6,
    check: (d) => /(\d)\1(?!\1)(\d)\2/.test(d),
  },
  {
    id: "blockxyyx",
    name: "א-ב-ב-א",
    desc: "ארבע ספרות בתבנית מראה (א-ב-ב-א)",
    pts: 7,
    check: (d) => /(\d)(?!\1)(\d)\2\1/.test(d),
  },
  {
    id: "blockxyxy",
    name: "א-ב-א-ב",
    desc: "תבנית מתחלפת באורך ארבע (א-ב-א-ב)",
    pts: 7,
    check: (d) => /(\d)(?!\1)(\d)\1\2/.test(d),
  },
  {
    id: "blockxyxyx",
    name: "א-ב-א-ב-א",
    desc: "תבנית מתחלפת באורך חמש (א-ב-א-ב-א)",
    pts: 16,
    check: (d) => /(\d)(?!\1)(\d)\1\2\1/.test(d),
    // Any 5-char ABABA window contains ABAB as its own first 4 chars.
    subsumes: ["blockxyxy"],
  },
  {
    id: "blockxxxyyy",
    name: "שלשה-שלשה",
    desc: "שתי שלשות צמודות של ספרות זהות שונות (א-א-א-ב-ב-ב)",
    pts: 22,
    check: (d) => /(\d)\1\1(?!\1)(\d)\2\2/.test(d),
    // An AAABBB block is itself 2 disjoint qualifying runs (twotriplerun), and its middle 4
    // chars (AABB) always match the local block pattern. NOT triplerun: this is a local
    // 6-char window with no spans, so listing triplerun here would let an unrelated 4th
    // same-digit run elsewhere on the plate (e.g. "0000111") get wrongly discarded.
    subsumes: ["twotriplerun", "blockxxyy"],
  },

  // ── Math ────────────────────────────────────────────────────────────────────
  {
    id: "mult11",
    name: "מתחלק ב11",
    desc: "מספר הלוחית מתחלק ב-11",
    pts: 6,
    check: (d) => Number(d) % 11 === 0,
  },
  {
    id: "mult13",
    name: "מתחלק ב13",
    desc: "מספר הלוחית מתחלק ב-13",
    pts: 7,
    check: (d) => Number(d) % 13 === 0,
  },
  {
    id: "mult100",
    name: "מתחלק ב100",
    desc: "מספר הלוחית מתחלק ב-100 (אך לא ב-1000)",
    pts: 3,
    check: (d) => d.endsWith("00") && !d.endsWith("000"),
  },
  {
    id: "mult10000",
    name: "מתחלק ב10,000",
    desc: "מספר הלוחית מתחלק ב-10,000",
    pts: 12,
    check: (d) => Number(d) % 10000 === 0,
    // Divisible by 10000 forces the plate to end "0000", which ends "000" too.
    subsumes: ["round"],
  },
  {
    id: "perfectsq",
    name: "ריבוע מושלם",
    desc: "מספר הלוחית הוא ריבוע מושלם",
    pts: 25,
    check: (d) => isPerfectSquare(Number(d)),
  },
  {
    id: "power2",
    name: "חזקת 2",
    desc: "מספר הלוחית הוא חזקה של 2",
    pts: 30,
    check: (d) => isPowerOfTwo(Number(d)),
  },
  {
    id: "perfectcube",
    name: "קוביה מושלמת",
    desc: "מספר הלוחית הוא חזקה שלישית מושלמת",
    pts: 30,
    check: (d) => isPerfectCube(Number(d)),
  },
  {
    id: "harshad",
    name: "מספר ניבן",
    desc: "מספר הלוחית מתחלק בסכום ספרותיו",
    pts: 5,
    check: (d) => {
      const s = digitSum(d);
      return s > 0 && Number(d) % s === 0;
    },
  },
  {
    id: "fibonacci",
    name: "פיבונאצ'י",
    desc: "מספר הלוחית מופיע בסדרת פיבונאצ'י",
    pts: 28,
    check: (d) => isFib(Number(d)),
  },
  {
    id: "triangular",
    name: "מספר משולש",
    desc: "מספר הלוחית הוא מספר משולש",
    pts: 15,
    check: (d) => isTriangular(Number(d)),
  },
  {
    id: "gematria18",
    name: "גימטרייה ח\"י",
    desc: "סכום הספרות הוא 18 (ח״י)",
    pts: 6,
    check: (d) => digitSum(d) === 18,
  },
  {
    id: "gematria36",
    name: "גימטרייה ל\"ו",
    desc: "סכום הספרות הוא 36 (ל״ו)",
    pts: 7,
    check: (d) => digitSum(d) === 36,
  },
  {
    id: "smallsum",
    name: "סכום קטן מ7",
    desc: "סכום כל הספרות הוא 7 או פחות",
    pts: 5,
    check: (d) => digitSum(d) <= 7,
  },
  {
    id: "balanced",
    name: "מאוזן",
    desc: "סכום ספרות המחצית הראשונה שווה לסכום ספרות המחצית השנייה (לוחית בת 8 ספרות)",
    pts: 7,
    check: (d) => d.length === 8 && digitSum(d.slice(0, 4)) === digitSum(d.slice(4)),
  },
  {
    id: "divbyalldigits",
    name: "מתחלק בכל ספרותיו",
    desc: "מספר הלוחית מתחלק בכל אחת מספרותיו (מלבד אפסים)",
    pts: 9,
    check: (d) => {
      const n = Number(d);
      if (n === 0) return false;
      for (const c of d) {
        const k = Number(c);
        if (k !== 0 && n % k !== 0) return false;
      }
      return true;
    },
  },
  {
    id: "automorphic",
    name: "אוטומורפי",
    desc: "ריבוע מספר הלוחית מסתיים באותו מספר",
    pts: 30,
    check: (d) => {
      const n = BigInt(d);
      if (n === 0n) return false;
      return (n * n).toString().endsWith(n.toString());
    },
  },
  {
    id: "primedigitsum",
    name: "סכום ראשוני",
    desc: "סכום ספרות הלוחית הוא מספר ראשוני",
    pts: 2,
    check: (d) => isPrime(digitSum(d)),
  },
  {
    id: "palindromeprime",
    name: "ראשוני פלינדרומי",
    desc: "מספר הלוחית ראשוני וגם פלינדרום",
    pts: 32,
    check: (d) =>
      new Set(d).size > 1 && d === d.split("").reverse().join("") && isPrime(Number(d)),
    // Own check already ANDs isPrime — prime is a direct restatement, not just an inference.
    subsumes: ["palindrome", "prime"],
  },

  // ── Contains ───────────────────────────────────────────────────────────────
  {
    id: "contains42",
    name: "התשובה",
    desc: "הרצף 42 מופיע בלוחית — התשובה לחיים, היקום וכל השאר",
    pts: 4,
    check: (d) => d.includes("42"),
  },
  {
    id: "contains1337",
    name: "l33t",
    desc: "הרצף 1337 מופיע בלוחית (\"leet\")",
    pts: 10,
    check: (d) => d.includes("1337"),
  },
  {
    id: "currentyear",
    name: `שנת ${CURRENT_YEAR}`,
    desc: "השנה הנוכחית מופיעה בלוחית",
    pts: 8,
    check: (d) => d.includes(String(CURRENT_YEAR)),
  },
  {
    id: "pi314",
    name: "פאי",
    desc: "הרצף 314 מופיע בלוחית (π)",
    pts: 5,
    check: (d) => d.includes("314"),
  },
  {
    id: "contains911",
    name: "911",
    desc: "הרצף 911 מופיע בלוחית",
    pts: 5,
    check: (d) => d.includes("911"),
  },
  {
    id: "independence",
    name: "עצמאות",
    desc: "הרצף 1948 מופיע בלוחית — שנת הקמת המדינה",
    pts: 12,
    check: (d) => d.includes("1948"),
  },
  {
    id: "sixday",
    name: "מלחמת ששת הימים",
    desc: "הרצף 1967 מופיע בלוחית — שנת מלחמת ששת הימים",
    pts: 10,
    check: (d) => d.includes("1967"),
    // "1967" contains "67" as a literal substring.
    subsumes: ["sixtyseven"],
  },
  {
    id: "yomkippur",
    name: "יום כיפור",
    desc: "הרצף 1973 מופיע בלוחית — שנת מלחמת יום הכיפורים",
    pts: 10,
    check: (d) => d.includes("1973"),
  },
  {
    id: "taryag",
    name: 'תרי"ג מצוות',
    desc: "הרצף 613 מופיע בלוחית — מספר המצוות",
    pts: 5,
    check: (d) => d.includes("613"),
  },
  {
    id: "israelcode",
    name: "קידומת ישראל",
    desc: "הרצף 972 מופיע בלוחית — קידומת החיוג של ישראל",
    pts: 5,
    check: (d) => d.includes("972"),
  },
  {
    id: "mada",
    name: 'מד"א',
    desc: "הרצף 101 מופיע בלוחית — מספר החירום של מגן דוד אדום",
    pts: 5,
    check: (d) => d.includes("101"),
  },
  {
    id: "cellprefix",
    name: "סלולרי",
    desc: "הלוחית מכילה קידומת סלולרית (050/052/053/054/058)",
    pts: 4,
    check: (d) => ["050", "052", "053", "054", "058"].some((p) => d.includes(p)),
  },
  {
    id: "bond",
    name: "ג'יימס בונד",
    desc: "הרצף 007 מופיע בלוחית",
    pts: 5,
    check: (d) => d.includes("007"),
  },
  {
    id: "fourtwenty",
    name: "הצת אותה!",
    desc: "הרצף 420 מופיע בלוחית",
    pts: 4,
    check: (d) => d.includes("420"),
    // "420" contains "42" as a literal substring (equal points; kept as a strict subset).
    subsumes: ["contains42"],
  },
  {
    id: "today",
    name: "היום!",
    desc: "מספר הלוחית מכיל את התאריך של היום (DDMMYY)",
    pts: 25,
    check: (d) => {
      const t = new Date();
      const dd = String(t.getDate()).padStart(2, "0");
      const mm = String(t.getMonth() + 1).padStart(2, "0");
      const yy = String(t.getFullYear() % 100).padStart(2, "0");
      return d.includes(`${dd}${mm}${yy}`);
    },
  },

  // ── Position ───────────────────────────────────────────────────────────────
  {
    id: "sameedges",
    name: "קצוות זהים",
    desc: "הספרה הראשונה והאחרונה זהות",
    pts: 5,
    check: (d) => d[0] === d[d.length - 1],
  },
  {
    id: "ninecomplement",
    name: "משלימים לתשע",
    desc: "כל ספרה והספרה הסימטרית לה מהצד השני מסתכמות ב-9",
    pts: 26,
    check: (d) => {
      for (let i = 0, j = d.length - 1; i <= j; i++, j--) {
        if (Number(d[i]) + Number(d[j]) !== 9) return false;
      }
      return true;
    },
    // At length 8, 4 mirrored pairs each summing to 9 force the total digit sum to be
    // exactly 4×9=36. (Unsatisfiable at length 7 — the middle digit would need 2×d=9 —
    // so this is vacuously safe there.)
    subsumes: ["gematria36"],
  },
  {
    id: "nondecreasing",
    name: "ספרות עולות",
    desc: "הספרות ממוינות משמאל לימין בסדר עולה",
    pts: 8,
    check: (d) => {
      for (let i = 1; i < d.length; i++) if (Number(d[i]) < Number(d[i - 1])) return false;
      return true;
    },
  },
  {
    id: "nonincreasing",
    name: "ספרות יורדות",
    desc: "הספרות ממוינות משמאל לימין בסדר יורד",
    pts: 8,
    check: (d) => {
      for (let i = 1; i < d.length; i++) if (Number(d[i]) > Number(d[i - 1])) return false;
      return true;
    },
  },
  {
    id: "hill",
    name: "גבעה",
    desc: "ספרות עולות עד הספרה האמצעית, ואז הן יורדות",
    pts: 16,
    check: (d) => isHill(d),
  },
  {
    id: "valley",
    name: "גיא",
    desc: "ספרות יורדות עד הספרה האמצעית, ואז הן עולות",
    pts: 16,
    check: (d) => isValley(d),
  },
  {
    id: "perfecthill",
    name: "גבעה מושלמת",
    desc: "גבעה שבה הספרה הראשונה והאחרונה זהות",
    pts: 22,
    check: (d) => isHill(d) && d[0] === d[d.length - 1],
    // Own check already ANDs d[0]===d[last].
    subsumes: ["hill", "sameedges"],
  },
  {
    id: "perfectvalley",
    name: "גיא מושלם",
    desc: "גיא שבו הספרה הראשונה והאחרונה זהות",
    pts: 22,
    check: (d) => isValley(d) && d[0] === d[d.length - 1],
    // Own check already ANDs d[0]===d[last].
    subsumes: ["valley", "sameedges"],
  },

  // ── Special / themed ─────────────────────────────────────────────────────────
  {
    // Israeli taxi registration numbers always end in 25 or 26 (true for both the
    // 7- and 8-digit formats — taxis still use the legacy 25/26 series). So a plate
    // ending in either suffix is, by the numbering scheme, a taxi. The Monte-Carlo
    // estimator reports ~2% (random digits land on 25/26 that often), but in the real
    // fleet 25/26 is RESERVED for taxis, so the true hit-rate is the taxi share of the
    // fleet: ~25,050 taxis / ~4.2M vehicles ≈ 0.6% (≈ the 5-pt themed-substring perks
    // like 911/מד"א), nudged up for being a signature find.
    id: "taxi",
    name: "מונית",
    desc: "מספר הלוחית מסתיים ב-25 או ב-26 — סימן ההיכר של מוניות בישראל",
    pts: 8,
    check: (d) => d.endsWith("25") || d.endsWith("26"),
  },
  {
    // Contains an Israeli intelligence/cyber unit code (7149 or 8200). Two specific
    // 4-digit substrings ≈ twice as likely as a single one (cf. contains1337).
    id: "cyber",
    name: "סייבר",
    desc: "סייבר.",
    pts: 10,
    check: (d) => d.includes("7149") || d.includes("8200"),
  },
  {
    // Outer 3+3 digits (8-digit plates only) sum to exactly 1000: 999 combos out of
    // 10^6 for the outer digits (~0.1%), middle two digits free.
    id: "thousand",
    name: "רכב אלף",
    desc: "שלוש הספרות הראשונות והאחרונות מסתכמות ב-1000",
    pts: 12,
    check: (d) => d.length === 8 && Number(d.slice(0, 3)) + Number(d.slice(5)) === 1000,
  },
  {
    // One exact plate (697-56-301). ~1-in-10^8 — the rarest perk; lands S on its own.
    id: "chosen",
    name: "הרכב הנבחר",
    desc: "הרכב הכי טוב בארץ!!!!!!!!!!!",
    pts: 100,
    check: (d) => d === "69756301",
  },
];

// Keep only the rarest perk within each overlapping feature ladder. A matched perk B may
// `subsumes` lower-rung perks; a subsumed perk A is dropped only when every position it
// claims (its `spans`, or the whole plate if it has none) is already covered by the union of
// its matched subsumers' spans. Subsumers without `spans` cover the whole plate, so they drop
// A unconditionally. This makes independent occurrences survive: 1111222 keeps both quadrun
// (1111) and triplerun (222); 1112341 keeps quaddigit because the 4th "1" is outside the run.
function scorePlate(digits) {
  const matched = PLATE_PERKS.filter((p) => p.check(digits));
  const len = digits.length;
  const survivors = matched.filter((perk) => {
    const subsumers = matched.filter((b) => b.subsumes?.includes(perk.id));
    if (subsumers.length === 0) return true;
    const covered = new Array(len).fill(false);
    for (const b of subsumers) {
      if (!b.spans) return false; // whole-plate subsumer → always drops
      for (const [s, e] of b.spans(digits)) for (let i = s; i <= e; i++) covered[i] = true;
    }
    const want = perk.spans ? perk.spans(digits) : [[0, len - 1]];
    for (const [s, e] of want) for (let i = s; i <= e; i++) if (!covered[i]) return true;
    return false; // every claimed position already covered by a rarer perk
  });
  const pts = survivors.reduce((s, p) => s + p.pts, 0);
  return { pts, perks: survivors };
}

// ── Daily streak bonus ──────────────────────────────────────────────────────
// Extra points for rolling on consecutive days. Added to the player's *overall*
// score (and the cumulative leaderboards) — never to the plate score or tier.
// Capped at 24 — the top of D tier, roughly the score of an average car.
// day1=1 … day10=14 (flat) … day30=19 (flat) … day100=24 (hard cap).
function streakBonus(streak) {
  if (streak <= 0) return 0;
  let bonus = Math.min(streak, 10);
  if (streak >= 7)   bonus += 4;
  if (streak >= 30)  bonus += 5;
  if (streak >= 100) bonus += 5;
  return bonus;
}

// ─────────────────────────────────────────────────────────────────────────────

// Percentile-based tiers, calibrated from a full 4,133,963-row fleet survey
// (scripts/survey-fleet.js, June 2026): top 1% → S, next 9% → A, next 20% → B,
// next 30% → C, next 30% → D, bottom 10% → F. Integer score clustering means the
// splits land at 1.1 / 9.7 / 19.6 / 29.2 / 30.5 / 9.9 % — the closest achievable
// to 1/9/20/30/30/10 (the C/D cutoff is nudged off the raw P40 to balance the pair).
function tierFor(score) {
  if (score >= 58) return "S";
  if (score >= 40) return "A";
  if (score >= 32) return "B";
  if (score >= 25) return "C";
  if (score >= 17) return "D";
  return "F";
}

function scoreRecord(record, plateDigits) {
  let raw = 0;
  const breakdown = {};
  for (const [key] of FIELDS) {
    const pts = SCORERS[key]?.(record[key], record) ?? 1;
    breakdown[key] = pts;
    raw += pts;
  }
  const plate = scorePlate(plateDigits);
  raw += plate.pts;
  return { score: raw, tier: tierFor(raw), breakdown, platePerks: plate.perks };
}

function formatPlate(digits) {
  const d = String(digits);
  if (d.length === 8) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  if (d.length === 7) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return d;
}

// Build the finished, client-ready payload from a raw dataset record. The client
// receives only this — no scoring tables — so it can't tamper with the result.
function buildRollPayload(record) {
  const digits = String(record.mispar_rechev);
  const display = formatPlate(digits);
  const scored = scoreRecord(record, digits);

  // Mirror the old client's revealScoring: drop fields with no value, keep FIELDS order.
  const fields = [];
  for (const [key, label] of FIELDS) {
    const value = record[key];
    if (value === null || value === undefined || value === "") continue;
    fields.push({ label, value: String(value), points: scored.breakdown[key] ?? 0 });
  }

  const platePerks = scored.platePerks.map((p) => ({ name: p.name, pts: p.pts }));

  return {
    plate: { digits, display },
    fields,
    platePerks,
    score: scored.score,
    tier: scored.tier,
  };
}

// User-facing perk explanations. Names + points are already in every payload, so the
// descriptions add nothing exploitable — they're display text the client looks up by name.
function getPerkDescriptions() {
  return PLATE_PERKS.map(({ name, desc }) => ({ name, desc }));
}

module.exports = {
  buildRollPayload,
  scoreRecord,
  tierFor,
  formatPlate,
  getPerkDescriptions,
  streakBonus,
  // Exported for scripts/check-perk-overlaps.js only — still server-side, never reaches public/.
  PLATE_PERKS,
  scorePlate,
};
