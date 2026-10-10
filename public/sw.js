// v4: network-first supaya update/fix langsung kepakai (versi lama cache-first,
// jadi file lama yang bug tetap disajikan sampai reload ke-2)
const CACHE = "soundpulse-v4";
const ASSETS = ["/", "/index.html", "/soundpulse-api-client.js", "/audio.js", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // API, audio/stream, dan request Range jangan disentuh SW
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || req.headers.has("range")) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(c => c || caches.match("/index.html")))
  );
});
