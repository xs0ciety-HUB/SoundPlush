// api/stream.js
export default async function handler(req, res) {
  const { url, client_id } = req.query;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Cache-Control", "public, max-age=3600");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (!url || !client_id) {
    return res.status(400).json({ error: "Missing url or client_id" });
  }

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  try {
    let targetUrl = url;

    // Kalau URL transcoding, resolve dulu ke CDN URL
    if (url.includes("/transcodings/")) {
      const resolveUrl = `${url}${url.includes("?") ? "&" : "?"}client_id=${client_id}`;
      const r = await fetch(resolveUrl, {
        headers: {
          "User-Agent": UA,
          "Accept": "application/json",
          "Referer": "https://soundcloud.com/",
        },
      });

      if (r.ok) {
        const data = await r.json();
        targetUrl = data.url || (Array.isArray(data.urls) && data.urls[0]) || url;
      }
    }

    // Redirect ke CDN SoundCloud — browser ambil langsung pake IP user
    return res.redirect(302, targetUrl);
  } catch (err) {
    console.error("[stream]", err);
    return res.status(500).json({ error: err.message });
  }
}
