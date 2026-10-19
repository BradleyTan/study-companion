// StudyNest service worker: only for the study timer's optional "time's up" notification
// (timer.md "Notifications"; Android shows notifications only through a service worker).
// It caches nothing and handles no requests, so it can never serve a stale page.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Clicking the notification focuses an open StudyNest tab and opens the timer panel there,
// or opens the timer page.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) {
      await tab.focus();
      tab.postMessage({ type: "studynest:open-timer" });
      return;
    }
    await self.clients.openWindow("/timer");
  })());
});
