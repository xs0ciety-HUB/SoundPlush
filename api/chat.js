// api/chat.js
let kv = null;
try {
  const mod = await import("@vercel/kv");
  kv = mod.kv;
} catch {
  kv = null;
}

const memStore = { messages: [] };
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
          .map(m => { try { return typeof m === "string" ? JSON.parse(m) : m; } catch { return null; } })
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
      const { name, text, avatar, bio, image, file, replyTo } = body || {};

      // Validasi: harus ada text atau image atau file
      if (!name || (!text && !image && !file)) {
        return res.status(400).json({ success: false, error: "Pesan kosong" });
      }

      const cleanName = String(name).slice(0, 24).trim();
      const cleanText = text ? String(text).slice(0, 500).trim() : "";
      const cleanBio = bio ? String(bio).slice(0, 100).trim() : null;
      const cleanAvatar = avatar && typeof avatar === "string" && avatar.length < 30000
        ? avatar : null;

      // Batasi ukuran attachment biar ga overload KV (max 500KB)
      const cleanImage = image && typeof image === "string" && image.length < 700000
        ? image : null;
      const cleanFile = file && typeof file === "object" && file.data && file.data.length < 700000
        ? {
            name: String(file.name || "file").slice(0, 100),
            type: String(file.type || "").slice(0, 60),
            size: Number(file.size) || 0,
            data: file.data,
          }
        : null;

      // Reply metadata (ringan)
      const cleanReply = replyTo && typeof replyTo === "object"
        ? {
            id: String(replyTo.id || "").slice(0, 30),
            name: String(replyTo.name || "").slice(0, 24),
            text: String(replyTo.text || "").slice(0, 100),
            hasImage: !!replyTo.image,
            hasFile: !!replyTo.file,
          }
        : null;

      if (!cleanName || (!cleanText && !cleanImage && !cleanFile)) {
        return res.status(400).json({ success: false, error: "Isi pesan kosong" });
      }

      const msg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: cleanName,
        text: cleanText,
        avatar: cleanAvatar,
        bio: cleanBio,
        image: cleanImage,
        file: cleanFile,
        replyTo: cleanReply,
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
