// api/stream.js - v4
// FIX UTAMA: URL transcoding SoundCloud api-v2 bentuknya
//   https://api-v2.soundcloud.com/media/soundcloud:tracks:123/<uuid>/stream/progressive
// (TIDAK mengandung "/transcodings/"). Versi lama salah deteksi -> nge-redirect browser
// ke endpoint JSON itu, bukan ke file audio -> <audio> error "source not supported".
// Sekarang: semua URL *.soundcloud.com di-resolve server-side dulu, baru redirect ke CDN.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const first = (v) => (Array.isArray(v) ? v[0] : v);

function parseAllowed(u) {
  try {
    const p = new URL(u);
    if (p.protocol !== "https:") return null;
    if (/(^|\.)soundcloud\.com$/.test(p.hostname) || /(^|\.)sndcdn\.com$/.test(p.hostname)) return p;
    return null; // cegah open-redirect / SSRF ke host lain
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, If-Range");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();

  const url = first(req.query.url);
  const client_id = first(req.query.client_id);
  const track_authorization = first(req.query.track_authorization);

  if (!url || !client_id) {
    return res.status(400).json({ error: "Missing url or client_id" });
  }

  const parsed = parseAllowed(url);
  if (!parsed) {
    return res.status(400).json({ error: "URL tidak diizinkan" });
  }

  try {
    let target = url;

    // URL api SoundCloud -> harus di-resolve jadi URL CDN yang asli
    if (/(^|\.)soundcloud\.com$/.test(parsed.hostname)) {
      parsed.searchParams.set("client_id", client_id);
      if (track_authorization) parsed.searchParams.set("track_authorization", track_authorization);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      let r;
      try {
        r = await fetch(parsed.toString(), {
          signal: controller.signal,
          headers: {
            "User-Agent": UA,
            Accept: "application/json",
            Referer: "https://soundcloud.com/",
            Origin: "https://soundcloud.com",
          },
        });
      } finally {
        clearTimeout(timer);
      }

      if (!r.ok) {
        console.warn(`[stream] resolve gagal: ${r.status}`);
        return res.status(502).json({
          error: "Gagal resolve stream dari SoundCloud",
          upstream_status: r.status,
          hint: r.status === 401 || r.status === 403 ? "client_id / track_authorization expired" : undefined,
        });
      }

      const data = await r.json().catch(() => null);
      target = data && data.url;
    }

    if (!target || !parseAllowed(target)) {
      return res.status(502).json({ error: "Stream URL tidak valid dari SoundCloud" });
    }

    // URL CDN bertanda tangan & expire berjam-jam; cache singkat di browser aja
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.redirect(302, target);
  } catch (err) {
    console.error("[stream] error:", err.message);
    const status = err.name === "AbortError" ? 504 : 500;
    return res.status(status).json({ error: err.name === "AbortError" ? "Timeout resolve stream" : err.message });
  }
}
