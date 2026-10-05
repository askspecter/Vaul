import {
  $, esc, live, toast, renderChrome, collectionMeta, collectionKey, listedCollections, loadLaunches, coinCard, eth,
  externalLive, chainIcon, chainName,
} from "../lib.js";

renderChrome("cards");

const launchHref = (c) => `launch?collection=${encodeURIComponent(c.key)}`;

async function render() {
  const cats = (await collectionMeta())
    .filter((c) => c.kind === "cards")
    .map((c) => ({ ...c, key: collectionKey(c.chainId, c.address, c.tag) }))
    // Collector Crypt first: it is where most graded Pokémon and One Piece cards trade.
    .sort((a, b) => (b.market === "collectorcrypt") - (a.market === "collectorcrypt"));
  const [listed, launches] = live && externalLive
    ? await Promise.all([listedCollections(), loadLaunches(500).catch(() => [])])
    : [[], []];
  const open = new Set(listed.map((k) => k.toLowerCase()));
  const isOpen = (c) => open.has(c.key.toLowerCase());

  // Hero buttons go straight to the launch wizard with the category picked.
  document.querySelectorAll("#cvCtas [data-cat]").forEach((a) => {
    const c = cats.filter((x) => x.name.toLowerCase().startsWith(a.dataset.cat)).sort((x, y) => isOpen(y) - isOpen(x))[0];
    if (c && isOpen(c)) a.href = launchHref(c);
    else {
      a.removeAttribute("href");
      a.classList.add("is-off");
    }
  });
  if (!cats.some(isOpen)) {
    $("#cvNote").hidden = false;
    $("#cvNote").textContent = "Card Vaults are opening soon. Launching unlocks once the categories are listed on-chain.";
  }

  $("#cvCats").innerHTML = cats.map((c) => {
    const coins = launches.filter((l) => l.collection.toLowerCase() === c.key.toLowerCase());
    const vault = coins.reduce((s, x) => s + x.vaultBalance, 0n);
    const cards = coins.reduce((s, x) => s + x.nfts, 0);
    return `<article class="cv-cat">
      <div class="cv-cat-art"><img src="${esc(c.image)}" alt="" loading="lazy" /></div>
      <div class="cv-cat-body">
        <h3>${esc(c.name)}</h3>
        <p class="cv-src">${chainIcon(c.chainId)}<span>Graded cards from <b>${esc(c.source || "the vault")}</b>, delivered on ${esc(chainName(c.chainId))}.</span></p>
        <dl><div><dt>Coins</dt><dd>${coins.length}</dd></div><div><dt>In vaults</dt><dd>${eth(vault, 3)} ETH</dd></div><div><dt>Cards bought</dt><dd>${cards}</dd></div></dl>
        ${isOpen(c)
          ? `<a class="btn btn-dark wide" href="${launchHref(c)}">Launch a ${esc(c.name.replace(/ Cards$/, ""))} coin</a>`
          : `<span class="btn btn-ghost wide is-off">Opening soon</span>`}
      </div>
    </article>`;
  }).join("");

  const keys = new Set(cats.map((c) => c.key.toLowerCase()));
  const mine = launches.filter((l) => keys.has(l.collection.toLowerCase()));
  $("#cvCoins").innerHTML = mine.length
    ? mine.map(coinCard).join("")
    : `<p class="empty">No card coins yet. The first one starts the first vault.</p>`;
}

render().catch((e) => {
  console.error(e);
  toast("Could not load Card Vaults: " + (e.shortMessage || e.message));
});
