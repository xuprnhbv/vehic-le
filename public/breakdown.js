// Shared roll-breakdown renderer used by the leaderboard and profile pages. Builds the
// field-by-field <dl> (label → value + point badge) plus the plate-perk chip row. Perk
// chips come from the shared Perks factory (perks.js must load first).
(function () {
  function pulseClassFor(points) {
    if (points >= 20) return "pulse-high";
    if (points >= 10) return "pulse-mid";
    if (points >= 3)  return "pulse-low";
    return "pulse-min";
  }

  function buildBreakdownDl(payload) {
    const dl = document.createElement("dl");
    dl.className = "roll-breakdown";
    for (const f of payload.fields) {
      const dt = document.createElement("dt");
      dt.textContent = f.label;
      const dd = document.createElement("dd");
      const valSpan = document.createElement("span");
      valSpan.className = "field-value";
      valSpan.textContent = f.value;
      dd.appendChild(valSpan);
      if (f.points) {
        const pts = document.createElement("span");
        pts.className = `field-points ${pulseClassFor(f.points)}`;
        pts.textContent = `+${f.points}`;
        dd.appendChild(pts);
      }
      dl.append(dt, dd);
    }
    if (payload.platePerks && payload.platePerks.length > 0) {
      const dt = document.createElement("dt");
      dt.textContent = "בונוס לוחית";
      const dd = document.createElement("dd");
      const chips = document.createElement("span");
      chips.className = "field-value perk-chips";
      payload.platePerks.forEach((p) => {
        chips.appendChild(Perks.createChip(p.name, p.pts, { pop: true }));
      });
      const totalPts = payload.platePerks.reduce((s, p) => s + p.pts, 0);
      const pts = document.createElement("span");
      pts.className = "field-points pulse-high";
      pts.textContent = `+${totalPts}`;
      dd.append(chips, pts);
      dl.append(dt, dd);
    }
    return dl;
  }

  window.Breakdown = { buildBreakdownDl, pulseClassFor };
})();
