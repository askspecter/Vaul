// Card Vaults: category tags, category matching and picking the cheapest matching card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ExternalKeeper, tagHex, matchesCategory } from "../src/external.js";

const COURTYARD = "0x251BE3A17Af4892035C37ebf5890F4a4D889dcAD";
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const NATIVE = "0x0000000000000000000000000000000000000000";
const entries = [
  { chainId: 137, address: COURTYARD, tag: "pokemon", name: "Pokémon Cards", slug: "courtyard-nft", match: ["pokemon", "pokémon"] },
  { chainId: 137, address: COURTYARD, tag: "onepiece", name: "One Piece Cards", slug: "courtyard-nft", match: ["one piece"] },
  { chainId: 8453, address: "0x00000000000000000000000000000000000000aa", name: "Plain", slug: "plain" },
];
const id32 = (tag, addr) => `0x${tagHex(tag)}${addr.slice(2).toLowerCase()}`;

test("tag sits in the 12 bytes in front of the address", () => {
  assert.equal(tagHex("pokemon"), "706f6b656d6f6e0000000000");
  assert.equal(tagHex(undefined), "0".repeat(24));
  assert.equal(id32("onepiece", COURTYARD).length, 66);
});

test("meta() tells categories of the same contract apart", () => {
  const k = new ExternalKeeper({ collections: entries });
  assert.equal(k.meta(137, id32("pokemon", COURTYARD)).name, "Pokémon Cards");
  assert.equal(k.meta(137, id32("onepiece", COURTYARD)).name, "One Piece Cards");
  assert.equal(k.meta(137, id32(undefined, COURTYARD)), undefined); // untagged id is not a card vault
  assert.equal(k.meta(8453, id32(undefined, entries[2].address)).name, "Plain");
});

test("matchesCategory reads names and traits, ignoring case and accents", () => {
  const nft = (name, traits = []) => ({ name, description: "", traits });
  assert.ok(matchesCategory(nft("1999 Pokemon Base Set Holo Charizard #4 PSA 9"), ["pokémon"]));
  assert.ok(matchesCategory(nft("Shanks OP01-120", ["Category: One Piece"]), ["one piece"]));
  assert.ok(!matchesCategory(nft("2018 Panini Prizm Luka Doncic PSA 10", ["Category: Basketball"]), ["pokemon", "one piece"]));
});

test("cardFloor skips other categories and keeps the cheapest per currency", async () => {
  const listings = [
    { token: COURTYARD, tokenId: 1n, price: 3_000_000n, paymentToken: USDC }, // basketball, cheapest
    { token: COURTYARD, tokenId: 2n, price: 9_000_000n, paymentToken: USDC }, // pokemon
    { token: COURTYARD, tokenId: 3n, price: 40n * 10n ** 18n, paymentToken: NATIVE }, // pokemon, POL
    { token: COURTYARD, tokenId: 4n, price: 10_000_000n, paymentToken: USDC }, // pokemon, pricier
  ];
  const names = { 1: "Panini Prizm Basketball", 2: "Pokemon Evolutions Charizard", 3: "Pokémon Pikachu", 4: "Pokemon Mew" };
  let lookups = 0;
  const os = {
    forChain: () => os,
    bestListings: async () => listings,
    nft: async (_c, id) => (lookups++, { name: names[id], description: "", traits: [] }),
  };
  const k = new ExternalKeeper({
    collections: entries, opensea: os, account: { address: "0x00000000000000000000000000000000000000bb" },
    // 1 ETH buys 1000 USDC or 5000 POL; the keeper already holds gas.
    bridge: { quote: async (_c, amount, _t, cur) => ({ amountIn: cur ? amount * 10n ** 12n / 1000n : amount / 5000n }) },
    targetClients: { 137: { public: { getBalance: async () => 10n ** 19n } } },
  });
  const f = await k.cardFloor({ id: "e0", chainId: 137 }, entries[0]);
  assert.equal(f.options.length, 2);
  const usdc = f.options.find((o) => o.paymentToken === USDC);
  assert.equal(usdc.listing.tokenId, 2n);
  assert.equal(usdc.needed, 9_000_000n);
  const pol = f.options.find((o) => o.paymentToken === NATIVE);
  assert.equal(pol.needed, 42n * 10n ** 18n); // price + 2 POL gas reserve
  // 42 POL costs 0.0084 ETH, 9 USDC costs 0.009 ETH: the POL card is the cheaper buy.
  assert.equal(f.listing.tokenId, 3n);
  assert.equal(f.ethCost, 8_400_000_000_000_000n);
  assert.equal(f.options[1].ethCost, 9_000_000_000_000_000n);
  assert.equal(lookups, 3); // listing 4 never looked up: a cheaper USDC Pokémon card was found

  await k.cardFloor({ id: "e0", chainId: 137 }, entries[0]);
  assert.equal(lookups, 3, "lookups are cached");
});
