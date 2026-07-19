async function boot() {
  if (import.meta.env.DEV && "serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));

      if ("caches" in globalThis) {
        const cacheNames = await globalThis.caches.keys();
        await Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith("soko-market-app-"))
            .map((cacheName) => globalThis.caches.delete(cacheName))
        );
      }
    } catch (error) {
      console.warn("Unable to clear the development service worker cache.", error);
    }
  }

  await import("./main");
}

void boot();
