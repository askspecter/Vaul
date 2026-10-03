// GET  /api/video?launch=<id>  -> { video: "<muse.ai id>" | null }
// POST { launch, video, time, signature } -> { video }
//
// A coin's muse.ai video. Only the wallet that launched the coin can set or remove it: it signs
// videoMessage() (same text as lib.js) and we check the signer against launches(id).creator.
// `launch` is a number for Robinhood coins and "e<n>" for coins collecting on other chains.
const { kv } = require("./_kv");

const { contracts } = require("./_contracts");
const { rpcUrl: RPC_URL, launcher: LAUNCHER, externalLauncher: EXTERNAL_LAUNCHER } = contracts();

const MAX_AGE = 10 * 60; // a signature is good for 10 minutes
const PER_HOUR = 30; // saves per IP per hour
const LAUNCH_RE = /^e?\d{1,9}$/;
const VIDEO_RE = /^[A-Za-z0-9]{4,32}$/;

const videoMessage = (launch, video, time) => `Vaul: set the video for coin ${launch}\nVideo: ${video || "none"}\nTime: ${time}`;

let viem;
async function publicClient() {
  viem ||= await import("viem");
  return viem.createPublicClient({ transport: viem.http(RPC_URL) });
}

async function creatorOf(client, launch) {
  const external = launch.startsWith("e");
  const abi = viem.parseAbi([
    "function launches(uint256) view returns (address token, address curve, address router, address vault, address collection, address creator)",
  ]);
  const [, , , , , creator] = await client.readContract({
    address: external ? EXTERNAL_LAUNCHER : LAUNCHER,
    abi,
    functionName: "launches",
    args: [BigInt(external ? launch.slice(1) : launch)],
  });
  return creator;
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const launch = String(req.query.launch || "");
      if (!LAUNCH_RE.test(launch)) return res.status(400).json({ error: "Bad launch id" });
      const video = await kv("GET", `video:${LAUNCHER.toLowerCase()}:${launch}`);
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
      return res.status(200).json({ video: video || null });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

    const body = typeof req.body === "object" && req.body ? req.body : {};
    const launch = String(body.launch ?? "");
    const video = body.video ? String(body.video) : "";
    const time = Number(body.time);
    const signature = String(body.signature || "");
    if (!LAUNCH_RE.test(launch)) return res.status(400).json({ error: "Bad launch id" });
    if (video && !VIDEO_RE.test(video)) return res.status(400).json({ error: "Bad muse.ai video id" });
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(time) || time > now + 60 || now - time > MAX_AGE) {
      return res.status(400).json({ error: "Signature expired, try again" });
    }
    if (!/^0x[0-9a-fA-F]+$/.test(signature)) return res.status(400).json({ error: "Missing signature" });

    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const rateKey = `rl:video:${ip}`;
    const count = await kv("INCR", rateKey);
    if (count === 1) await kv("EXPIRE", rateKey, 3600);
    if (count > PER_HOUR) return res.status(429).json({ error: "Too many requests, try again later" });

    const client = await publicClient();
    const creator = await creatorOf(client, launch).catch(() => null);
    if (!creator || /^0x0{40}$/i.test(creator)) return res.status(404).json({ error: "Unknown coin" });
    // verifyMessage also accepts smart-contract wallets (ERC-1271 / ERC-6492).
    const ok = await client
      .verifyMessage({ address: creator, message: videoMessage(launch, video, time), signature })
      .catch(() => false);
    if (!ok) return res.status(403).json({ error: "Only the wallet that launched this coin can set its video" });

    if (video) await kv("SET", `video:${LAUNCHER.toLowerCase()}:${launch}`, video);
    else await kv("DEL", `video:${LAUNCHER.toLowerCase()}:${launch}`);
    return res.status(200).json({ video: video || null });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
