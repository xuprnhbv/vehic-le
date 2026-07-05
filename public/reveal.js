// Shared scoring-reveal helpers used by both the roll page (app.js) and the
// rate page (rate.js), so the count-up animation and result rendering can't drift.
// Each function takes its container elements as arguments instead of closing over
// page-specific globals.

window.Reveal = (function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Local tier thresholds — used ONLY to animate the badge as the running total
  // climbs during the count-up. The server still sends the authoritative final tier.
  function tierFor(score) {
    if (score >= 58) return "S";
    if (score >= 40) return "A";
    if (score >= 32) return "B";
    if (score >= 25) return "C";
    if (score >= 17) return "D";
    return "F";
  }

  function pulseClassFor(points) {
    if (points >= 20) return "pulse-high";
    if (points >= 10) return "pulse-mid";
    if (points >= 3) return "pulse-low";
    return "pulse-min";
  }

  // Fanciness tier for the streak flourish — the longer the streak, the showier.
  function streakTier(streak) {
    if (streak >= 100) return 5;
    if (streak >= 30) return 4;
    if (streak >= 7) return 3;
    if (streak >= 2) return 2;
    return 1;
  }

  // One flame per ~tier so the icon row visibly grows with the streak.
  function streakFlames(tier) {
    return "🔥".repeat(tier);
  }

  // Build (and optionally animate) the streak banner shown under the rating. The
  // bonus counts toward the overall/total score — never the plate score or tier.
  // Returns the node, or null when there's no streak to show.
  async function renderStreak(payload, resultEl, animate) {
    const streak = payload?.streak;
    if (!streak) return null;
    const bonus = payload.streakBonus ?? 0;
    const tier = streakTier(streak);

    // Remove any prior banner (e.g. re-render on reload).
    resultEl.querySelector(".streak")?.remove();

    const el = document.createElement("div");
    el.className = `streak streak-tier-${tier}`;
    el.innerHTML = `
      <span class="streak-flames">${streakFlames(tier)}</span>
      <span class="streak-body">
        <span class="streak-count">רצף של ${streak} ${streak === 1 ? "יום" : "ימים"}!</span>
        <span class="streak-bonus">+0</span>
        <span class="streak-note">לניקוד הכולל</span>
      </span>`;
    // Place right after the rating block.
    const rating = resultEl.querySelector("#rating");
    if (rating && rating.nextSibling) resultEl.insertBefore(el, rating.nextSibling);
    else resultEl.appendChild(el);

    const bonusEl = el.querySelector(".streak-bonus");
    if (animate) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      el.classList.add("streak-in");
      await countUp(bonusEl, 0, bonus, 600, (v) => `+${v}`);
      el.classList.add("streak-pop");
      setTimeout(() => el.classList.remove("streak-pop"), 700);
    } else {
      el.classList.add("streak-in");
      bonusEl.textContent = `+${bonus}`;
    }
    return el;
  }

  // Colored circle for a per-field score, matching the on-screen pulse colors
  // (min→grey, low→blue, mid→purple, high→gold) so a shared score carries the
  // same at-a-glance rarity cues as the page.
  function pointEmoji(points) {
    if (points >= 20) return "🟡";
    if (points >= 10) return "🟣";
    if (points >= 3) return "🔵";
    return "⚪";
  }

  // One colored line per scored detail (יצרן, דגם, שנת ייצור…) for share text.
  // The circle's color signals how rare/valuable that detail is — no need to
  // spell out the points.
  function shareDetailLines(payload) {
    return payload.fields
      .map((f) => `${pointEmoji(f.points ?? 0)} ${f.label}: ${f.value}`)
      .join("\n");
  }

  // The top 3 plate-number perks (by points) as Hebrew lines for share text. Perk
  // names are already Hebrew, so they slot straight into the rest of the message.
  // Returns "" when the plate earned no perks.
  function sharePerkLines(payload) {
    return (payload.platePerks ?? [])
      .slice()
      .sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0))
      .slice(0, 3)
      .map((p) => `🏅 ${p.name}`)
      .join("\n");
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
        <div class="rating-tier tier-pill"></div>
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
    badge.className = "rating-badge tier-f";
    badge.textContent = "0";
    const tierPill = rating.querySelector(".rating-tier");
    tierPill.className = "rating-tier tier-pill tier-f";
    tierPill.textContent = "F";

    resultEl.classList.remove("hidden");
    // Force a paint so the initial .field-hidden state commits before we trigger the transition.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    let runningScore = 0;
    let currentTier = "F";

    function applyTierIfChanged(newScore) {
      const newTier = tierFor(newScore);
      if (newTier !== currentTier) {
        currentTier = newTier;
        badge.className = `rating-badge tier-${newTier.toLowerCase()} badge-tier-up`;
        setTimeout(() => badge.classList.remove("badge-tier-up"), 550);
        tierPill.className = `rating-tier tier-pill tier-${newTier.toLowerCase()} tier-pop`;
        tierPill.textContent = newTier;
        setTimeout(() => tierPill.classList.remove("tier-pop"), 550);
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

    // Streak flourish plays after the plate score is fully revealed.
    await sleep(350);
    await renderStreak(payload, resultEl, true);
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
    const tierPill = rating.querySelector(".rating-tier");
    tierPill.className = `rating-tier tier-pill tier-${payload.tier.toLowerCase()}`;
    tierPill.textContent = payload.tier;

    renderStreak(payload, resultEl, false);

    resultEl.classList.remove("hidden");
  }

  return { tierFor, pulseClassFor, pointEmoji, shareDetailLines, sharePerkLines, countUp, ensureRatingNode, revealScoring, showResultInstant, renderStreak, streakTier };
})();
