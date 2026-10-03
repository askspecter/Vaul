// On-chain activity for one or many coins: fee harvests, NFT buys, vault moves and giveaways.
// Everything here is read straight from contract events, so the feed cannot drift from the chain.
import { parseAbi } from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";
import {
  CONFIG, ABI, client, esc, eth, short, addrLink, txLink, chainName, externalTxLink, getAddress, toast,
} from "./lib.js";

const FROM = () => BigInt(CONFIG.startBlock || 0);

const VAULT_EVENTS = parseAbi([
  "event Bought(address indexed marketplace, uint256 indexed tokenId, uint256 price)",
  "event Burned(uint256 indexed tokenId)",
  "event PrizeSent(uint256 indexed tokenId, address indexed to)",
  "event ExternalPurchase(uint256 indexed tokenId, uint256 price, bytes32 externalTx)",
  "event Withdrawn(address indexed keeper, uint256 amount)",
  "event PrizeDelivered(uint256 indexed tokenId, address indexed to, bytes32 destination, bytes32 externalTx)",
]);
const RAFFLE_EVENTS = ABI.raffles.filter((x) => x.type === "event");

const logs = (address, events) => (address.length
  ? client.getLogs({ address, events, fromBlock: FROM(), toBlock: "latest" })
  : Promise.resolve([]));

const tokenLabel = (id) => {
  const s = String(id);
  return s.length > 10 ? `#${s.slice(0, 4)}…${s.slice(-3)}` : `#${s}`;
};

/** All activity for the given launches, newest first. */
export async function loadActivity(launches) {
  if (!launches.length) return [];
  const byRouter = new Map(launches.map((l) => [l.router.toLowerCase(), l]));
  const byVault = new Map(launches.map((l) => [l.vault.toLowerCase(), l]));
  const raffleAddrs = [...new Set(await Promise.all(launches.filter((l) => l.policy === "Raffle").map((l) =>
    client.readContract({ address: l.vault, abi: ABI.vault, functionName: "raffles" }).then((a) => a.toLowerCase()).catch(() => null))))].filter(Boolean);

  const [fees, vaults, raffles] = await Promise.all([
    logs([...byRouter.keys()], [ABI.router.find((x) => x.name === "Harvested")]),
    logs([...byVault.keys()], VAULT_EVENTS),
    raffleAddrs.length ? client.getLogs({ address: raffleAddrs, events: RAFFLE_EVENTS, fromBlock: FROM(), toBlock: "latest" }) : [],
  ]);

  const items = [];
  const push = (log, l, kind, title, detail, extra = {}) => items.push({
    kind, launch: l, title, detail, tx: log.transactionHash, block: log.blockNumber, index: log.logIndex, ...extra,
  });

  for (const x of fees) {
    const l = byRouter.get(x.address.toLowerCase());
    const total = x.args.toVault + x.args.toTreasury;
    push(x, l, "fees", "Fees harvested", `${eth(total, 5)} ETH collected · ${eth(x.args.toVault, 5)} to the vault`, {
      toVault: x.args.toVault, toTreasury: x.args.toTreasury,
    });
  }
  for (const x of vaults) {
    const l = byVault.get(x.address.toLowerCase());
    if (!l) continue;
    const a = x.args;
    switch (x.eventName) {
      case "Bought":
        push(x, l, "nft", "Floor NFT bought", `${esc(l.collectionName)} ${tokenLabel(a.tokenId)} for ${eth(a.price, 4)} ETH`, { tokenId: a.tokenId, price: a.price });
        break;
      case "ExternalPurchase": {
        const link = externalTxLink(l.chainId, a.externalTx);
        push(x, l, "nft", `Floor NFT bought on ${esc(chainName(l.chainId))}`, `${esc(l.collectionName)} ${tokenLabel(a.tokenId)} for ${eth(a.price, 4)} ETH`, { tokenId: a.tokenId, price: a.price, externalLink: link });
        break;
      }
      case "Burned":
        push(x, l, "nft", "NFT burned", `${esc(l.collectionName)} ${tokenLabel(a.tokenId)} removed for good`, { tokenId: a.tokenId });
        break;
      case "Withdrawn":
        push(x, l, "vault", `Vault funds sent to ${esc(chainName(l.chainId))}`, `${eth(a.amount, 4)} ETH bridged to buy the floor`, { amount: a.amount });
        break;
      case "PrizeSent":
        push(x, l, "raffle", "Prize delivered", `${esc(l.collectionName)} ${tokenLabel(a.tokenId)} sent to ${addrLink(a.to)}`, { tokenId: a.tokenId, winner: a.to });
        break;
      case "PrizeDelivered": {
        const link = externalTxLink(l.chainId, a.externalTx);
        push(x, l, "raffle", `Prize delivered on ${esc(chainName(l.chainId))}`, `${esc(l.collectionName)} ${tokenLabel(a.tokenId)} for ${addrLink(a.to)}`, { tokenId: a.tokenId, winner: a.to, externalLink: link });
        break;
      }
    }
  }
  for (const x of raffles) {
    const l = byVault.get(x.args.vault.toLowerCase());
    if (!l) continue;
    const a = x.args;
    if (x.eventName === "RaffleOpened") push(x, l, "raffle", `Giveaway #${a.id} opened`, `${esc(l.collectionName)} ${tokenLabel(a.tokenId)} · every holder in the snapshot has tickets`, { tokenId: a.tokenId });
    if (x.eventName === "RaffleDrawn") push(x, l, "raffle", `Giveaway #${a.id} drawn`, "A winning ticket was picked on-chain");
    if (x.eventName === "RaffleClaimed") push(x, l, "raffle", `Giveaway #${a.id} won`, `${addrLink(a.winner)} takes ${esc(l.collectionName)} ${tokenLabel(a.tokenId)}`, { tokenId: a.tokenId, winner: a.winner });
  }

  items.sort((a, b) => (a.block === b.block ? b.index - a.index : a.block > b.block ? -1 : 1));
  return items;
}

