/* global URL, caches, self */

const CACHE_PREFIX = "soko-market-app-";
const CACHE_NAME = `${CACHE_PREFIX}v6`;
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/soko-icon.svg",
  "/icons/soko-icon-32.png",
  "/icons/soko-icon-192.png",
  "/icons/soko-icon-512.png",
  "/icons/soko-icon-maskable-512.png",
  "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  const shouldCache = url.pathname.startsWith("/assets/") || APP_SHELL.includes(url.pathname);

  if (!shouldCache) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse !== undefined) {
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        if (!response.ok) {
          return response;
        }

        const responseClone = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone)));
        return response;
      });
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "message.notification") return;
  event.waitUntil(
    self.registration.showNotification(event.data.title || "New Soko message", {
      body: event.data.body || "Open Soko to read your message.",
      icon: "/icons/soko-icon-192.png",
      badge: "/icons/soko-icon-192.png",
      tag: event.data.tag,
      data: { conversationId: event.data.conversationId, url: "/" }
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = {};
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "New Soko message", {
      body: "Open Soko to read your message.",
      icon: "/icons/soko-icon-192.png",
      badge: "/icons/soko-icon-192.png",
      tag: payload.messageId ? `soko-message-${payload.messageId}` : "soko-message",
      data: { conversationId: payload.conversationId, url: "/" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients[0];
      if (existing) {
        existing.postMessage({
          type: "message.notification.open",
          conversationId: event.notification.data?.conversationId
        });
        return existing.focus();
      }
      const conversationId = event.notification.data?.conversationId;
      const url = conversationId
        ? `/?conversation=${encodeURIComponent(conversationId)}`
        : event.notification.data?.url || "/";
      return self.clients.openWindow(url);
    })
  );
});
