// api/me.js
export default async function handler(req, res) {
  const { clientId, authToken } = req.query;

  if (!clientId || !authToken) {
    return res.status(400).json({ error: "Missing clientId or authToken" });
  }

  try {
    const scResponse = await fetch(`https://api-mobi.soundcloud.com/me?client_id=${clientId}&stage=`, {
      method: "GET",
      headers: {
        "Authorization": `OAuth ${authToken}`,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36"
      }
    });

    const data = await scResponse.json();
    return res.status(scResponse.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Internal Proxy Error", details: error.message });
  }
}
