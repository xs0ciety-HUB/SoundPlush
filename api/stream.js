// api/stream.js
export const config = { runtime: "edge" };

const SC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

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

  if (!url || !clientId) {
    return json({ error: "Missing url or client_id" }, 400);
  }

  try {
    let targetUrl = url;

    // Resolve transcoding endpoint -> dapat URL CDN asli
    if (url.includes("/transcodings/") || url.includes("/stream/")) {
      const apiUrl = `${url}${url.includes("?") ? "&" : "?"}client_id=${clientId}`;
      const tokenRes = await fetch(apiUrl, {
        headers: {
          "User-Agent": SC_UA,
          "Accept": "application/json",
          "Referer": "https://soundcloud.com/",
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

    // Fetch dari CDN SoundCloud pake header yang tepat
    const fwdHeaders = {
      "User-Agent": SC_UA,
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://soundcloud.com/",
      "Origin": "https://soundcloud.com",
    };
    const range = req.headers.get("range");
    if (range) fwdHeaders["Range"] = range;

    const upstream = await fetch(targetUrl, { headers: fwdHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      return json({
        error: `Upstream error: ${upstream.status}`,
        target: targetUrl.slice(0, 100),
      }, upstream.status);
    }

    const upstreamType = upstream.headers.get("content-type") || "";
    const isManifest =
      upstreamType.includes("mpegurl") ||
      upstreamType.includes("m3u") ||
      targetUrl.split("?")[0].endsWith(".m3u8");

    // HLS manifest -> rewrite semua segment URL biar lewat proxy ini juga
    if (isManifest) {
      const text = await upstream.text();
      const base = new URL(targetUrl);
      const proxyOrigin = reqUrl.origin;

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
              return `URI="${proxyOrigin}/api/stream?url=${encodeURIComponent(abs)}&client_id=${clientId}"`;
            });
          }

          // Rewrite URL segment
          let abs;
          try { abs = new URL(t, base).toString(); } catch { return line; }
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

    // Pipe audio stream pake ReadableStream (Edge-compatible)
    const respHeaders = new Headers();
    respHeaders.set("Content-Type", upstreamType || "audio/mpeg");
    respHeaders.set("Access-Control-Allow-Origin", "*");
    respHeaders.set("Accept-Ranges", "bytes");
    respHeaders.set("Cache-Control", "public, max-age=3600");

    const cl = upstream.headers.get("content-length");
    if (cl) respHeaders.set("Content-Length", cl);
    const cr = upstream.headers.get("content-range");
    if (cr) respHeaders.set("Content-Range", cr);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });

  } catch (err) {
    console.error("[stream]", err);
    return json({ error: err.message }, 500);
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
