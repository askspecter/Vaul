// Collector Crypt marketplace API (https://docs.collectorcrypt.com/marketplace/api): graded
// trading cards vaulted by Collector Crypt, as NFTs on Solana, priced in USDC.
//
// Reads and transaction builders are public; an API key (`ccsk_…`, from support@collectorcrypt.com)
// only raises the rate limits 10×. Buying is build → sign → broadcast: the API returns an
// unsigned transaction, the keeper signs it and posts it back to /marketplace/broadcast.
const BASE = "https://api.collectorcrypt.com";

export class CollectorCrypt {
  constructor({ apiKey = "", baseUrl = BASE, log = () => {} } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.log = log;
  }

  async #req(path, init = {}) {
    const res = await fetch(this.baseUrl + path, {
      ...init,
      headers: {
        accept: "application/json",
        "user-agent": "vaul-keeper/0.1", // requests without a User-Agent are rejected at the edge
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    if (!res.ok) {
      const msg = typeof body === "object" ? body.message : text.slice(0, 200);
      const retry = res.status === 429 ? ` (retry in ${body?.retryAfter ?? 60}s)` : "";
      throw new Error(`Collector Crypt ${res.status} ${path.split("?")[0]}: ${msg}${retry}`);
    }
    return body;
  }

  /**
   * Cheapest graded cards in `category` (e.g. "Pokemon", "One Piece") that the keeper can buy:
   * listed on Collector Crypt's own marketplace, in USDC, as MPL Core assets (the standard the
   * keeper can also deliver to raffle winners). Lowest price first.
   */
  async cheapest(category, { want = 3, pages = 5, step = 1000 } = {}) {
    const wanted = category.toLowerCase();
    const out = [];
    let cursor = null;
    for (let page = 0; page < pages && out.length < want; page++) {
      const q = new URLSearchParams({ step: String(step), orderBy: "listedPriceAsc", marketplaceSource: "CC" });
      if (cursor) q.set("cursor", cursor);
      const data = await this.#req(`/marketplace?${q}`);
      for (const c of data.filterNFtCard || []) {
        if (isBuyable(c, wanted)) out.push(toListing(c));
        if (out.length >= want) break;
      }
      cursor = data.nextCursor;
      if (!cursor) break;
    }
    return out;
  }

  /** Live market state of one card: its active listing (or null) and owner. */
  async market(mint) {
    const m = await this.#req(`/cards/publicNft/${mint}/market`);
    return { listing: m.listing || null, ownerWallet: m.owner?.wallet || null, status: m.status, nftStatus: m.nftStatus };
  }

  /** Unsigned buy transaction (base64) for `listing`, with `wallet` as buyer. */
  async buyTransaction(wallet, listing) {
    const tx = await this.#req("/marketplace/buy", {
      method: "POST",
      body: JSON.stringify({ wallet, nftAddress: listing.mint, price: listing.usdc, isV2Listing: true, tokenStandard: "CoreNft" }),
    });
    if (typeof tx !== "string" || !tx) throw new Error("Collector Crypt returned no buy transaction");
    return tx;
  }

  /** Broadcasts a signed transaction through Collector Crypt. Returns the Solana signature. */
  async broadcast(wallet, signedTransaction) {
    const res = await this.#req("/marketplace/broadcast", { method: "POST", body: JSON.stringify({ wallet, signedTransaction }) });
    if (!res?.signature) throw new Error(`Collector Crypt broadcast failed: ${JSON.stringify(res).slice(0, 200)}`);
    return res.signature;
  }
}

/** A card the keeper may buy: graded, the wanted category, a USDC listing on CC, MPL Core. */
export function isBuyable(card, category) {
  const l = card.listing;
  return String(card.category || "").toLowerCase() === category
    && !!card.gradingCompany
    && card.nftStandard === "core"
    && l && l.marketplace === "CC" && l.currency === "USDC" && Number(l.price) > 0;
}

export function toListing(card) {
  return {
    mint: card.nftAddress,
    usdc: Number(card.listing.price),
    price: BigInt(Math.round(Number(card.listing.price) * 1e6)), // USDC base units
    name: card.itemName,
    grade: [card.gradingCompany, card.grade].filter(Boolean).join(" "),
    image: card.frontImage || null,
    cc: true,
  };
}
