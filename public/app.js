// Client is animation-only. The server rolls the plate, fetches the record, and
// scores it; we just fetch the finished payload from /api/roll and play it back.

const GAME_URL = window.location.origin + '/';
const TIER_EMOJI = { S: '🌟', A: '🟣', B: '🔵', C: '🟢', D: '⚪' };

const plateEl = document.getElementById("plate");
const rollBtn = document.getElementById("rollBtn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const resultFields = document.getElementById("resultFields");
const shareBtn = document.getElementById("shareBtn");

let currentRoll = null;

function showShareButton(payload, rank) {
  currentRoll = { ...payload, rank: rank ?? null };
  shareBtn.classList.remove("hidden");
}

shareBtn.addEventListener("click", async () => {
  if (!currentRoll) return;
  const { tier, score, plate, rank } = currentRoll;
  const rankStr = rank != null ? `(#${rank} today)` : '(unranked)';
  const text = `Vehic-le 🚕 ${plate.display} 🚕\n\n${TIER_EMOJI[tier] ?? '⭐'} Tier ${tier} - ${score} points ${rankStr}\n\n${GAME_URL}`;
  if (navigator.share) {
    try { await navigator.share({ text }); } catch { /* user dismissed */ }
  } else {
    await navigator.clipboard.writeText(text);
    const orig = shareBtn.textContent;
    shareBtn.textContent = "הועתק!";
    setTimeout(() => { shareBtn.textContent = orig; }, 1500);
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function roll() {
  const res = await fetch("/api/roll");
  if (res.status === 429) throw Object.assign(new Error("daily_limit"), { dailyLimit: true });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // { plate, fields, platePerks, score, tier }
}

function makeSlotWindow() {
  const win = document.createElement("span");
  win.className = "slot-window";
  const reel = document.createElement("span");
  reel.className = "slot-reel slot-spinning";
  for (let cycle = 0; cycle < 2; cycle++) {
    for (let d = 0; d <= 9; d++) {
      const item = document.createElement("span");
      item.className = "slot-reel-digit";
      item.textContent = d;
      reel.appendChild(item);
    }
  }
  win.appendChild(reel);
  return { win, reel };
}

function lockSlot(reel, finalChar) {
  reel.classList.remove("slot-spinning");
  void reel.offsetHeight;
  // Slower, weightier settle so each digit lands with a dramatic ease-out.
  reel.style.transition = "transform 0.85s cubic-bezier(0.12, 0.8, 0.18, 1)";
  reel.style.transform = `translateY(-${10 + parseInt(finalChar)}em)`;
  const win = reel.parentElement;
  win.classList.add("slot-locked");
  setTimeout(() => win?.classList.remove("slot-locked"), 1100);
}

function buildSlotPlate(format) {
  plateEl.innerHTML = "";
  const slots = [];
  for (const c of format) {
    if (c === "-") {
      const sep = document.createElement("span");
      sep.className = "plate-sep";
      sep.textContent = "-";
      plateEl.appendChild(sep);
    } else {
      const { win, reel } = makeSlotWindow();
      plateEl.appendChild(win);
      slots.push({ reel, final: c });
    }
  }
  return slots;
}

async function revealPlate(plate) {
  const slots = buildSlotPlate(plate.display);
  await sleep(900);
  for (let i = 0; i < slots.length; i++) {
    // Longer beat between digits so each one gets its own dramatic moment.
    if (i > 0) await sleep(1500);
    lockSlot(slots[i].reel, slots[i].final);
  }
  // Whole-plate "lock in": blink + glossy shine sweep before any score shows.
  await sleep(450);
  plateEl.classList.add("plate-lockedin");
  await sleep(1200);
  plateEl.classList.remove("plate-lockedin");
}

// Thin wrappers over the shared scoring-reveal helpers (see reveal.js), bound to
// this page's result containers.
const revealScoring = (payload) => Reveal.revealScoring(payload, { resultEl, resultFields });
const showResultInstant = (payload) =>
  Reveal.showResultInstant(payload, { plateEl, resultEl, resultFields });

async function loadTodayRoll() {
  try {
    const res = await fetch("/api/me/today");
    if (!res.ok) return;
    const { payload, rank } = await res.json();
    if (!payload) return;
    showResultInstant(payload);
    showShareButton(payload, rank);
    statusEl.textContent = "כבר גלגלת היום! חזור מחר.";
    rollBtn.disabled = true;
  } catch {
    // not critical — silent
  }
}

window.addEventListener("auth:loggedIn", loadTodayRoll);

window.addEventListener("auth:loggedOut", () => {
  plateEl.innerHTML = `<span class="plate-placeholder">–––<span class="plate-placeholder-sep">–</span>––<span class="plate-placeholder-sep">–</span>–––</span>`;
  resultEl.classList.add("hidden");
  resultFields.innerHTML = "";
  const rating = document.getElementById("rating");
  if (rating) rating.remove();
  statusEl.textContent = "";
  rollBtn.disabled = false;
  shareBtn.classList.add("hidden");
  currentRoll = null;
});

rollBtn.addEventListener("click", async () => {
  rollBtn.disabled = true;
  // Show spinning slots immediately (8-digit placeholder: XXX-XX-XXX, more common than 7-digit)
  buildSlotPlate("000-00-000");
  statusEl.textContent = "מגלגל…";
  resultEl.classList.add("hidden");
  let hitDailyLimit = false;

  try {
    const payload = await roll();
    statusEl.textContent = "";
    await revealPlate(payload.plate);
    await sleep(220);
    await revealScoring(payload);
    showShareButton(payload, payload.rank);
  } catch (err) {
    console.error(err);
    plateEl.innerHTML = "";
    if (err.dailyLimit) {
      hitDailyLimit = true;
      statusEl.textContent = "כבר גלגלת היום! חזור מחר.";
      loadTodayRoll();
    } else {
      statusEl.textContent = "תקלה ברשת, נסה שוב";
    }
  } finally {
    if (!hitDailyLimit) rollBtn.disabled = false;
  }
});
