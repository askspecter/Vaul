import { $, live, toast, renderChrome, loadLaunches, coinCard, eth } from "../lib.js";

renderChrome("explore");
let coins = [];
let sort = "new";

function render() {
  const q = $("#search").value.trim().toLowerCase();
  const rows = coins
    .filter((c) => !q || [c.name, c.symbol, c.collectionName].some((s) => s.toLowerCase().includes(q)))
    .sort((a, b) =>
      sort === "vault" ? (b.vaultBalance > a.vaultBalance ? 1 : -1) : sort === "nfts" ? b.nfts - a.nfts : b.id - a.id);
  $("#grid").innerHTML = rows.length ? rows.map(coinCard).join("") : `<p class="empty">${coins.length ? "No matches." : "No coins launched yet."}</p>`;
}

function renderKpis() {
  const vault = coins.reduce((s, c) => s + c.vaultBalance, 0n);
  const nfts = coins.reduce((s, c) => s + c.nfts, 0);
  const pending = coins.reduce((s, c) => s + c.pending, 0n);
  $("#kpis").innerHTML = [
    ["Coins", coins.length],
    ["ETH in vaults", eth(vault)],
    ["NFTs held", nfts],
    ["Fees awaiting harvest", `${eth(pending)} ETH`],
  ].map(([k, v]) => `<div class="kpi"><span>${k}</span><b>${v}</b></div>`).join("");
}

$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
  sort = btn.dataset.sort;
  render();
});
$("#search").addEventListener("input", render);

if (!live) {
  $("#grid").innerHTML = `<p class="empty">Launches appear here once the contracts are deployed.</p>`;
  renderKpis();
} else {
  loadLaunches(500)
    .then((c) => { coins = c; renderKpis(); render(); })
    .catch((e) => toast("Could not load launches: " + (e.shortMessage || e.message)));
}
