// api/search.js
export default async function handler(req, res) {
  const { q, client_id } = req.query;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=1800");

  if (!q || !client_id) {
    return res.status(400).json({ 
      success: false,
      error: "Missing parameters",
      required: { q: "string", client_id: "string" },
      received: { q: !!q, client_id: !!client_id }
    });
  }

  // Validate client_id format
  if (typeof client_id !== 'string' || client_id.length < 25) {
    return res.status(400).json({ 
      success: false,
      error: "Invalid client_id format"
    });
  }

  try {
    const searchUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${client_id}&limit=20`;
    
    console.log(`[search] Query: "${q}", URL: ${searchUrl.split('?')[0]}...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const scRes = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Accept": "application/json"
      }
    });

    clearTimeout(timeoutId);

    // Handle non-OK responses
    if (!scRes.ok) {
      console.error(`[search] SoundCloud error: ${scRes.status} ${scRes.statusText}`);
      
      // 401/403 = bad client_id
      if (scRes.status === 401 || scRes.status === 403) {
        return res.status(401).json({ 
          success: false,
          error: "Invalid or expired client_id",
          status: scRes.status,
          hint: "Try refreshing credentials from /api/get-credentials"
        });
      }
      
      // 429 = rate limited
      if (scRes.status === 429) {
        return res.status(429).json({ 
          success: false,
          error: "Rate limited by SoundCloud",
          status: scRes.status,
          retry_after: scRes.headers.get("retry-after") || "60 seconds"
        });
      }

      return res.status(scRes.status).json({ 
        success: false,
        error: `SoundCloud API error: ${scRes.statusText}`,
        status: scRes.status
      });
    }

    let data = null;
    try {
      data = await scRes.json();
    } catch (parseErr) {
      console.error("[search] JSON parse error:", parseErr);
      return res.status(502).json({ 
        success: false,
        error: "Invalid JSON response from SoundCloud"
      });
    }

    // Validate response structure
    if (!data) {
      return res.status(502).json({ 
        success: false,
        error: "Empty response from SoundCloud"
      });
    }

    // Ensure collection exists
    if (!data.collection) {
      data.collection = [];
    }

    if (!Array.isArray(data.collection)) {
      console.warn("[search] Collection is not array:", typeof data.collection);
      data.collection = [];
    }

    // Enhance tracks dengan stream URLs
    data.collection = data.collection.filter(track => !!track).map(track => {
      let streamUrl = null;
      const formats = [];

      // Priority 1: stream_url (direct)
      if (track.stream_url) {
        streamUrl = track.stream_url;
        formats.push("stream_url");
      }

      // Priority 2: media.transcodings
      if (track.media?.transcodings && Array.isArray(track.media.transcodings)) {
        const progressive = track.media.transcodings.find(t => 
          t?.format?.protocol === 'progressive' || t?.format?.mime_type === 'audio/mpeg'
        );
        if (progressive?.url) {
          if (!streamUrl) streamUrl = progressive.url;
          formats.push("progressive");
        }

        // Fallback to HLS
        if (!streamUrl) {
          const hls = track.media.transcodings.find(t => 
            t?.format?.protocol === 'hls'
          );
          if (hls?.url) {
            streamUrl = hls.url;
            formats.push("hls");
          }
        }

        // Last resort: any transcoding
        if (!streamUrl && track.media.transcodings.length > 0 && track.media.transcodings[0]?.url) {
          streamUrl = track.media.transcodings[0].url;
          formats.push("fallback");
        }
      }

      // Check if track is playable
      const isBlockedPolicy = track?.policy?.policy === "BLOCK";
      const isStreamable = !!streamUrl && !isBlockedPolicy;

      return {
        ...track,
        stream_url: streamUrl,
        streamable: isStreamable,
        _available_formats: formats
      };
    });

    // Count streamable tracks
    const streamableCount = data.collection.filter(t => t.streamable).length;
    console.log(`[search] Found ${data.collection.length} tracks, ${streamableCount} streamable`);

    return res.status(200).json({
      success: true,
      ...data,
      _stats: {
        total: data.collection.length,
        streamable: streamableCount
      }
    });
  } catch (err) {
    console.error("[search] Error:", err.message);
    
    // Timeout error
    if (err.name === 'AbortError') {
      return res.status(504).json({ 
        success: false,
        error: "Request timeout - SoundCloud API slow to respond"
      });
    }

    return res.status(500).json({ 
      success: false,
      error: err.message,
      type: err.name
    });
  }
}
