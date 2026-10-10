// api/search.js
export default async function handler(req, res) {
  const { q, client_id, type = "tracks", playlist_id } = req.query;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=1800");

  if (!client_id) {
    return res.status(400).json({ success: false, error: "Missing client_id" });
  }

  if (typeof client_id !== "string" || client_id.length < 25) {
    return res.status(400).json({ success: false, error: "Invalid client_id format" });
  }

  const UA = "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

  /* ============================================================
     MODE 1: Fetch playlist detail by ID
  ============================================================ */
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

      if (!r.ok) {
        return res.status(r.status).json({
          success: false,
          error: `SoundCloud playlist error: ${r.status}`
        });
      }

      const data = await r.json();
      if (!data || !Array.isArray(data.tracks)) {
        return res.status(502).json({ success: false, error: "Invalid playlist response" });
      }

      data.tracks = data.tracks.filter(Boolean).map(enhanceTrack);

      return res.status(200).json({
        success: true,
        playlist: {
          id: data.id,
          title: data.title,
          user: data.user,
          artwork_url: data.artwork_url,
          track_count: data.track_count,
          description: data.description
        },
        collection: data.tracks,
        _stats: {
          total: data.tracks.length,
          streamable: data.tracks.filter(t => t.streamable).length
        }
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message,
        type: err.name
      });
    }
  }

  /* ============================================================
     MODE 2: Search
  ============================================================ */
  if (!q) {
    return res.status(400).json({
      success: false,
      error: "Missing query",
      required: { q: "string", client_id: "string" },
      received: { q: false, client_id: !!client_id }
    });
  }

  const allowedTypes = ["tracks", "playlists", "users", "albums"];
  const safeType = allowedTypes.includes(type) ? type : "tracks";

  try {
    const searchUrl = `https://api-v2.soundcloud.com/search/${safeType}?q=${encodeURIComponent(q)}&client_id=${client_id}&limit=20`;
    console.log(`[search] type=${safeType} q="${q}"`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const scRes = await fetch(searchUrl, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/json" }
    });

    clearTimeout(timeoutId);

    if (!scRes.ok) {
      if (scRes.status === 401 || scRes.status === 403) {
        return res.status(401).json({
          success: false,
          error: "Invalid or expired client_id",
          status: scRes.status,
          hint: "Refresh credentials from /api/get-credentials"
        });
      }
      if (scRes.status === 429) {
        return res.status(429).json({
          success: false,
          error: "Rate limited by SoundCloud",
          status: scRes.status,
          retry_after: scRes.headers.get("retry-after") || "60"
        });
      }
      return res.status(scRes.status).json({
        success: false,
        error: `SoundCloud API error: ${scRes.statusText}`,
        status: scRes.status
      });
    }

    let data;
    try { data = await scRes.json(); }
    catch { return res.status(502).json({ success: false, error: "Invalid JSON from SoundCloud" }); }

    if (!data || !Array.isArray(data.collection)) {
      data = data || {};
      data.collection = [];
    }

    data.collection = data.collection.filter(Boolean);

    if (safeType === "tracks") {
      data.collection = data.collection.map(enhanceTrack);
    } else if (safeType === "playlists") {
      data.collection = data.collection.map(p => ({
        id: p.id,
        title: p.title,
        user: p.user,
        artwork_url: p.artwork_url,
        track_count: p.track_count,
        description: p.description,
        created_at: p.created_at,
        genre: p.genre,
        permalink_url: p.permalink_url
      }));
    } else if (safeType === "users") {
      data.collection = data.collection.map(u => ({
        id: u.id,
        username: u.username,
        avatar_url: u.avatar_url,
        full_name: u.full_name,
        followers_count: u.followers_count,
        track_count: u.track_count,
        permalink_url: u.permalink_url,
        verified: u.verified
      }));
    }

    return res.status(200).json({
      success: true,
      type: safeType,
      collection: data.collection,
      _stats: { total: data.collection.length }
    });
  } catch (err) {
    console.error("[search] Error:", err.message);
    if (err.name === "AbortError") {
      return res.status(504).json({ success: false, error: "Request timeout" });
    }
    return res.status(500).json({ success: false, error: err.message, type: err.name });
  }
}

/* ============================================================
   Helper: enhance track with stream URL
   Prioritas: progressive mp3 (single file) > hls mp3 > hls lainnya
   Fix: cek protocol dengan ketat (dulu mime audio/mpeg ikut kena HLS
   sehingga m3u8 dianggap "progressive"), buang transcoding "snipped"
   (preview 30 detik), dan bawa track_authorization buat resolve.
============================================================ */
function enhanceTrack(track) {
  let streamUrl = null;
  let streamType = null;

  const list = Array.isArray(track.media?.transcodings) ? track.media.transcodings : [];
  const full = list.filter(t => t && t.url && !t.snipped);
  const usable = full.length ? full : list.filter(t => t && t.url);

  const isMp3 = t => (t.format?.mime_type || "").startsWith("audio/mpeg");
  const prog = usable.find(t => t.format?.protocol === "progressive" && isMp3(t))
            || usable.find(t => t.format?.protocol === "progressive");
  const hls = usable.find(t => t.format?.protocol === "hls" && isMp3(t))
           || usable.find(t => t.format?.protocol === "hls");

  if (prog) { streamUrl = prog.url; streamType = "progressive"; }
  else if (hls) { streamUrl = hls.url; streamType = "hls"; }
  else if (track.stream_url) { streamUrl = track.stream_url; streamType = "progressive"; }

  const blocked = track?.policy === "BLOCK" || track?.policy?.policy === "BLOCK";
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
    track_authorization: track.track_authorization || null,
    streamable,
    policy: track.policy
  };
}
