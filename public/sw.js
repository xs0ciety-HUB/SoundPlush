// v5: cache app shell + library CDN + cover art supaya UI tetap kebuka offline
const CACHE = "xs0ciety-v5";
const LOCAL = ["/", "/index.html", "/soundpulse-api-client.js", "/audio.js", "/manifest.json", "/icon-192.png", "/icon-512.png"];
const CDN = [
  "https://cdn.tailwindcss.com",
  "https://unpkg.com/lucide@latest",
  "https://cdn.jsdelivr.net/npm/hls.js@1",
];
const CDN_HOSTS = ["cdn.tailwindcss.com", "unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(LOCAL.map(u => c.add(u).catch(() => {})));
    await Promise.all(CDN.map(u => c.add(new Request(u, { mode: "no-cors" })).catch(() => {})));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

const putCopy = (req, res) => { if (res && (res.ok || res.type === "opaque")) caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {}); return res; };

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);

  // library CDN + cover art: cache dulu, update di belakang layar
  if (url.origin !== location.origin) {
    const isCdn = CDN_HOSTS.includes(url.hostname);
    const isArt = req.destination === "image" && /sndcdn\.com$/.test(url.hostname);
    if (!isCdn && !isArt) return;
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(r => putCopy(req, r)).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  if (url.pathname.startsWith("/api/")) return;

  // file sendiri: network-first, fallback cache
  e.respondWith(
    fetch(req).then(r => putCopy(req, r))
      .catch(() => caches.match(req).then(hit => hit || caches.match("/index.html")))
  );
});
