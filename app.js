import {
  live, $, esc, toast, renderChrome, loadLaunches, coinCard, formatEther, collectionMeta, chainIcon, hd,
} from "./lib.js";

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
