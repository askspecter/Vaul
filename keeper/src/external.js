// Keeper flow for coins whose collection lives on another chain (Ethereum, Base, Hyperliquid,
// Polygon, Solana).
//
// Per external vault, each pass:
//   1. price the cheapest OpenSea listing on the target chain, in ETH (via a Relay quote for HYPE/SOL);
//   2. if the vault can afford it and nothing is in flight, announce a withdrawal (1h delay,
//      cancellable by the registry owner);
//   3. once ready, execute it and bridge the ETH to the keeper's wallet on the target chain;
//   4. buy the listing there, burn it if the coin's policy says so, and record it on Robinhood Chain;
//   5. deliver raffle prizes the Raffles contract assigned (EVM: same address; Solana: the
//      destination the winner saved) and mark them delivered.
//
// Card Vaults pair a coin with one category of graded trading cards. Their collections.json
// entry has `kind: "cards"` and a `tag` (stored in the vault's collection id) and one of:
//   - `match` words (Courtyard on Polygon, via OpenSea): the keeper buys the cheapest listing
//     whose name or traits contain one of the words, paying in POL or USDC;
//   - `market: "collectorcrypt"` and a `category` (Collector Crypt on Solana, via its own API):
//     the keeper buys the cheapest graded card of that category, paying in USDC.
// Grail Mode entries (`kind: "grail"`, Collector Crypt) add a spec (`search`, `must`, `graders`,
// `grade`, `minUsd`): the vault buys nothing until it can afford the cheapest card that meets
// it, so it saves up for one grail. `ceilingEth` raises MAX_CEILING_ETH for that grail.
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, getAddress, keccak256, toHex, formatEther, parseEther } from "viem";
import * as relay from "./relay.js";
import { log, warn } from "./log.js";

export const extLauncherAbi = parseAbi([
  "function launchCount() view returns (uint256)",
  "function launches(uint256) view returns (address token, address curve, address router, address vault, address collection, address creator)",
]);
export const extVaultAbi = parseAbi([
  "function policy() view returns (uint8)",
  "function raffles() view returns (address)",
  "function externalChainId() view returns (uint64)",
  "function externalCollection() view returns (bytes32)",
  "function externalIsEvm() view returns (bool)",
  "function pendingAmount() view returns (uint256)",
  "function pendingReadyAt() view returns (uint256)",
  "function totalWithdrawn() view returns (uint256)",
  "function totalSpent() view returns (uint256)",
  "function held(uint256) view returns (bool)",
  "function prizeOwedTo(uint256) view returns (address)",
  "function prizeDestination(uint256) view returns (bytes32)",
  "function announceWithdrawal(uint256 amount)",
  "function executeWithdrawal()",
  "function recordPurchase(uint256 tokenId, uint256 price, bytes32 externalTx)",
  "function markDelivered(uint256 tokenId, bytes32 externalTx)",
  "event PrizeOwed(uint256 indexed tokenId, address indexed to)",
]);
const erc721 = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function transferFrom(address from, address to, uint256 tokenId)",
]);
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const DEAD = "0x000000000000000000000000000000000000dEaD";
const NATIVE = "0x0000000000000000000000000000000000000000";
const OPENSEA_CONDUIT = "0x1E0049783F008A0085193E00003D00cd54003c71"; // pulls ERC-20 payments for Seaport listings
const MAX_CARD_CHECKS = 25; // NFT metadata lookups per vault per pass

/** A Card Vault category tag as the 12 bytes in front of the address (see lib.js tagHex). */
export function tagHex(tag, bytes = 12) {
  if (!tag) return "0".repeat(bytes * 2);
  return [...tag].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("").padEnd(bytes * 2, "0");
}

/** True when the NFT's name, description or traits contain one of the entry's `match` words. */
export function matchesCategory(nft, words) {
  const norm = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const text = norm([nft.name, nft.description, ...nft.traits].join(" | "));
  return words.some((w) => text.includes(norm(w)));
}
const POLICY = ["raffle", "hold", "burn"];

