// Shared nav auth for non-index pages: toggles history/admin links and renders auth area.
(function () {
  const authChannel = new BroadcastChannel("vehic-le-auth");
  const historyLink = document.getElementById("historyLink");
  const adminLink   = document.getElementById("adminLink");
  const authArea    = document.getElementById("authArea");

  function renderLoggedIn(user) {
    if (historyLink) historyLink.classList.remove("hidden");
    if (adminLink)   adminLink.classList.toggle("hidden", !user.isAdmin);
    if (!authArea)   return;
    authArea.innerHTML = `
      <span class="user-name">שלום, ${user.username}</span>
      <button type="button" class="logout-btn" id="navLogout">התנתק</button>`;
    document.getElementById("navLogout").addEventListener("click", () => {
      fetch("/api/auth/logout", { method: "POST" }).then(() => {
        authChannel.postMessage({ type: "logout" });
        location.reload();
      });
    });
  }

  function renderLoggedOut() {
    if (historyLink) historyLink.classList.add("hidden");
    if (adminLink)   adminLink.classList.add("hidden");
    if (authArea)    authArea.innerHTML =
      `<button type="button" class="login-trigger" onclick="location.href='/'">התחבר / הרשם</button>`;
  }

  authChannel.onmessage = ({ data }) => {
    if (data.type === "login") renderLoggedIn(data.user);
    else if (data.type === "logout") renderLoggedOut();
  };

  fetch("/api/auth/me")
    .then(r => r.json())
    .then(({ user }) => user ? renderLoggedIn(user) : renderLoggedOut())
    .catch(renderLoggedOut);
})();
