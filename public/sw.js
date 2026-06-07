// Service worker for daily roll reminders. It does two things: show the push
// notification the server sends, and focus/open the app when one is clicked.
// No app logic lives here — the payload is built server-side.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Vehic-le";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    dir: "rtl",
    lang: "he",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // Focus an already-open app window if there is one, else open a new one.
      for (const win of wins) {
        if ("focus" in win) {
          win.navigate?.(url);
          return win.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
