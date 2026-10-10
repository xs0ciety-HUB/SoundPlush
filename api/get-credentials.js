// api/get-credentials.js
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=1800"); // 30 menit cache

  try {
    let clientId = null;
    const attempts = [];

    // Known valid client IDs (update regularly)
    const FALLBACK_IDS = [
      "KKzJxmw11tYpCs6T24P4uUYhqmjalG6M",  // Most stable
      "BRKRzTYe4wpIL5Ln9Lg5qMQc6J6W8HMo",  // Alternative
      "Ln23Gc3vXZb5rPvmX0B8X0B8X0B8X0B8",  // Backup
    ];

    // 1. Try scrape dari mobile SoundCloud
    try {
      const pageRes = await fetch("https://m.soundcloud.com/", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        },
        timeout: 4000
      });
      
      if (pageRes.ok) {
        const html = await pageRes.text();
        
        // Cari di HTML
        let match = html.match(/client_id['":\s=]+["']([a-zA-Z0-9]{30,40})["']/i);
        if (match?.[1]) {
          clientId = match[1];
          attempts.push({ method: "scrape_html", found: true });
        }

        // Scan scripts
        if (!clientId) {
          const scriptUrls = html.match(/https?:\/\/[^\s"'<>]+\.js/g) || [];
          for (const url of scriptUrls.slice(0, 5)) {
            try {
              const jsRes = await fetch(url, { timeout: 3000 });
              if (!jsRes.ok) continue;
              
              const jsText = await jsRes.text().catch(() => null);
              if (!jsText) continue;
              
              const m = jsText.match(/client_id['\"]?\s*[:=]\s*['""`]?([a-zA-Z0-9]{30,40})['""`]?/);
              if (m?.[1]) {
                clientId = m[1];
                attempts.push({ method: "scrape_script", found: true });
                break;
              }
            } catch (e) {
              // continue
            }
          }
        }
      }
    } catch (fetchErr) {
      attempts.push({ method: "scrape_failed", error: fetchErr.message });
    }

    // 2. If scraping failed, validate fallback IDs
    if (!clientId) {
      for (const id of FALLBACK_IDS) {
        try {
          const testRes = await fetch(
            `https://api-v2.soundcloud.com/search/tracks?q=lagu&client_id=${id}&limit=1`,
            { 
              timeout: 4000,
              headers: {
                "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
              }
            }
          );
          
          if (testRes.ok) {
            clientId = id;
            attempts.push({ method: "validate_fallback", id_index: FALLBACK_IDS.indexOf(id), success: true });
            break;
          } else {
            attempts.push({ method: "validate_fallback", id_index: FALLBACK_IDS.indexOf(id), status: testRes.status });
          }
        } catch (e) {
          attempts.push({ method: "validate_fallback", id_index: FALLBACK_IDS.indexOf(id), error: e.message });
        }
      }
    }

    // Last resort
    if (!clientId) {
      clientId = FALLBACK_IDS[0];
      attempts.push({ method: "lastresort_fallback" });
    }

    // Validasi format
    if (!clientId || clientId.length < 30) {
      clientId = FALLBACK_IDS[0];
      attempts.push({ method: "format_validation_fallback" });
    }

    return res.status(200).json({ 
      success: true, 
      client_id: clientId,
      timestamp: new Date().toISOString(),
      debug: process.env.DEBUG ? { attempts, method_count: attempts.length } : undefined
    });
  } catch (err) {
    console.error("[get-credentials]", err);
    // Fallback hardcoded jika semuanya gagal
    return res.status(200).json({ 
      success: true,
      client_id: "KKzJxmw11tYpCs6T24P4uUYhqmjalG6M",
      fallback: true,
      error_note: err.message
    });
  }
}
