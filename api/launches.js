// GET  /api/launches         -> { ids: ["12", "e3", ...] } newest first
// POST { hash: "0x..." }     -> { id }
//
// Vaul's own list of coins. Only coins launched through this site are shown, so the launcher
// contracts' full history stays off the site. A launch is recorded by posting its transaction
// hash; we read the receipt from the chain and only accept a successful tx that emitted a
// Launched event from one of the launcher contracts, so nobody can add arbitrary ids.
const { kv } = require("./_kv");

const { contracts } = require("./_contracts");
const { rpcUrl: RPC_URL, launcher: LAUNCHER, externalLauncher: EXTERNAL_LAUNCHER } = contracts();

// Sorted set (member = launch id, score = time recorded in ms), one per Launcher so ids from an
// earlier deployment never mix with the current one.
const KEY = `vaul:launches:${LAUNCHER.toLowerCase()}`;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const PER_HOUR = 30; // posts per IP per hour

let viem;
async function publicClient() {
  viem ||= await import("viem");
  return viem.createPublicClient({ transport: viem.http(RPC_URL) });
}

async function launchIdFromTx(hash) {
  const client = await publicClient();
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction did not succeed");
  const abi = viem.parseAbi([
    "event Launched(uint256 indexed id, address indexed creator, address indexed collection, address token, address curve, address router, address vault, uint8 policy)",
    "event Launched(uint256 indexed id, address indexed creator, address indexed collection, uint64 chainId, address token, address curve, address router, address vault, uint8 policy)",
  ]);
  for (const [address, prefix] of [[LAUNCHER, ""], [EXTERNAL_LAUNCHER, "e"]]) {
    const logs = receipt.logs.filter((l) => l.address.toLowerCase() === address.toLowerCase());
    const [ev] = viem.parseEventLogs({ abi, logs, eventName: "Launched", strict: false });
    if (ev) return `${prefix}${ev.args.id}`;
  }
  throw new Error("No launch found in this transaction");
}

module.exports = async (req, res) => {
  try {
    if (!LAUNCHER) {
      if (req.method === "GET") return res.status(200).json({ ids: [] });
      return res.status(503).json({ error: "Contracts are not configured yet" });
    }
    if (req.method === "GET") {
      const ids = (await kv("ZRANGE", KEY, 0, -1, "REV")) || [];
      res.setHeader("Cache-Control", "public, max-age=10, stale-while-revalidate=60");
      return res.status(200).json({ ids });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const hash = String(body.hash || "");
    if (!HASH_RE.test(hash)) return res.status(400).json({ error: "Bad transaction hash" });

    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const rateKey = `rate:launches:${ip}`;
    const count = await kv("INCR", rateKey);
    if (count === 1) await kv("EXPIRE", rateKey, 3600);
    if (count > PER_HOUR) return res.status(429).json({ error: "Too many requests, try again later" });

    const id = await launchIdFromTx(hash);
    await kv("ZADD", KEY, "NX", Date.now(), id);
    return res.status(200).json({ id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.shortMessage || err.message || "Server error" });
  }
};
