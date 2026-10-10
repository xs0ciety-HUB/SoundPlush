export default async function handler(req, res) {
  const { url, client_id } = req.query;
  
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Cache-Control", "public, max-age=7200");

  if (!url || !client_id) {
    return res.status(400).json({ error: "Missing stream URL or client_id", received: { url: !!url, client_id: !!client_id } });
  }

  try {
    let targetUrl = url;
    let resolved = false;

    // Resolusi transcoding URL dari SoundCloud API v2
    if (url.includes('/transcodings/') || url.includes('hls') || url.includes('http')) {
      const resolveUrl = url.startsWith('http') ? url : `https://${url}`;
      const apiUrl = `${resolveUrl}${resolveUrl.includes('?') ? '&' : '?'}client_id=${client_id}`;
      
      try {
        const tokenRes = await fetch(apiUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            "Accept": "application/json",
            "Referer": "https://soundcloud.com/"
          },
          timeout: 8000
        });

        if (!tokenRes.ok) {
          console.error(`Transcoding resolve failed: ${tokenRes.status} ${tokenRes.statusText}`);
          // Jika resolve gagal, coba langsung redirect ke URL original
          targetUrl = apiUrl;
        } else {
          try {
            const tokenData = await tokenRes.json();
            if (tokenData.url) {
              targetUrl = tokenData.url;
              resolved = true;
            } else if (tokenData.urls && Array.isArray(tokenData.urls)) {
              // Fallback ke first URL dari array
              targetUrl = tokenData.urls[0];
              resolved = true;
            } else {
              targetUrl = apiUrl;
            }
          } catch (jsonErr) {
            // Response bukan JSON, redirect ke API URL saja
            targetUrl = apiUrl;
          }
        }
      } catch (resolveErr) {
        console.error("Transcoding resolve timeout:", resolveErr.message);
        // Timeout atau network error, coba langsung
        targetUrl = `${resolveUrl}${resolveUrl.includes('?') ? '&' : '?'}client_id=${client_id}`;
      }
    } else {
      targetUrl = `${url}${url.includes('?') ? '&' : '?'}client_id=${client_id}`;
    }

    // Set proper audio headers untuk playback
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("X-Stream-Resolved", resolved ? "yes" : "no");

    // Redirect ke final URL
    return res.redirect(302, targetUrl);
  } catch (err) {
    console.error("Stream error:", err);
    return res.status(500).json({ 
      error: err.message,
      type: err.name,
      debug: process.env.DEBUG ? { stack: err.stack } : undefined
    });
  }
}
