// api/stream.js
export const config = { runtime: "nodejs", maxDuration: 60 };

const SC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
    return res.status(204).end();
  }

  const { url, client_id } = req.query;

  if (!url || !client_id) {
    return res.status(400).json({ error: "Missing url or client_id" });
  }

  try {
    let targetUrl = url;

    // Resolve transcoding endpoint → dapat URL CDN asli
    if (url.includes("/transcodings/") || url.includes("/stream/")) {
      const apiUrl = `${url}${url.includes("?") ? "&" : "?"}client_id=${client_id}`;
      const tokenRes = await fetch(apiUrl, {
        headers: {
          "User-Agent": SC_UA,
          "Accept": "application/json",
          "Referer": "https://soundcloud.com/",
        },
      });

      if (!tokenRes.ok) {
        return res.status(tokenRes.status).json({
          error: `Token resolve failed: ${tokenRes.status}`,
        });
      }

      const tokenData = await tokenRes.json();
      targetUrl = tokenData.url || (Array.isArray(tokenData.urls) && tokenData.urls[0]);

      if (!targetUrl) {
        return res.status(502).json({ error: "No URL in token response" });
      }
    }

    // Fetch dari CDN SoundCloud pake header yang tepat
    const upstreamHeaders = {
      "User-Agent": SC_UA,
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://soundcloud.com/",
      "Origin": "https://soundcloud.com",
    };
    if (req.headers.range) upstreamHeaders["Range"] = req.headers.range;

    const upstream = await fetch(targetUrl, { headers: upstreamHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).json({
        error: `Upstream error: ${upstream.status}`,
        target: targetUrl.slice(0, 100),
      });
    }

    const upstreamType = upstream.headers.get("content-type") || "";
    const isManifest =
      upstreamType.includes("mpegurl") ||
      upstreamType.includes("m3u") ||
      targetUrl.split("?")[0].endsWith(".m3u8");

    // HLS manifest — rewrite semua segment URL biar lewat proxy ini juga
    if (isManifest) {
      const text = await upstream.text();
      const base = new URL(targetUrl);
      const proto = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers["x-forwarded-host"] || req.headers.host;
      const proxyOrigin = `${proto}://${host}`;

      const rewritten = text
        .split("\n")
        .map((line) => {
          const t = line.trim();
          if (!t) return line;

          // Rewrite URI="..." (encryption key / init segment)
          if (t.startsWith("#")) {
            return t.replace(/URI="([^"]+)"/g, (_, u) => {
              let abs;
              try { abs = new URL(u, base).toString(); } catch { return `URI="${u}"`; }
              return `URI="${proxyOrigin}/api/stream?url=${encodeURIComponent(abs)}&client_id=${client_id}"`;
            });
          }

          // Rewrite URL segment
          let abs;
          try { abs = new URL(t, base).toString(); } catch { return line; }
          return `${proxyOrigin}/api/stream?url=${encodeURIComponent(abs)}&client_id=${client_id}`;
        })
        .join("\n");

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(rewritten);
    }

    // Pipe audio stream
    res.setHeader("Content-Type", upstreamType || "audio/mpeg");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");

    const cl = upstream.headers.get("content-length");
    if (cl) res.setHeader("Content-Length", cl);
    const cr = upstream.headers.get("content-range");
    if (cr) res.setHeader("Content-Range", cr);

    res.status(upstream.status);

    // Pipe body
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch (e) {
      console.error("[stream] pipe error:", e.message);
    }
    res.end();

  } catch (err) {
    console.error("[stream]", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
        }
