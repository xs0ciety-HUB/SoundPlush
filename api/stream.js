// api/stream.js
export const config = { runtime: "edge" };

const SC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const SC_REFERER = "https://soundcloud.com/";

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Range",
      },
    });
  }

  const reqUrl = new URL(req.url);
  const url = reqUrl.searchParams.get("url");
  const clientId = reqUrl.searchParams.get("client_id");
  const proxyOrigin = reqUrl.origin;

  if (!url || !clientId) {
    return json({ error: "Missing parameters: url, client_id" }, 400);
  }

  try {
    let targetUrl = url;

    // === 1. Resolve transcoding URL kalau perlu ===
    if (url.includes("/transcodings/")) {
      const apiUrl = `${url}${url.includes("?") ? "&" : "?"}client_id=${clientId}`;
      const tokenRes = await fetch(apiUrl, {
        headers: {
          "User-Agent": SC_UA,
          "Accept": "application/json",
          "Referer": SC_REFERER,
        },
      });

      if (!tokenRes.ok) {
        return json({ error: `Token resolve failed: ${tokenRes.status}` }, tokenRes.status);
      }

      const tokenData = await tokenRes.json();
      targetUrl = tokenData.url || (Array.isArray(tokenData.urls) && tokenData.urls[0]);
      if (!targetUrl) {
        return json({ error: "No URL in token response" }, 502);
      }
    }

    // === 2. Fetch dari SoundCloud ===
    const fwdHeaders = {
      "User-Agent": SC_UA,
      "Referer": SC_REFERER,
      "Origin": "https://soundcloud.com",
      "Accept": "*/*",
    };
    const range = req.headers.get("range");
    if (range) fwdHeaders["Range"] = range;

    const upstream = await fetch(targetUrl, { headers: fwdHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      return json({ error: `Upstream ${upstream.status}`, target: targetUrl.slice(0, 80) }, upstream.status);
    }

    const upstreamType = upstream.headers.get("content-type") || "";
    const looksLikeManifest =
      upstreamType.includes("mpegurl") ||
      upstreamType.includes("m3u") ||
      targetUrl.split("?")[0].endsWith(".m3u8");

    // === 3. Kalau HLS manifest, rewrite semua segment URL biar lewat proxy ini juga ===
    if (looksLikeManifest) {
      const text = await upstream.text();
      const base = new URL(targetUrl);

      const rewritten = text
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          // Baris komentar di m3u8 (kecuali EXT-X-MAP / EXT-X-KEY yang berisi URI)
          if (trimmed.startsWith("#")) {
            // Rewrite URI="..." kalau ada (buat encryption key / init segment)
            return trimmed.replace(/URI="([^"]+)"/g, (_, u) => {
              let abs;
              try { abs = new URL(u, base).toString(); } catch { return `URI="${u}"`; }
              return `URI="${proxyOrigin}/api/stream?url=${encodeURIComponent(abs)}&client_id=${clientId}"`;
            });
          }
          // Baris URL segmen
          let abs;
          try { abs = new URL(trimmed, base).toString(); } catch { return line; }
          return `${proxyOrigin}/api/stream?url=${encodeURIComponent(abs)}&client_id=${clientId}`;
        })
        .join("\n");

      return new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    }

    // === 4. Pipe audio stream ===
    const respHeaders = new Headers();
    respHeaders.set("Content-Type", upstreamType || "audio/mpeg");
    respHeaders.set("Accept-Ranges", "bytes");
    respHeaders.set("Access-Control-Allow-Origin", "*");
    respHeaders.set("Cache-Control", "public, max-age=7200");

    const cl = upstream.headers.get("content-length");
    if (cl) respHeaders.set("Content-Length", cl);
    const cr = upstream.headers.get("content-range");
    if (cr) respHeaders.set("Content-Range", cr);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });

  } catch (err) {
    console.error("[stream] error:", err);
    return json({ error: err.message || "Unknown error" }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
    }
