// Fill `launcher` and `startBlock` after running contracts/script/Deploy.s.sol on Robinhood Chain.
// While `launcher` is empty the site shows sample data and launching is disabled.
export const CONFIG = {
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  ponsFactory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  seaport: "0x0000000000000068F116a894984e2DB1123eB395",
  launcher: "0x4fbac0fe4ba373ea7c34661cb1b9934b6f4c5a37",
  startBlock: 70558619, // block the Registry was deployed in
  snapshotBaseUrl: "snapshots/", // where the keeper's SNAPSHOT_DIR is served
  externalLauncher: "0xdbe1b07b2e5c4d4c32c4813c360ba3341f766270", // Ethereum / Base / Hyperliquid / Solana collections
  // Chains a coin can collect NFTs on. Ids for non-Robinhood chains follow Relay's chain ids.
  chains: {
    4663: { name: "Robinhood", evm: true, currency: "ETH", explorer: "https://robinhoodchain.blockscout.com", opensea: "robinhood", icon: "assets/chains/robinhood.png" },
    1: { name: "Ethereum", evm: true, currency: "ETH", explorer: "https://etherscan.io", rpc: "https://ethereum-rpc.publicnode.com", opensea: "ethereum", icon: "assets/chains/ethereum.png" },
    8453: { name: "Base", evm: true, currency: "ETH", explorer: "https://basescan.org", rpc: "https://base-rpc.publicnode.com", opensea: "base", icon: "assets/chains/base.jpg" },
    999: { name: "Hyperliquid", evm: true, currency: "HYPE", explorer: "https://hyperevmscan.io", rpc: "https://rpc.hyperliquid.xyz/evm", opensea: "hyperevm", icon: "assets/chains/hyperliquid.jpg" },
    792703809: { name: "Solana", evm: false, currency: "SOL", explorer: "https://solscan.io", icon: "assets/chains/solana.jpg" },
  },
  collectionsUrl: "collections.json", // names + marketplace slugs for listed collections
  hiddenLaunches: ["0"], // launch ids kept off the site's lists (the contracts still run them)
  x: "vauldotapp", // X / Twitter handle shown in the menu
  // Reown (WalletConnect) Project ID from https://cloud.reown.com. Public by design.
  // Empty = fall back to the browser's injected wallet only.
  reownProjectId: "5c559ec7c86f657976f14d599d5e66b5",
};
