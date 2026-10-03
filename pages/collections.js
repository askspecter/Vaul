import { $, esc, live, toast, renderChrome, listedCollectionsDetailed, loadLaunches, addrLink, eth, chainBadge, ROBINHOOD, CONFIG, collectionLogo } from "../lib.js";

renderChrome("collections");

async function render() {
  const body = $("#table tbody");
  if (!live) return (body.innerHTML = `<tr><td colspan="4" class="empty">Contracts not deployed yet.</td></tr>`);
  const [listed, launches] = await Promise.all([listedCollectionsDetailed(), loadLaunches(500)]);
  if (!listed.length) return (body.innerHTML = `<tr><td colspan="4" class="empty">No collections listed yet.</td></tr>`);
  const rows = listed.map((c) => {
    const coins = launches.filter((l) => l.collection.toLowerCase() === c.key.toLowerCase());
    return { ...c, coins: coins.length, eth: coins.reduce((s, x) => s + x.vaultBalance, 0n), nfts: coins.reduce((s, x) => s + x.nfts, 0) };
  });
  rows.sort((a, b) => (b.eth > a.eth ? 1 : b.eth < a.eth ? -1 : b.coins - a.coins));
  const cell = (r) => {
    const chain = CONFIG.chains[r.chainId];
    const logo = collectionLogo(r.name, r.image, 28);
    if (r.chainId === ROBINHOOD) return `<span class="collects">${logo}${addrLink(r.address, r.name)} ${chainBadge(r.chainId)}</span>`;
    return `<span class="collects">${logo}<a class="mono" href="${chain.explorer}/address/${r.address}" target="_blank" rel="noopener">${esc(r.name)}</a> ${chainBadge(r.chainId)}</span>`;
  };
  const q = $("#q");
  q.value = new URLSearchParams(location.search).get("q") || "";
  let chain = "all";
  const chains = [...new Set(rows.map((r) => r.chainId))];
  $("#chainChips").innerHTML = [`<button class="chip active" data-c="all">All<small>${rows.length}</small></button>`,
    ...chains.map((c) => `<button class="chip" data-c="${c}">${chainBadge(c)}<small>${rows.filter((r) => r.chainId === c).length}</small></button>`)].join("");
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const shown = rows.filter((r) => (chain === "all" || String(r.chainId) === chain)
      && (!term || r.name.toLowerCase().includes(term) || String(r.address).toLowerCase().includes(term) || (r.slug || "").includes(term)));
    body.innerHTML = shown.length
      ? shown.map((r) => `<tr><td>${cell(r)}</td><td>${r.coins ? r.coins : `<a class="btn btn-ghost btn-sm" href="launch?collection=${encodeURIComponent(r.key)}">Launch a coin</a>`}</td><td>${eth(r.eth)}</td><td>${r.nfts}</td></tr>`).join("")
      : `<tr><td colspan="4" class="empty">No collection matches “${esc(q.value)}”.</td></tr>`;
  };
  q.addEventListener("input", draw);
  $("#chainChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-c]");
    if (!b) return;
    chain = b.dataset.c;
    document.querySelectorAll("#chainChips .chip").forEach((x) => x.classList.toggle("active", x === b));
    draw();
  });
  draw();
}

render().catch((e) => toast("Could not load collections: " + (e.shortMessage || e.message)));
