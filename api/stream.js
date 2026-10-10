// api/stream.js
export const config = { runtime: "nodejs", maxDuration: 60 };

const SC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

  if (req.method === "OPTIONS") return res.status(204).end();

  const { url, client_id } = req.query;
  if (!url || !client_id) return res.status(400).json({ error: "Missing url or client_id" });

  try {
    let targetUrl = url;

    // Resolve transcoding endpoint → CDN URL asli
    if (url.includes("/transcodings/") || url.includes("/stream/")) {
      const apiUrl = `${url}${url.includes("?") ? "&" : "?"}client_id=${client_id}`;
      const tokenRes = await fetch(apiUrl, {
        headers: {
          "User-Agent": SC_UA,
          "Accept": "application/json",
          "Referer": "https://soundcloud.com/"
        }
      });

      if (!tokenRes.ok) {
        return res.status(tokenRes.status).json({ error: `Token resolve: ${tokenRes.status}` });
      }

      const data = await tokenRes.json();
      targetUrl = data.url || (Array.isArray(data.urls) && data.urls[0]);
      if (!targetUrl) return res.status(502).json({ error: "No URL in token response" });
    }

    // Forward Range header dari browser
    const headers = {
      "User-Agent": SC_UA,
      "Accept": "*/*",
      "Referer": "https://soundcloud.com/"
    };
    if (req.headers.range) headers["Range"] = req.headers.range;

    const upstream = await fetch(targetUrl, { headers });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({
        error: `Upstream: ${upstream.status}`,
        target: targetUrl.slice(0, 100)
      });
    }

    const ctype = upstream.headers.get("content-type") || "";
    const isManifest = ctype.includes("mpegurl") || targetUrl.split("?")[0].endsWith(".m3u8");

    // === HLS MANIFEST → rewrite semua URL biar lewat proxy ini ===
    if (isManifest) {
      const text = await upstream.text();
      const base = new URL(targetUrl);
      const proto = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const origin = `${proto}://${host}`;

      const rewritten = text.split("\n").map(line => {
        const t = line.trim();
        if (!t) return line;

        if (t.startsWith("#")) {
          return t.replace(/URI="([^"]+)"/g, (_, u) => {
            try {
              const abs = new URL(u, base).toString();
              return `URI="${origin}/api/stream?url=${encodeURIComponent(abs)}&client_id=${client_id}"`;
            } catch { return `URI="${u}"`; }
          });
        }

        try {
          const abs = new URL(t, base).toString();
          return `${origin}/api/stream?url=${encodeURIComponent(abs)}&client_id=${client_id}`;
        } catch { return line; }
      }).join("\n");

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(rewritten);
    }

    // === PROGRESSIVE / SEGMENT → pipe audio ===
    res.setHeader("Content-Type", ctype || "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");

    const cl = upstream.headers.get("content-length");
    const cr = upstream.headers.get("content-range");
    if (cl) res.setHeader("Content-Length", cl);
    if (cr) res.setHeader("Content-Range", cr);

    res.status(upstream.status);

    // Pipe pake reader — handle backpressure
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const ok = res.write(Buffer.from(value));
        if (!ok) await new Promise(r => res.once("drain", r));
      }
      res.end();
    } catch (e) {
      console.error("[stream] pipe err:", e.message);
      try { res.end(); } catch {}
    }

  } catch (err) {
    console.error("[stream]", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else try { res.end(); } catch {}
  }
      }
