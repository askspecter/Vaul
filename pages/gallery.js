import { createPublicClient, http, parseAbi } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";
import {
  $, esc, eth, live, renderChrome, loadLaunches, chainIcon, chainName, chainBadge, collectionLogo, client,
  CONFIG, ROBINHOOD, base58Encode, toHex,
} from "../lib.js";
import { loadActivity } from "../feed.js";

renderChrome("gallery");

const uriAbi = parseAbi(["function tokenURI(uint256) view returns (string)"]);
const clients = { [ROBINHOOD]: client };
const clientFor = (chainId) => {
  const c = CONFIG.chains[chainId];
  if (!c?.evm || !c.rpc) return clients[chainId] || null;
  clients[chainId] ||= createPublicClient({ transport: http(c.rpc) });
  return clients[chainId];
};
const gateway = (u) => (u || "").replace(/^ipfs:\/\/(ipfs\/)?/, "https://ipfs.io/ipfs/").replace(/^ar:\/\//, "https://arweave.net/");

/** Image for one NFT from its tokenURI metadata; null when it cannot be read. */
async function nftImage(chainId, address, tokenId) {
  const c = clientFor(chainId);
  if (!c || !address) return null;
  try {
    const uri = await c.readContract({ address, abi: uriAbi, functionName: "tokenURI", args: [tokenId] });
    let meta;
    if (uri.startsWith("data:application/json;base64,")) meta = JSON.parse(atob(uri.split(",")[1]));
    else if (uri.startsWith("data:application/json")) meta = JSON.parse(decodeURIComponent(uri.split(",").slice(1).join(",")));
    else meta = await fetch(gateway(uri), { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    const img = gateway(meta.image || meta.image_url || "");
    return /^(https:|data:image\/)/.test(img) ? img : null;
  } catch {
    return null;
  }
}

function openseaLink(chainId, address, tokenId) {
  const slug = CONFIG.chains[chainId]?.opensea;
  if (Number(chainId) === 792703809) return `https://opensea.io/item/solana/${base58Encode(toHex(tokenId, { size: 32 }))}`;
  return slug && address ? `https://opensea.io/item/${slug}/${address}/${tokenId}` : null;
}

let nfts = [];
let filter = "all";

function draw() {
  const rows = nfts.filter((n) => filter === "all" || String(n.chainId) === filter);
  $("#gallery").innerHTML = rows.length ? rows.map((n) => {
    const href = openseaLink(n.chainId, n.address, n.tokenId);
    const tag = href ? `a href="${href}" target="_blank" rel="noopener"` : "div";
    const id = String(n.tokenId).length > 10 ? `${String(n.tokenId).slice(0, 5)}…` : String(n.tokenId);
    return `<${tag} class="nft">
      <div class="nft-img" data-key="${n.key}">${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" />` : collectionLogo(n.collectionName, n.collectionImage, 72)}</div>
      <div class="nft-body">
        <b>${esc(n.collectionName)} #${esc(id)}</b>
        <span class="muted">${chainIcon(n.chainId)} ${eth(n.price, 4)} ETH · fed by <span class="mono">$${esc(n.symbol)}</span></span>
        <span class="nft-status s-${n.status.split(" ")[0].toLowerCase()}">${n.status}</span>
      </div>
    </${href ? "a" : "div"}>`;
  }).join("") : `<p class="empty">No NFTs bought yet${filter === "all" ? "" : ` on ${esc(chainName(Number(filter)))}`}. They appear here as soon as a vault buys a floor.</p>`;
}

async function render() {
  if (!live) return ($("#gallery").innerHTML = `<p class="empty">Contracts not deployed yet.</p>`);
  const launches = await loadLaunches(500);
  const items = await loadActivity(launches);
  const gone = new Map();
  for (const i of items) {
    if (i.tokenId == null) continue;
    const k = `${i.launch.vault}-${i.tokenId}`;
    if (i.title === "NFT burned") gone.set(k, "Burned");
    else if (i.title.startsWith("Prize delivered") || i.title.endsWith("won")) gone.set(k, gone.get(k) || "Given to a holder");
  }
  nfts = items.filter((i) => i.title.startsWith("Floor NFT bought")).map((i, n) => {
    const l = i.launch;
    const chainId = l.external ? l.chainId : ROBINHOOD;
    return {
      key: n, chainId, tokenId: i.tokenId, price: i.price, symbol: l.symbol,
      address: l.external ? l.collectionAddress : l.collection,
      collectionName: l.collectionName, collectionImage: l.collectionImage,
      status: gone.get(`${l.vault}-${i.tokenId}`) || "In the vault",
    };
  });

  const chains = [...new Set(nfts.map((n) => n.chainId))];
  $("#filters").innerHTML = [`<button class="chip active" data-f="all">All<small>${nfts.length}</small></button>`,
    ...chains.map((c) => `<button class="chip" data-f="${c}">${chainBadge(c)}<small>${nfts.filter((n) => n.chainId === c).length}</small></button>`)].join("");
  $("#filters").onclick = (e) => {
    const b = e.target.closest("[data-f]");
    if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll("#filters .chip").forEach((x) => x.classList.toggle("active", x === b));
    draw();
  };
  draw();

  // Fill images in the background, a few at a time.
  const queue = nfts.slice(0, 80);
  const worker = async () => {
    for (let n = queue.shift(); n; n = queue.shift()) {
      n.image = await nftImage(n.chainId, n.address, n.tokenId);
      const slot = document.querySelector(`.nft-img[data-key="${n.key}"]`);
      if (n.image && slot) slot.innerHTML = `<img src="${esc(n.image)}" alt="" loading="lazy" />`;
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

render().catch((e) => ($("#gallery").innerHTML = `<p class="empty">Could not load the gallery: ${esc(e.shortMessage || e.message)}</p>`));
