# LaunchNFT contracts — Robinhood Chain × Pons V2

Coins launched on [Pons V2](https://docs.ponsfamily.com/docs/v2) whose creator fees can only be spent on NFTs from one paired collection.

Network: Robinhood Chain mainnet, chain id `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com`.

## Flow

1. `Launcher.launch()` deploys a `SweepVault` and a `FeeRouter`, then calls Pons `launchToken` with `creatorFeeRecipient = FeeRouter`. `msg.value` must equal `pons.launchFee()`. Pons deploys the token and its bonding curve.
2. Every trade on the Pons curve accrues creator fees on the curve itself.
3. Anyone calls `FeeRouter.harvest()`. It sweeps the curve into the Pons fee escrow (only the fee recipient may do this before graduation), claims from the escrow, and sends 80% to the vault and 20% to the treasury.
4. The keeper posts a price ceiling (valid for 1 hour) and buys floor NFTs through Seaport 1.6. The vault checks that it received the NFT and spent no more than the ceiling.
5. What happens to the NFTs depends on the policy fixed at launch: **Raffle** (Merkle snapshot of holders, a 15-minute delay, then a draw from a future block hash), **Hold**, or **Burn**.

`FeeRouter` has no function that calls `transferCreatorFeeRecipient`, so the fee pairing can never change. `SweepVault` has no withdraw function.

| Contract | Role |
| --- | --- |
| `Launcher` | Entry point. Collection must be listed in `Registry`. |
| `FeeRouter` | Pons creator-fee recipient; permissionless `harvest()`. |
| `SweepVault` | Spends ETH only on the paired collection. |
| `Registry` | Owner-managed keeper, treasury, marketplace and collection allowlists. It cannot move vault funds or NFTs. |
| `interfaces/IPons.sol` | Pons V2 factory / escrow / curve functions, checked against deployed bytecode. |

External addresses (Robinhood Chain): Pons V2 factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`, Pons fee escrow `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`, Seaport 1.6 `0x0000000000000068F116a894984e2DB1123eB395`.

## Test

```sh
npm install
forge test                                        # unit tests with a mocked Pons
FORK=1 forge test --match-contract PonsFork -vv   # real Pons on a mainnet fork: launch → buy → harvest
```

## Deploy to mainnet

Use an encrypted keystore rather than pasting a private key: `cast wallet import deployer --interactive`.

```sh
KEEPER=0x... TREASURY=0x... forge script script/Deploy.s.sol \
  --rpc-url robinhood --account deployer --broadcast
```

Then:
- put the printed `Launcher` address into `../config.js`;
- list collections with `cast send <Registry> "setCollection(address,bool)" <nft> true --rpc-url robinhood --account deployer`.

## Trust assumptions and risks

- **Not audited.** Get an independent audit before real users deposit money.
- **The keeper is trusted within limits.** It chooses the ceiling and the listing, so a dishonest keeper could overpay up to the ceiling. It also publishes raffle snapshots, which people should check off-chain during the 15-minute delay.
- **After graduation, the router cannot sweep fees itself.** Pool fees reach the escrow only when Pons's sweep operator sweeps them. `harvest()` still claims whatever has been credited.
- **Pons can change its terms.** Pons may change `launchFee`, launch configs or fee splits. `expectedEconomics` makes a launch revert, instead of silently accepting different terms, if they change mid-transaction.
