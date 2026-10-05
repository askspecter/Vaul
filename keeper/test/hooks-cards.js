// Test-only overrides for test/e2e-cards.sh (a Card Vault on a local "Polygon"): OpenSea lists
// a basketball card and a cheaper-to-match Pokémon card in USDC, and the bridge mints USDC
// (1 ETH = 2000 USDC) or credits the chain's coin to the keeper.
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, encodeFunctionData, toHex } from "viem";

const market = parseAbi([
  "function listings(uint256) view returns (address seller, uint256 price)",
  "function fill(uint256 id)",
]);
const usdcAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const NAMES = { 5: "2018 Panini Prizm Basketball Luka Doncic PSA 10", 7: "1999 Pokemon Base Set Holo Charizard #4 PSA 8" };

export default function hooks({ account }) {
  const chainId = Number(process.env.TARGET_CHAIN);
  const url = process.env.TARGET_RPC;
  const chain = defineChain({ id: chainId, name: "Target", nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
  const pub = createPublicClient({ chain, transport: http(url) });
  const wallet = createWalletClient({ account, chain, transport: http(url) });
  const MARKET = process.env.TARGET_MARKET;
  const NFT = process.env.TARGET_NFT;
  const USDC = process.env.TARGET_USDC;

  const fakeOpenSea = {
    forChain: () => fakeOpenSea,
    async bestListings() {
      const out = [];
      for (const id of [5n, 7n]) {
        const [seller, price] = await pub.readContract({ address: MARKET, abi: market, functionName: "listings", args: [id] });
        if (seller !== "0x0000000000000000000000000000000000000000") out.push({ price, token: NFT, tokenId: id, paymentToken: USDC, currency: "USDC" });
      }
      return out.sort((a, b) => (a.price < b.price ? -1 : 1));
    },
    async nft(_contract, id) {
      return { name: NAMES[Number(id)] || "", description: "", traits: [] };
    },
    async fulfillment(listing) {
      return { to: MARKET, value: 0n, data: encodeFunctionData({ abi: market, functionName: "fill", args: [listing.tokenId] }) };
    },
  };

  const bridge = {
    // amount is what should arrive: USDC units (6 decimals) or wei of the chain's coin
    quote: async (_chain, amount, _type, currency) => ({ amountIn: currency ? (amount * 10n ** 12n) / 2000n : amount, amountOut: amount }),
    async send(_chain, amountWei, currency) {
      if (currency && currency !== "0x0000000000000000000000000000000000000000") {
        const h = await wallet.writeContract({ address: USDC, abi: usdcAbi, functionName: "mint", args: [account.address, (amountWei * 2000n) / 10n ** 12n] });
        await pub.waitForTransactionReceipt({ hash: h });
        return;
      }
      const bal = await pub.getBalance({ address: account.address });
      await pub.request({ method: "anvil_setBalance", params: [account.address, toHex(bal + amountWei)] });
    },
  };

  return { opensea: fakeOpenSea, bridge, paymentSpender: MARKET, targetClients: { [chainId]: { public: pub, wallet } } };
}
