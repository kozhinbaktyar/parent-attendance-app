/* Service worker — app shell caching + notification click handling.
   Firebase Realtime Database traffic is never cached (always live). */
const VERSION = "v2.0.0";
const SHELL_CACHE = "attendance-shell-" + VERSION;
const SDK_CACHE = "attendance-sdk-v1";               // Firebase SDK scripts (versioned URLs, safe to keep)

const SHELL_FILES = [
  "./", "./index.html", "./manifest.json",
  "./css/style.css", "./js/app.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== SDK_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Firebase SDK from gstatic: cache-first (URL contains the exact version) → app opens offline
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    event.respondWith(
      caches.open(SDK_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());   // <script> loads are no-cors → opaque
        return res;
      })
    );
    return;
  }

  // Everything else that is not same-origin (database, auth, ...) → straight to network
  if (url.origin !== self.location.origin) return;

  // Same-origin app files: network-first (always the newest), cache fallback when offline
  event.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "#/alerts", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ("focus" in c) { c.navigate && c.navigate(target).catch(() => {}); return c.focus(); }
      }
      return self.clients.openWindow(target);
    })
  );
});
