export default async function handler(req, res) {
  let { url, client_id } = req.query;
  if (!url) return res.status(400).json({ error: "Missing stream URL" });

  try {
    let targetUrl = url;

    // Kalau link dari transcodings v2, ambil redirect streaming URL asli yang di-generate SoundCloud
    if (url.includes('/transcodings/') || !url.startsWith('http')) {
      const fetchUrl = url.startsWith('http') ? url : `https://${url}`;
      const tokenRes = await fetch(`${fetchUrl}?client_id=${client_id}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });
      const tokenData = await tokenRes.json();
      if (tokenData.url) {
        targetUrl = tokenData.url;
      }
    }

    const audioRes = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
        "Range": req.headers.range || "bytes=0-"
      },
      redirect: "follow"
    });

    res.setHeader("Content-Type", audioRes.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (audioRes.headers.get("content-range")) res.setHeader("Content-Range", audioRes.headers.get("content-range"));
    if (audioRes.headers.get("content-length")) res.setHeader("Content-Length", audioRes.headers.get("content-length"));

    const buffer = await audioRes.arrayBuffer();
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
