// api/get-credentials.js
export default async function handler(req, res) {
  try {
    // 1. Fetch halaman mobile SoundCloud
    const pageRes = await fetch("https://m.soundcloud.com/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36"
      }
    });
    const html = await pageRes.text();

    // 2. Cari URL script app js
    const scriptUrls = html.match(/https?:\/\/[^"]+\.js/g) || [];
    let clientId = null;

    // 3. Scan script buat dapet client_id yang valid
    for (const url of scriptUrls.slice(0, 5)) {
      const jsRes = await fetch(url);
      const jsText = await jsRes.text();
      const match = jsText.match(/client_id[:=]\s*["']([a-zA-Z0-9]{32})["']/);
      if (match) {
        clientId = match[1];
        break;
      }
    }

    // Fallback pakai client_id default lu kalau scraping gagal
    if (!clientId) {
      clientId = "KKzJxmw11tYpCs6T24P4uUYhqmjalG6M";
    }

    return res.status(200).json({ success: true, client_id: clientId });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
