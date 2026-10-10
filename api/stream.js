// api/stream.js
export default async function handler(req, res) {
  const { url, client_id } = req.query;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, If-Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Accept-Ranges", "bytes");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (!url || !client_id) return res.status(400).json({ error: "Missing url or client_id" });

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  try {
    let targetUrl = url;

    if (url.includes("/transcodings/")) {
      const resolveUrl = `${url}${url.includes("?") ? "&" : "?"}client_id=${client_id}`;
      try {
        const r = await fetch(resolveUrl, {
          headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://soundcloud.com/" }
        });
        if (r.ok) {
          const data = await r.json();
          targetUrl = data.url || (Array.isArray(data.urls) && data.urls[0]) || resolveUrl;
        } else {
          targetUrl = resolveUrl;
        }
      } catch {
        targetUrl = resolveUrl;
      }
    } else {
      targetUrl = `${url}${url.includes("?") ? "&" : "?"}client_id=${client_id}`;
    }

    if (!targetUrl || !targetUrl.startsWith("http")) {
      return res.status(400).json({ error: "Invalid stream URL" });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    return res.redirect(302, targetUrl);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
