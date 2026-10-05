import {
  $, esc, live, toast, renderChrome, collectionMeta, collectionKey, isListed, loadLaunches, coinCard, eth,
  externalLive, chainIcon, chainName, loadGrails, client, CONFIG, ABI, write, walletClient, friendlyError, short,
} from "../lib.js";

renderChrome("cards");

const launchHref = (c) => `launch?collection=${encodeURIComponent(c.key)}`;
const usd = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// The page renders straight from collections.json, then fills in what is slower to fetch, each
// part on its own: grail prices (/api/grails), which categories are listed (a few Registry
// reads) and the coins already launched (the slowest). Nothing waits on anything else.
const state = {
  cats: [], grails: [],
  open: null, // Set of listed keys, null while checking
  launches: null, // null while loading
  prices: null, // Map tag -> live grail price, null while loading
};
const isOpen = (c) => state.open?.has(c.key.toLowerCase());
const coinsFor = (c) => (state.launches || []).filter((l) => l.collection.toLowerCase() === c.key.toLowerCase());

function launchButton(c, label) {
  if (state.open === null) return `<span class="btn btn-ghost wide is-off">Checking…</span>`;
  return isOpen(c)
    ? `<a class="btn btn-dark wide" href="${launchHref(c)}">${label}</a>`
    : `<span class="btn btn-ghost wide is-off">Opening soon</span>`;
}

function drawHero() {
  document.querySelectorAll("#cvCtas [data-cat]").forEach((a) => {
    const c = state.cats.filter((x) => x.name.toLowerCase().startsWith(a.dataset.cat)).sort((x, y) => isOpen(y) - isOpen(x))[0];
    const ok = state.open === null || (c && isOpen(c));
    a.classList.toggle("is-off", !ok);
    if (c && ok) a.href = launchHref(c);
    else a.removeAttribute("href");
  });
  const none = state.open !== null && !state.cats.some(isOpen);
  $("#cvNote").hidden = !none;
  if (none) $("#cvNote").textContent = "Card Vaults are opening soon. Launching unlocks once the categories are listed on-chain.";
}

function drawCategories() {
  const n = (x) => (state.launches ? x : "…");
  $("#cvCats").innerHTML = state.cats.map((c) => {
    const coins = coinsFor(c);
    return `<article class="cv-cat">
      <div class="cv-cat-art"><img src="${esc(c.image)}" alt="" loading="lazy" /></div>
      <div class="cv-cat-body">
        <h3>${esc(c.name)}</h3>
        <p class="cv-src">${chainIcon(c.chainId)}<span>Graded cards from <b>${esc(c.source || "the vault")}</b>, delivered on ${esc(chainName(c.chainId))}.</span></p>
        <dl><div><dt>Coins</dt><dd>${n(coins.length)}</dd></div><div><dt>In vaults</dt><dd>${n(eth(coins.reduce((s, x) => s + x.vaultBalance, 0n), 3))} ETH</dd></div><div><dt>Cards bought</dt><dd>${n(coins.reduce((s, x) => s + x.nfts, 0))}</dd></div></dl>
        ${launchButton(c, `Launch a ${esc(c.name.replace(/ Cards$/, ""))} coin`)}
      </div>
    </article>`;
  }).join("");
}

/** Grail Mode tiles: each grail's spec and the live price of the cheapest card that meets it. */
function drawGrails() {
  $("#gmGrid").innerHTML = state.grails.map((g) => {
    const p = state.prices?.get(g.tag);
    const coins = coinsFor(g).length;
    const price = state.prices === null
      ? `<span>Cheapest listed now</span><b class="gm-wait">…</b><small>checking</small>`
      : p?.priceUsd != null
        ? `<span>Cheapest listed now</span><b>${usd(p.priceUsd)}</b><small>≈ ${p.priceEth.toFixed(3)} ETH</small>`
        : `<span>Not listed right now</span><b>—</b><small>The vault waits for one</small>`;
    return `<article class="gm-card">
      <div class="gm-art"><img src="${esc(p?.image || g.image)}" alt="" loading="lazy" onerror="this.src='${esc(g.image)}'" /></div>
      <div class="gm-body">
        <span class="gm-tag">${chainIcon(g.chainId)} GRAIL · ${esc(g.source)}</span>
        <h3>${esc(g.name)}</h3>
        <p>${esc(g.spec || "")}</p>
        <div class="gm-price">${price}</div>
        ${p?.card ? `<p class="gm-card-name" title="${esc(p.card)}">${esc(p.card)}</p>` : ""}
        ${launchButton(g, "Launch a grail coin")}
        ${coins ? `<small class="gm-coins">${coins} coin${coins === 1 ? "" : "s"} saving for it</small>` : ""}
      </div>
    </article>`;
  }).join("") || `<p class="empty">No grails yet.</p>`;
}

