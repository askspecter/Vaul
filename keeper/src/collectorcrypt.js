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
   * Cheapest graded cards the keeper can buy that match `spec`: listed on Collector Crypt's own
   * marketplace, in USDC, as MPL Core assets (the standard the keeper can also deliver to raffle
   * winners). `spec` is a category name ("Pokemon", "One Piece") or a grail spec (see
   * matchesSpec); a spec's `search` narrows the API query. Lowest price first.
   */
  async cheapest(spec, { want = 3, pages = 5, step = 1000 } = {}) {
    if (typeof spec === "string") spec = { category: spec };
    const out = [];
    let cursor = null;
    for (let page = 0; page < pages && out.length < want; page++) {
      const q = new URLSearchParams({ step: String(step), orderBy: "listedPriceAsc", marketplaceSource: "CC" });
      if (spec.search) q.set("search", spec.search);
      if (spec.minUsd) q.set("listPriceMin", String(spec.minUsd));
      if (cursor) q.set("cursor", cursor);
      const data = await this.#req(`/marketplace?${q}`);
      for (const c of data.filterNFtCard || []) {
        if (isBuyable(c, spec.category.toLowerCase()) && matchesSpec(c, spec)) out.push(toListing(c));
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

/**
 * Grail Mode: does a card meet the grail spec? Every `must` word appears in its name, it is
 * graded by one of `graders` (any when omitted) at exactly `grade` (when given), and it is
 * listed at `minUsd` or more, so a "PSA 10 Charizard" grail never settles for a $40 promo.
 */
export function matchesSpec(card, spec) {
  const name = String(card.itemName || "").toLowerCase();
  if ((spec.must || []).some((w) => !name.includes(w.toLowerCase()))) return false;
  const grader = String(card.gradingCompany || "").toLowerCase();
  if (spec.graders?.length && !spec.graders.some((g) => g.toLowerCase() === grader)) return false;
  if (spec.grade != null) {
    const g = String(spec.grade);
    const named = new RegExp(`\\b(psa|cgc|bgs|beckett|sgc)\\s*${g}\\b`, "i").test(card.itemName || "");
    const field = Number(card.gradeNum) === Number(g) || new RegExp(`(^|\\s)${g}$`).test(String(card.grade || "").trim());
    if (!named && !field) return false;
  }
  return !(spec.minUsd && Number(card.listing?.price) < spec.minUsd);
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
