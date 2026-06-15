// One-time announcement popup. Shows at most once per browser, and only while the
// server reports the post-deploy window is still open (24h from deploy — see
// /api/announce in server/rolls.js). The window is server-driven so it tracks the
// actual deploy time rather than a date baked into this file. Bump STORAGE_KEY to
// re-show a future announcement to everyone.
(function () {
  const STORAGE_KEY = "announce-seen-2026-06-15";

  // Already seen on this browser? Skip the network check entirely.
  try {
    if (localStorage.getItem(STORAGE_KEY)) return;
  } catch { /* storage unavailable — fall through and show once */ }

  async function maybeShow() {
    let active = false;
    try {
      const res = await fetch("/api/announce");
      if (!res.ok) return;
      active = (await res.json()).active;
    } catch { return; /* network issue — don't show */ }
    if (!active) return;

    const overlay = document.getElementById("announceModal");
    if (!overlay) return;

    // Mark as seen the moment it appears, so it never reappears for this browser.
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
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
