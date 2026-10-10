// api/stream.js
export default async function handler(req, res) {
  let { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing stream URL" });

  try {
    // Kalau URL transcodings hls/progressive dari soundcloud
    if (url.includes('api.soundcloud.com') && !url.includes('http')) {
      url = 'https://' + url;
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity",
        "Range": req.headers.range || "bytes=0-"
      }
    });

    res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (response.headers.get("content-range")) {
      res.setHeader("Content-Range", response.headers.get("content-range"));
    }
    if (response.headers.get("content-length")) {
      res.setHeader("Content-Length", response.headers.get("content-length"));
    }

    const buffer = await response.arrayBuffer();
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
