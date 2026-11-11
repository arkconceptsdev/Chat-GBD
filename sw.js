const CACHE_NAME = "chat-gbd-shell-v17";
const scope = new URL(self.registration.scope);
const SHELL_URL = new URL("index.html", scope).href;
const INSTALL_FILES = ["/manifest.json", "/icon-192.png", "/icon-512.png", "/favicon.png", "/apple-touch-icon.png"];

async function refreshShell(cache) {
  const shell = await fetch(SHELL_URL, { cache: "no-cache" });
  if (!shell.ok) throw new Error("App shell unavailable");
  const html = await shell.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="((?:\.|[^"]*?)?\/assets\/[^"]+)"/g)].map((match) => new URL(match[1], scope).href);
  if (!assets.length) throw new Error("App shell has no built assets");
  const missing = await Promise.all(assets.map(async (asset) => (await cache.match(asset)) ? null : asset));
  await cache.addAll(missing.filter(Boolean));
  await cache.put(SHELL_URL, shell.clone());
  return shell;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await refreshShell(cache);
    await cache.addAll(INSTALL_FILES.map((file) => new URL(file.slice(1), scope).href));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name === "vaultmind-v1" || (name.startsWith("chat-gbd-shell-") && name !== CACHE_NAME)) {
        await caches.delete(name);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  const relativePath = "/" + url.pathname.slice(scope.pathname.length);
  if (event.request.mode === "navigate" && (url.pathname === scope.pathname || url.href === SHELL_URL)) {
    const cache = caches.open(CACHE_NAME);
    const refresh = cache.then(refreshShell);
    event.waitUntil(refresh.catch(() => {}));
    event.respondWith(cache.then(async (shellCache) => (await shellCache.match(SHELL_URL)) || refresh));
  } else if (url.href === new URL("manifest.json", scope).href) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request, { cache: "no-cache" });
        if (response.ok) { await cache.put(event.request, response.clone()); return response; }
        return (await cache.match(event.request)) || response;
      } catch (error) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        throw error;
      }
    })());
  } else if (url.pathname.startsWith(scope.pathname) && (relativePath.startsWith("/assets/") || INSTALL_FILES.includes(relativePath))) {
    event.respondWith(caches.match(event.request, { cacheName: CACHE_NAME }).then((cached) => cached || fetch(event.request)));
  }
});
