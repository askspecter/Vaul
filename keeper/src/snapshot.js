import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, zeroAddress } from "viem";
import { erc20Abi } from "./abi.js";

const DEAD = "0x000000000000000000000000000000000000dEaD";

/** Replays Transfer logs to get balances at `toBlock`. */
export async function balancesAt(client, token, fromBlock, toBlock, chunk) {
  const bal = new Map();
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = start + chunk - 1n > toBlock ? toBlock : start + chunk - 1n;
    const logs = await client.getContractEvents({
      address: token, abi: erc20Abi, eventName: "Transfer", fromBlock: start, toBlock: end,
    });
    for (const { args } of logs) {
      const { from, to, value } = args;
      if (from !== zeroAddress) bal.set(from, (bal.get(from) || 0n) - value);
      bal.set(to, (bal.get(to) || 0n) + value);
    }
  }
  return bal;
}

/**
 * Holders become ticket ranges [start, end) proportional to balance. Contracts (curve,
 * pools, lockers, the vault) and burn addresses are excluded, so only wallets can win.
 * Leaves are (address account, uint256 start, uint256 end), matching SweepVault.claim.
 */
export async function buildSnapshot(client, balances, { exclude = [], minBalance = 0n }) {
  const skip = new Set([zeroAddress, DEAD, ...exclude].map((a) => getAddress(a)));
  const holders = [];
  for (const [addr, amount] of balances) {
    const a = getAddress(addr);
    if (amount <= minBalance || amount === 0n || skip.has(a)) continue;
    holders.push([a, amount]);
  }
  // Drop contracts (checked in parallel, bounded batches).
  const eoas = [];
  for (let i = 0; i < holders.length; i += 50) {
    const batch = holders.slice(i, i + 50);
    const codes = await Promise.all(batch.map(([a]) => client.getCode({ address: a })));
    batch.forEach((h, j) => { if (!codes[j] || codes[j] === "0x") eoas.push(h); });
  }
  eoas.sort((x, y) => (x[0].toLowerCase() < y[0].toLowerCase() ? -1 : 1));

  let cursor = 0n;
  const values = eoas.map(([a, amount]) => {
    const row = [a, cursor.toString(), (cursor + amount).toString()];
    cursor += amount;
    return row;
  });
  if (!values.length) return null;

  const tree = StandardMerkleTree.of(values, ["address", "uint256", "uint256"]);
  const entries = [];
  for (const [i, v] of tree.entries()) entries.push({ account: v[0], start: v[1], end: v[2], proof: tree.getProof(i) });
  return { root: tree.root, totalTickets: cursor, entries };
}

export function winnerOf(snapshot, ticket) {
  const t = BigInt(ticket);
  return snapshot.entries.find((e) => BigInt(e.start) <= t && t < BigInt(e.end));
}
