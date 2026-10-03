// Vaul's own contracts (deployed 3 Oct 2026, see PANDUAN-HP.md). While `launcher` is empty the
// site shows a setup banner and launching is disabled.
// The API (api/*.js) reads these same values, so this is the only place to change them.
export const CONFIG = {
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  ponsFactory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  seaport: "0x0000000000000068F116a894984e2DB1123eB395",
  launcher: "0xc3fcb48dfcc3716cdc57312646046cd01dfaa477", // Vaul Launcher (Registry 0x73235cfd5c8ea0a8177ec3f61467c6452613f586)
  startBlock: 78887766, // block the Vaul Registry was deployed in
  snapshotBaseUrl: "snapshots/", // where the keeper's SNAPSHOT_DIR is served
  externalLauncher: "0xfc33e6b4200038984d3f6d5333b690d064294550", // Vaul external launcher (Ethereum / Base / Hyperliquid / Solana)
  // Chains a coin can collect NFTs on. Ids for non-Robinhood chains follow Relay's chain ids.
  chains: {
    4663: { name: "Robinhood", evm: true, currency: "ETH", explorer: "https://robinhoodchain.blockscout.com", opensea: "robinhood", icon: "assets/chains/robinhood.png" },
    1: { name: "Ethereum", evm: true, currency: "ETH", explorer: "https://etherscan.io", rpc: "https://ethereum-rpc.publicnode.com", opensea: "ethereum", icon: "assets/chains/ethereum.png" },
    8453: { name: "Base", evm: true, currency: "ETH", explorer: "https://basescan.org", rpc: "https://base-rpc.publicnode.com", opensea: "base", icon: "assets/chains/base.jpg" },
    999: { name: "Hyperliquid", evm: true, currency: "HYPE", explorer: "https://hyperevmscan.io", rpc: "https://rpc.hyperliquid.xyz/evm", opensea: "hyperevm", icon: "assets/chains/hyperliquid.jpg" },
    792703809: { name: "Solana", evm: false, currency: "SOL", explorer: "https://solscan.io", icon: "assets/chains/solana.jpg" },
  },
  collectionsUrl: "collections.json", // names + marketplace slugs for listed collections
  hiddenLaunches: [], // launch ids kept off the site's lists (the contracts still run them)
  x: "UseVaul", // X / Twitter handle shown in the menu
  // Reown (WalletConnect) Project ID from https://cloud.reown.com. Public by design.
  // Empty = fall back to the browser's injected wallet only.
  reownProjectId: "5c559ec7c86f657976f14d599d5e66b5",
};
