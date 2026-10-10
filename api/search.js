// api/search.js
export default async function handler(req, res) {
  const { q, client_id, type = "tracks", playlist_id } = req.query;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=1800");

  if (!client_id) {
    return res.status(400).json({ success: false, error: "Missing client_id" });
  }

  const UA = "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

  if (playlist_id) {
    try {
      const url = `https://api-v2.soundcloud.com/playlists/${playlist_id}?client_id=${client_id}`;
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!r.ok) return res.status(r.status).json({ success: false, error: `SoundCloud playlist error: ${r.status}` });

      const data = await r.json();
      data.tracks = (data.tracks || []).filter(Boolean).map(enhanceTrack);

      return res.status(200).json({
        success: true,
        playlist: { id: data.id, title: data.title, user: data.user, artwork_url: data.artwork_url, track_count: data.track_count },
        collection: data.tracks
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (!q) return res.status(400).json({ success: false, error: "Missing query" });

  const safeType = ["tracks", "playlists", "users", "albums"].includes(type) ? type : "tracks";

  try {
    const searchUrl = `https://api-v2.soundcloud.com/search/${safeType}?q=${encodeURIComponent(q)}&client_id=${client_id}&limit=20`;
    const scRes = await fetch(searchUrl, { headers: { "User-Agent": UA, Accept: "application/json" } });

    if (!scRes.ok) return res.status(scRes.status).json({ success: false, error: `SoundCloud API error: ${scRes.status}` });

    let data = await scRes.json();
    if (!data || !Array.isArray(data.collection)) data = { collection: [] };

    data.collection = data.collection.filter(Boolean);

    if (safeType === "tracks") {
      data.collection = data.collection.map(enhanceTrack);
    } else if (safeType === "playlists") {
      data.collection = data.collection.map(p => ({
        id: p.id, title: p.title, user: p.user, artwork_url: p.artwork_url, track_count: p.track_count
      }));
    } else if (safeType === "users") {
      data.collection = data.collection.map(u => ({
        id: u.id, username: u.username, avatar_url: u.avatar_url, followers_count: u.followers_count
      }));
    }

    return res.status(200).json({ success: true, type: safeType, collection: data.collection });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

function enhanceTrack(track) {
  let streamUrl = null;
  let streamType = "progressive";

  if (Array.isArray(track.media?.transcodings)) {
    // UTAMAKAN PROGRESSIVE (MP3 Direct) agar aman dari isu HLS m3u8 browser
    const prog = track.media.transcodings.find(t =>
      t?.format?.protocol === "progressive" || t?.format?.mime_type === "audio/mpeg"
    );

    if (prog?.url) {
      streamUrl = prog.url;
      streamType = "progressive";
    } else {
      const hls = track.media.transcodings.find(t => t?.format?.protocol === "hls");
      if (hls?.url) {
        streamUrl = hls.url;
        streamType = "hls";
      }
    }
  }

  if (!streamUrl && track.stream_url) {
    streamUrl = track.stream_url;
  }

  const blocked = track?.policy?.policy === "BLOCK";
  const streamable = !!streamUrl && !blocked;

  return {
    id: track.id,
    title: track.title,
    user: track.user,
    artwork_url: track.artwork_url,
    duration: track.duration,
    stream_url: streamUrl,
    stream_type: streamType,
    streamable,
    policy: track.policy
  };
}
