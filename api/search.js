// api/search.js
export default async function handler(req, res) {
  const { q, client_id } = req.query;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=1800");

  if (!q || !client_id) {
    return res.status(400).json({ error: "Missing query or client_id", received: { q: !!q, client_id: !!client_id } });
  }

  try {
    const searchUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${client_id}&limit=20&linked_partitioning=1`;
    
    const scRes = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://soundcloud.com/"
      },
      timeout: 10000
    });

    if (!scRes.ok) {
      console.error(`SoundCloud API error: ${scRes.status} ${scRes.statusText}`);
      return res.status(scRes.status).json({ 
        error: `SoundCloud API error: ${scRes.statusText}`,
        status: scRes.status 
      });
    }

    const data = await scRes.json();
    
    // Enhance tracks dengan stream URLs yang robust
    if (data.collection && Array.isArray(data.collection)) {
      data.collection = data.collection.map(track => {
        if (!track) return track;

        let streamUrl = null;
        const streamUrls = [];

        // Priority 1: stream_url (legacy)
        if (track.stream_url) {
          streamUrl = track.stream_url;
          streamUrls.push({ type: "stream_url", url: streamUrl });
        }

        // Priority 2: media.transcodings (prefer progressive/mp3)
        if (track.media && track.media.transcodings && Array.isArray(track.media.transcodings)) {
          const progressive = track.media.transcodings.find(t => 
            t.format && (t.format.protocol === 'progressive' || t.format.mime_type === 'audio/mpeg')
          );
          if (progressive && progressive.url) {
            if (!streamUrl) streamUrl = progressive.url;
            streamUrls.push({ type: "progressive", url: progressive.url });
          }

          // Fallback: hls jika available
          const hls = track.media.transcodings.find(t => 
            t.format && (t.format.protocol === 'hls' || t.format.mime_type === 'application/x-mpegURL')
          );
          if (hls && hls.url) {
            if (!streamUrl) streamUrl = hls.url;
            streamUrls.push({ type: "hls", url: hls.url });
          }

          // Last resort: ambil transcoding pertama apapun
          if (!streamUrl && track.media.transcodings.length > 0) {
            streamUrl = track.media.transcodings[0].url;
            streamUrls.push({ type: "fallback", url: streamUrl });
          }
        }

        return {
          ...track,
          stream_url: streamUrl || null,
          streamable: !!streamUrl && !track.policy?.policy === "BLOCK" ?? true,
          _debug: {
            has_media: !!track.media,
            transcodings_count: track.media?.transcodings?.length ?? 0,
            available_formats: streamUrls.map(s => ({ type: s.type }))
          }
        };
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Search error:", err);
    return res.status(500).json({ 
      error: err.message,
      type: err.name,
      debug: process.env.DEBUG ? { stack: err.stack } : undefined
    });
  }
}
