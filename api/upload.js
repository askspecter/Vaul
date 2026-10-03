// POST { data: "<base64>" } -> { id, path }. Stores a coin logo in Vercel KV.
// Only raster formats are accepted (no SVG, which could carry scripts), checked by magic bytes.
const crypto = require("crypto");
const { kv } = require("./_kv");

const MAX_BYTES = 512 * 1024;
const PER_HOUR = 30; // uploads per IP per hour

function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length > 6 && buf.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const b64 = typeof req.body === "object" && req.body ? req.body.data : null;
    if (typeof b64 !== "string" || !b64) return res.status(400).json({ error: "Missing image data" });
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) return res.status(400).json({ error: "Empty image" });
    if (buf.length > MAX_BYTES) return res.status(413).json({ error: "Image too large (max 512 KB)" });
    const type = sniff(buf);
    if (!type) return res.status(415).json({ error: "Use a PNG, JPG, WEBP or GIF image" });

    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const rateKey = `rl:upload:${ip}`;
    const count = await kv("INCR", rateKey);
    if (count === 1) await kv("EXPIRE", rateKey, 3600);
    if (count > PER_HOUR) return res.status(429).json({ error: "Too many uploads, try again later" });

    // Content-addressed: the same image always gets the same id.
    const id = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32);
    await kv("SET", `img:${id}`, JSON.stringify({ type, data: b64 }));

    return res.status(200).json({ id, path: `/api/img?id=${id}` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