/** Fills in block times for the newest `limit` items (one RPC call per distinct block). */
export async function addTimes(items, limit = 60) {
  const blocks = [...new Set(items.slice(0, limit).map((i) => i.block))];
  const times = new Map(await Promise.all(blocks.map(async (b) => {
    const blk = await client.getBlock({ blockNumber: b }).catch(() => null);
    return [b, blk ? Number(blk.timestamp) : null];
  })));
  for (const i of items) i.time = times.get(i.block) ?? null;
  return items;
}

export function timeAgo(sec) {
  if (!sec) return "";
  const d = Math.max(0, Date.now() / 1000 - sec);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export const KINDS = [
  ["all", "Everything"],
  ["fees", "Fees"],
  ["nft", "NFTs"],
  ["vault", "Vault"],
  ["raffle", "Giveaways"],
];
const ICON = { fees: "◎", nft: "▣", vault: "⇄", raffle: "✦" };

/** Renders a filterable feed into `el`. `showCoin` adds the coin ticker to each row. */
export function mountFeed(el, items, { showCoin = false, limit = 60 } = {}) {
  let kind = el.dataset.kind || "all";
  const counts = Object.fromEntries(KINDS.map(([k]) => [k, k === "all" ? items.length : items.filter((i) => i.kind === k).length]));
  const draw = () => {
    const rows = items.filter((i) => kind === "all" || i.kind === kind).slice(0, limit);
    el.innerHTML = `
      <div class="chips feed-chips">${KINDS.map(([k, label]) => `<button class="chip${k === kind ? " active" : ""}" data-kind="${k}">${label}<small>${counts[k]}</small></button>`).join("")}</div>
      ${rows.length ? `<ul class="feed">${rows.map((i) => `
        <li class="feed-row k-${i.kind}">
          <span class="feed-icon" aria-hidden="true">${ICON[i.kind]}</span>
          <div class="feed-main">
            <b>${i.title}${showCoin ? ` <a class="feed-coin" href="coin?id=${i.launch.id}">$${esc(i.launch.symbol)}</a>` : ""}</b>
            <span>${i.detail}</span>
          </div>
          <div class="feed-side">
            <a class="mono" href="${txLink(i.tx)}" target="_blank" rel="noopener">${short(i.tx)}</a>
            ${i.externalLink ? `<a class="mono" href="${i.externalLink}" target="_blank" rel="noopener">receipt ↗</a>` : ""}
            <small>${i.time ? timeAgo(i.time) : `block ${i.block}`}</small>
          </div>
        </li>`).join("")}</ul>` : `<p class="empty">Nothing here yet.</p>`}`;
  };
  el.onclick = (e) => {
    const chip = e.target.closest("[data-kind]");
    if (!chip) return;
    kind = el.dataset.kind = chip.dataset.kind;
    draw();
  };
  draw();
}

/** Totals for a set of activity items. */
export function summarize(items) {
  const s = { harvested: 0n, toVault: 0n, toTreasury: 0n, harvests: 0, bought: 0, spent: 0n, burned: 0, given: 0, opened: 0, drawn: 0, bridged: 0n };
  for (const i of items) {
    if (i.kind === "fees") { s.harvests++; s.toVault += i.toVault; s.toTreasury += i.toTreasury; }
    if (i.title.startsWith("Floor NFT bought")) { s.bought++; s.spent += i.price; }
    if (i.title === "NFT burned") s.burned++;
    if (i.title.startsWith("Prize delivered")) s.given++;
    if (i.title.endsWith("opened")) s.opened++;
    if (i.title.endsWith("drawn")) s.drawn++;
    if (i.kind === "vault") s.bridged += i.amount;
  }
  s.harvested = s.toVault + s.toTreasury;
  return s;
}

/** Copy-to-clipboard buttons: any element with data-copy="<text>". */
export function wireCopy(root = document) {
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      toast("Copied");
    } catch {
      toast(b.dataset.copy);
    }
  });
}
export const copyBtn = (text, label = "Copy") => `<button class="copy" data-copy="${esc(text)}" title="Copy">${label}</button>`;

// ---------------------------------------------------------------- GeckoTerminal

const GT_NETWORK = "robinhood";

/** Best pool for a token on GeckoTerminal: the DEX pool once the coin graduates, else its Pons curve. */
export async function geckoPool(token, curve) {
  try {
    const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${GT_NETWORK}/tokens/${token.toLowerCase()}/pools?page=1`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const { data } = await res.json();
      const best = (data || []).sort((a, b) => Number(b.attributes.reserve_in_usd || 0) - Number(a.attributes.reserve_in_usd || 0))[0];
      if (best?.attributes?.address) return best.attributes.address;
    }
  } catch { /* rate limited or offline: fall back to the curve */ }
  return curve.toLowerCase();
}

export const geckoPage = (pool) => `https://www.geckoterminal.com/${GT_NETWORK}/pools/${pool}`;

export function geckoEmbed(pool) {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  return `${geckoPage(pool)}?embed=1&info=0&swaps=0&grayscale=0&light_chart=${dark ? 0 : 1}&chart_type=price&resolution=15m`;
}

export const ponsPage = (token) => `https://www.ponsfamily.com/launchpad/${getAddress(token)}`;
