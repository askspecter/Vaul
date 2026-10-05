// GET /api/grails -> { ethUsd, grails: [{ tag, name, priceUsd, priceEth, card, image, mint }] }
//
// Grail Mode: the live price of each grail in collections.json, i.e. the cheapest card on
// Collector Crypt that meets the grail's spec, found with the same code the keeper buys with
// (keeper/src/collectorcrypt.js). `priceUsd` is null while no matching card is listed.
const fs = require("fs");
const path = require("path");

let cc;
async function client() {
  if (!cc) {
    const { CollectorCrypt } = await import("../keeper/src/collectorcrypt.js");
    cc = new CollectorCrypt({ apiKey: process.env.COLLECTOR_CRYPT_API_KEY || "" });
  }
  return cc;
}

async function ethUsd() {
  const res = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=ETH");
  const { data } = await res.json();
  return Number(data.rates.USD);
}

module.exports = async (req, res) => {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "collections.json"), "utf8"));
    const specs = all.filter((c) => c.kind === "grail");
    const [cc, usd] = await Promise.all([client(), ethUsd()]);
    const grails = await Promise.all(specs.map(async (g) => {
      const [l] = await cc.cheapest(g, { want: 1, pages: 3 }).catch(() => []);
      return {
        tag: g.tag, name: g.name,
        priceUsd: l ? l.usdc : null, priceEth: l ? l.usdc / usd : null,
        card: l ? l.name : null, image: l ? l.image : null, mint: l ? l.mint : null,
      };
    }));
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
    return res.status(200).json({ ethUsd: usd, grails });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
};
