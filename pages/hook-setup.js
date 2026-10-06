// /cards?setup: the owner deploys the $VAUL Sweep Hook from a phone wallet. assets/sweep-hook.json
// (written by contracts/script/SweepHookPlan.s.sol) holds the exact CREATE2 transactions; each
// step is detected on-chain, so the panel always shows what is left to do.
import { $, esc, client, toast, walletClient, friendlyError, short } from "../lib.js";
import { parseAbi } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";

if (new URLSearchParams(location.search).has("setup")) init().catch((e) => console.error(e));

const HOOK = parseAbi([
  "function poolCreated() view returns (bool)",
  "function totalBurned() view returns (uint256)",
  "function totalSwept() view returns (uint256)",
]);
const PM = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "function initialize(PoolKey key, uint160 sqrtPriceX96) returns (int24 tick)",
]);
const PONS_POOL = "0x6bd65d4fea4b7e4137b3106c257bd260dc2addde"; // $VAUL's Pons pool, for the starting price

let plan;
const has = async (a) => ((await client.getCode({ address: a }).catch(() => null)) || "0x") !== "0x";

async function init() {
  plan = await fetch("assets/sweep-hook.json").then((r) => r.json());
  await draw();
  $("#hookSetup").addEventListener("click", onClick);
}

async function state() {
  const [vault, hook] = await Promise.all([has(plan.vault), has(plan.hook)]);
  const pool = hook && await client.readContract({ address: plan.hook, abi: HOOK, functionName: "poolCreated" }).catch(() => false);
  return { vault, hook, pool };
}

async function draw() {
  const s = await state();
  const row = (n, title, detail, done, action, enabled) => `
    <div class="cv-setup-row">
      <span><b>${n}. ${title}</b><small class="mono">${detail}</small></span>
      ${done ? `<span class="pill">Done ✓</span>` : `<button class="btn btn-dark btn-sm" data-step="${action}"${enabled ? "" : " disabled"}>${n === 3 ? "Create pool" : "Deploy"}</button>`}
    </div>`;
  $("#hookSetup").innerHTML = [
    row(1, "Card vault for $VAUL holders", `vault ${short(plan.vault)} · ${esc(plan.vaultTag)}, raffle`, s.vault, "vault", true),
    row(2, "Sweep Hook", `hook ${short(plan.hook)} · ${plan.feeBps / 100}% per swap`, s.hook, "hook", true),
    row(3, "ETH/$VAUL pool with the hook", `Uniswap v4 · ${plan.lpFee / 10_000}% LP fee · priced from the Pons pool`, s.pool, "pool", s.hook),
  ].join("") + (s.pool
    ? `<p class="hint">Pool is live. Add liquidity on Uniswap (v4, ETH/$VAUL, ${plan.lpFee / 10_000}% fee, hook <span class="mono">${plan.hook}</span>).</p>`
    : `<p class="hint">Owner: <span class="mono">${short(plan.owner)}</span></p>`);
}

/** $VAUL per ETH from the Pons pool on GeckoTerminal, as a Uniswap sqrtPriceX96 (ETH is currency0). */
async function startPrice() {
  const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${PONS_POOL}`);
  const ethPerVaul = Number((await res.json()).data.attributes.base_token_price_quote_token);
  if (!(ethPerVaul > 0)) throw new Error("Could not read the $VAUL price");
  const vaulPerEth = 1 / ethPerVaul;
  const priceX192 = (BigInt(Math.round(vaulPerEth * 1e9)) << 192n) / 1_000_000_000n;
  let x = priceX192, y = (x + 1n) / 2n; // integer square root
  while (y < x) { x = y; y = (x + priceX192 / x) / 2n; }
  return { sqrt: x, vaulPerEth };
}

async function onClick(e) {
  const b = e.target.closest("[data-step]");
  if (!b) return;
  b.disabled = true;
  const label = b.textContent;
  try {
    const wallet = await walletClient();
    if (wallet.account.address.toLowerCase() !== plan.owner.toLowerCase()) throw new Error(`Connect the owner wallet (${short(plan.owner)}).`);
    b.textContent = "Confirm in your wallet…";
    let hash;
    if (b.dataset.step === "vault" || b.dataset.step === "hook") {
      const data = b.dataset.step === "vault" ? plan.vaultTx : plan.hookTx;
      const req = { account: wallet.account, to: plan.create2Deployer, data };
      const gas = ((await client.estimateGas(req)) * 13n) / 10n;
      hash = await wallet.sendTransaction({ ...req, gas });
    } else {
      const { sqrt, vaulPerEth } = await startPrice();
      if (!confirm(`Create the pool at ${Math.round(vaulPerEth).toLocaleString()} $VAUL per ETH (the Pons price now)?`)) throw new Error("Cancelled");
      const key = { currency0: "0x0000000000000000000000000000000000000000", currency1: plan.token, fee: plan.lpFee, tickSpacing: plan.tickSpacing, hooks: plan.hook };
      const { request } = await client.simulateContract({ account: wallet.account, address: plan.poolManager, abi: PM, functionName: "initialize", args: [key, sqrt] });
      hash = await wallet.writeContract(request);
    }
    b.textContent = "Waiting…";
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("Transaction failed");
    toast("Done");
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    b.textContent = label;
  } finally {
    await draw();
  }
}
