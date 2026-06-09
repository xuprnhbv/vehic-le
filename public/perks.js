// Shared perk-chip factory + description popover, used everywhere a plate-perk chip is
// shown (roll page, rate page, leaderboard, history). Chips are tappable: clicking one
// opens a small popover with a short Hebrew description of the perk. Descriptions come
// from /api/perks (keyed by perk name), so old saved rolls — whose payloads only carry
// {name, pts} — get descriptions too.

window.Perks = (function () {
  let descPromise = null;
  let descMap = null;

  // Fetch the name → description map once; concurrent callers share the request.
  function loadDescriptions() {
    if (!descPromise) {
      descPromise = fetch("/api/perks")
        .then((r) => (r.ok ? r.json() : { perks: [] }))
        .then(({ perks }) => {
          descMap = new Map((perks || []).map((p) => [p.name, p.desc]));
          return descMap;
        })
        .catch(() => {
          descMap = new Map();
          return descMap;
        });
    }
    return descPromise;
  }

  // ── Single shared popover ────────────────────────────────────────────────────
  let popover = null;
  let activeChip = null;

  function ensurePopover() {
    if (!popover) {
      popover = document.createElement("div");
      popover.className = "perk-popover hidden";
      popover.innerHTML = `<span class="perk-popover-name"></span><span class="perk-popover-desc"></span>`;
      document.body.appendChild(popover);
    }
    return popover;
  }

  function hidePopover() {
    if (popover) popover.classList.add("hidden");
    if (activeChip) activeChip.classList.remove("perk-chip-active");
    activeChip = null;
  }

  function positionPopover(chip) {
    const rect = chip.getBoundingClientRect();
    const pop = popover;
    // Show first so we can measure, then clamp within the viewport.
    pop.classList.remove("hidden");
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const margin = 8;
    let top = rect.bottom + 6;
    if (top + ph > window.innerHeight - margin) top = rect.top - ph - 6; // flip above
    let left = rect.left + rect.width / 2 - pw / 2; // center under chip
    left = Math.max(margin, Math.min(left, window.innerWidth - pw - margin));
    pop.style.top = `${Math.max(margin, top)}px`;
    pop.style.left = `${left}px`;
  }

  function showPopover(chip, name, desc) {
    const pop = ensurePopover();
    pop.querySelector(".perk-popover-name").textContent = name;
    pop.querySelector(".perk-popover-desc").textContent = desc;
    if (activeChip && activeChip !== chip) activeChip.classList.remove("perk-chip-active");
    positionPopover(chip);
    activeChip = chip;
    chip.classList.add("perk-chip-active");
  }

  async function toggle(chip, name) {
    if (activeChip === chip) {
      hidePopover();
      return;
    }
    await loadDescriptions();
    const desc = descMap.get(name);
    if (!desc) {
      hidePopover();
      return; // no description known (e.g. cross-year currentyear perk) — stay inert
    }
    showPopover(chip, name, desc);
  }

  // Global dismissers, registered once.
  document.addEventListener("click", (e) => {
    if (activeChip && !activeChip.contains(e.target) && !popover.contains(e.target)) {
      hidePopover();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hidePopover();
  });
  window.addEventListener("scroll", hidePopover, true);
  window.addEventListener("resize", hidePopover);

  // ── Chip factory ─────────────────────────────────────────────────────────────
  function createChip(name, pts, { pop = false } = {}) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "perk-chip" + (pop ? " perk-chip-pop" : "");
    chip.textContent = `${name} +${pts}`;
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle(chip, name);
    });
    return chip;
  }

  return { loadDescriptions, createChip };
})();
