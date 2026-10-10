// api/get-credentials.js - v3
// Fix: opsi `timeout` di fetch Node TIDAK ada -> request bisa nge-hang sampai function mati (504).
// Sekarang pakai AbortController. Scrape juga diarahkan ke bundle JS asli (a-v2.sndcdn.com).
// ID palsu di fallback dihapus.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Fallback terakhir. Kalau semua mati, update manual di sini.
const FALLBACK_IDS = ["KKzJxmw11tYpCs6T24P4uUYhqmjalG6M", "BRKRzTYe4wpIL5Ln9Lg5qMQc6J6W8HMo"];

async function fetchT(url, ms = 4000, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal, headers: { "User-Agent": UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

async function isValid(id) {
  try {
    const r = await fetchT(
      `https://api-v2.soundcloud.com/search/tracks?q=lagu&client_id=${id}&limit=1`,
      4000,
      { headers: { Accept: "application/json" } }
    );
    return r.ok;
  } catch {
    return false;
  }
}

async function scrapeClientId(attempts) {
  const home = await fetchT("https://soundcloud.com/", 4000);
  if (!home.ok) {
    attempts.push({ step: "home", status: home.status });
    return null;
  }
  const html = await home.text();

  const scripts = [...new Set(html.match(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"'\s]+\.js/g) || [])];
  attempts.push({ step: "scripts_found", count: scripts.length });

  // client_id biasanya ada di bundle paling belakang
  for (const src of scripts.reverse().slice(0, 6)) {
    try {
      const r = await fetchT(src, 4000);
      if (!r.ok) continue;
      const js = await r.text();
      const m = js.match(/client_id\s*[:=]\s*["']([a-zA-Z0-9]{32})["']/) || js.match(/client_id=([a-zA-Z0-9]{32})/);
      if (m && m[1]) return m[1];
    } catch {}
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const attempts = [];
  try {
    let clientId = null;
    let source = null;

    try {
      const scraped = await scrapeClientId(attempts);
      if (scraped && (await isValid(scraped))) {
        clientId = scraped;
        source = "scrape";
      } else if (scraped) {
        attempts.push({ step: "scraped_invalid" });
      }
    } catch (e) {
      attempts.push({ step: "scrape_error", error: e.message });
    }

    if (!clientId) {
      for (const id of FALLBACK_IDS) {
        if (await isValid(id)) {
          clientId = id;
          source = "fallback";
          break;
        }
        attempts.push({ step: "fallback_dead", id: id.slice(0, 6) + "..." });
      }
    }

    if (!clientId) {
      // Semua gagal: tetap kirim ID pertama biar client punya sesuatu, tapi jangan di-cache
      return res.status(200).json({
        success: false,
        client_id: FALLBACK_IDS[0],
        warning: "Tidak ada client_id yang tervalidasi",
        attempts,
      });
    }

    // Cache di edge 15 menit hanya kalau ID sudah tervalidasi
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=600");
    return res.status(200).json({
      success: true,
      client_id: clientId,
      source,
      timestamp: new Date().toISOString(),
      debug: process.env.DEBUG ? attempts : undefined,
    });
  } catch (err) {
    console.error("[get-credentials]", err);
    return res.status(200).json({ success: false, client_id: FALLBACK_IDS[0], error_note: err.message });
  }
}
