// Solana side of the keeper: its wallet, balances, OpenSea buys and NFT transfers.
import {
  Connection, Keypair, PublicKey, VersionedTransaction, Transaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction, createBurnCheckedInstruction, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import { log } from "./log.js";

export class SolanaSide {
  constructor({ secretKey, rpc }) {
    this.keypair = Keypair.fromSecretKey(bs58.decode(secretKey));
    this.address = this.keypair.publicKey.toBase58();
    this.conn = new Connection(rpc || "https://api.mainnet-beta.solana.com", "confirmed");
  }

  /** A Solana address as the bytes32 hex the vault stores. */
  toBytes32(base58) {
    return `0x${Buffer.from(new PublicKey(base58).toBytes()).toString("hex")}`;
  }

  fromBytes32(hex) {
    return new PublicKey(Buffer.from(hex.slice(2), "hex")).toBase58();
  }

  async balance() {
    return BigInt(await this.conn.getBalance(this.keypair.publicKey));
  }

  /**
   * Buys an OpenSea Solana listing: OpenSea returns co-signed transaction bytes; we add our
   * signature to those exact bytes (never rebuild them) and broadcast. Returns the last signature.
   */
  async buy(listing, opensea, dryRun) {
    const encoded = await opensea.solanaFulfillment(listing, this.address);
    let sig = null;
    for (const b64 of encoded) {
      const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
      tx.sign([this.keypair]);
      const sim = await this.conn.simulateTransaction(tx, { sigVerify: false });
      if (sim.value.err) throw new Error(`Solana buy simulation failed: ${JSON.stringify(sim.value.err)}`);
      if (dryRun) { log(`[dry-run] buy ${listing.mint} for ${Number(listing.price) / 1e9} SOL`); return null; }
      sig = await this.conn.sendRawTransaction(tx.serialize());
      await this.conn.confirmTransaction(sig, "confirmed");
    }
    log(`bought ${listing.mint} on Solana ✓ ${sig}`);
    return sig;
  }

  async #send(ixs, dryRun, label) {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = this.keypair.publicKey;
    tx.recentBlockhash = (await this.conn.getLatestBlockhash()).blockhash;
    tx.sign(this.keypair);
    const sim = await this.conn.simulateTransaction(tx);
    if (sim.value.err) {
      throw new Error(`${label} simulation failed (programmable/compressed NFTs need a manual transfer): ${JSON.stringify(sim.value.err)}`);
    }
    if (dryRun) return log(`[dry-run] ${label}`), null;
    const sig = await this.conn.sendRawTransaction(tx.serialize());
    await this.conn.confirmTransaction(sig, "confirmed");
    log(`${label} ✓ ${sig}`);
    return sig;
  }

  /** Transfers a standard SPL NFT (mint given as bytes32 hex) to `destination` (bytes32 hex). */
  async transfer(mintHex, destinationHex, dryRun) {
    const mint = new PublicKey(Buffer.from(mintHex.slice(2), "hex"));
    const dest = new PublicKey(Buffer.from(destinationHex.slice(2), "hex"));
    const from = getAssociatedTokenAddressSync(mint, this.keypair.publicKey);
    const to = getAssociatedTokenAddressSync(mint, dest, true);
    return this.#send([
      createAssociatedTokenAccountIdempotentInstruction(this.keypair.publicKey, to, dest, mint),
      createTransferCheckedInstruction(from, mint, to, this.keypair.publicKey, 1, 0, [], TOKEN_PROGRAM_ID),
    ], dryRun, `transfer ${mint.toBase58()} → ${dest.toBase58()}`);
  }

  async burn(mintBase58, dryRun) {
    const mint = new PublicKey(mintBase58);
    const account = getAssociatedTokenAddressSync(mint, this.keypair.publicKey);
    return this.#send([createBurnCheckedInstruction(account, mint, this.keypair.publicKey, 1, 0)], dryRun, `burn ${mintBase58}`);
  }
}

export const lamportsToSol = (l) => Number(l) / LAMPORTS_PER_SOL;
