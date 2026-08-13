/* global URL, Response, caches, self */

const CACHE_PREFIX = "soko-market-app-";
const CACHE_NAME = `${CACHE_PREFIX}v12`;
const STATIC_CACHE = `${CACHE_PREFIX}static-v12`;
const PUBLIC_READ_CACHE = `${CACHE_PREFIX}public-read-v12`;
const ACTIVE_CACHES = new Set([CACHE_NAME, STATIC_CACHE, PUBLIC_READ_CACHE]);
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
    Promise.all([
      caches
        .keys()
        .then((cacheNames) =>
          Promise.all(
            cacheNames
              .filter(
                (cacheName) =>
                  cacheName.startsWith(CACHE_PREFIX) &&
                  cacheName !== CACHE_NAME &&
                  !ACTIVE_CACHES.has(cacheName)
              )
              .map((cacheName) => caches.delete(cacheName))
          )
        ),
      self.registration.navigationPreload?.enable()
    ]).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (isInteractiveModelRequest(request, url)) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            JSON.stringify({
              code: "interactive_model_offline",
              message: "Connect to the internet to activate this model.",
              recoverable: true
            }),
            {
              status: 503,
              headers: { "content-type": "application/json", "cache-control": "no-store" }
            }
          )
      )
    );
    return;
  }

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(event));
    return;
  }

  if (isNetworkOnlyRequest(request, url)) {
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (APP_SHELL.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  if (isPublicCatalogueRead(url)) {
    event.respondWith(staleWhileRevalidate(event, request, PUBLIC_READ_CACHE));
  }
});

async function navigationResponse(event) {
  const shellCache = await caches.open(CACHE_NAME);
  const cachedShell = shellCache.match("/");

  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(event.request));
    if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
      event.waitUntil(shellCache.put("/", response.clone()));
    }
    return response;
  } catch {
    const offlineShell = await cachedShell;
    if (offlineShell !== undefined) return offlineShell;
    return new Response("Soko.market is not available offline yet. Open it once while connected.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached !== undefined) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response.ok && response.type !== "opaque") {
      event.waitUntil(cache.put(request, response.clone()));
    }
    return response;
  });
  if (cached !== undefined) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  return network;
}

function isNetworkOnlyRequest(request, url) {
  return (
    request.headers.has("authorization") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname === "/session" ||
    url.pathname.startsWith("/session/") ||
    url.pathname === "/logout" ||
    url.pathname === "/logout-all" ||
    url.pathname === "/sessions" ||
    url.pathname.startsWith("/sessions/") ||
    url.pathname.startsWith("/businesses/") ||
    url.pathname.startsWith("/v1/conversations") ||
    url.pathname.startsWith("/v1/messages") ||
    url.pathname.startsWith("/v1/models/")
  );
}

function isPublicCatalogueRead(url) {
  return (
    url.pathname.startsWith("/public/storefronts/") || url.pathname.startsWith("/public/catalogue/")
  );
}

function isInteractiveModelRequest(request, url) {
  if (request.method === "GET") return false;
  return (
    /\/businesses\/[^/]+\/(?:agent-model|ai-model)$/.test(url.pathname) ||
    /\/businesses\/[^/]+\/runtime\/sessions(?:\/|$)/.test(url.pathname) ||
    /\/v1\/models\/(?:installed|[^/]+\/validate)$/.test(url.pathname)
  );
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "message.notification") return;
  event.waitUntil(
    self.registration.showNotification(event.data.title || "New Soko message", {
      body: event.data.body || "Open Soko to read your message.",
      icon: "/icons/soko-icon-192.png",
      badge: "/icons/soko-icon-192.png",
      tag: event.data.tag,
      data: {
        conversationId: event.data.conversationId,
        url: event.data.conversationId
          ? `/marketplace/conversations/${encodeURIComponent(event.data.conversationId)}`
          : "/marketplace"
      }
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
      data: {
        conversationId: payload.conversationId,
        url: payload.conversationId
          ? `/marketplace/conversations/${encodeURIComponent(payload.conversationId)}`
          : "/marketplace"
      }
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
        ? `/marketplace/conversations/${encodeURIComponent(conversationId)}`
        : event.notification.data?.url || "/marketplace";
      return self.clients.openWindow(url);
    })
  );
});
