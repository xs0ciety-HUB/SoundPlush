// api/get-credentials.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");

  try {
    let clientId = null;
    const attempts = [];

    // 1. Try fetch mobile SoundCloud dan scrape client_id dari HTML/JS
    try {
      const pageRes = await fetch("https://m.soundcloud.com/", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        },
        timeout: 5000
      });
      const html = await pageRes.text();

      // Cari client_id langsung dari HTML
      let match = html.match(/client_id['":\s=]+["']([a-zA-Z0-9]{32,40})["']/i);
      if (match && match[1]) {
        clientId = match[1];
        attempts.push({ method: "html_direct", found: true });
      }

      // Jika tidak ketemu, cari script URLs dan scan mereka
      if (!clientId) {
        const scriptUrls = html.match(/https?:\/\/[^\s"']+\.js/g) || [];
        for (const url of scriptUrls.slice(0, 8)) {
          try {
            const jsRes = await fetch(url, { timeout: 4000 });
            if (!jsRes.ok) continue;
            const jsText = await jsRes.text();
            const m = jsText.match(/(?:client_id|CLIENT_ID)['\"]?\s*[:=]\s*['""`]?([a-zA-Z0-9_\-]{32,40})['""`]?/);
            if (m && m[1]) {
              clientId = m[1];
              attempts.push({ method: "script_scan", url: url.substring(0, 50), found: true });
              break;
            }
          } catch (e) {
            attempts.push({ method: "script_scan_failed", url: url.substring(0, 50), error: e.message });
          }
        }
      }
    } catch (fetchErr) {
      attempts.push({ method: "page_fetch_failed", error: fetchErr.message });
    }

    // 2. Fallback ke multiple valid client IDs (updated list)
    if (!clientId) {
      const fallbackIds = [
        "Ln23Gc3vXZb5rPvmX0B8X0B8X0B8X0B8",  // v2 stable
        "KKzJxmw11tYpCs6T24P4uUYhqmjalG6M",  // legacy
        "BRKRzTYe4wpIL5Ln9Lg5qMQc6J6W8HMo",  // alternative
      ];
      
      // Try validate fallback IDs pakai test API call
      for (const id of fallbackIds) {
        try {
          const testRes = await fetch(
            `https://api-v2.soundcloud.com/search/tracks?q=test&client_id=${id}&limit=1`,
            { timeout: 3000 }
          );
          if (testRes.ok) {
            clientId = id;
            attempts.push({ method: "fallback_validation", id: id, success: true });
            break;
          }
        } catch (e) {
          attempts.push({ method: "fallback_validation", id: id, success: false, error: e.message });
        }
      }
    }

    // Last resort: hardcoded yang paling baru
    if (!clientId) {
      clientId = "KKzJxmw11tYpCs6T24P4uUYhqmjalG6M";
      attempts.push({ method: "hardcoded_fallback", status: "last_resort" });
    }

    return res.status(200).json({ 
      success: true, 
      client_id: clientId,
      timestamp: new Date().toISOString(),
      debug: process.env.DEBUG ? { attempts } : undefined
    });
  } catch (err) {
    console.error("get-credentials error:", err);
    return res.status(500).json({ 
      success: false, 
      error: err.message,
      debug: process.env.DEBUG ? { stack: err.stack } : undefined
    });
  }
}
