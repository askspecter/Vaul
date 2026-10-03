import "dotenv/config";
import { parseEther, isAddress } from "viem";

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (see .env.example)`);
  return v;
}

export function loadConfig() {
  const cfg = {
    rpcUrl: process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    chainId: Number(process.env.CHAIN_ID || 4663),
    privateKey: req("KEEPER_PRIVATE_KEY"),
    launcher: req("LAUNCHER"),
    externalLauncher: process.env.EXTERNAL_LAUNCHER || "",
    collectionsFile: process.env.COLLECTIONS_FILE || "../collections.json",
    solanaKey: process.env.KEEPER_SOLANA_KEY || "",
    solanaRpc: process.env.SOLANA_RPC || "",
    startBlock: BigInt(process.env.START_BLOCK || 0),
    openseaApiKey: process.env.OPENSEA_API_KEY || "",
    sweepDisabled: process.env.SWEEP_DISABLED === "1",
    snapshotPort: Number(process.env.SNAPSHOT_PORT || process.env.PORT || 0),
    openseaChain: process.env.OPENSEA_CHAIN || "robinhood",
    seaport: process.env.SEAPORT || "0x0000000000000068F116a894984e2DB1123eB395",
    ceilingMarkupBps: BigInt(process.env.CEILING_MARKUP_BPS || 300),
    maxCeiling: parseEther(process.env.MAX_CEILING_ETH || "5"),
    minHarvest: parseEther(process.env.MIN_HARVEST_ETH || "0.005"),
    minTicketBalance: parseEther(process.env.MIN_TICKET_TOKENS || "0"),
    snapshotDir: process.env.SNAPSHOT_DIR || "../snapshots",
    intervalSec: Number(process.env.INTERVAL_SEC || 60),
    dryRun: process.env.DRY_RUN === "1",
    logChunk: BigInt(process.env.LOG_CHUNK || 50_000),
  };
  if (!isAddress(cfg.launcher)) throw new Error("LAUNCHER is not an address");
  return cfg;
}
