// Opt-in daily roll reminders (Web Push). Shows a bell toggle in the topbar for
// logged-in users; enabling it registers a push subscription with the server,
// which sends a "you haven't rolled today" notification each morning. No scoring
// or roll logic here — this only manages the subscription.

(function () {
  const supported =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  let vapidKey = null;
  let registration = null;
  let loggedIn = false;
  let btn = null;
  let busy = false;

  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  // VAPID public key (base64url) → Uint8Array for PushManager.subscribe.
  function urlBase64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function ensureButton() {
    if (btn) return btn;
    const topbar = document.querySelector(".topbar");
    const authArea = document.getElementById("authArea");
    if (!topbar || !authArea) return null;
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "push-bell hidden";
    btn.addEventListener("click", onToggle);
    topbar.insertBefore(btn, authArea);
    return btn;
  }

  function setBtn(on, label) {
    if (!btn) return;
    btn.textContent = on ? "🔔" : "🔕";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.classList.toggle("active", on);
  }

  async function currentSubscription() {
    if (!registration) return null;
    return registration.pushManager.getSubscription();
  }

  async function refresh() {
    if (!btn) return;
    if (!loggedIn) {
      btn.classList.add("hidden");
      return;
    }
    btn.classList.remove("hidden");
    const sub = await currentSubscription();
    if (sub) setBtn(true, "התראות יומיות פעילות — לחץ לביטול");
    else setBtn(false, "קבל תזכורת יומית לגלגל");
  }

  async function enable() {
    // iOS only delivers web push to an installed (home-screen) PWA.
    if (isIOS() && !isStandalone()) {
      alert("כדי לקבל התראות ב‑iPhone: שתף › הוסף למסך הבית, ואז הפעל מתוך האפליקציה.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      alert("ההתראות חסומות בדפדפן. אפשר אותן בהגדרות האתר כדי לקבל תזכורות.");
      return;
    }
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub),
    });
    if (!res.ok) {
      await sub.unsubscribe().catch(() => {});
      throw new Error("subscribe failed");
    }
  }

  async function disable() {
    const sub = await currentSubscription();
    if (!sub) return;
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }

  async function onToggle() {
    if (busy) return;
    busy = true;
    try {
      const sub = await currentSubscription();
      if (sub) await disable();
      else await enable();
    } catch (err) {
      console.error("[push] toggle failed", err);
      alert("לא ניתן לעדכן את ההתראות כרגע, נסה שוב.");
    } finally {
      busy = false;
      refresh();
    }
  }

  async function init() {
    if (!supported) return;
    let cfg;
    try {
      cfg = await (await fetch("/api/push/config")).json();
    } catch {
      return;
    }
    if (!cfg.enabled || !cfg.vapidPublicKey) return;
    vapidKey = cfg.vapidPublicKey;
    try {
      registration = await navigator.serviceWorker.register("/sw.js");
    } catch (err) {
      console.error("[push] service worker registration failed", err);
      return;
    }
    ensureButton();
    // auth.js / nav.js emit these on live login/logout transitions.
    window.addEventListener("auth:loggedIn", () => {
      loggedIn = true;
      refresh();
    });
    window.addEventListener("auth:loggedOut", () => {
      loggedIn = false;
      refresh();
    });
    // Don't depend solely on the events above: this init is async (service
    // worker registration can be slow on navigation), so the page's initial
    // auth:loggedIn may fire before we subscribe and get missed. Determine the
    // current session state ourselves so the bell shows on every page load.
    try {
      const { user } = await (await fetch("/api/auth/me")).json();
      loggedIn = Boolean(user);
    } catch {
      /* leave loggedIn as-is; events can still correct it later */
    }
    refresh();
  }

  init();
})();
