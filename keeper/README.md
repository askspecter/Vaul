# LaunchNFT keeper

A long-running Node process that keeps every LaunchNFT vault moving:

| Step | What it does | On-chain guard |
| --- | --- | --- |
| **Harvest** | Calls `FeeRouter.harvest()` once `pending()` ≥ `MIN_HARVEST_ETH`. It sweeps the Pons curve, claims from the escrow and splits 80/20. | Permissionless; the split is fixed in the contract. |
| **Sweep** | Reads the cheapest ETH listing for the paired collection on OpenSea. It posts a ceiling (floor + `CEILING_MARKUP_BPS`, at most `MAX_CEILING_ETH`), gets Seaport fulfillment calldata with the vault as buyer, simulates, then calls `vault.buy`. | Seaport must be allow-listed, price ≤ ceiling, the ceiling expires after 1h, the vault must receive the NFT and must not overspend. |
| **Raffle: open** | For each bought NFT not yet raffled, it replays the coin's `Transfer` logs. Tickets are proportional to each wallet's balance; contracts such as the curve, pools and the vault are excluded. It publishes the Merkle root and writes `SNAPSHOT_DIR/<vault>-<id>.json` with every proof. | The root is public for 15 minutes before any draw. |
| **Raffle: draw** | After the delay: `commitDraw`, then `draw` once the pinned chain block exists. | The seed is the hash of a future chain block (ArbSys). |
| **Raffle: deliver** | Calls `claim` for the winner using the snapshot proof. The NFT goes straight to their wallet. | Merkle proof checked on-chain; anyone could do this. |

Every transaction is simulated before it is sent. `DRY_RUN=1` simulates only.

## Run

```sh
npm install
cp .env.example .env    # fill KEEPER_PRIVATE_KEY, LAUNCHER, START_BLOCK, OPENSEA_API_KEY
npm run once            # single pass, good for checking config
npm start               # loop every INTERVAL_SEC
```

Run it under a process manager such as systemd, pm2 or a container with a restart policy.

**OpenSea key:** with `OPENSEA_API_KEY` empty, the keeper creates a free-tier key itself and renews it before its 7-day expiry. Free-tier limits are low (fulfillment is about 5/minute), which is enough to start. For production, use a full key from https://opensea.io/settings/developer. On a `429` the keeper pauses OpenSea calls until the time given in `Retry-After`.

**Snapshots for a static site (Vercel):** set `SNAPSHOT_PORT`. The keeper then serves `SNAPSHOT_DIR` read-only with CORS at `/<vault>-<id>.json`, plus `/health`. Put it behind HTTPS (a Caddy/nginx reverse proxy, or the host's HTTPS URL) and set `snapshotBaseUrl` in the site's `config.js` to that URL.

## Run on GitHub Actions (no server)

`.github/workflows/keeper.yml` runs one pass every 30 minutes (`--once`) and commits new raffle snapshots to `snapshots/`, which the static site serves. Configure it with the repo secrets `KEEPER_PRIVATE_KEY` and `OPENSEA_API_KEY`, and the variables `LAUNCHER` and `START_BLOCK`. The workflow does nothing until `LAUNCHER` is set. See `../PANDUAN-HP.md`.

## Test

```sh
bash test/e2e.sh   # needs foundry; runs anvil with mocked Pons + marketplace
```

The e2e test runs harvest, buy, snapshot, openRaffle, commitDraw, draw and delivery, and checks that the NFT reaches a holder.

## Notes

- Keep the keeper key separate from the Registry owner key. If the keeper key leaks, the owner calls `Registry.setKeeper(newAddress)`.
- Holders who hold through smart-contract wallets are excluded from raffles (only EOAs get tickets).
- The OpenSea fulfillment encoding is generic, and every buy is simulated before sending. Run with `DRY_RUN=1` first on mainnet and check the logs before going live.
