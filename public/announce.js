// Site announcement popup. Asks the server for the currently-active announcement
// (admins manage these in the dashboard), renders its markdown body, and shows it at
// most once per browser — keyed by announcement id, so a new announcement shows again
// but a dismissed one never re-appears. The active window (start/end) is enforced
// server-side via /api/announce.
(function () {
  const STORAGE_KEY = "announce-seen-ids";

  function seenIds() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
    catch { return []; }
  }
  function markSeen(id) {
    try {
      const ids = seenIds();
      if (!ids.includes(id)) {
        ids.push(id);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
      }
    } catch { /* storage unavailable — ignore */ }
  }

  async function maybeShow() {
    let announcement;
    try {
      const res = await fetch("/api/announce");
      if (!res.ok) return;
      announcement = (await res.json()).announcement;
    } catch { return; /* network issue — don't show */ }
    if (!announcement) return;
    if (seenIds().includes(announcement.id)) return;

    const overlay = document.getElementById("announceModal");
    const body = document.getElementById("announceBody");
    if (!overlay || !body || !window.AnnounceMD) return;

    body.innerHTML = window.AnnounceMD.render(announcement.body);

    // Mark seen the moment it appears, so it never re-shows for this browser.
    markSeen(announcement.id);
    overlay.classList.remove("hidden");

    const dismiss = () => overlay.classList.add("hidden");
    document.getElementById("announceClose")?.addEventListener("click", dismiss);
    document.getElementById("announceOk")?.addEventListener("click", dismiss);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) dismiss(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeShow);
  } else {
    maybeShow();
  }
})();
