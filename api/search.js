// api/search.js
export default async function handler(req, res) {
  const { q, client_id } = req.query;

  if (!q || !client_id) {
    return res.status(400).json({ error: "Missing query or client_id" });
  }

  try {
    const scRes = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${client_id}&limit=20`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36"
      }
    });

    const data = await scRes.json();
    
    // Mapping tambahan untuk memastikan link streaming mp3/progressive ada
    if (data.collection) {
      data.collection = data.collection.map(track => {
        let streamUrl = track.stream_url;
        if (!streamUrl && track.media && track.media.transcodings) {
          // Cari format progressive (mp3)
          const progressive = track.media.transcodings.find(t => t.format.protocol === 'progressive');
          if (progressive) streamUrl = progressive.url;
          else if (track.media.transcodings.length > 0) streamUrl = track.media.transcodings[0].url;
        }
        return { ...track, resolved_stream_url: streamUrl };
      });
    }

    return res.status(scRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
