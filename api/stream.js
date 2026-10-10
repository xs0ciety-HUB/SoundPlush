export default async function handler(req, res) {
  const { url, client_id } = req.query;
  
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Cache-Control", "public, max-age=7200");

  if (!url || !client_id) {
    return res.status(400).json({ 
      error: "Missing parameters",
      required: { url: "string", client_id: "string" },
      received: { url: !!url, client_id: !!client_id }
    });
  }

  try {
    let targetUrl = url;
    let resolved = false;

    console.log(`[stream] Resolving: ${url.substring(0, 50)}...`);

    // Resolusi transcoding URL dari SoundCloud API v2
    if (url.includes('/transcodings/') || url.includes('hls') || url.startsWith('http')) {
      const resolveUrl = url.startsWith('http') ? url : `https://${url}`;
      const apiUrl = `${resolveUrl}${resolveUrl.includes('?') ? '&' : '?'}client_id=${client_id}`;
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const tokenRes = await fetch(apiUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            "Accept": "application/json",
            "Referer": "https://soundcloud.com/"
          }
        });

        clearTimeout(timeoutId);

        if (!tokenRes.ok) {
          console.warn(`[stream] Transcoding resolve returned ${tokenRes.status}, using direct URL`);
          targetUrl = apiUrl;
        } else {
          try {
            const tokenData = await tokenRes.json();
            
            if (tokenData.url) {
              targetUrl = tokenData.url;
              resolved = true;
              console.log('[stream] Successfully resolved transcoding URL');
            } else if (tokenData.urls && Array.isArray(tokenData.urls) && tokenData.urls.length > 0) {
              targetUrl = tokenData.urls[0];
              resolved = true;
              console.log('[stream] Using first URL from urls array');
            } else if (tokenData.stream_url) {
              targetUrl = tokenData.stream_url;
              resolved = true;
            } else {
              console.warn('[stream] Response has no URL field, using API URL');
              targetUrl = apiUrl;
            }
          } catch (jsonErr) {
            console.warn('[stream] Response not JSON, using API URL');
            targetUrl = apiUrl;
          }
        }
      } catch (resolveErr) {
        if (resolveErr.name === 'AbortError') {
          console.warn('[stream] Transcoding resolve timed out, using direct URL');
        } else {
          console.error('[stream] Transcoding resolve error:', resolveErr.message);
        }
        // Fallback ke direct URL + client_id
        targetUrl = `${resolveUrl}${resolveUrl.includes('?') ? '&' : '?'}client_id=${client_id}`;
      }
    } else {
      // Jika bukan transcoding URL, append client_id saja
      targetUrl = `${url}${url.includes('?') ? '&' : '?'}client_id=${client_id}`;
    }

    // Validate final URL
    if (!targetUrl || !targetUrl.startsWith('http')) {
      console.error('[stream] Invalid final URL:', targetUrl);
      return res.status(400).json({ 
        error: "Could not resolve valid stream URL"
      });
    }

    // Set proper audio headers untuk playback
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("X-Stream-Resolved", resolved ? "yes" : "no");

    console.log(`[stream] Redirecting to: ${targetUrl.substring(0, 50)}... (resolved: ${resolved})`);

    // Redirect ke final URL
    return res.redirect(302, targetUrl);
  } catch (err) {
    console.error("[stream] Error:", err.message);
    return res.status(500).json({ 
      error: err.message,
      type: err.name
    });
  }
}
