import {
  live, $, esc, toast, renderChrome, loadLaunches, coinCard, formatEther, collectionMeta, chainIcon, hd,
  client, ABI, CONFIG,
} from "./lib.js";
import { geckoPool, geckoPage, geckoEmbed, ponsPage } from "./feed.js";

let coins = [];
let currentSort = "new";

renderChrome("index");

function renderGrid() {
  const sorted = [...coins].sort((a, b) =>
    currentSort === "vault" ? (b.vaultBalance > a.vaultBalance ? 1 : -1)
      : currentSort === "nfts" ? b.nfts - a.nfts
      : 0 // already newest first
  );
  $("#grid").innerHTML = sorted.length
    ? sorted.slice(0, 8).map(coinCard).join("")
    : `<p class="empty">No coins launched yet. Be the first.</p>`;
}

function countUp(el, to, dec = 0) {
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / 900);
    el.textContent = (to * p).toFixed(dec);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderStats() {
  countUp($("#statCoins"), coins.length);
  countUp($("#statNfts"), coins.reduce((s, c) => s + c.nfts, 0));
  countUp($("#statVault"), coins.reduce((s, c) => s + Number(formatEther(c.vaultBalance)), 0), 1);
}

$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
  currentSort = btn.dataset.sort;
  renderGrid();
});

async function refresh() {
  if (live) coins = await loadLaunches(24);
  renderGrid();
  renderStats();
}

const fmt = (n, dp = 2) => Number(n).toLocaleString(undefined, { maximumFractionDigits: dp });

async function loadFloors() {
  const res = await fetch("data/floors.json");
  if (!res.ok) throw new Error("no floor data");
  return res.json();
}

/** Hero stage: the collection with the highest floor (in USD) on each chain, fanned out. */
function renderStage(items, total) {
  const best = new Map();
  for (const c of items) if (!best.has(c.chainId) || c.floorUsd > best.get(c.chainId).floorUsd) best.set(c.chainId, c);
  const top = [...best.values()].sort((x, y) => y.floorUsd - x.floorUsd).slice(0, 5);
  if (top.length < 3) return;
  // Highest in the middle, then alternating left/right outwards.
  const slots = ["mid", "l1", "r1", "l2", "r2"];
  const card = (c, slot) => `
    <div class="card3d c-${slot}">
      ${slot === "mid" ? '<span class="holo"></span>' : ""}
      <img src="${esc(hd(c.image, slot === "mid" ? 1000 : 600))}" alt="${esc(c.name)}" />
      <span class="c-label">
        <span class="c-name">${chainIcon(c.chainId)}<span>${esc(c.name)}</span></span>
        <b>${fmt(c.floor, c.floor < 1 ? 3 : 2)} ${esc(c.symbol)}</b>
      </span>
    </div>`;
  $("#stage").innerHTML = top.map((c, i) => card(c, slots[i])).join("") + `
    <div class="tag"><span class="dot"></span>Top floor on each chain · <b>${total} collections</b> to collect</div>`;
}

async function renderFloors() {
  const [data, meta] = await Promise.all([loadFloors(), collectionMeta()]);
  renderStage(data.items.filter((c) => c.image && c.floorUsd), meta.length);
}

renderFloors().catch((err) => console.error(err));
if (location.hash === "#launch") location.replace("launch");
refresh().catch((e) => toast("Could not load launches: " + (e.shortMessage || e.message)));

/** Vaul's own token (CONFIG.officialToken): contract, live burn, Pons link and chart. */
async function renderOfficial() {
  const t = CONFIG.officialToken;
  if (!t?.address) return;
  const addr = t.address;
  $("#official").hidden = false;
  $("#otCa").textContent = addr;
  $("#otBuy").href = ponsPage(addr);
  $("#otExplorer").href = `${CONFIG.explorer}/token/${addr}`;
  $("#otCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(addr); toast("Copied"); } catch { toast(addr); }
  });
  const read = (fn, args) => client.readContract({ address: addr, abi: ABI.erc20, functionName: fn, args });
  const [supply, burned, logo] = await Promise.all([
    read("totalSupply").catch(() => null),
    read("balanceOf", ["0x000000000000000000000000000000000000dEaD"]).catch(() => null),
    read("logo").catch(() => ""),
  ]);
  const n = (wei) => Number(formatEther(wei));
  if (supply) $("#otSupply").textContent = n(supply).toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (supply && burned !== null) {
    const pct = (n(burned) / n(supply)) * 100;
    $("#otBurn").innerHTML = `${n(burned).toLocaleString(undefined, { maximumFractionDigits: 0 })} <small>${pct.toFixed(2)}%</small>`;
  }
  const img = String(logo || "").replace(/^ipfs:\/\/(ipfs\/)?/, "https://ipfs.io/ipfs/");
  if (/^https:\/\//.test(img)) {
    const el = $("#otLogo");
    el.onerror = () => { el.onerror = null; el.src = "assets/brand/vaul-512.png"; };
    el.src = img;
  }
  const pool = await geckoPool(addr, "");
  if (pool) {
    $("#otChart").href = geckoPage(pool); $("#otChart").hidden = false;
    $("#otChartFrame").src = geckoEmbed(pool); $("#otChartWrap").hidden = false;
  }
}
renderOfficial().catch((e) => console.error(e));

/** $VAUL Sweep Hook (Uniswap v4): what its swaps have burned and swept so far, once deployed. */
async function renderHook() {
  const plan = await fetch("assets/sweep-hook.json").then((r) => r.json());
  const code = await client.getCode({ address: plan.hook }).catch(() => null);
  if (!code || code === "0x") return;
  const abi = [
    { type: "function", name: "totalBurned", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { type: "function", name: "totalSwept", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  ];
  const [burned, swept] = await Promise.all(["totalBurned", "totalSwept"].map((fn) => client.readContract({ address: plan.hook, abi, functionName: fn })));
  const n = (wei, dp) => Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: dp });
  $("#otHook").innerHTML = `<span class="ot-hook-k">Sweep Hook · Uniswap v4</span>
    <span>Every buy burns 1%, every sell sweeps 1% into a card vault for holders.</span>
    <b>${n(burned, 0)} $VAUL burned by swaps</b><b>${n(swept, 4)} ETH swept to the vault</b>
    <a href="${CONFIG.explorer}/address/${plan.hook}" target="_blank" rel="noopener">Hook ↗</a>`;
  $("#otHook").hidden = false;
}
renderHook().catch((e) => console.error(e));
