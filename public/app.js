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

// Local tier thresholds — used ONLY to animate the badge as the running total
// climbs during the count-up. The server still sends the authoritative final tier.
function tierFor(score) {
  if (score >= 90) return "S";
  if (score >= 60) return "A";
  if (score >= 30) return "B";
  if (score >= 15) return "C";
  return "D";
}

async function roll() {
  const res = await fetch("/api/roll");
  if (res.status === 429) throw Object.assign(new Error("daily_limit"), { dailyLimit: true });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json(); // { plate, fields, platePerks, score, tier }
}

function ensureRatingNode() {
  let rating = document.getElementById("rating");
  if (!rating) {
    rating = document.createElement("div");
    rating.id = "rating";
    rating.className = "rating";
    rating.innerHTML = `
      <div class="rating-label">דירוג נדירות</div>
      <div class="rating-badge"></div>
      <div class="rating-score"></div>
    `;
    resultEl.insertBefore(rating, resultEl.firstChild);
  }
  return rating;
}

function countUp(el, from, to, duration, format) {
  return new Promise((resolve) => {
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) * (1 - t); // easeOutQuad
      const v = Math.round(from + (to - from) * eased);
      el.textContent = format(v);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
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

function pulseClassFor(points) {
  if (points >= 20) return "pulse-high";
  if (points >= 10) return "pulse-mid";
  if (points >= 3) return "pulse-low";
  return "pulse-min";
}

async function revealScoring(payload) {
  resultFields.innerHTML = "";
  const rows = [];
  for (const field of payload.fields) {
    const dt = document.createElement("dt");
    dt.textContent = field.label;
    dt.classList.add("field-hidden");

    const dd = document.createElement("dd");
    dd.classList.add("field-hidden");
    const valueSpan = document.createElement("span");
    valueSpan.className = "field-value";
    valueSpan.textContent = field.value;
    const pointsSpan = document.createElement("span");
    pointsSpan.className = "field-points";
    pointsSpan.textContent = "+0";
    dd.append(valueSpan, pointsSpan);

    resultFields.append(dt, dd);
    rows.push({ dt, dd, pointsSpan, points: field.points ?? 0 });
  }

  // Plate perks row (only if any matched)
  let perkRow = null;
  if (payload.platePerks.length > 0) {
    const dt = document.createElement("dt");
    dt.textContent = "בונוס לוחית";
    dt.classList.add("field-hidden");
    const dd = document.createElement("dd");
    dd.classList.add("field-hidden", "perk-dd");
    const chipsWrap = document.createElement("span");
    chipsWrap.className = "field-value perk-chips";
    payload.platePerks.forEach((p) => {
      const chip = document.createElement("span");
      chip.className = "perk-chip";
      chip.textContent = `${p.name} +${p.pts}`;
      chipsWrap.appendChild(chip);
    });
    const totalPts = payload.platePerks.reduce((s, p) => s + p.pts, 0);
    dd.append(chipsWrap);
    resultFields.append(dt, dd);
    perkRow = { dt, dd, points: totalPts };
  }

  // Show badge at 0 from the start; accumulate score live
  const rating = ensureRatingNode();
  const badge = rating.querySelector(".rating-badge");
  badge.className = "rating-badge tier-d";
  badge.textContent = "0";
  rating.querySelector(".rating-score").textContent = "";

  resultEl.classList.remove("hidden");
  // Force a paint so the initial .field-hidden state commits before we trigger the transition.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  let runningScore = 0;
  let currentTier = "D";

  function applyTierIfChanged(newScore) {
    const newTier = tierFor(newScore);
    if (newTier !== currentTier) {
      currentTier = newTier;
      badge.className = `rating-badge tier-${newTier.toLowerCase()} badge-tier-up`;
      setTimeout(() => badge.classList.remove("badge-tier-up"), 550);
    }
  }

  for (const row of rows) {
    row.dt.classList.add("field-revealed");
    row.dd.classList.add("field-revealed");
    await sleep(80);
    const prevScore = runningScore;
    runningScore += row.points;
    await Promise.all([
      countUp(row.pointsSpan, 0, row.points, 280, (v) => `+${v}`),
      countUp(badge, prevScore, runningScore, 280, (v) => `${v}`),
    ]);
    row.pointsSpan.classList.add(pulseClassFor(row.points));
    applyTierIfChanged(runningScore);
    await sleep(110);
  }

  if (perkRow) {
    perkRow.dt.classList.add("field-revealed");
    perkRow.dd.classList.add("field-revealed");
    await sleep(80);
    // Chips pop in one by one
    const chips = perkRow.dd.querySelectorAll(".perk-chip");
    for (const chip of chips) {
      chip.classList.add("perk-chip-pop");
      await sleep(180);
    }
    await sleep(80);
    const prevScore = runningScore;
    runningScore += perkRow.points;
    await countUp(badge, prevScore, runningScore, 400, (v) => `${v}`);
    applyTierIfChanged(runningScore);
    await sleep(150);
  }

  // Grand finale flash at the end
  rating.classList.add("rating-flash");
  setTimeout(() => rating.classList.remove("rating-flash"), 900);
}

// Show the result the server already saved, without any animation.
function showResultInstant(payload) {
  plateEl.textContent = payload.plate.display;

  resultFields.innerHTML = "";
  for (const field of payload.fields) {
    const dt = document.createElement("dt");
    dt.textContent = field.label;
    dt.classList.add("field-revealed");
    const dd = document.createElement("dd");
    dd.classList.add("field-revealed");
    const valueSpan = document.createElement("span");
    valueSpan.className = "field-value";
    valueSpan.textContent = field.value;
    const pointsSpan = document.createElement("span");
    pointsSpan.className = "field-points";
    pointsSpan.textContent = `+${field.points ?? 0}`;
    dd.append(valueSpan, pointsSpan);
    resultFields.append(dt, dd);
  }

  if (payload.platePerks?.length > 0) {
    const dt = document.createElement("dt");
    dt.textContent = "בונוס לוחית";
    dt.classList.add("field-revealed");
    const dd = document.createElement("dd");
    dd.classList.add("field-revealed", "perk-dd");
    const chipsWrap = document.createElement("span");
    chipsWrap.className = "field-value perk-chips";
    payload.platePerks.forEach((p) => {
      const chip = document.createElement("span");
      chip.className = "perk-chip perk-chip-pop";
      chip.textContent = `${p.name} +${p.pts}`;
      chipsWrap.appendChild(chip);
    });
    dd.append(chipsWrap);
    resultFields.append(dt, dd);
  }

  const rating = ensureRatingNode();
  const badge = rating.querySelector(".rating-badge");
  badge.className = `rating-badge tier-${payload.tier.toLowerCase()}`;
  badge.textContent = String(payload.score);
  rating.querySelector(".rating-score").textContent = "";

  resultEl.classList.remove("hidden");
}

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
  plateEl.innerHTML = `<span class="plate-placeholder">— — — — — — —</span>`;
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
  // Show spinning slots immediately (7-digit placeholder: XX-XXX-XX)
  buildSlotPlate("00-000-00");
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
