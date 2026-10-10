// api/chat.js
let kv = null;
try {
  const mod = await import("@vercel/kv");
  kv = mod.kv;
} catch {
  kv = null;
}

const memStore = { messages: [] };

// Prefix unik biar ga bentrok sama project lain di database yang sama
const KEY = "soundpulse:chat:messages";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();

  const useKV = kv && process.env.KV_REST_API_URL;

  try {
    // ============ GET ============
    if (req.method === "GET") {
      let messages = [];
      if (useKV) {
        const raw = await kv.lrange(KEY, 0, 99);
        messages = raw
          .map(m => {
            try { return typeof m === "string" ? JSON.parse(m) : m; }
            catch { return null; }
          })
          .filter(Boolean);
      } else {
        messages = [...memStore.messages].slice(-100);
      }
      return res.status(200).json({
        success: true,
        messages: messages.reverse(),
        storage: useKV ? "kv" : "memory",
      });
    }

    // ============ POST ============
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { name, text, avatar, bio } = body || {};

      if (!name || !text) {
        return res.status(400).json({ success: false, error: "name dan text wajib" });
      }

      const cleanName = String(name).slice(0, 24).trim();
      const cleanText = String(text).slice(0, 500).trim();
      const cleanBio = bio ? String(bio).slice(0, 100).trim() : null;
      const cleanAvatar = avatar && typeof avatar === "string" && avatar.length < 30000
        ? avatar : null;

      if (!cleanName || !cleanText) {
        return res.status(400).json({ success: false, error: "Isi pesan kosong" });
      }

      const msg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: cleanName,
        text: cleanText,
        avatar: cleanAvatar,
        bio: cleanBio,
        ts: Date.now(),
      };

      if (useKV) {
        await kv.lpush(KEY, JSON.stringify(msg));
        await kv.ltrim(KEY, 0, 199);
      } else {
        memStore.messages.push(msg);
        if (memStore.messages.length > 200) memStore.messages.shift();
      }

      return res.status(200).json({ success: true, message: msg });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    console.error("[chat]", err);
    return res.status(500).json({ success: false, error: err.message });
  }
      }