function drawCoins() {
  if (!state.launches) return;
  const keys = new Set([...state.cats, ...state.grails].map((c) => c.key.toLowerCase()));
  const mine = state.launches.filter((l) => keys.has(l.collection.toLowerCase()));
  $("#cvCoins").innerHTML = mine.length
    ? mine.map(coinCard).join("")
    : `<p class="empty">No card coins yet. The first one starts the first vault.</p>`;
}

function draw() { drawHero(); drawCategories(); drawGrails(); drawCoins(); drawSetup(); }

// /cards?setup: the Registry owner lists categories and grails (setCollection) from a phone wallet.
const SETUP = new URLSearchParams(location.search).has("setup");
let setup = null; // { registry, owner }
async function initSetup() {
  if (!SETUP || !live) return;
  const registry = await client.readContract({ address: CONFIG.launcher, abi: ABI.launcher, functionName: "registry" });
  const owner = await client.readContract({ address: registry, abi: ABI.registry, functionName: "owner" });
  setup = { registry, owner };
  $("#cvSetup").hidden = false;
  drawSetup();
  $("#cvSetup").scrollIntoView({ behavior: "smooth", block: "start" });
  $("#cvSetupRows").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-list]");
    if (!b) return;
    b.disabled = true;
    try {
      const wallet = await walletClient();
      if (wallet.account.address.toLowerCase() !== owner.toLowerCase()) throw new Error(`Connect the Registry owner wallet (${short(owner)}).`);
      b.textContent = "Confirm in your wallet…";
      await write({ address: registry, abi: ABI.registry, functionName: "setCollection", args: [b.dataset.list, true] });
      toast("Listed");
      state.open?.add(b.dataset.list.toLowerCase());
      draw();
    } catch (err) {
      console.error(err);
      toast(friendlyError(err));
      b.textContent = "List it";
      b.disabled = false;
    }
  });
}

function drawSetup() {
  if (!setup) return;
  const rows = [...state.grails.map((g) => [g, "Grail"]), ...state.cats.map((c) => [c, "Category"])];
  $("#cvSetupRows").innerHTML = rows.map(([c, kind]) => `
    <div class="cv-setup-row">
      <span><b>${esc(c.name)}</b> <small class="muted">· ${kind} · ${esc(c.source || "")}</small><small class="mono">key ${short(c.key)}</small></span>
      ${state.open === null ? `<span class="muted small">Checking…</span>` : isOpen(c) ? `<span class="pill">Listed ✓</span>` : `<button class="btn btn-dark btn-sm" data-list="${c.key}">List it</button>`}
    </div>`).join("") + `<p class="hint">Registry owner: <span class="mono">${short(setup.owner)}</span></p>`;
}

async function render() {
  const meta = await collectionMeta();
  const withKey = (c) => ({ ...c, key: collectionKey(c.chainId, c.address, c.tag) });
  state.grails = meta.filter((c) => c.kind === "grail").map(withKey);
  // Collector Crypt first: it is where most graded Pokémon and One Piece cards trade.
  state.cats = meta.filter((c) => c.kind === "cards").map(withKey)
    .sort((a, b) => (b.market === "collectorcrypt") - (a.market === "collectorcrypt"));
  draw();

  loadGrails().then(({ byTag }) => { state.prices = byTag; drawGrails(); });
  initSetup().catch((e) => console.error(e));
  if (!live || !externalLive) {
    state.open = new Set(); state.launches = [];
    return draw();
  }
  const all = [...state.cats, ...state.grails];
  isListed(all.map((c) => c.key))
    .then((flags) => { state.open = new Set(all.filter((_, i) => flags[i]).map((c) => c.key.toLowerCase())); })
    .catch(() => { state.open = new Set(); })
    .finally(draw);
  loadLaunches(500).catch(() => []).then((l) => { state.launches = l; draw(); });
}

render().catch((e) => {
  console.error(e);
  toast("Could not load Card Vaults: " + (e.shortMessage || e.message));
});
