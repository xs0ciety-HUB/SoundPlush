export default async function handler(req, res) {
  let { url, client_id } = req.query;
  if (!url) return res.status(400).json({ error: "Missing URL" });

  try {
    let targetUrl = url;

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
    } else {
      targetUrl = `${url}${url.includes('?') ? '&' : '?'}client_id=${client_id}`;
    }

    const audioRes = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*"
      },
      redirect: "follow"
    });

    res.setHeader("Content-Type", audioRes.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const buffer = await audioRes.arrayBuffer();
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
