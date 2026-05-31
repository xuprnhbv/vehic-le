// Client auth: renders the header auth area, drives the login/register modal,
// and surfaces verification / OAuth notices. No scoring or roll logic lives here.

(function () {
  const authChannel = new BroadcastChannel("vehic-le-auth");
  const authArea = document.getElementById("authArea");
  const historyLink = document.getElementById("historyLink");
  const notice = document.getElementById("authNotice");
  const modal = document.getElementById("authModal");
  const modalClose = document.getElementById("modalClose");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const loginMsg = document.getElementById("loginMsg");
  const registerMsg = document.getElementById("registerMsg");
  const googleWrap = document.getElementById("googleWrap");
  const tabs = document.querySelectorAll(".tab");

  function showNotice(text, kind) {
    notice.textContent = text;
    notice.className = `auth-notice ${kind || ""}`;
  }

  // Surface ?verified / ?auth flags from server redirects, then clean the URL.
  function handleRedirectFlags() {
    const params = new URLSearchParams(location.search);
    if (params.get("verified") === "1") {
      showNotice("המייל אומת בהצלחה! אפשר להתחבר עכשיו.", "ok");
    } else if (params.get("verified") === "invalid") {
      showNotice("קישור האימות לא תקין או שפג תוקפו.", "err");
    } else if (params.get("auth") === "google_failed") {
      showNotice("ההתחברות עם Google נכשלה.", "err");
    }
    if (params.has("verified") || params.has("auth")) {
      history.replaceState({}, "", location.pathname);
    }
  }

  function renderLoggedOut() {
    authArea.innerHTML = `<button type="button" class="login-trigger">התחבר / הרשם</button>`;
    authArea.querySelector(".login-trigger").addEventListener("click", openModal);
    historyLink.classList.add("hidden");
  }

  function renderLoggedIn(user) {
    authArea.innerHTML = `
      <span class="user-name">שלום, ${user.username}</span>
      <button type="button" class="logout-btn">התנתק</button>`;
    authArea.querySelector(".logout-btn").addEventListener("click", logout);
    historyLink.classList.remove("hidden");
    const adminLink = document.getElementById("adminLink");
    if (adminLink) adminLink.classList.toggle("hidden", !user.isAdmin);
    window.dispatchEvent(new CustomEvent("auth:loggedIn"));
  }

  function openModal() {
    modal.classList.remove("hidden");
  }
  function closeModal() {
    modal.classList.add("hidden");
    loginMsg.textContent = "";
    registerMsg.textContent = "";
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      const isLogin = tab.dataset.tab === "login";
      loginForm.classList.toggle("hidden", !isLogin);
      registerForm.classList.toggle("hidden", isLogin);
    });
  });

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginMsg.className = "form-msg";
    loginMsg.textContent = "מתחבר…";
    const body = {
      identifier: loginForm.identifier.value,
      password: loginForm.password.value,
    };
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        loginMsg.className = "form-msg err";
        loginMsg.textContent = data.error || "ההתחברות נכשלה";
        return;
      }
      closeModal();
      renderLoggedIn(data.user);
      authChannel.postMessage({ type: "login", user: data.user });
    } catch {
      loginMsg.className = "form-msg err";
      loginMsg.textContent = "תקלת רשת, נסה שוב";
    }
  });

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    registerMsg.className = "form-msg";
    registerMsg.textContent = "נרשם…";
    const body = {
      username: registerForm.username.value,
      email: registerForm.email.value,
      password: registerForm.password.value,
    };
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      registerMsg.className = res.ok ? "form-msg ok" : "form-msg err";
      registerMsg.textContent = data.message || data.error || "";
      if (res.ok) registerForm.reset();
    } catch {
      registerMsg.className = "form-msg err";
      registerMsg.textContent = "תקלת רשת, נסה שוב";
    }
  });

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    authChannel.postMessage({ type: "logout" });
    renderLoggedOut();
    window.dispatchEvent(new CustomEvent("auth:loggedOut"));
  }

  // Boot: figure out who we are and whether Google is available.
  async function init() {
    handleRedirectFlags();
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      googleWrap.classList.toggle("hidden", !data.googleEnabled);
      if (data.user) renderLoggedIn(data.user);
      else renderLoggedOut();
    } catch {
      renderLoggedOut();
    }
  }

  authChannel.onmessage = ({ data }) => {
    if (data.type === "login") renderLoggedIn(data.user);
    else if (data.type === "logout") renderLoggedOut();
  };

  init();
})();
