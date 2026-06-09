// Shared scoring-reveal helpers used by both the roll page (app.js) and the
// rate page (rate.js), so the count-up animation and result rendering can't drift.
// Each function takes its container elements as arguments instead of closing over
// page-specific globals.

window.Reveal = (function () {
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

  function pulseClassFor(points) {
    if (points >= 20) return "pulse-high";
    if (points >= 10) return "pulse-mid";
    if (points >= 3) return "pulse-low";
    return "pulse-min";
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

  function ensureRatingNode(resultEl) {
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

  async function revealScoring(payload, { resultEl, resultFields }) {
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
        chipsWrap.appendChild(Perks.createChip(p.name, p.pts));
      });
      const totalPts = payload.platePerks.reduce((s, p) => s + p.pts, 0);
      dd.append(chipsWrap);
      resultFields.append(dt, dd);
      perkRow = { dt, dd, points: totalPts };
    }

    // Show badge at 0 from the start; accumulate score live
    const rating = ensureRatingNode(resultEl);
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

  // Show a scored result immediately, with no animation.
  function showResultInstant(payload, { plateEl, resultEl, resultFields }) {
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
        chipsWrap.appendChild(Perks.createChip(p.name, p.pts, { pop: true }));
      });
      dd.append(chipsWrap);
      resultFields.append(dt, dd);
    }

    const rating = ensureRatingNode(resultEl);
    const badge = rating.querySelector(".rating-badge");
    badge.className = `rating-badge tier-${payload.tier.toLowerCase()}`;
    badge.textContent = String(payload.score);
    rating.querySelector(".rating-score").textContent = "";

    resultEl.classList.remove("hidden");
  }

  return { tierFor, pulseClassFor, countUp, ensureRatingNode, revealScoring, showResultInstant };
})();