/** Chain settings. Robinhood Chain ids follow Relay's chain ids for the targets. */
export const TARGETS = {
  1: { name: "Ethereum", currency: "ETH", opensea: "ethereum", rpcEnv: "ETHEREUM_RPC", rpc: "https://ethereum-rpc.publicnode.com", gasReserve: 1_000_000_000_000_000n },
  8453: { name: "Base", currency: "ETH", opensea: "base", rpcEnv: "BASE_RPC", rpc: "https://base-rpc.publicnode.com", gasReserve: 50_000_000_000_000n },
  137: {
    name: "Polygon", currency: "POL", opensea: "matic", rpcEnv: "POLYGON_RPC", rpc: "https://polygon-bor-rpc.publicnode.com", gasReserve: 2_000_000_000_000_000_000n,
    listingCurrencies: ["POL", "MATIC", "USDC"], tokens: { USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
  },
  999: { name: "Hyperliquid", currency: "HYPE", opensea: "hyperevm", rpcEnv: "HYPEREVM_RPC", rpc: "https://rpc.hyperliquid.xyz/evm", gasReserve: 50_000_000_000_000_000n },
  [relay.SOLANA_CHAIN_ID]: { name: "Solana", currency: "SOL", solana: true, gasReserve: 10_000_000n, tokens: { USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } },
};

const tokenSymbol = (t, token) => Object.keys(t.tokens || {}).find((k) => t.tokens[k].toLowerCase() === String(token).toLowerCase()) || token;

export class ExternalKeeper {
  /**
   * deps: { cfg, client (Robinhood public), account, send(label, req), opensea, solana,
   *         collections: [{chainId,address,name,slug}], bridge (optional override for tests),
   *         targetClients (optional override: chainId -> { public, wallet }),
   *         paymentSpender (optional override for tests: who pulls ERC-20 payments),
   *         cc (Collector Crypt client, for Collector Crypt Card Vaults) }
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.targets = new Map();
  }

  target(chainId) {
    if (this.targetClients?.[chainId]) return this.targetClients[chainId];
    if (!this.targets.has(chainId)) {
      const t = TARGETS[chainId];
      const url = process.env[t.rpcEnv] || t.rpc;
      const chain = defineChain({ id: chainId, name: t.name, nativeCurrency: { name: t.currency, symbol: t.currency, decimals: 18 }, rpcUrls: { default: { http: [url] } } });
      this.targets.set(chainId, {
        public: createPublicClient({ chain, transport: http(url) }),
        wallet: createWalletClient({ account: this.account, chain, transport: http(url) }),
      });
    }
    return this.targets.get(chainId);
  }

  meta(chainId, collection32) {
    return this.collections.find((c) => {
      if (Number(c.chainId) !== chainId) return false;
      // Solana Card Vaults have no address in their id: it is the tag itself, 32 bytes.
      if (TARGETS[chainId]?.solana) return c.tag ? `0x${tagHex(c.tag, 32)}` === collection32.toLowerCase() : this.solana?.toBytes32(c.address) === collection32.toLowerCase();
      return `0x${collection32.slice(-40)}`.toLowerCase() === c.address.toLowerCase() && collection32.slice(2, 26).toLowerCase() === tagHex(c.tag);
    });
  }

  async readLaunches() {
    if (!this.cfg.externalLauncher) return [];
    const n = await this.client.readContract({ address: this.cfg.externalLauncher, abi: extLauncherAbi, functionName: "launchCount" });
    const out = [];
    for (let i = 0n; i < n; i++) {
      const [token, curve, router, vault] = await this.client.readContract({ address: this.cfg.externalLauncher, abi: extLauncherAbi, functionName: "launches", args: [i] });
      const r = (fn) => this.client.readContract({ address: vault, abi: extVaultAbi, functionName: fn });
      const [policy, raffles, chainId, collection, isEvm] = await Promise.all([r("policy"), r("raffles"), r("externalChainId"), r("externalCollection"), r("externalIsEvm")]);
      // `collection` for the shared raffle code is the vault itself (it answers ownerOf).
      out.push({ id: `e${i}`, token, curve, router, vault, collection: vault, raffles, policy: POLICY[policy], external: true, chainId: Number(chainId), collection32: collection, isEvm });
    }
    return [...out, ...await this.readStandaloneVaults()];
  }

  /**
   * Standalone ExternalVaults from vaults.json (e.g. the one SweepHook fills): no launch and no fee
   * router; `token` is the coin whose holders the raffles snapshot. Skipped until deployed.
   */
  async readStandaloneVaults() {
    const out = [];
    for (const v of this.vaults || []) {
      const code = await this.client.getCode({ address: v.vault }).catch(() => null);
      if (!code || code === "0x") continue;
      const r = (fn) => this.client.readContract({ address: v.vault, abi: extVaultAbi, functionName: fn });
      const [policy, raffles, chainId, collection, isEvm] = await Promise.all([r("policy"), r("raffles"), r("externalChainId"), r("externalCollection"), r("externalIsEvm")]);
      out.push({ id: v.id, token: v.token, curve: null, router: null, vault: v.vault, collection: v.vault, raffles, policy: POLICY[policy], external: true, chainId: Number(chainId), collection32: collection, isEvm });
    }
    return out;
  }

  /**
   * Cheapest listing on the target chain, with its ETH cost including bridge fees.
   * Returns { listing, needed, ethCost, paymentToken, options }: `needed` is what the keeper
   * must hold there in the payment currency, and `options` lists every currency's cheapest
   * listing (cheapest ETH cost first) so a buy can use whichever currency the keeper holds.
   */
  async floor(l, meta) {
    const t = TARGETS[l.chainId];
    if (meta.market === "collectorcrypt") return this.collectorCryptFloor(l, meta);
    if (meta.match?.length && !t.solana) return this.cardFloor(l, meta);
    let listing;
    if (t.solana) {
      [listing] = await this.opensea.forChain("solana").bestListingsBySlug(meta.slug);
      if (listing && !listing.mint) return warn(`#${l.id} OpenSea listing has no mint address — skipping`), null;
      if (listing) listing.tokenId = BigInt(this.solana.toBytes32(listing.mint));
    } else {
      [listing] = await this.opensea.forChain(t.opensea).bestListings(meta.address);
    }
    if (!listing) return null;
    const needed = listing.price + t.gasReserve;
    let ethCost = needed;
    if (t.currency !== "ETH" || t.solana) {
      const q = await this.bridgeQuote(l.chainId, needed, "EXACT_OUTPUT");
      ethCost = q.amountIn;
    } else {
      ethCost = (needed * 10_100n) / 10_000n; // ~1% bridge fee headroom
    }
    const f = { listing, needed, ethCost, paymentToken: NATIVE };
    return { ...f, options: [f] };
  }

  /** Card Vaults: the cheapest listing per payment currency whose NFT matches the category. */
  async cardFloor(l, meta) {
    const t = TARGETS[l.chainId];
    const os = this.opensea.forChain(t.opensea);
    const listings = await os.bestListings(meta.address, 50, { currencies: t.listingCurrencies || [t.currency], slug: meta.slug });
    const allowed = new Set([NATIVE, ...Object.values(t.tokens || {}).map((a) => getAddress(a))]);
    this.cardChecks ||= new Map(); // `${token}:${id}` -> matches, kept for the process lifetime
    const cheapest = new Map(); // payment token -> listing
    let lookups = 0;
    for (const x of listings) {
      const pay = x.paymentToken || NATIVE;
      if (cheapest.has(pay) || !allowed.has(pay)) continue;
      const key = `${x.token}:${x.tokenId}`;
      if (!this.cardChecks.has(key)) {
        if (lookups++ >= MAX_CARD_CHECKS) break;
        this.cardChecks.set(key, matchesCategory(await os.nft(x.token, x.tokenId), meta.match));
      }
      if (this.cardChecks.get(key)) cheapest.set(pay, x);
    }
    if (!cheapest.size) return warn(`#${l.id} no ${meta.name} listed in the cheapest ${listings.length} ${meta.slug} listings`), null;

    const gasTopUp = async () => (await this.targetBalance(l.chainId) >= t.gasReserve ? 0n : (await this.bridgeQuote(l.chainId, t.gasReserve, "EXACT_OUTPUT")).amountIn);
    const options = [];
    for (const [pay, listing] of cheapest) {
      const native = pay === NATIVE;
      const needed = native ? listing.price + t.gasReserve : listing.price;
      const q = await this.bridgeQuote(l.chainId, needed, "EXACT_OUTPUT", native ? undefined : pay);
      options.push({ listing, needed, paymentToken: pay, ethCost: q.amountIn + (native ? 0n : await gasTopUp()) });
    }
    options.sort((a, b) => (a.ethCost < b.ethCost ? -1 : 1));
    return { ...options[0], options };
  }

  /** Collector Crypt Card Vaults: the cheapest graded card of the category, paid in USDC. */
  async collectorCryptFloor(l, meta) {
    const t = TARGETS[l.chainId];
    if (!this.cc) return warn(`#${l.id} Collector Crypt client missing`), null;
    const [listing] = await this.cc.cheapest(meta, { want: 1 });
    if (!listing) return warn(`#${l.id} no ${meta.name} listed on Collector Crypt`), null;
    listing.tokenId = BigInt(this.solana.toBytes32(listing.mint));
    const usdc = t.tokens.USDC;
    const q = await this.bridgeQuote(l.chainId, listing.price, "EXACT_OUTPUT", usdc);
    const gas = await this.targetBalance(l.chainId) >= t.gasReserve ? 0n : (await this.bridgeQuote(l.chainId, t.gasReserve, "EXACT_OUTPUT")).amountIn;
    const f = { listing, needed: listing.price, paymentToken: usdc, ethCost: q.amountIn + gas };
    return { ...f, options: [f] };
  }

  recipient(chainId) {
    return TARGETS[chainId].solana ? this.solana.address : this.account.address;
  }

  bridgeQuote(chainId, amount, tradeType, destinationCurrency) {
    if (this.bridge) return this.bridge.quote(chainId, amount, tradeType, destinationCurrency);
    return relay.quote({
      originChainId: this.cfg.chainId, destinationChainId: chainId,
      user: this.account.address, recipient: this.recipient(chainId), amount, tradeType, destinationCurrency,
    });
  }

  /**
   * Bridges `amountWei` of the vault's withdrawn ETH to the keeper on the target chain. With an
   * ERC-20 `paymentToken` (Card Vaults paying in USDC) it first tops up the chain's coin for gas
   * when the keeper is short, then sends the rest as that token.
   */
  async bridgeOut(chainId, amountWei, paymentToken = NATIVE) {
    if (this.bridge) return this.bridge.send(chainId, amountWei, paymentToken);
    const t = TARGETS[chainId];
    let rest = amountWei;
    if (paymentToken !== NATIVE && await this.targetBalance(chainId) < t.gasReserve) {
      const gas = await this.bridgeQuote(chainId, t.gasReserve, "EXACT_OUTPUT");
      if (gas.amountIn < rest) {
        log(`bridging ${formatEther(gas.amountIn)} ETH → ${t.name} ${t.currency} for gas`);
        await relay.execute(gas, { wallet: this.wallet, publicClient: this.client, log });
        rest -= gas.amountIn;
      }
    }
    const token = paymentToken === NATIVE ? undefined : paymentToken;
    const q = await this.bridgeQuote(chainId, rest, "EXACT_INPUT", token);
    log(`bridging ${formatEther(rest)} ETH → ${t.name}${token ? ` ${tokenSymbol(t, token)}` : ""} (${q.amountOut} out)`);
    await relay.execute(q, { wallet: this.wallet, publicClient: this.client, log });
  }

  /** Keeper's balance on the target chain: its coin, or `token` (an ERC-20) when given. */
  async targetBalance(chainId, token = NATIVE) {
    if (TARGETS[chainId].solana) return token === NATIVE ? this.solana.balance() : this.solana.tokenBalance(token);
    const { public: pub } = this.target(chainId);
    if (token !== NATIVE) return pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [this.account.address] });
    return pub.getBalance({ address: this.account.address });
  }

  /** True when the keeper holds enough on the target chain to buy `option` right now. */
  async canBuy(chainId, option) {
    const t = TARGETS[chainId];
    if (option.paymentToken === NATIVE) return await this.targetBalance(chainId) >= option.listing.price + t.gasReserve / 2n;
    return await this.targetBalance(chainId, option.paymentToken) >= option.listing.price
      && await this.targetBalance(chainId) >= t.gasReserve / 2n;
  }

  async tick(l) {
    const meta = this.meta(l.chainId, l.collection32);
    if (!meta) return warn(`#${l.id} collection not in collections.json — cannot price it`);
    const r = (fn) => this.client.readContract({ address: l.vault, abi: extVaultAbi, functionName: fn });
    const [pendingBefore, readyAt] = await Promise.all([r("pendingAmount"), r("pendingReadyAt")]);
    const now = (await this.client.getBlock()).timestamp;
    const card = meta.kind === "cards" || meta.kind === "grail";
    let floor;

    // 3. Execute a ready withdrawal and bridge it straight away. Card Vaults price first so the
    //    ETH arrives in the currency the cheapest matching card is listed in.
    if (pendingBefore > 0n && now >= readyAt) {
      if (card) {
        floor = await this.floor(l, meta);
        if (!floor) return warn(`#${l.id} withdrawal ready but no ${meta.name} listed — keeping it in the vault for now`);
      }
      await this.send(`#${l.id} executeWithdrawal ${formatEther(pendingBefore)} ETH`, { address: l.vault, abi: extVaultAbi, functionName: "executeWithdrawal" });
      if (this.cfg.dryRun) return;
      await this.bridgeOut(l.chainId, pendingBefore, floor?.paymentToken);
      if (card) floor = await this.floor(l, meta); // re-read: the gas top-up changes the cost
    }
    // Read after any withdrawal above so this pass can buy with the funds it just moved.
    const [balance, pending, withdrawn, spent] = await Promise.all([
      this.client.getBalance({ address: l.vault }), r("pendingAmount"), r("totalWithdrawn"), r("totalSpent"),
    ]);

    await this.deliverPrizes(l);

    floor ||= await this.floor(l, meta);
    if (!floor) return;
    const inFlight = withdrawn - spent; // ETH already moved for this vault but not yet spent

    // 4. Buy when this vault's moved funds cover it and the keeper wallet there holds enough,
    //    in whichever listed currency it holds (the cheapest one may have changed since).
    if (inFlight > 0n) {
      for (const option of floor.options) {
        if (await this.canBuy(l.chainId, option)) return this.buy(l, option);
      }
      if (inFlight >= floor.ethCost) return warn(`#${l.id} waiting for bridged funds on ${TARGETS[l.chainId].name}`);
    }

    // 2. Announce a withdrawal when the vault can pay for the floor.
    if (pending === 0n && balance >= floor.ethCost - inFlight) {
      const amount = floor.ethCost - inFlight;
      const ceiling = meta.ceilingEth ? parseEther(String(meta.ceilingEth)) : this.cfg.maxCeiling;
      if (floor.ethCost > ceiling) return warn(`#${l.id} floor ${formatEther(floor.ethCost)} ETH above the ${meta.ceilingEth ? "grail's ceilingEth" : "MAX_CEILING_ETH"}`);
      await this.send(`#${l.id} announceWithdrawal ${formatEther(amount)} ETH for ${meta.name}`, {
        address: l.vault, abi: extVaultAbi, functionName: "announceWithdrawal", args: [amount],
      });
    }
  }

  async buy(l, { listing, ethCost, paymentToken = NATIVE }) {
    const t = TARGETS[l.chainId];
    let txId;
    if (t.solana && listing.cc) {
      // Collector Crypt cards are real cards: a "burn" coin keeps them rather than destroying the NFT.
      txId = await this.solana.buyCollectorCrypt(this.cc, listing, this.cfg.dryRun);
      if (!txId) return;
      if (l.policy === "burn") warn(`#${l.id} burn policy: keeping card ${listing.mint} (Collector Crypt cards are not burned)`);
    } else if (t.solana) {
      txId = await this.solana.buy(listing, this.opensea.forChain("solana"), this.cfg.dryRun);
      if (!txId) return;
      if (l.policy === "burn") await this.solana.burn(listing.mint, this.cfg.dryRun);
    } else {
      const { public: pub, wallet } = this.target(l.chainId);
      const tx = await this.opensea.forChain(t.opensea).fulfillment(listing, this.account.address);
      const value = paymentToken === NATIVE ? listing.price : 0n;
      if (tx.value !== value) throw new Error(`fulfillment value ${tx.value} != expected ${value}`);
      if (paymentToken !== NATIVE) await this.approvePayment(l, paymentToken, listing.price);
      await pub.call({ account: this.account, to: tx.to, data: tx.data, value: tx.value }); // simulate
      if (this.cfg.dryRun) return log(`[dry-run] buy ${listing.tokenId} on ${t.name}`);
      const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value });
      const rc = await pub.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error(`buy reverted on ${t.name}: ${hash}`);
      txId = hash;
      log(`#${l.id} bought ${listing.tokenId} on ${t.name} ✓ ${hash}`);
      if (l.policy === "burn") {
        const h = await wallet.writeContract({ address: listing.token, abi: erc721, functionName: "transferFrom", args: [this.account.address, DEAD, listing.tokenId] });
        await pub.waitForTransactionReceipt({ hash: h });
        log(`#${l.id} burned ${listing.tokenId} ✓ ${h}`);
      }
      if (!this.nftContracts) this.nftContracts = {};
      this.nftContracts[l.vault] = listing.token;
    }
    const ref = t.solana ? keccak256(toHex(txId)) : txId;
    const price = t.currency === "ETH" && !t.solana && paymentToken === NATIVE ? listing.price : ethCost;
    await this.send(`#${l.id} recordPurchase ${listing.tokenId}`, {
      address: l.vault, abi: extVaultAbi, functionName: "recordPurchase", args: [listing.tokenId, price, ref],
    });
    if (t.solana) this.receipts?.(l, listing.tokenId, txId);
  }

  /** Lets OpenSea's conduit pull exactly `amount` of the ERC-20 for one Seaport listing. */
  async approvePayment(l, token, amount) {
    const { public: pub, wallet } = this.target(l.chainId);
    const spender = this.paymentSpender || OPENSEA_CONDUIT; // tests swap in their stand-in market
    const allowance = await pub.readContract({ address: token, abi: erc20, functionName: "allowance", args: [this.account.address, spender] });
    if (allowance >= amount) return;
    if (this.cfg.dryRun) return log(`[dry-run] approve ${amount} of ${token} for OpenSea`);
    const h = await wallet.writeContract({ address: token, abi: erc20, functionName: "approve", args: [spender, amount] });
    await pub.waitForTransactionReceipt({ hash: h });
    log(`#${l.id} approved ${amount} ${tokenSymbol(TARGETS[l.chainId], token)} for OpenSea ✓ ${h}`);
  }

  async deliverPrizes(l) {
    const logs = await this.client.getContractEvents({ address: l.vault, abi: extVaultAbi, eventName: "PrizeOwed", fromBlock: this.cfg.startBlock, toBlock: "latest" });
    const t = TARGETS[l.chainId];
    const meta = this.meta(l.chainId, l.collection32);
    for (const { args } of logs) {
      const tokenId = args.tokenId;
      const owed = await this.client.readContract({ address: l.vault, abi: extVaultAbi, functionName: "prizeOwedTo", args: [tokenId] });
      if (owed === "0x0000000000000000000000000000000000000000") continue; // already delivered
      let txId;
      if (t.solana) {
        const dest = await this.client.readContract({ address: l.vault, abi: extVaultAbi, functionName: "prizeDestination", args: [tokenId] });
        if (/^0x0+$/.test(dest)) continue; // winner has not saved a Solana address yet
        txId = await this.solana.transfer(toHex(tokenId, { size: 32 }), dest, this.cfg.dryRun);
        if (!txId) continue;
        txId = keccak256(toHex(txId));
      } else {
        const { public: pub, wallet } = this.target(l.chainId);
        const nft = getAddress(meta.address);
        await pub.simulateContract({ account: this.account, address: nft, abi: erc721, functionName: "safeTransferFrom", args: [this.account.address, owed, tokenId] });
        if (this.cfg.dryRun) { log(`[dry-run] deliver ${tokenId} → ${owed} on ${t.name}`); continue; }
        txId = await wallet.writeContract({ address: nft, abi: erc721, functionName: "safeTransferFrom", args: [this.account.address, owed, tokenId] });
        await pub.waitForTransactionReceipt({ hash: txId });
        log(`#${l.id} delivered ${tokenId} to ${owed} on ${t.name} ✓ ${txId}`);
      }
      await this.send(`#${l.id} markDelivered ${tokenId}`, { address: l.vault, abi: extVaultAbi, functionName: "markDelivered", args: [tokenId, txId] });
    }
  }
}
