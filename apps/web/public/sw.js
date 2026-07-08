/* global URL, caches, self */

const CACHE_NAME = "soko-market-app-v1";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/soko-icon.svg"];

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
            .filter((cacheName) => cacheName !== CACHE_NAME)
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
