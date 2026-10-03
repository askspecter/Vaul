// Keeper flow for coins whose collection lives on another chain (Ethereum, Base, Hyperliquid, Solana).
//
// Per external vault, each pass:
//   1. price the cheapest OpenSea listing on the target chain, in ETH (via a Relay quote for HYPE/SOL);
//   2. if the vault can afford it and nothing is in flight, announce a withdrawal (1h delay,
//      cancellable by the registry owner);
//   3. once ready, execute it and bridge the ETH to the keeper's wallet on the target chain;
//   4. buy the listing there, burn it if the coin's policy says so, and record it on Robinhood Chain;
//   5. deliver raffle prizes the Raffles contract assigned (EVM: same address; Solana: the
//      destination the winner saved) and mark them delivered.
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, getAddress, keccak256, toHex, formatEther } from "viem";
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
const DEAD = "0x000000000000000000000000000000000000dEaD";
const POLICY = ["raffle", "hold", "burn"];

/** Chain settings. Robinhood Chain ids follow Relay's chain ids for the targets. */
export const TARGETS = {
  1: { name: "Ethereum", currency: "ETH", opensea: "ethereum", rpcEnv: "ETHEREUM_RPC", rpc: "https://ethereum-rpc.publicnode.com", gasReserve: 1_000_000_000_000_000n },
  8453: { name: "Base", currency: "ETH", opensea: "base", rpcEnv: "BASE_RPC", rpc: "https://base-rpc.publicnode.com", gasReserve: 50_000_000_000_000n },
  999: { name: "Hyperliquid", currency: "HYPE", opensea: "hyperevm", rpcEnv: "HYPEREVM_RPC", rpc: "https://rpc.hyperliquid.xyz/evm", gasReserve: 50_000_000_000_000_000n },
  [relay.SOLANA_CHAIN_ID]: { name: "Solana", currency: "SOL", solana: true, gasReserve: 10_000_000n },
};

export class ExternalKeeper {
  /**
   * deps: { cfg, client (Robinhood public), account, send(label, req), opensea, solana,
   *         collections: [{chainId,address,name,slug}], bridge (optional override for tests),
   *         targetClients (optional override: chainId -> { public, wallet }) }
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
      if (TARGETS[chainId]?.solana) return this.solana?.toBytes32(c.address) === collection32.toLowerCase();
      return `0x${collection32.slice(-40)}`.toLowerCase() === c.address.toLowerCase();
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
    return out;
  }

  /** Cheapest listing on the target chain, with its ETH cost including bridge fees. */
  async floor(l, meta) {
    const t = TARGETS[l.chainId];
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
    return { listing, needed, ethCost };
  }

  recipient(chainId) {
    return TARGETS[chainId].solana ? this.solana.address : this.account.address;
  }

  bridgeQuote(chainId, amount, tradeType) {
    if (this.bridge) return this.bridge.quote(chainId, amount, tradeType);
    return relay.quote({
      originChainId: this.cfg.chainId, destinationChainId: chainId,
      user: this.account.address, recipient: this.recipient(chainId), amount, tradeType,
    });
  }

  async bridgeOut(chainId, amountWei) {
    if (this.bridge) return this.bridge.send(chainId, amountWei);
    const q = await this.bridgeQuote(chainId, amountWei, "EXACT_INPUT");
    log(`bridging ${formatEther(amountWei)} ETH → ${TARGETS[chainId].name} (${q.amountOut} out)`);
    await relay.execute(q, { wallet: this.wallet, publicClient: this.client, log });
  }

  async targetBalance(chainId) {
    if (TARGETS[chainId].solana) return this.solana.balance();
    return this.target(chainId).public.getBalance({ address: this.account.address });
  }

  async tick(l) {
    const meta = this.meta(l.chainId, l.collection32);
    if (!meta) return warn(`#${l.id} collection not in collections.json — cannot price it`);
    const r = (fn) => this.client.readContract({ address: l.vault, abi: extVaultAbi, functionName: fn });
    const [pendingBefore, readyAt] = await Promise.all([r("pendingAmount"), r("pendingReadyAt")]);
    const now = (await this.client.getBlock()).timestamp;

    // 3. Execute a ready withdrawal and bridge it straight away.
    if (pendingBefore > 0n && now >= readyAt) {
      await this.send(`#${l.id} executeWithdrawal ${formatEther(pendingBefore)} ETH`, { address: l.vault, abi: extVaultAbi, functionName: "executeWithdrawal" });
      if (this.cfg.dryRun) return;
      await this.bridgeOut(l.chainId, pendingBefore);
    }
    // Read after any withdrawal above so this pass can buy with the funds it just moved.
    const [balance, pending, withdrawn, spent] = await Promise.all([
      this.client.getBalance({ address: l.vault }), r("pendingAmount"), r("totalWithdrawn"), r("totalSpent"),
    ]);

    await this.deliverPrizes(l);

    const floor = await this.floor(l, meta);
    if (!floor) return;
    const inFlight = withdrawn - spent; // ETH already moved for this vault but not yet spent

    // 4. Buy when this vault's moved funds cover it and the keeper wallet there holds enough.
    if (inFlight >= floor.ethCost || (inFlight > 0n && await this.targetBalance(l.chainId) >= floor.needed)) {
      const have = await this.targetBalance(l.chainId);
      if (have >= floor.listing.price + TARGETS[l.chainId].gasReserve / 2n) {
        await this.buy(l, floor);
        return;
      }
      return warn(`#${l.id} waiting for bridged funds on ${TARGETS[l.chainId].name}`);
    }

    // 2. Announce a withdrawal when the vault can pay for the floor.
    if (pending === 0n && balance >= floor.ethCost - inFlight) {
      const amount = floor.ethCost - inFlight;
      if (floor.ethCost > this.cfg.maxCeiling) return warn(`#${l.id} floor ${formatEther(floor.ethCost)} ETH above MAX_CEILING_ETH`);
      await this.send(`#${l.id} announceWithdrawal ${formatEther(amount)} ETH for ${meta.name}`, {
        address: l.vault, abi: extVaultAbi, functionName: "announceWithdrawal", args: [amount],
      });
    }
  }

  async buy(l, { listing, ethCost }) {
    const t = TARGETS[l.chainId];
    let txId;
    if (t.solana) {
      txId = await this.solana.buy(listing, this.opensea.forChain("solana"), this.cfg.dryRun);
      if (!txId) return;
      if (l.policy === "burn") await this.solana.burn(listing.mint, this.cfg.dryRun);
    } else {
      const { public: pub, wallet } = this.target(l.chainId);
      const tx = await this.opensea.forChain(t.opensea).fulfillment(listing, this.account.address);
      if (tx.value !== listing.price) throw new Error(`fulfillment value ${tx.value} != listing ${listing.price}`);
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
    const price = t.currency === "ETH" && !t.solana ? listing.price : ethCost;
    await this.send(`#${l.id} recordPurchase ${listing.tokenId}`, {
      address: l.vault, abi: extVaultAbi, functionName: "recordPurchase", args: [listing.tokenId, price, ref],
    });
    if (t.solana) this.receipts?.(l, listing.tokenId, txId);
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
