// "Rate my plate": the user types a plate, the server looks it up in the registry
// and scores it with the exact same logic as a roll. We just play the scoring
// count-up (no slot-reel spin — the digits are already known). Nothing is saved.

const RATE_URL = window.location.origin + "/rate.html";
const TIER_EMOJI = { S: "🌟", A: "🟣", B: "🔵", C: "🟢", D: "⚪" };

const form = document.getElementById("rateForm");
const plateInput = document.getElementById("plateInput");
const rateBtn = document.getElementById("rateBtn");
const msgEl = document.getElementById("rateMsg");
const resultEl = document.getElementById("result");
const resultFields = document.getElementById("resultFields");
const shareBtn = document.getElementById("shareBtn");

let currentRoll = null;

function showMsg(text, color) {
  msgEl.textContent = text;
  msgEl.style.color = color || "var(--muted)";
}

shareBtn.addEventListener("click", async () => {
  if (!currentRoll) return;
  const { tier, score, plate } = currentRoll;
  const text =
    `הרכב שלי 🚗 ${plate.display}\n\n` +
    `${TIER_EMOJI[tier] ?? "⭐"} Tier ${tier} - ${score} נקודות\n\n` +
    `דרגו את הרכב שלכם:\n${RATE_URL}`;
  if (navigator.share) {
    try { await navigator.share({ text }); } catch { /* user dismissed */ }
  } else {
    await navigator.clipboard.writeText(text);
    const orig = shareBtn.textContent;
    shareBtn.textContent = "הועתק!";
    setTimeout(() => { shareBtn.textContent = orig; }, 1500);
  }
});

async function rate(digits) {
  const res = await fetch("/api/rate?plate=" + encodeURIComponent(digits));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.userMessage = data.error;
    err.status = res.status;
    throw err;
  }
  return data; // { plate, fields, platePerks, score, tier }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const digits = plateInput.value.replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 8) {
    showMsg("יש להזין מספר רכב תקין (5–8 ספרות)", "#f87171");
    return;
  }

  rateBtn.disabled = true;
  showMsg("בודק…");
  resultEl.classList.add("hidden");
  shareBtn.classList.add("hidden");
  currentRoll = null;

  try {
    const payload = await rate(digits);
    showMsg("");
    await Reveal.revealScoring(payload, { resultEl, resultFields });
    currentRoll = payload;
    shareBtn.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    if (err.status === 404) {
      showMsg(err.userMessage || "הרכב לא נמצא במאגר", "#f87171");
    } else if (err.status === 429) {
      showMsg(err.userMessage || "יותר מדי בקשות, נסו שוב מאוחר יותר", "#f87171");
    } else if (err.status === 400) {
      showMsg(err.userMessage || "מספר רכב לא תקין", "#f87171");
    } else {
      showMsg("תקלה ברשת, נסו שוב", "#f87171");
    }
  } finally {
    rateBtn.disabled = false;
  }
});
