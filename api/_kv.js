// Minimal Vercel KV (Upstash Redis REST) client. Vercel sets KV_REST_API_URL / KV_REST_API_TOKEN
// when a KV store is connected; newer Upstash integrations use UPSTASH_REDIS_REST_* instead.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kv(...command) {
  if (!URL_ || !TOKEN) throw new Error("KV is not connected to this Vercel project");
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error || `KV error ${res.status}`);
  return json.result;
}

module.exports = { kv };
