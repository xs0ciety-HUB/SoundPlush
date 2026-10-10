// api/search.js
export default async function handler(req, res) {
  const { q, client_id, type = "tracks", playlist_id } = req.query;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=1800");

  if (!client_id) return res.status(400).json({ success: false, error: "Missing client_id" });
  if (typeof client_id !== "string" || client_id.length < 25) {
    return res.status(400).json({ success: false, error: "Invalid client_id format" });
  }

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

  if (playlist_id) {
    try {
      const url = `https://api-v2.soundcloud.com/playlists/${playlist_id}?client_id=${client_id}`;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10000);
      const r = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": UA, Accept: "application/json" }
      });
      clearTimeout(t);
      if (!r.ok) return res.status(r.status).json({ success: false, error: `SoundCloud: ${r.status}` });

      const data = await r.json();
      if (!data || !Array.isArray(data.tracks)) return res.status(502).json({ success: false, error: "Invalid playlist" });

      data.tracks = data.tracks.filter(Boolean).map(enhanceTrack);
      return res.status(200).json({
        success: true,
        playlist: {
          id: data.id, title: data.title, user: data.user,
          artwork_url: data.artwork_url, track_count: data.track_count,
          description: data.description
        },
        collection: data.tracks
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (!q) return res.status(400).json({ success: false, error: "Missing query" });

  const allowedTypes = ["tracks", "playlists", "users", "albums"];
  const safeType = allowedTypes.includes(type) ? type : "tracks";

  try {
    const searchUrl = `https://api-v2.soundcloud.com/search/${safeType}?q=${encodeURIComponent(q)}&client_id=${client_id}&limit=20`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const scRes = await fetch(searchUrl, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/json" }
    });
    clearTimeout(timeoutId);

    if (!scRes.ok) {
      if (scRes.status === 401 || scRes.status === 403) {
        return res.status(401).json({ success: false, error: "client_id expired", status: scRes.status });
      }
      return res.status(scRes.status).json({ success: false, error: `SoundCloud: ${scRes.statusText}`, status: scRes.status });
    }

    let data;
    try { data = await scRes.json(); }
    catch { return res.status(502).json({ success: false, error: "Invalid JSON" }); }

    if (!data || !Array.isArray(data.collection)) { data = data || {}; data.collection = []; }
    data.collection = data.collection.filter(Boolean);

    if (safeType === "tracks") data.collection = data.collection.map(enhanceTrack);
    else if (safeType === "playlists") {
      data.collection = data.collection.map(p => ({
        id: p.id, title: p.title, user: p.user, artwork_url: p.artwork_url,
        track_count: p.track_count, description: p.description,
        created_at: p.created_at, genre: p.genre, permalink_url: p.permalink_url
      }));
    } else if (safeType === "users") {
      data.collection = data.collection.map(u => ({
        id: u.id, username: u.username, avatar_url: u.avatar_url,
        full_name: u.full_name, followers_count: u.followers_count,
        track_count: u.track_count, permalink_url: u.permalink_url, verified: u.verified
      }));
    }

    return res.status(200).json({ success: true, type: safeType, collection: data.collection });
  } catch (err) {
    if (err.name === "AbortError") return res.status(504).json({ success: false, error: "Timeout" });
    return res.status(500).json({ success: false, error: err.message });
  }
}

/* ============================================================
   Helper: enhance track
   PRIORITAS: progressive (single file) > HLS
   FIX: stream_type di-detect dari URL, bukan asal set
============================================================ */
function enhanceTrack(track) {
  let streamUrl = null;
  let streamType = null;

  // PRIORITAS 1: progressive transcoding (single file, ga ada segment expiry)
  if (Array.isArray(track.media?.transcodings)) {
    const prog = track.media.transcodings.find(t =>
      t?.format?.protocol === "progressive" || t?.format?.mime_type === "audio/mpeg"
    );
    if (prog?.url) {
      streamUrl = prog.url;
      streamType = "progressive";
    }

    // PRIORITAS 2: HLS transcoding
    if (!streamUrl) {
      const hls = track.media.transcodings.find(t => t?.format?.protocol === "hls");
      if (hls?.url) {
        streamUrl = hls.url;
        streamType = "hls";
      }
    }
  }

  // FALLBACK: track.stream_url mentah — DETECT TYPE dari URL
  if (!streamUrl && track.stream_url) {
    streamUrl = track.stream_url;
    streamType = track.stream_url.includes("/hls") ? "hls" : "progressive";
  }

  const blocked = track?.policy?.policy === "BLOCK";
  const streamable = !!streamUrl && !blocked;

  return {
    id: track.id,
    title: track.title,
    user: track.user,
    artwork_url: track.artwork_url,
    duration: track.duration,
    playback_count: track.playback_count,
    likes_count: track.likes_count,
    genre: track.genre,
    permalink_url: track.permalink_url,
    stream_url: streamUrl,
    stream_type: streamType,
    streamable,
    policy: track.policy
  };
                                                                                               }
