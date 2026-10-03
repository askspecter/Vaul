// Test-only overrides loaded via KEEPER_TEST_HOOKS: a local "target chain" (second anvil),
// an instant bridge that credits the keeper there, and a stand-in for OpenSea that lists
// MockMarket's token on the target chain.
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, encodeFunctionData, toHex } from "viem";

const market = parseAbi([
  "function listings(uint256) view returns (address seller, uint256 price)",
  "function fill(uint256 id) payable",
]);

export default function hooks({ account }) {
  const chainId = Number(process.env.TARGET_CHAIN);
  const url = process.env.TARGET_RPC;
  const chain = defineChain({ id: chainId, name: "Target", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
  const pub = createPublicClient({ chain, transport: http(url) });
  const wallet = createWalletClient({ account, chain, transport: http(url) });
  const MARKET = process.env.TARGET_MARKET;
  const NFT = process.env.TARGET_NFT;
  const TOKEN_ID = 7n;

  const fakeOpenSea = {
    forChain: () => fakeOpenSea,
    async bestListings() {
      const [seller, price] = await pub.readContract({ address: MARKET, abi: market, functionName: "listings", args: [TOKEN_ID] });
      if (seller === "0x0000000000000000000000000000000000000000") return [];
      return [{ price, token: NFT, tokenId: TOKEN_ID }];
    },
    async fulfillment(listing) {
      return { to: MARKET, value: listing.price, data: encodeFunctionData({ abi: market, functionName: "fill", args: [listing.tokenId] }) };
    },
  };

  const bridge = {
    quote: async (_chain, amount) => ({ amountIn: amount, amountOut: amount }),
    async send(_chain, amount) {
      const bal = await pub.getBalance({ address: account.address });
      await pub.request({ method: "anvil_setBalance", params: [account.address, toHex(bal + amount)] });
    },
  };

  return { opensea: fakeOpenSea, bridge, targetClients: { [chainId]: { public: pub, wallet } } };
}
