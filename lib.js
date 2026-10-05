import {
  createPublicClient, createWalletClient, custom, http, defineChain, parseAbi,
  formatEther, isAddress, toHex, getAddress, keccak256, encodeAbiParameters, pad,
} from "https://cdn.jsdelivr.net/npm/viem@2.21.0/+esm";
import { CONFIG } from "./config.js";

export { CONFIG, formatEther, isAddress, toHex, getAddress };

export const chain = defineChain({
  id: CONFIG.chainId,
  name: CONFIG.chainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: CONFIG.explorer } },
});
export const client = createPublicClient({ chain, transport: http() });
export const live = isAddress(CONFIG.launcher);
export const externalLive = isAddress(CONFIG.externalLauncher || "");
export const ROBINHOOD = CONFIG.chainId;
export const chainName = (id) => CONFIG.chains[Number(id)]?.name || `Chain ${id}`;

/** Round chain logo; pages that load from a sub-folder pass `base = "../"` is not needed since
 *  every page lives at the site root. */
export function chainIcon(id) {
  const c = CONFIG.chains[Number(id)];
  return c?.icon ? `<img class="chain-icon" src="${c.icon}" alt="" width="16" height="16" />` : "";
}

/** Sharper OpenSea CDN images: i2c.seadn.io serves 500px by default and resizes on `?w=`. */
export function hd(url, w = 1000) {
  if (!url || !/^https:\/\/i2c\.seadn\.io\//.test(url) || url.includes("?")) return url || "";
  return `${url}?w=${w}`;
}

/** Collection logo (from collections.json), or a coloured initial when there is none. */
export function collectionLogo(name, image, size = 44) {
  const style = `width:${size}px;height:${size}px`;
  const initial = `<span class="col-logo col-logo-fallback" style="${style};background:${colorFor(name || "?")}">${esc((name || "?").slice(0, 1))}</span>`;
  if (!image) return initial;
  return `<img class="col-logo" style="${style}" src="${esc(hd(image, Math.max(128, size * 3)))}" alt="" loading="lazy" onerror="this.outerHTML=this.dataset.fallback" data-fallback="${esc(initial)}" />`;
}

/** Logo + name pill, e.g. for coin cards and collection rows. */
export const chainBadge = (id) => `<span class="pill-chain">${chainIcon(id)}${esc(chainName(id))}</span>`;

/** Chain id for a display name (used by the filter chips). */
export const chainIdByName = (name) => Number(Object.keys(CONFIG.chains).find((k) => CONFIG.chains[k].name === name));

export const ABI = {
  pons: parseAbi([
    "function launchFee() view returns (uint256)",
    "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  ]),
  launcher: parseAbi([
    "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
    "struct LaunchParams { string name; string symbol; string logo; string description; Socials socials; uint16 creatorTaxBps; uint256 launchConfigId; bytes32 expectedEconomics; bytes32 salt; address collection; uint8 policy; }",
    "function launch(LaunchParams p) payable returns (uint256)",
    "function launchCount() view returns (uint256)",
    "function registry() view returns (address)",
    "function launches(uint256) view returns (address token, address curve, address router, address vault, address collection, address creator)",
  ]),
  registry: parseAbi([
    "event CollectionSet(address collection, bool listed)",
    "function isCollection(address) view returns (bool)",
    "function keeper() view returns (address)",
    "function treasury() view returns (address)",
    "function owner() view returns (address)",
    "function setCollection(address collection, bool listed)",
  ]),
  router: parseAbi([
    "function pending() view returns (uint256)",
    "function harvest()",
    "event Harvested(uint256 toVault, uint256 toTreasury)",
  ]),
  vault: parseAbi([
    "function policy() view returns (uint8)",
    "function ceiling() view returns (uint256)",
    "function ceilingExpiry() view returns (uint256)",
    "function raffles() view returns (address)",
    "event Bought(address indexed marketplace, uint256 indexed tokenId, uint256 price)",
    "event Burned(uint256 indexed tokenId)",
    "event PrizeSent(uint256 indexed tokenId, address indexed to)",
  ]),
  raffles: parseAbi([
    "event RaffleOpened(address indexed vault, uint256 indexed id, uint256 indexed tokenId, bytes32 root, uint256 totalTickets)",
    "event RaffleDrawn(address indexed vault, uint256 indexed id, uint256 winningTicket)",
    "event RaffleClaimed(address indexed vault, uint256 indexed id, address indexed winner, uint256 tokenId)",
    "struct Raffle { uint256 tokenId; bytes32 root; uint256 totalTickets; uint64 publishedAt; uint64 drawBlock; uint256 winningTicket; bool drawn; bool claimed; }",
    "function raffleCount(address vault) view returns (uint256)",
    "function raffles(address vault, uint256 id) view returns (Raffle)",
    "function claim(address vault, uint256 id, address account, uint256 start, uint256 end, bytes32[] proof)",
  ]),
  extLauncher: parseAbi([
    "struct ExtSocials { string twitter; string telegram; string discord; string website; string farcaster; }",
    "struct ExtLaunchParams { string name; string symbol; string logo; string description; ExtSocials socials; uint16 creatorTaxBps; uint256 launchConfigId; bytes32 expectedEconomics; bytes32 salt; uint64 chainId; bytes32 collection; bool isEvm; uint8 policy; }",
    "function launch(ExtLaunchParams p) payable returns (uint256)",
    "function launchCount() view returns (uint256)",
    "function launches(uint256) view returns (address token, address curve, address router, address vault, address collection, address creator)",
    "function collectionKey(uint64 chainId, bytes32 collection) pure returns (address)",
  ]),
  extVault: parseAbi([
    "function policy() view returns (uint8)",
    "function raffles() view returns (address)",
    "function externalChainId() view returns (uint64)",
    "function externalCollection() view returns (bytes32)",
    "function externalIsEvm() view returns (bool)",
    "function pendingAmount() view returns (uint256)",
    "function pendingReadyAt() view returns (uint256)",
    "function totalWithdrawn() view returns (uint256)",
    "function totalSpent() view returns (uint256)",
    "function prizeOwedTo(uint256) view returns (address)",
    "function prizeDestination(uint256) view returns (bytes32)",
    "function setPrizeDestination(uint256 tokenId, bytes32 destination)",
    "function cancelWithdrawal()",
    "event ExternalPurchase(uint256 indexed tokenId, uint256 price, bytes32 externalTx)",
    "event PrizeOwed(uint256 indexed tokenId, address indexed to)",
    "event PrizeDelivered(uint256 indexed tokenId, address indexed to, bytes32 destination, bytes32 externalTx)",
    "event Withdrawn(address indexed keeper, uint256 amount)",
    "event Burned(uint256 indexed tokenId)",
  ]),
  erc20: parseAbi([
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function logo() view returns (string)",
    "function description() view returns (string)",
    "function balanceOf(address) view returns (uint256)",
  ]),
  erc721: parseAbi([
    "function name() view returns (string)",
    "function balanceOf(address) view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
    "function tokenURI(uint256) view returns (string)",
  ]),
};

export const POLICIES = ["Raffle", "Hold", "Burn"];

export const $ = (s, el = document) => el.querySelector(s);

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
export const eth = (wei, dp = 3) => Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: dp });
export const addrLink = (a, label) => `<a class="mono" href="${CONFIG.explorer}/address/${a}" target="_blank" rel="noopener">${esc(label || short(a))}</a>`;
export const txLink = (h) => `${CONFIG.explorer}/tx/${h}`;

/** A short, readable reason for a failed wallet or contract call (viem errors carry long dumps). */
export function friendlyError(err) {
  const raw = [err?.details, err?.shortMessage, err?.cause?.shortMessage, err?.cause?.message, err?.message]
    .find((x) => typeof x === "string" && x.trim()) || "Something went wrong";
  const text = raw.split("\n")[0].replace(/0x[0-9a-fA-F]{40,}/g, "…").trim();
  if (/insufficient funds/i.test(raw)) return "Not enough ETH on Robinhood Chain for the launch fee plus gas.";
  if (/out of gas|gas limit|intrinsic gas|gas required exceeds/i.test(raw)) return "Your wallet set the gas limit too low. Allow about 4,000,000 gas in the wallet's advanced settings and try again.";
  if (/chain|network/i.test(raw) && /mismatch|does not match|unsupported|unrecognized|switch/i.test(raw)) return "Switch your wallet to Robinhood Chain and try again.";
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

/** Closing the wallet window or rejecting a request is a choice, not an error: stay quiet. */
const QUIET = /cancell?ed|user rejected|user denied|rejected the request|request rejected|user closed/i;

export function toast(msg) {
  if (QUIET.test(String(msg))) return;
  msg = String(msg).split("\n")[0].replace(/0x[0-9a-fA-F]{40,}/g, "…");
  if (msg.length > 200) msg = `${msg.slice(0, 197)}…`;
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 3200);
}

// ------------------------------------------------------------------ wallet

let account = null;
const listeners = new Set();
export const getAccount = () => account;
export const onAccount = (fn) => listeners.add(fn);

/** Accepts a plain address or a CAIP-10 id ("eip155:4663:0x…") and returns a checksummed address. */
const normalizeAddress = (addr) => {
  try { return addr ? getAddress(String(addr).split(":").pop().trim()) : null; } catch { return null; }
};
const setAccount = (addr) => {
  account = normalizeAddress(addr);
  document.querySelectorAll("[data-connect]").forEach((btn) => (($("span", btn) || btn).textContent = account ? short(account) : "Connect wallet"));
  listeners.forEach((fn) => fn(account));
};
const remember = (v) => { try { v ? localStorage.setItem("vaul-wallet", v) : localStorage.removeItem("vaul-wallet"); } catch { /* storage blocked */ } };
const remembered = () => { try { return localStorage.getItem("vaul-wallet"); } catch { return null; } };

// ---------------------------------------------------------------- Reown AppKit (WalletConnect)

const REOWN_URL = "https://cdn.jsdelivr.net/npm/@reown/appkit-cdn@1.8.24/dist/appkit.js";
const ROBINHOOD_NETWORK = {
  id: CONFIG.chainId, name: CONFIG.chainName, chainNamespace: "eip155", caipNetworkId: `eip155:${CONFIG.chainId}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: CONFIG.explorer } },
};
let kitPromise = null;
let provider = null; // EIP-1193 provider of the connected wallet

/** Loads AppKit on first use (the bundle is large, so pages do not pay for it up front). */
function appKit() {
  kitPromise ||= import(REOWN_URL).then(({ createAppKit, WagmiAdapter }) => {
    const projectId = CONFIG.reownProjectId;
    const adapter = new WagmiAdapter({ projectId, networks: [ROBINHOOD_NETWORK] });
    const kit = createAppKit({
      adapters: [adapter], networks: [ROBINHOOD_NETWORK], defaultNetwork: ROBINHOOD_NETWORK, projectId,
      metadata: {
        name: "Vaul", description: "Memecoins with a vault inside", url: location.origin,
        icons: [new URL("assets/brand/vaul-512.png", location.href).href],
      },
      features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false },
      // WalletConnect explorer ids: Bitget Wallet, MetaMask, Trust Wallet shown first.
      featuredWalletIds: [
        "38f5d18bd8522c244bdd70cb4a68e0e718865155811c043f052fb9f1c51de662",
        "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
        "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0",
      ],
      // Don't interrupt browsing with a "Switch Network" popup on every page;
      // the switch happens once, right before a transaction (see ensureChain).
      allowUnsupportedChain: true,
      themeMode: "dark",
      themeVariables: { "--w3m-accent": "#7b5cff", "--w3m-color-mix": "#000000", "--w3m-color-mix-strength": 20, "--w3m-border-radius-master": "2px", "--w3m-font-family": "Inter, system-ui, sans-serif" },
    });
    kit.subscribeAccount((s) => {
      if (s.isConnected && s.address) {
        provider = kit.getWalletProvider?.() || provider;
        remember("reown");
        if (s.address.toLowerCase() !== account?.toLowerCase()) setAccount(s.address);
      } else if (!s.isConnected && account) {
        provider = null;
        remember(null);
        setAccount(null);
      }
    });
    kit.subscribeProviders?.((p) => { if (p?.eip155) provider = p.eip155; });
    return kit;
  });
  return kitPromise;
}

/** Opens the Reown modal and resolves once a wallet is connected (rejects if it is closed first). */
async function connectReown() {
  const kit = await appKit();
  if (!account) {
    await new Promise((resolve, reject) => {
      let opened = false;
      const unsubs = [];
      const done = (fn) => { unsubs.forEach((u) => typeof u === "function" && u()); fn(); };
      unsubs.push(kit.subscribeAccount((s) => { if (s.isConnected && s.address) done(resolve); }));
      unsubs.push(kit.subscribeState((s) => {
        if (s.open) opened = true;
        else if (opened && !account) done(() => reject(new Error("Wallet connection cancelled")));
      }));
      kit.open();
    });
  }
  provider = kit.getWalletProvider?.() || provider;
  return account;
}

// ---------------------------------------------------------------- injected wallet (fallback)

async function connectInjected() {
  if (!window.ethereum) throw new Error("No wallet found — install a browser wallet");
  const [acc] = await window.ethereum.request({ method: "eth_requestAccounts" });
  const hexId = toHex(CONFIG.chainId);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err) {
    if (err.code !== 4902) throw err;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hexId, chainName: CONFIG.chainName, rpcUrls: [CONFIG.rpcUrl],
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [CONFIG.explorer],
      }],
    });
  }
  provider = window.ethereum;
  setAccount(acc);
  return account;
}

export async function connect() {
  return CONFIG.reownProjectId ? connectReown() : connectInjected();
}

/** Header button: connect, or open the wallet's account view when already connected. */
export async function openWallet() {
  if (account && CONFIG.reownProjectId) return (await appKit()).open();
  return connect();
}

// Reconnect a Reown session in the background if the visitor connected before.
if (CONFIG.reownProjectId && remembered() === "reown") {
  (window.requestIdleCallback || setTimeout)(() => appKit().catch(() => {}));
}

/** Makes sure the wallet is on Robinhood Chain; asks it to switch only when it is not. */
async function ensureChain(transport) {
  const hex = await transport.request({ method: "eth_chainId" }).catch(() => null);
  if (hex && Number(hex) === CONFIG.chainId) return;
  try {
    await transport.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(CONFIG.chainId) }] });
  } catch (err) {
    if (err?.code !== 4902) throw new Error("Switch your wallet to Robinhood Chain and try again.");
    await transport.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: toHex(CONFIG.chainId), chainName: CONFIG.chainName, rpcUrls: [CONFIG.rpcUrl],
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [CONFIG.explorer],
      }],
    });
  }
}

export async function walletClient() {
  if (!account) await connect();
  const transport = provider || window.ethereum;
  if (!transport) throw new Error("No wallet connected");
  // Use the account the wallet has selected right now; a remembered session can point at another one.
  const accs = await transport.request({ method: "eth_accounts" }).catch(() => []);
  const current = normalizeAddress(Array.isArray(accs) ? accs[0] : null);
  if (current && current !== account) setAccount(current);
  if (!account) throw new Error("Connect your wallet first.");
  await ensureChain(transport);
  return createWalletClient({ account, chain, transport: custom(transport) });
}

/** Sends a contract write from the connected wallet and waits for it. */
export async function write(req) {
  const wallet = await walletClient();
  const { request } = await client.simulateContract({ account: wallet.account, ...req });
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted");
  return receipt;
}

// ------------------------------------------------------------------ muse.ai video

/** The video id in a muse.ai link (muse.ai/v/<id>, muse.ai/v/<id>-title, muse.ai/embed/<id>), or null. */
export function museId(link) {
  const m = String(link || "").trim().match(/^(?:https?:\/\/)?(?:www\.)?muse\.ai\/(?:v|embed)\/([A-Za-z0-9]{4,32})(?:[-/?#]|$)/i);
  return m ? m[1] : null;
}
export const museEmbed = (id) => `https://muse.ai/embed/${encodeURIComponent(id)}`;
export const musePage = (id) => `https://muse.ai/v/${encodeURIComponent(id)}`;

// Keep in sync with api/video.js.
const videoMessage = (launch, video, time) => `Vaul: set the video for coin ${launch}\nVideo: ${video || "none"}\nTime: ${time}`;

/** The coin's muse.ai video id, or null. `launch` is a launch id as used in coin?id=. */
export async function loadVideo(launch) {
  try {
    const res = await fetch(`/api/video?launch=${encodeURIComponent(launch)}`);
    return res.ok ? (await res.json()).video || null : null;
  } catch {
    return null;
  }
}

/** Sets (or with an empty `video`, removes) the coin's video. The coin's creator signs a message; no gas. */
export async function saveVideo(launch, video) {
  const wallet = await walletClient();
  const time = Math.floor(Date.now() / 1000);
  const signature = await wallet.signMessage({ account: wallet.account, message: videoMessage(String(launch), video, time) });
  const res = await fetch("/api/video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ launch: String(launch), video: video || "", time, signature }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Could not save the video (${res.status})`);
  return json.video;
}

// ------------------------------------------------------------------ layout

const NAV = [
  ["explore", "Coins"],
  ["cards", "Cards"],
  ["collections", "Collections"],
  ["gallery", "Gallery"],
  ["activity", "Activity"],
  ["claims", "Giveaways"],
  ["analytics", "Analytics"],
  ["docs", "Docs"],
];

const ICONS = {
  menu: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.1 2.1 0 0 0-2.9-.1z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>',
};

export function renderChrome(active) {
  const header = $("#site-header");
  if (header) {
    header.className = "nav";
    const q = active === "collections" ? new URLSearchParams(location.search).get("q") || "" : "";
    header.innerHTML = `
      <button class="burger" id="burger" aria-label="Open menu" aria-expanded="false">${ICONS.menu}</button>
      <a href="/" class="brand" aria-label="Vaul home"><img src="assets/brand/vaul-logo.png" alt="" width="32" height="32" /><span>Vaul</span></a>
      <nav class="nav-links" id="navLinks">
        <form class="nav-search" action="collections" role="search">
          <input name="q" type="search" placeholder="Search collections" aria-label="Search collections" value="${esc(q)}" />
        </form>
        ${NAV.map(([href, label]) => `<a href="${href}"${href === active ? ' class="active"' : ""}>${label}</a>`).join("")}
        <div class="menu-foot">
          ${CONFIG.x ? `<a class="x-link" href="https://x.com/${esc(CONFIG.x)}" target="_blank" rel="noopener">${ICONS.x}<span>@${esc(CONFIG.x)}</span></a>` : ""}
          <a class="btn btn-dark menu-btn" href="launch">${ICONS.rocket}Launch a coin</a>
          <button class="btn btn-ghost menu-btn" data-connect>${ICONS.wallet}<span>Connect wallet</span></button>
        </div>
      </nav>`;
    const burger = $("#burger", header);
    const menu = $("#navLinks", header);
    const setOpen = (open) => {
      menu.classList.toggle("open", open);
      burger.setAttribute("aria-expanded", String(open));
      burger.innerHTML = open ? ICONS.close : ICONS.menu;
    };
    burger.addEventListener("click", (e) => { e.stopPropagation(); setOpen(!menu.classList.contains("open")); });
    document.addEventListener("click", (e) => { if (!header.contains(e.target)) setOpen(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
    $("[data-connect]", header).addEventListener("click", () => { setOpen(false); openWallet().catch((e) => toast(e.shortMessage || e.message)); });
    if (account) $("[data-connect] span", header).textContent = short(account);
  }
  const footer = $("#site-footer");
  if (footer) {
    footer.className = "footer";
    footer.innerHTML = `
      <div>
        <a href="/" class="brand" aria-label="Vaul home"><img src="assets/brand/vaul-logo.png" alt="" width="32" height="32" /><span>Vaul</span></a>
        <p>Pons coins on Robinhood Chain whose creator fees buy NFT floors. Vault rules are enforced on-chain.</p>
      </div>
      <div class="foot-links">${NAV.map(([h, l]) => `<a href="${h}">${l}</a>`).join("")}</div>
      ${CONFIG.officialToken ? `<p class="foot-token">Official token <b>$${esc(CONFIG.officialToken.symbol)}</b> <span class="mono">${esc(CONFIG.officialToken.address)}</span></p>` : ""}
      <small>© ${new Date().getFullYear()} Vaul. Not affiliated with Robinhood Markets or Pons. Not financial advice.</small>`;
  }
  if (!live) {
    const banner = document.createElement("div");
    banner.className = "banner";
    banner.textContent = "Vaul contracts are being set up. Launching opens as soon as they are live.";
    document.body.prepend(banner);
  }
}

// ------------------------------------------------------------------ data

const read = (address, abi, functionName, args) => client.readContract({ address, abi, functionName, args });

export async function launchCount() {
  return live ? Number(await read(CONFIG.launcher, ABI.launcher, "launchCount")) : 0;
}

// ---------------------------------------------------------------- collections metadata

let metaPromise;
/** Names and marketplace slugs for listed collections, from collections.json. */
export function collectionMeta() {
  metaPromise ||= fetch(CONFIG.collectionsUrl).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  return metaPromise;
}

/** A collection id as bytes32: EVM addresses are left-padded, Solana addresses base58-decoded.
 *  Card Vaults pair with one category of a mixed collection (e.g. the Pokémon cards on
 *  Courtyard): the category tag fills the 12 spare bytes in front of the EVM address, so each
 *  category gets its own Registry key while the keeper still reads the address from the low
 *  20 bytes. */
export function collectionId(chainId, address, tag) {
  // Solana Card Vaults (Collector Crypt) buy across a whole marketplace: the id is the tag alone.
  if (!CONFIG.chains[Number(chainId)]?.evm) return tag ? `0x${tagHex(tag, 32)}` : toHex(base58Decode(address), { size: 32 });
  const id = pad(getAddress(address), { size: 32 });
  return tag ? `0x${tagHex(tag)}${id.slice(-40)}` : id;
}

/** A category tag as `bytes` bytes of hex (ASCII, zero-padded on the right). */
export function tagHex(tag, bytes = 12) {
  if (!/^[\x21-\x7e]+$/.test(tag) || tag.length > bytes) throw new Error(`tag must be 1–${bytes} ASCII characters`);
  const hex = [...tag].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  return hex.padEnd(bytes * 2, "0");
}

/** Registry key: the address itself on Robinhood Chain, a hash of (chain, id) elsewhere. */
export function collectionKey(chainId, address, tag) {
  if (Number(chainId) === ROBINHOOD) return getAddress(address);
  const hash = keccak256(encodeAbiParameters([{ type: "uint64" }, { type: "bytes32" }], [BigInt(chainId), collectionId(chainId, address, tag)]));
  return getAddress(`0x${hash.slice(-40)}`);
}

export async function metaByKey() {
  const map = new Map();
  for (const c of await collectionMeta()) {
    try { map.set(collectionKey(c.chainId, c.address, c.tag), c); } catch { /* malformed entry */ }
  }
  return map;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(str) {
  let n = 0n;
  for (const ch of str) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error("Invalid Solana address");
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of str) { if (ch !== "1") break; bytes.unshift(0); }
  if (bytes.length !== 32) throw new Error("Solana address must be 32 bytes");
  return new Uint8Array(bytes);
}
export function base58Encode(hex) {
  let n = BigInt(hex);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  const bytes = hex.slice(2).match(/../g) || [];
  for (const b of bytes) { if (b !== "00") break; out = "1" + out; }
  return out;
}

// ---------------------------------------------------------------- launches

async function nameFor(meta, collection) {
  const m = meta.get(getAddress(collection));
  if (m) return m.name;
  return read(collection, ABI.erc721, "name").catch(() => short(collection));
}

const imageFor = (meta, collection) => meta.get(getAddress(collection))?.image || null;

/** Full view of one launch. `id` is a number for Robinhood coins, "e<n>" for other chains. */
export async function loadLaunch(id) {
  if (String(id).startsWith("e")) return loadExternalLaunch(Number(String(id).slice(1)));
  const meta = await metaByKey();
  const [token, curve, router, vault, collection, creator] = await read(CONFIG.launcher, ABI.launcher, "launches", [BigInt(id)]);
  const [name, symbol, logo, description, collectionName, vaultBalance, nfts, pending, policy] = await Promise.all([
    read(token, ABI.erc20, "name"),
    read(token, ABI.erc20, "symbol"),
    read(token, ABI.erc20, "logo").catch(() => ""),
    read(token, ABI.erc20, "description").catch(() => ""),
    nameFor(meta, collection),
    client.getBalance({ address: vault }),
    read(collection, ABI.erc721, "balanceOf", [vault]).catch(() => 0n),
    read(router, ABI.router, "pending").catch(() => 0n),
    read(vault, ABI.vault, "policy"),
  ]);
  return {
    id: Number(id), chainId: ROBINHOOD, external: false, token, curve, router, vault, collection, creator,
    name, symbol, logo, description, collectionName, collectionImage: imageFor(meta, collection), vaultBalance, nfts: Number(nfts), pending, policy: POLICIES[policy],
  };
}

export async function loadExternalLaunch(n) {
  const meta = await metaByKey();
  const [token, curve, router, vault, collection, creator] = await read(CONFIG.externalLauncher, ABI.extLauncher, "launches", [BigInt(n)]);
  const v = (fn) => read(vault, ABI.extVault, fn);
  const [name, symbol, logo, description, vaultBalance, pending, policy, chainId, isEvm, withdrawn, spent, pendingAmount, pendingReadyAt, buys] = await Promise.all([
    read(token, ABI.erc20, "name"),
    read(token, ABI.erc20, "symbol"),
    read(token, ABI.erc20, "logo").catch(() => ""),
    read(token, ABI.erc20, "description").catch(() => ""),
    client.getBalance({ address: vault }),
    read(router, ABI.router, "pending").catch(() => 0n),
    v("policy"), v("externalChainId"), v("externalIsEvm"), v("totalWithdrawn"), v("totalSpent"),
    v("pendingAmount"), v("pendingReadyAt"),
    client.getContractEvents({ address: vault, abi: ABI.extVault, eventName: "ExternalPurchase", fromBlock: BigInt(CONFIG.startBlock || 0), toBlock: "latest" }),
  ]);
  const m = meta.get(getAddress(collection));
  return {
    id: `e${n}`, chainId: Number(chainId), external: true, isEvm, token, curve, router, vault, collection, creator,
    name, symbol, logo, description, collectionName: m?.name || `${chainName(chainId)} collection`, collectionAddress: m?.address, collectionImage: m?.image || null, kind: m?.kind || null, source: m?.source || null, tag: m?.tag || null, spec: m?.spec || null,
    vaultBalance, pending, policy: POLICIES[policy], nfts: buys.length,
    withdrawn, spent, pendingAmount, pendingReadyAt: Number(pendingReadyAt),
    purchases: buys.map((b) => ({ tokenId: b.args.tokenId, price: b.args.price, externalTx: b.args.externalTx })),
  };
}

/** Grail Mode: live price of every grail (the cheapest card meeting its spec), keyed by tag. */
let grailsPromise;
export function loadGrails() {
  grailsPromise ||= fetch("/api/grails").then((r) => (r.ok ? r.json() : { grails: [] })).catch(() => ({ grails: [] }))
    .then((d) => ({ ethUsd: d.ethUsd || null, byTag: new Map((d.grails || []).map((g) => [g.tag, g])) }));
  return grailsPromise;
}

/** Ids of the coins launched through Vaul, newest first. Kept in the site's own KV store
 *  (api/launches.js), so coins made elsewhere on the shared launcher contracts never show up. */
export async function vaulLaunchIds() {
  const res = await fetch("/api/launches", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load the coin list");
  return (await res.json()).ids || [];
}

/** Records a launch transaction in Vaul's coin list. */
export async function recordLaunch(hash) {
  const res = await fetch("/api/launches", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Could not record the launch");
  return json.id;
}

export async function loadLaunches(limit = 60) {
  if (!live) return [];
  const hidden = new Set((CONFIG.hiddenLaunches || []).map(String));
  const ids = (await vaulLaunchIds())
    .filter((id) => !hidden.has(String(id)) && (externalLive || !String(id).startsWith("e")))
    .slice(0, limit);
  return Promise.all(ids.map(loadLaunch));
}

/** Explorer link for a transaction on an EVM chain. Solana signatures (64 bytes) do not fit the
 *  vault's bytes32 field; for Solana the keeper records a hash and publishes the signature in
 *  its receipts file, so there is no direct link. */
export function externalTxLink(chainId, txHash) {
  const c = CONFIG.chains[Number(chainId)];
  if (!c?.evm || !txHash || /^0x0+$/.test(txHash)) return null;
  return `${c.explorer}/tx/${txHash}`;
}

export async function loadRaffles(l) {
  const raffles = await read(l.vault, ABI.vault, "raffles");
  const count = Number(await read(raffles, ABI.raffles, "raffleCount", [l.vault]));
  return Promise.all([...Array(count).keys()].map(async (id) => {
    const r = await read(raffles, ABI.raffles, "raffles", [l.vault, BigInt(id)]);
    return { ...r, id, raffles, publishedAt: Number(r.publishedAt) };
  }));
}

export async function loadSnapshot(vault, id) {
  const url = `${CONFIG.snapshotBaseUrl}${vault.toLowerCase()}-${id}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Snapshot not published at ${url}`);
  return res.json();
}

export function winnerEntry(snapshot, ticket) {
  const t = BigInt(ticket);
  return snapshot.entries.find((e) => BigInt(e.start) <= t && t < BigInt(e.end));
}

/** Registry keys of every listed collection (Robinhood addresses and other-chain keys). */
export async function listedCollections() {
  const registry = await read(CONFIG.launcher, ABI.launcher, "registry");
  const logs = await client.getContractEvents({
    address: registry, abi: ABI.registry, eventName: "CollectionSet", fromBlock: BigInt(CONFIG.startBlock || 0), toBlock: "latest",
  });
  const state = new Map();
  for (const { args } of logs) state.set(getAddress(args.collection), args.listed);
  return [...state].filter(([, listed]) => listed).map(([a]) => a);
}

/** Whether each Registry key is listed, read directly (a handful of calls, no log scan). */
let registryAddr;
export async function isListed(keys) {
  registryAddr ||= read(CONFIG.launcher, ABI.launcher, "registry");
  const registry = await registryAddr;
  return Promise.all(keys.map((k) => read(registry, ABI.registry, "isCollection", [k])));
}

/** Listed collections with chain + name, ready for pickers and lists. */
export async function listedCollectionsDetailed() {
  const [keys, meta] = await Promise.all([listedCollections(), metaByKey()]);
  return Promise.all(keys.map(async (key) => {
    const m = meta.get(key);
    if (m) return { key, chainId: Number(m.chainId), address: m.address, tag: m.tag, kind: m.kind, source: m.source, market: m.market, spec: m.spec, name: m.name, slug: m.slug, image: m.image };
    // Unknown key: a Robinhood collection not in collections.json yet (other-chain keys need metadata).
    const name = await read(key, ABI.erc721, "name").catch(() => null);
    return name ? { key, chainId: ROBINHOOD, address: key, name } : null;
  })).then((rows) => rows.filter(Boolean));
}

export const COLORS = ["#7b5cff", "#5b3bf5", "#a99bff", "#3d6bff", "#9d5cff", "#4a2fd0", "#6d8bff", "#b08cff"];
export const colorFor = (s) => COLORS[[...String(s)].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length];

/** Coin picture: the logo stored on the token, or a gradient tile with the ticker. Only http(s)
 *  logos are rendered, since the logo string is whatever the creator typed. */
export function coinArt(c, cls) {
  const tile = `<div class="${cls}" style="background:linear-gradient(135deg, ${colorFor(c.symbol)}, #07060c)">$${esc(c.symbol)}</div>`;
  if (!c.logo || !/^https?:\/\//i.test(c.logo)) return tile;
  return `<div class="${cls} has-img"><img src="${esc(c.logo)}" alt="" loading="lazy" onerror="this.parentNode.outerHTML=this.dataset.fallback" data-fallback="${esc(tile)}" /></div>`;
}

export function coinCard(c) {
  const href = c.id != null ? `coin?id=${c.id}` : null;
  const tag = href ? `a href="${href}"` : "article";
  return `<${tag} class="coin">
    ${coinArt(c, "art")}
    <div class="body">
      <h4>${esc(c.name)} <small>${esc(c.policy || "")}</small></h4>
      ${chainBadge(c.chainId || ROBINHOOD)}
      <div class="meta"><span class="collects">Collects ${collectionLogo(c.collectionName, c.collectionImage, 18)}<b>${esc(c.collectionName)}</b></span></div>
      <div class="meta"><span>Vault <b>${eth(c.vaultBalance)} ETH</b></span><span><b>${c.nfts}</b> ${c.kind === "cards" ? "cards" : "NFTs"}</span></div>
    </div>
  </${href ? "a" : "article"}>`;
}
