// POST /api/rpc — read-only JSON-RPC relay to Robinhood Chain, for visitors whose network blocks
// or throttles the public RPC host. The site uses it only as a fallback (lib.js). Accepts single
// or batched requests; only read methods are forwarded.
const { contracts } = require("./_contracts");

const READ = new Set([
  "eth_chainId", "eth_blockNumber", "eth_call", "eth_getCode", "eth_getBalance", "eth_getLogs",
  "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getTransactionByHash", "eth_getTransactionReceipt",
  "eth_getTransactionCount", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
  "eth_getStorageAt", "net_version",
]);
const MAX_BATCH = 100;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "null") : req.body;
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > MAX_BATCH || calls.some((c) => !c || !READ.has(c.method))) {
    return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Only read methods are relayed" } });
  }
  try {
    const upstream = await fetch(contracts().rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    res.setHeader("content-type", "application/json");
    return res.status(upstream.status).send(text);
  } catch (err) {
    console.error(err);
    return res.status(502).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Upstream RPC unreachable" } });
  }
};
