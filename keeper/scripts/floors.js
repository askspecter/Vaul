// Refreshes data/floors.json: the OpenSea floor, owners and 7-day volume of every collection
// in collections.json, plus a USD value so floors on different chains can be compared.
// Run by .github/workflows/floors.yml.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const KEY = process.env.OPENSEA_API_KEY;
if (!KEY) throw new Error("OPENSEA_API_KEY missing");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function os(path) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`https://api.opensea.io/api/v2${path}`, { headers: { accept: "application/json", "x-api-key": KEY } });
    if (res.status === 429) {
      await sleep((Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`OpenSea ${res.status} ${path}`);
    await sleep(250);
    return res.json();
  }
  throw new Error(`OpenSea kept rate limiting ${path}`);
}

async function usdRates() {
  const res = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=USD");
  const { data } = await res.json();
  return Object.fromEntries(["ETH", "SOL", "HYPE"].filter((s) => data.rates[s]).map((s) => [s, 1 / Number(data.rates[s])]));
}

const collections = JSON.parse(await readFile("../collections.json", "utf8"));
const usd = await usdRates();
const items = [];
for (const c of collections) {
  if (!c.slug) continue;
  try {
    const s = await os(`/collections/${c.slug}/stats`);
    const week = (s.intervals || []).find((i) => i.interval === "seven_day") || {};
    const floor = s.total?.floor_price ?? 0;
    const symbol = s.total?.floor_price_symbol || "ETH";
    items.push({
      chainId: c.chainId, address: c.address, slug: c.slug, name: c.name, image: c.image || null,
      floor, symbol, floorUsd: usd[symbol] ? Math.round(floor * usd[symbol] * 100) / 100 : null,
      owners: s.total?.num_owners ?? null, volume7d: week.volume ?? 0, sales7d: week.sales ?? 0,
    });
  } catch (e) {
    console.warn(c.slug, e.message);
  }
}
items.sort((a, b) => (b.floorUsd ?? 0) - (a.floorUsd ?? 0));
await mkdir("../data", { recursive: true });
await writeFile("../data/floors.json", JSON.stringify({ updatedAt: new Date().toISOString(), usd, items }));
console.log(`wrote data/floors.json with ${items.length} collections`);
