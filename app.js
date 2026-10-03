import {
  live, $, esc, toast, renderChrome, loadLaunches, coinCard, formatEther, collectionMeta, collectionKey, chainBadge, CONFIG,
} from "./lib.js";

const RULES = [
  ["PAIRING", "locked at launch"],
  ["FEE SPLIT", "80 vault / 20 protocol"],
  ["SPEND LIMIT", "price ≤ posted ceiling"],
  ["CEILING TTL", "expires after 1 hour"],
  ["MARKET", "Seaport 1.6 only"],
  ["WITHDRAW", "not implemented, by design"],
  ["HARVEST", "callable by anyone"],
  ["DRAW", "future chain block hash"],
  ["POLICY", "raffle, hold or burn"],
  ["ADMIN KEYS", "none on the vault"],
];

const SAMPLE = [
  { name: "Floor Muncher", symbol: "MUNCH", collectionName: "Pixel Pals", vaultBalance: 12_400000000000000000n, nfts: 31, policy: "Raffle" },
  { name: "Ape Sweeper", symbol: "SWEEP", collectionName: "Jungle Club", vaultBalance: 48_100000000000000000n, nfts: 9, policy: "Hold" },
  { name: "Punk Bucket", symbol: "BUCKET", collectionName: "Block Punks", vaultBalance: 22_700000000000000000n, nfts: 4, policy: "Burn" },
  { name: "Cat Collector", symbol: "MEOW", collectionName: "Night Cats", vaultBalance: 3_900000000000000000n, nfts: 57, policy: "Raffle" },
];

let coins = live ? [] : SAMPLE;
let currentSort = "new";

renderChrome("index");

function renderRules() {
  const html = RULES.map(([k, v]) => `<div class="rule"><small>${k}</small><span>${v}</span></div>`).join("");
  $("#track").innerHTML = html + html; // duplicated for a seamless loop
}

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
const usdFmt = (n) => (n >= 1000 ? `$${fmt(n / 1000, 1)}k` : `$${fmt(n, 0)}`);

async function loadFloors() {
  const res = await fetch("data/floors.json");
  if (!res.ok) throw new Error("no floor data");
  return res.json();
}

/** 3D stage in the hero: the three most valuable collections by floor. */
function renderStage(top, total, chains) {
  if (top.length < 3) return;
  const [first, second, third] = top;
  $("#stage").innerHTML = `
    <div class="card3d c-left"><img src="${esc(second.image)}" alt="" /></div>
    <div class="card3d c-right"><img src="${esc(third.image)}" alt="" /></div>
    <div class="card3d c-mid"><span class="holo"></span><img src="${esc(first.image)}" alt="" />
      <span class="c-label"><span class="c-name">${esc(first.name)}</span><b>${fmt(first.floor)} ${esc(first.symbol)}</b></span></div>
    <div class="stage-floor"></div>
    <div class="tag"><span class="dot"></span>Collecting from <b>${total} collections</b> on ${chains} chains</div>`;
}

/** Horizontally scrollable profiles of the collections with the highest floors. */
function renderRail(items) {
  $("#rail").innerHTML = items.map((c, i) => {
    let key = "";
    try { key = collectionKey(c.chainId, c.address); } catch { /* unknown chain */ }
    const os = CONFIG.chains[c.chainId]?.opensea;
    return `<article class="profile">
      <div class="p-img"><img src="${esc(c.image || "")}" alt="" loading="lazy" /><span class="p-rank">#${i + 1}</span>${chainBadge(c.chainId)}</div>
      <div class="p-body">
        <h3>${esc(c.name)}</h3>
        <div class="p-floor"><b>${fmt(c.floor, c.floor < 1 ? 3 : 2)} ${esc(c.symbol)}</b>${c.floorUsd ? `<span>≈ ${usdFmt(c.floorUsd)}</span>` : ""}</div>
        <dl>
          <div><dt>Owners</dt><dd>${c.owners ? fmt(c.owners, 0) : "—"}</dd></div>
          <div><dt>7d volume</dt><dd>${fmt(c.volume7d, 1)} ${esc(c.symbol)}</dd></div>
          <div><dt>7d sales</dt><dd>${fmt(c.sales7d, 0)}</dd></div>
        </dl>
        <div class="p-actions">
          ${key ? `<a class="btn btn-dark" href="launch?collection=${key}">Launch a coin</a>` : ""}
          ${os && c.slug ? `<a class="btn btn-ghost" href="https://opensea.io/collection/${esc(c.slug)}" target="_blank" rel="noopener">OpenSea ↗</a>` : ""}
        </div>
      </div>
    </article>`;
  }).join("");
}

async function renderFloors() {
  const [data, meta] = await Promise.all([loadFloors(), collectionMeta()]);
  const items = data.items.filter((c) => c.image && c.floorUsd);
  const chains = new Set(meta.map((m) => m.chainId)).size;
  renderStage(items.slice(0, 3), meta.length, chains);
  renderRail(items.slice(0, 20));
  const when = new Date(data.updatedAt);
  $("#floorsNote").textContent = `The most valuable collections a coin can collect. Floors from OpenSea, updated ${when.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.`;
}

$("#top").addEventListener("click", (e) => {
  const b = e.target.closest(".rail-btn");
  if (!b) return;
  const rail = $("#rail");
  rail.scrollBy({ left: Number(b.dataset.dir) * rail.clientWidth * 0.85, behavior: "smooth" });
});

renderRules();
renderFloors().catch(() => ($("#rail").innerHTML = `<p class="empty">Floor prices are not available right now.</p>`));
if (location.hash === "#launch") location.replace("launch");
refresh().catch((e) => toast("Could not load launches: " + (e.shortMessage || e.message)));
