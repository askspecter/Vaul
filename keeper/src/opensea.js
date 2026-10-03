import { parseAbiItem, encodeFunctionData, getAddress } from "viem";

const BASE = "https://api.opensea.io/api/v2";
const NATIVE = ["ETH", "HYPE"]; // listings priced in the chain's native currency

export class RateLimited extends Error {
  constructor(until) {
    super(`OpenSea rate limited until ${new Date(until).toISOString()}`);
    this.until = until;
  }
}

/**
 * Minimal OpenSea v2 client: floor listings and Seaport fulfillment calldata.
 * Without an apiKey it mints a free-tier key (POST /auth/keys, valid 7 days) and
 * renews it before expiry or when OpenSea rejects it.
 */
export class OpenSea {
  constructor({ apiKey, chain, log = () => {}, shared }) {
    // Key and rate-limit state are shared by every per-chain client (see forChain).
    this.shared = shared || { apiKey: apiKey || null, auto: !apiKey, expiresAt: Infinity, pausedUntil: 0 };
    this.chain = chain;
    this.log = log;
    this.slugs = new Map();
  }

  get apiKey() { return this.shared.apiKey; }
  set apiKey(v) { this.shared.apiKey = v; }
  get auto() { return this.shared.auto; }
  get expiresAt() { return this.shared.expiresAt; }
  set expiresAt(v) { this.shared.expiresAt = v; }
  get pausedUntil() { return this.shared.pausedUntil; }
  set pausedUntil(v) { this.shared.pausedUntil = v; }

  async #ensureKey() {
    if (!this.auto || (this.apiKey && Date.now() < this.expiresAt - 3_600_000)) return;
    const res = await fetch(`${BASE}/auth/keys`, { method: "POST", headers: { accept: "application/json" } });
    if (res.status === 429) throw new RateLimited(Date.now() + retryAfterMs(res, 3_600_000));
    if (!res.ok) throw new Error(`OpenSea key mint ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const k = await res.json();
    this.apiKey = k.api_key;
    this.expiresAt = Date.parse(k.expires_at) || Date.now() + 6 * 86_400_000;
    this.log(`OpenSea free-tier key minted (${k.name}), expires ${k.expires_at}`);
  }

  async #get(path, init = {}) {
    if (Date.now() < this.pausedUntil) throw new RateLimited(this.pausedUntil);
    await this.#ensureKey();
    const res = await fetch(BASE + path, {
      ...init,
      headers: { accept: "application/json", "x-api-key": this.apiKey, ...(init.headers || {}) },
    });
    if (res.status === 429) {
      this.pausedUntil = Date.now() + retryAfterMs(res, 60_000);
      throw new RateLimited(this.pausedUntil);
    }
    if ((res.status === 401 || res.status === 403) && this.auto) this.apiKey = null; // re-mint next call
    if (!res.ok) throw new Error(`OpenSea ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  /** Same key and rate-limit state, different chain (e.g. "ethereum", "base", "hyperevm"). */
  forChain(chain) {
    if (chain === this.chain) return this;
    this.children ||= new Map();
    if (!this.children.has(chain)) {
      // A real instance (not Object.create) so private methods like #get work on it.
      this.children.set(chain, new OpenSea({ chain, log: this.log, shared: this.shared }));
    }
    return this.children.get(chain);
  }

  async slugFor(contract) {
    const key = contract.toLowerCase();
    if (!this.slugs.has(key)) {
      const c = await this.#get(`/chain/${this.chain}/contract/${contract}`);
      this.slugs.set(key, c.collection);
    }
    return this.slugs.get(key);
  }

  /** Cheapest active ETH listings for a collection, lowest first. */
  async bestListings(contract, limit = 10) {
    const slug = await this.slugFor(contract);
    const data = await this.#get(`/listings/collection/${slug}/best?limit=${limit}`);
    return (data.listings || [])
      .map((l) => {
        const offer = l.protocol_data?.parameters?.offer?.[0];
        return {
          hash: l.order_hash,
          protocolAddress: l.protocol_address,
          price: BigInt(l.price.current.value),
          currency: l.price.current.currency,
          token: offer?.token && getAddress(offer.token),
          tokenId: offer ? BigInt(offer.identifierOrCriteria) : null,
          itemType: offer?.itemType,
        };
      })
      .filter((l) => NATIVE.includes(l.currency) && l.token && l.token === getAddress(contract) && l.itemType === 2)
      .sort((a, b) => (a.price < b.price ? -1 : 1));
  }

  /**
   * Cheapest listings by collection slug, for chains without an EVM contract lookup (Solana).
   * Price is in the chain's smallest unit (lamports on Solana). `mint` is the NFT's address.
   */
  async bestListingsBySlug(slug, limit = 10) {
    const data = await this.#get(`/listings/collection/${encodeURIComponent(slug)}/best?limit=${limit}`);
    return (data.listings || [])
      .map((l) => {
        const offer = l.protocol_data?.parameters?.offer?.[0];
        return {
          hash: l.order_hash,
          protocolAddress: l.protocol_address,
          price: BigInt(l.price.current.value),
          currency: l.price.current.currency,
          mint: offer?.token || l.asset?.identifier || l.nft?.identifier || l.token_id || null,
        };
      })
      .filter((l) => l.currency === "SOL")
      .sort((a, b) => (a.price < b.price ? -1 : 1));
  }

  /**
   * Solana listings settle through an onchain program: OpenSea returns an already co-signed
   * transaction (base64) that the buyer signs and broadcasts unchanged.
   */
  async solanaFulfillment(listing, fulfiller) {
    const res = await this.#get(`/listings/fulfillment/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        listing: { hash: listing.hash, chain: this.chain, protocol_address: listing.protocolAddress },
        fulfiller: { address: fulfiller },
        recipient: fulfiller,
      }),
    });
    const txs = [];
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        if (/partially_?signed_?transaction|serialized_?transaction|transaction_?base64/i.test(k) && typeof v === "string") txs.push(v);
        else visit(v);
      }
    };
    visit(res.steps);
    if (!txs.length) throw new Error("OpenSea returned no signed Solana transaction for this listing");
    return txs;
  }

  /** Returns { to, value, data } for filling `listing` with `fulfiller` as the buyer. */
  async fulfillment(listing, fulfiller) {
    const res = await this.#get(`/listings/fulfillment_data`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        listing: { hash: listing.hash, chain: this.chain, protocol_address: listing.protocolAddress },
        fulfiller: { address: fulfiller },
      }),
    });
    const tx = res.fulfillment_data.transaction;
    const item = parseAbiItem(`function ${tx.function}`);
    const args = Object.values(tx.input_data).map(toPositional);
    return { to: getAddress(tx.to), value: BigInt(tx.value), data: encodeFunctionData({ abi: [item], args }) };
  }
}

function retryAfterMs(res, fallback) {
  const retry = Number(res.headers.get("retry-after"));
  if (retry > 0) return retry * 1000;
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (reset > 0) return Math.max(reset * 1000 - Date.now(), 1000);
  return fallback;
}

// OpenSea returns tuples as JSON objects in struct order; the ABI item has unnamed
// components, so convert objects to positional arrays recursively.
function toPositional(v) {
  if (Array.isArray(v)) return v.map(toPositional);
  if (v && typeof v === "object") return Object.values(v).map(toPositional);
  return v;
}
