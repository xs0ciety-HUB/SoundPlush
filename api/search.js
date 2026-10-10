export default async function handler(req, res) {
  const { q, client_id } = req.query;
  if (!q || !client_id) return res.status(400).json({ error: "Missing query or client_id" });

  try {
    const scRes = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${client_id}&limit=20`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36"
      }
    });
    const data = await scRes.json();
    return res.status(scRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
