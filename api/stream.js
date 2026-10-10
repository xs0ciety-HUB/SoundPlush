export default async function handler(req, res) {
  let { url, client_id } = req.query;
  if (!url) return res.status(400).json({ error: "Missing stream URL" });

  try {
    let targetUrl = url;

    // Resolusi URL transcoding dari API v2 SoundCloud
    if (url.includes('/transcodings/') || !url.startsWith('http')) {
      const fetchUrl = url.startsWith('http') ? url : `https://${url}`;
      const tokenRes = await fetch(`${fetchUrl}?client_id=${client_id}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });

      if (!tokenRes.ok) {
        throw new Error(`SoundCloud API error: ${tokenRes.statusText}`);
      }

      const tokenData = await tokenRes.json();
      if (tokenData.url) {
        targetUrl = tokenData.url;
      }
    } else {
      targetUrl = `${url}${url.includes('?') ? '&' : '?'}client_id=${client_id}`;
    }

    // Redirect langsung ke URL stream CDN
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.redirect(302, targetUrl);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
