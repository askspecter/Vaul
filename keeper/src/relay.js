// Minimal Relay (relay.link) client: quotes and executes bridges/swaps out of Robinhood Chain.
const BASE = "https://api.relay.link";
export const NATIVE_EVM = "0x0000000000000000000000000000000000000000";
export const NATIVE_SOL = "11111111111111111111111111111111";
export const SOLANA_CHAIN_ID = 792703809;

async function post(path, body) {
  const res = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Relay ${res.status}: ${json.message || JSON.stringify(json).slice(0, 200)}`);
  return json;
}

/**
 * Quote moving native ETH from `originChainId` to the native currency of `destinationChainId`.
 * EXACT_INPUT: `amount` is wei spent. EXACT_OUTPUT: `amount` is the destination amount wanted.
 */
export async function quote({ originChainId, destinationChainId, user, recipient, amount, tradeType }) {
  const q = await post("/quote", {
    user, recipient, originChainId, destinationChainId, tradeType,
    originCurrency: NATIVE_EVM,
    destinationCurrency: destinationChainId === SOLANA_CHAIN_ID ? NATIVE_SOL : NATIVE_EVM,
    amount: amount.toString(),
  });
  return {
    raw: q,
    amountIn: BigInt(q.details.currencyIn.amount),
    amountOut: BigInt(q.details.currencyOut.amount),
    requestId: q.steps?.[0]?.requestId,
  };
}

/** Sends every transaction step of a quote from `wallet` and waits for Relay to fill it. */
export async function execute(q, { wallet, publicClient, log }) {
  for (const step of q.raw.steps) {
    if (step.kind !== "transaction") throw new Error(`unsupported Relay step ${step.kind}`);
    for (const item of step.items) {
      const d = item.data;
      const hash = await wallet.sendTransaction({
        to: d.to, data: d.data, value: BigInt(d.value || 0),
        ...(d.gas ? { gas: BigInt(d.gas) } : {}),
      });
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error(`Relay deposit reverted: ${hash}`);
      log(`bridge deposit ✓ ${hash}`);
    }
  }
  // Poll until the destination side is filled (usually seconds).
  for (let i = 0; i < 120; i++) {
    const res = await fetch(`${BASE}/intents/status/v2?requestId=${q.requestId}`).then((r) => r.json()).catch(() => ({}));
    if (res.status === "success") return res;
    if (res.status === "failure" || res.status === "refund") throw new Error(`Relay ${res.status} for ${q.requestId}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Relay request ${q.requestId} not filled after 10 minutes`);
}
