// Solana side of the keeper: its wallet, balances, OpenSea and Collector Crypt buys, and NFT
// transfers (SPL NFTs and Metaplex Core assets).
import {
  Connection, Keypair, PublicKey, VersionedTransaction, Transaction, TransactionInstruction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction, createBurnCheckedInstruction, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import { log } from "./log.js";

export const MPL_CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/**
 * Reads a Metaplex Core asset account: Key (1 byte, AssetV1 = 1), owner (32), then the update
 * authority (1-byte kind: 0 none, 1 address, 2 collection; + 32 bytes).
 */
export function parseCoreAsset(data) {
  if (data[0] !== 1) throw new Error("not a Metaplex Core asset");
  const kind = data[33];
  return {
    owner: new PublicKey(data.subarray(1, 33)),
    collection: kind === 2 ? new PublicKey(data.subarray(34, 66)) : null,
  };
}

/**
 * Metaplex Core TransferV1 (discriminator 14, no compression proof). Unused optional accounts
 * are passed as the program id, as the official client does; the payer signs as the owner.
 */
export function coreTransferInstruction({ asset, collection, payer, newOwner }) {
  const none = { pubkey: MPL_CORE, isSigner: false, isWritable: false };
  return new TransactionInstruction({
    programId: MPL_CORE,
    keys: [
      { pubkey: asset, isSigner: false, isWritable: true },
      collection ? { pubkey: collection, isSigner: false, isWritable: false } : none,
      { pubkey: payer, isSigner: true, isWritable: true },
      none, // authority: defaults to the payer
      { pubkey: newOwner, isSigner: false, isWritable: false },
      none, // system program
      none, // log wrapper
    ],
    data: Buffer.from([14, 0]),
  });
}

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

  /** Balance of an SPL token (e.g. USDC) in base units; 0 when the account does not exist yet. */
  async tokenBalance(mintBase58) {
    const ata = getAssociatedTokenAddressSync(new PublicKey(mintBase58), this.keypair.publicKey);
    const r = await this.conn.getTokenAccountBalance(ata).catch(() => null);
    return BigInt(r?.value?.amount || 0);
  }

  /** Owner and collection of a Metaplex Core asset, or null when the mint is not a Core asset. */
  async coreAsset(mint) {
    const acc = await this.conn.getAccountInfo(new PublicKey(mint));
    if (!acc || !acc.owner.equals(MPL_CORE)) return null;
    return parseCoreAsset(acc.data);
  }

  /**
   * Buys a Collector Crypt listing: the API builds the transaction, we sign it without changing
   * its bytes (it may already carry the platform's fee-payer signature) and broadcast it through
   * the API. Confirms that the card is ours afterwards. Returns the signature.
   */
  async buyCollectorCrypt(cc, listing, dryRun) {
    const b64 = await cc.buyTransaction(this.address, listing);
    const raw = Buffer.from(b64, "base64");
    let tx;
    try {
      tx = VersionedTransaction.deserialize(raw);
      tx.sign([this.keypair]);
    } catch {
      tx = Transaction.from(raw);
      tx.partialSign(this.keypair);
    }
    const sim = tx instanceof VersionedTransaction
      ? await this.conn.simulateTransaction(tx, { sigVerify: false })
      : await this.conn.simulateTransaction(tx);
    if (sim.value.err) throw new Error(`Collector Crypt buy simulation failed: ${JSON.stringify(sim.value.err)}`);
    if (dryRun) { log(`[dry-run] buy ${listing.name} (${listing.mint}) for ${listing.usdc} USDC`); return null; }
    const signed = Buffer.from(tx instanceof VersionedTransaction ? tx.serialize() : tx.serialize({ requireAllSignatures: true })).toString("base64");
    const sig = await cc.broadcast(this.address, signed);
    await this.conn.confirmTransaction(sig, "confirmed");
    const asset = await this.coreAsset(listing.mint);
    if (!asset?.owner.equals(this.keypair.publicKey)) throw new Error(`bought ${listing.mint} but it is not in the keeper wallet (${sig})`);
    log(`bought ${listing.name} for ${listing.usdc} USDC on Collector Crypt ✓ ${sig}`);
    return sig;
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

  /** Transfers an NFT (mint given as bytes32 hex) to `destination` (bytes32 hex): a Metaplex Core
   *  asset (Collector Crypt cards) or a standard SPL NFT. */
  async transfer(mintHex, destinationHex, dryRun) {
    const mint = new PublicKey(Buffer.from(mintHex.slice(2), "hex"));
    const dest = new PublicKey(Buffer.from(destinationHex.slice(2), "hex"));
    const core = await this.coreAsset(mint);
    if (core) {
      return this.#send([coreTransferInstruction({ asset: mint, collection: core.collection, payer: this.keypair.publicKey, newOwner: dest })],
        dryRun, `transfer ${mint.toBase58()} → ${dest.toBase58()}`);
    }
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
