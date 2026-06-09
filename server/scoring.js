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
const MANUFACTURER_POINTS = {
  // Very common — dominate Israeli fleet (>6 %)
  "טויוטה": 1, "קיה": 1, "יונדאי": 2, "מזדה": 2, "סקודה": 2,
  // Common (2.5–5 %)
  "מיצובישי": 3, "סוזוקי": 3, "ניסאן": 4, "פולקסווגן": 4, "שברולט": 4, "סיאט": 4,
  // Moderately common (1–2 %)
  "סובארו": 5, "הונדה": 5, "פורד": 5, "סיטרואן": 5, "צ'רי": 5, "פיג'ו": 5,
  "בי ווי די": 6, "מרצדס": 6, "ב מ וו": 6, "אאודי": 6,
  // Uncommon (0.5–1 %)
  "רנו": 8, "אופל": 8, "דאציה": 8, "איסוזו": 8, "פיאט": 8, "וולבו": 8,
  "לקסוס": 9, "דייהטסו": 9, "טסלה": 9, "מרוטי": 9,
  // Rare (0.1–0.5 %)
  "קרייזלר": 11, "אלפא רומיאו": 13, "ג'יפ": 13, "קאדילאק": 13, "קאדילק": 13,
  "רובר": 13,
  // Very rare (0.05–0.1 %)
  "פורשה": 14, "דימלר": 14, "ביואיק": 14, "קופרה": 14, "סרס": 14,
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
    if (days < 0) {
      // Expired: deeper expiry = rarer find. -7d=5, -30d=7, -180d=10
      return clamp(Math.round(5 + Math.log10(Math.abs(days) + 1) * 3), 5, 10);
    }
    if (days < 30) return clamp(Math.round(5 - days / 10), 2, 5);
    // Fresh license: 1pt baseline; vehicles with very long validity nudged up slightly.
    return clamp(1 + Math.floor(days / 200), 1, 4);
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

const PLATE_PERKS = [
  {
    id: "monodigit",
    name: "ספרה בודדה",
    desc: "כל ספרות הלוחית זהות",
    pts: 40,
    check: (d) => new Set(d).size === 1,
  },
  {
    id: "palindrome",
    name: "פלינדרום",
    desc: "הלוחית נקראת אותו דבר משני הכיוונים",
    pts: 22,
    check: (d) => d === d.split("").reverse().join("") && new Set(d).size > 1,
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
  },
  {
    id: "triplerun",
    name: "שלשה ברצף",
    desc: "שלוש ספרות זהות ברצף",
    pts: 8,
    check: (d) => /(.)\1\1/.test(d),
  },
  {
    id: "triple777",
    name: "777",
    desc: "הרצף 777 מופיע בלוחית",
    pts: 7,
    check: (d) => d.includes("777"),
  },
  {
    id: "triple888",
    name: "888",
    desc: "הרצף 888 מופיע בלוחית",
    pts: 7,
    check: (d) => d.includes("888"),
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
  },
  {
    id: "binary",
    name: "בינארי",
    desc: "הלוחית מורכבת מהספרות 0 ו-1 בלבד",
    pts: 25,
    check: (d) => isAllIn(d, "01") && new Set(d).size > 1,
  },
  {
    id: "quad7",
    name: "רביעיית שביעיות",
    desc: "הספרה 7 מופיעה לפחות ארבע פעמים",
    pts: 12,
    check: (d) => (d.match(/7/g) || []).length >= 4,
  },

  // ── Runs & Patterns ────────────────────────────────────────────────────────
  {
    id: "quadrun",
    name: "רביעיה ברצף",
    desc: "ארבע ספרות זהות ברצף",
    pts: 18,
    check: (d) => /(.)\1\1\1/.test(d),
  },
  {
    id: "quintrun",
    name: "חמישיה ברצף",
    desc: "חמש ספרות זהות ברצף",
    pts: 32,
    check: (d) => /(.)\1\1\1\1/.test(d),
  },
  {
    id: "twotriplerun",
    name: "שתי שלשות",
    desc: "שתי קבוצות נפרדות של שלוש ספרות זהות ברצף",
    pts: 20,
    check: (d) => countRuns(d, 3).length >= 2,
  },
  {
    id: "abab",
    name: "תבנית מתחלפת",
    desc: "שתי ספרות מתחלפות לסירוגין (א-ב-א-ב)",
    pts: 20,
    check: (d) => isABAB(d),
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
    id: "seq123",
    name: "123",
    desc: "הרצף 123 מופיע בלוחית",
    pts: 5,
    check: (d) => d.includes("123"),
  },
  {
    id: "seq321",
    name: "321",
    desc: "הרצף 321 מופיע בלוחית",
    pts: 5,
    check: (d) => d.includes("321"),
  },
  {
    id: "innerzero",
    name: "אפסים מוכלים",
    desc: "לפחות שני אפסים בתוך הלוחית (לא בקצוות)",
    pts: 6,
    check: (d) => (d.slice(1, -1).match(/0/g) || []).length >= 2,
  },
  {
    id: "quaddigit",
    name: "רביעייה",
    desc: "אותה ספרה מופיעה לפחות ארבע פעמים",
    pts: 10,
    check: (d) => maxDigitCount(d) >= 4,
  },
  {
    id: "quintdigit",
    name: "חמישייה",
    desc: "אותה ספרה מופיעה לפחות חמש פעמים",
    pts: 18,
    check: (d) => maxDigitCount(d) >= 5,
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

  // ── Contains ───────────────────────────────────────────────────────────────
  {
    id: "contains42",
    name: "42",
    desc: "הרצף 42 מופיע בלוחית",
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

  // ── Position ───────────────────────────────────────────────────────────────
  {
    id: "sameedges",
    name: "קצוות זהים",
    desc: "הספרה הראשונה והאחרונה זהות",
    pts: 5,
    check: (d) => d[0] === d[d.length - 1],
  },
  {
    id: "nearedges",
    name: "קצוות סמוכים",
    desc: "ההפרש בין הספרה הראשונה והאחרונה הוא 1",
    pts: 3,
    check: (d) => Math.abs(Number(d[0]) - Number(d[d.length - 1])) === 1,
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

  // ── Special / themed ─────────────────────────────────────────────────────────
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

function scorePlate(digits) {
  const matched = PLATE_PERKS.filter((p) => p.check(digits));
  const pts = matched.reduce((s, p) => s + p.pts, 0);
  return { pts, perks: matched };
}

// ─────────────────────────────────────────────────────────────────────────────

function tierFor(score) {
  if (score >= 90) return "S";
  if (score >= 60) return "A";
  if (score >= 30) return "B";
  if (score >= 15) return "C";
  return "D";
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

module.exports = { buildRollPayload, scoreRecord, tierFor, formatPlate, getPerkDescriptions };
