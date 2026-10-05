import {
  $, esc, live, toast, renderChrome, collectionMeta, collectionKey, listedCollections, loadLaunches, coinCard, eth,
  externalLive, chainIcon, chainName, loadGrails,
} from "../lib.js";

renderChrome("cards");

const launchHref = (c) => `launch?collection=${encodeURIComponent(c.key)}`;

async function render() {
  const meta = await collectionMeta();
  const grails = meta.filter((c) => c.kind === "grail").map((c) => ({ ...c, key: collectionKey(c.chainId, c.address, c.tag) }));
  const cats = meta
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

  renderGrails(grails, isOpen, launches);

  const keys = new Set([...cats, ...grails].map((c) => c.key.toLowerCase()));
  const mine = launches.filter((l) => keys.has(l.collection.toLowerCase()));
  $("#cvCoins").innerHTML = mine.length
    ? mine.map(coinCard).join("")
    : `<p class="empty">No card coins yet. The first one starts the first vault.</p>`;
}

/** Grail Mode tiles: each grail's spec and the live price of the cheapest card that meets it. */
async function renderGrails(grails, isOpen, launches) {
  const { byTag } = await loadGrails();
  const usd = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  $("#gmGrid").innerHTML = grails.map((g) => {
    const live = byTag.get(g.tag);
    const coins = launches.filter((l) => l.collection.toLowerCase() === g.key.toLowerCase()).length;
    const img = live?.image || g.image;
    return `<article class="gm-card">
      <div class="gm-art"><img src="${esc(img)}" alt="" loading="lazy" onerror="this.src='${esc(g.image)}'" /></div>
      <div class="gm-body">
        <span class="gm-tag">${chainIcon(g.chainId)} GRAIL · ${esc(g.source)}</span>
        <h3>${esc(g.name)}</h3>
        <p>${esc(g.spec || "")}</p>
        <div class="gm-price">${live?.priceUsd != null
          ? `<span>Cheapest listed now</span><b>${usd(live.priceUsd)}</b><small>≈ ${live.priceEth.toFixed(3)} ETH</small>`
          : `<span>Not listed right now</span><b>—</b><small>The vault waits for one</small>`}</div>
        ${live?.card ? `<p class="gm-card-name" title="${esc(live.card)}">${esc(live.card)}</p>` : ""}
        ${isOpen(g)
          ? `<a class="btn btn-dark wide" href="launch?collection=${encodeURIComponent(g.key)}">Launch a grail coin</a>`
          : `<span class="btn btn-ghost wide is-off">Opening soon</span>`}
        ${coins ? `<small class="gm-coins">${coins} coin${coins === 1 ? "" : "s"} saving for it</small>` : ""}
      </div>
    </article>`;
  }).join("") || `<p class="empty">No grails yet.</p>`;
}

render().catch((e) => {
  console.error(e);
  toast("Could not load Card Vaults: " + (e.shortMessage || e.message));
});
