import { $, esc, eth, live, renderChrome, loadLaunches, chainBadge, collectionLogo, CONFIG, ROBINHOOD } from "../lib.js";
import { loadActivity, summarize } from "../feed.js";

renderChrome("analytics");

async function render() {
  if (!live) return ($("#totals").innerHTML = `<p class="empty">Contracts not deployed yet.</p>`);
  const launches = await loadLaunches(500);
  const items = await loadActivity(launches);
  const all = summarize(items);
  const inVaults = launches.reduce((t, l) => t + l.vaultBalance, 0n);
  const collections = new Set(launches.map((l) => l.collection.toLowerCase())).size;

  $("#totals").innerHTML = [
    ["Coins launched", launches.length],
    ["Collections fed", collections],
    ["Fees harvested", `${eth(all.harvested, 4)} ETH`],
    ["Sent to vaults", `${eth(all.toVault, 4)} ETH`],
    ["ETH in vaults now", `${eth(inVaults, 4)} ETH`],
    ["NFTs bought", all.bought],
    ["Spent on floors", `${eth(all.spent, 4)} ETH`],
    ["NFTs given away", all.given],
  ].map(([k, v]) => `<div class="kpi"><span>${k}</span><b>${v}</b></div>`).join("");

  const chains = Object.keys(CONFIG.chains).map(Number).map((chainId) => {
    const ls = launches.filter((l) => (l.external ? l.chainId : ROBINHOOD) === chainId);
    const s = summarize(items.filter((i) => ls.includes(i.launch)));
    return { chainId, coins: ls.length, bought: s.bought, spent: s.spent, vault: ls.reduce((t, l) => t + l.vaultBalance, 0n) };
  });
  $("#byChain tbody").innerHTML = chains.map((c) => `<tr><td>${chainBadge(c.chainId)}</td><td>${c.coins}</td><td>${c.bought}</td><td>${eth(c.spent, 4)}</td><td>${eth(c.vault, 4)}</td></tr>`).join("");

  const top = launches.map((l) => ({ l, s: summarize(items.filter((i) => i.launch === l)) }))
    .sort((a, b) => (b.s.harvested > a.s.harvested ? 1 : b.s.harvested < a.s.harvested ? -1 : 0))
    .slice(0, 20);
  $("#top tbody").innerHTML = top.length
    ? top.map(({ l, s }) => `<tr>
        <td><a href="coin?id=${l.id}"><b>$${esc(l.symbol)}</b></a></td>
        <td><span class="collects">${collectionLogo(l.collectionName, l.collectionImage, 20)}${esc(l.collectionName)}</span></td>
        <td>${eth(s.harvested, 5)}</td><td>${s.bought}</td><td>${s.given}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">No coins yet.</td></tr>`;
}

render().catch((e) => ($("#totals").innerHTML = `<p class="empty">Could not load analytics: ${esc(e.shortMessage || e.message)}</p>`));
