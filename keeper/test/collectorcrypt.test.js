// Collector Crypt Card Vaults: which cards are buyable, pricing in USDC on Solana, buy routing,
// and the Metaplex Core transfer used to deliver prizes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey, Keypair } from "@solana/web3.js";
import { ExternalKeeper, tagHex } from "../src/external.js";
import { isBuyable, toListing, matchesSpec } from "../src/collectorcrypt.js";
import { coreTransferInstruction, parseCoreAsset, MPL_CORE } from "../src/solana.js";

const SOL = 792703809;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const entry = { chainId: SOL, address: "CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac", kind: "cards", market: "collectorcrypt", tag: "cc-pokemon", category: "Pokemon", name: "Pokémon Cards" };
const card = (over = {}) => ({
  nftAddress: "H989XWkP66uXyHUSTHiactEFLgnGWbU7mxXQh1AN8Gsg", itemName: "2020 Pokemon Darkness Ablaze Dedenne #78 CGC 9", category: "Pokemon",
  gradingCompany: "CGC", grade: "MINT 9", nftStandard: "core", listing: { price: 12.09, currency: "USDC", marketplace: "CC" }, ...over,
});
const fakeSolana = {
  toBytes32: (b58) => `0x${Buffer.from(new PublicKey(b58).toBytes()).toString("hex")}`,
  balance: async () => 50_000_000n, tokenBalance: async () => 0n,
};

test("only graded Core cards of the category, listed on CC in USDC, are buyable", () => {
  assert.ok(isBuyable(card(), "pokemon"));
  assert.ok(!isBuyable(card({ category: "Moonbirds" }), "pokemon"));
  assert.ok(!isBuyable(card({ gradingCompany: null }), "pokemon"), "ungraded");
  assert.ok(!isBuyable(card({ nftStandard: "pnft" }), "pokemon"), "not Core");
  assert.ok(!isBuyable(card({ listing: { price: 12, currency: "USDC", marketplace: "ME" } }), "pokemon"), "Magic Eden listing");
  assert.ok(!isBuyable(card({ listing: null }), "pokemon"));
  assert.ok(isBuyable(card({ category: "One Piece" }), "one piece"));
  assert.equal(toListing(card()).price, 12_090_000n);
});

test("Solana Card Vault ids are the tag itself", () => {
  const k = new ExternalKeeper({ collections: [entry], solana: fakeSolana });
  assert.equal(tagHex("cc-pokemon", 32).length, 64);
  assert.equal(k.meta(SOL, `0x${tagHex("cc-pokemon", 32)}`).name, "Pokémon Cards");
  assert.equal(k.meta(SOL, `0x${tagHex("cc-onepiece", 32)}`), undefined);
});

test("floor: cheapest card priced in USDC plus bridge, no gas top-up when SOL is there", async () => {
  const listing = toListing(card());
  const k = new ExternalKeeper({
    collections: [entry], solana: fakeSolana,
    cc: { cheapest: async (spec) => (assert.equal(spec.category, "Pokemon"), [listing]) },
    bridge: { quote: async (_c, amount, _t, cur) => (assert.equal(cur, USDC), { amountIn: (amount * 10n ** 12n) / 2000n }) },
  });
  const f = await k.floor({ id: "e1", chainId: SOL }, entry);
  assert.equal(f.paymentToken, USDC);
  assert.equal(f.needed, 12_090_000n);
  assert.equal(f.ethCost, 6_045_000_000_000_000n); // 12.09 USDC at 2000 USDC/ETH
  assert.equal(f.listing.tokenId, BigInt(fakeSolana.toBytes32(listing.mint)));
});

test("buy goes through Collector Crypt and records the purchase", async () => {
  const listing = { ...toListing(card()), tokenId: 1n };
  const calls = [];
  const k = new ExternalKeeper({
    cfg: { dryRun: false }, collections: [entry],
    solana: { buyCollectorCrypt: async (cc, l) => (calls.push(["buy", l.mint]), "5igSig") },
    cc: {}, send: async (label, req) => calls.push(["send", req.functionName, req.args[0]]),
    receipts: (_l, id, sig) => calls.push(["receipt", id, sig]),
  });
  await k.buy({ id: "e1", chainId: SOL, vault: "0x0000000000000000000000000000000000000001", policy: "raffle" }, { listing, ethCost: 5n, paymentToken: USDC });
  assert.deepEqual(calls, [["buy", listing.mint], ["send", "recordPurchase", 1n], ["receipt", 1n, "5igSig"]]);
});

test("Core transfer: discriminator 14, no proof, official account order", () => {
  const [asset, collection, payer, to] = [Keypair.generate(), Keypair.generate(), Keypair.generate(), Keypair.generate()].map((x) => x.publicKey);
  const ix = coreTransferInstruction({ asset, collection, payer, newOwner: to });
  assert.ok(ix.programId.equals(MPL_CORE));
  assert.deepEqual([...ix.data], [14, 0]);
  const keys = ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]);
  const none = [MPL_CORE.toBase58(), false, false];
  assert.deepEqual(keys, [[asset.toBase58(), false, true], [collection.toBase58(), false, false], [payer.toBase58(), true, true], none, [to.toBase58(), false, false], none, none]);
});

test("parseCoreAsset reads owner and collection", () => {
  const owner = Keypair.generate().publicKey, coll = Keypair.generate().publicKey;
  const data = Buffer.concat([Buffer.from([1]), owner.toBuffer(), Buffer.from([2]), coll.toBuffer(), Buffer.alloc(40)]);
  const a = parseCoreAsset(data);
  assert.ok(a.owner.equals(owner) && a.collection.equals(coll));
});

test("grail spec: the right card, the right grade, never a cheap stand-in", () => {
  const zard = { category: "Pokemon", search: "Charizard", must: ["charizard"], graders: ["PSA"], grade: 10, minUsd: 1000 };
  const c = (itemName, price, extra = {}) => card({ itemName, gradingCompany: "PSA", grade: null, gradeNum: null, listing: { price, currency: "USDC", marketplace: "CC" }, ...extra });
  assert.ok(matchesSpec(c("2009 #002 Charizard G LV.X-Holo 1st Edition PSA 10 Japanese", 4390), zard));
  assert.ok(!matchesSpec(c("2025 #013 Mega Charizard X EX PSA 10 Japanese", 42), zard), "below minUsd");
  assert.ok(!matchesSpec(c("2002 #3 Charizard-Reverse Foil PSA 1 Legendary Collection", 5000), zard), "PSA 1 is not PSA 10");
  assert.ok(!matchesSpec(c("1999 #4 Charizard-Holo PSA 9 Base Set", 3000), zard), "PSA 9");
  assert.ok(!matchesSpec(c("1998 Charizard CGC 10 Pristine CD Promo", 4800, { gradingCompany: "CGC" }), zard), "wrong grader");
  assert.ok(!matchesSpec(c("2019 Blastoise PSA 10", 2000), zard), "not a Charizard");
  assert.ok(matchesSpec(c("Charizard ex Special Art", 1500, { gradeNum: 10 }), zard), "grade from gradeNum");
  const manga = { category: "One Piece", must: ["manga art", "luffy"], grade: 10 };
  assert.ok(matchesSpec(c("2022 #P-001 Manga Art Monkey D. Luffy CGC 10 PRISTINE Promo", 250, { gradingCompany: "CGC" }), manga));
  assert.ok(!matchesSpec(c("2022 #ST01-002 Manga Art Usopp CGC 10 PRISTINE", 32, { gradingCompany: "CGC" }), manga));
});
