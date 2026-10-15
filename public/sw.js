// v11: Tambah pengecualian robots.txt & sitemap.xml dari cache
// Fix cache runtime: res.clone() dipanggil sinkron sebelum response dipakai browser
// -> library CDN (Tailwind/lucide/hls) bisa tersimpan -> offline aman
const CACHE = "soundpulse-v11";
const LOCAL = [
  "/",
  "/index.html",
  "/soundpulse-api-client.js",
  "/audio.js",
  "/manifest.json",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/apple-touch-icon.png",
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/avatar.jpg",
];
const CDN = [
  "https://cdn.tailwindcss.com",
  "https://unpkg.com/lucide@latest",
  "https://cdn.jsdelivr.net/npm/hls.js@1",
];
const CDN_HOSTS = [
  "cdn.tailwindcss.com",
  "unpkg.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

// File yang TIDAK boleh di-cache (biar Google selalu baca versi fresh)
const NO_CACHE = ["/robots.txt", "/sitemap.xml"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(LOCAL.map(u => c.add(u).catch(() => {})));
    // cache.add menolak response opaque, jadi ambil manual lalu put
    await Promise.all(CDN.map(u => fetch(u, { mode: "no-cors" }).then(r => c.put(u, r)).catch(() => {})));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

function putCopy(req, res) {
  if (res && (res.ok || res.type === "opaque")) {
    const copy = res.clone(); // WAJIB sinkron, sebelum res dikembalikan
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);

  // Jangan pernah cache robots.txt & sitemap.xml — biar crawler Google selalu fresh
  if (NO_CACHE.includes(url.pathname)) {
    e.respondWith(fetch(req).catch(() => new Response("", { status: 503 })));
    return;
  }

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

  // API selalu network-only
  if (url.pathname.startsWith("/api/")) return;

  // file sendiri: network-first, fallback cache
  // halaman utama jadi fallback untuk navigasi
  e.respondWith(
    fetch(req).then(r => putCopy(req, r)).catch(async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") return (await caches.match("/index.html")) || (await caches.match("/"));
      return Response.error();
    })
  );
});
