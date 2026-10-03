// GET /api/img?id=<id> -> the stored image bytes.
const { kv } = require("./_kv");

module.exports = async (req, res) => {
  const id = String(req.query.id || "");
  if (!/^[0-9a-f]{32}$/.test(id)) return res.status(400).send("Bad id");
  try {
    const raw = await kv("GET", `img:${id}`);
    if (!raw) return res.status(404).send("Not found");
    const { type, data } = JSON.parse(raw);
    res.setHeader("Content-Type", type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).send(Buffer.from(data, "base64"));
  } catch (e) {
    return res.status(500).send(e.message);
  }
};
