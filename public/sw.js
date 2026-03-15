// Service Worker for AI News PWA
// Primary purpose: receive push notifications and handle notification clicks

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "AI News 每日文档";
  const options = {
    body: data.body || "今日精选 AI 文章已更新",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(targetUrl) && "focus" in client) {
            return client.focus();
          }
        }
        return clients.openWindow(targetUrl);
      }),
  );
});
