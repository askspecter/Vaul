#!/usr/bin/env bash
# End-to-end keeper test on a local anvil chain with mocked Pons/marketplace.
# Requires foundry (anvil, forge, cast) on PATH. Run from keeper/: bash test/e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."
KEEPER_DIR=$PWD
CONTRACTS=$KEEPER_DIR/../contracts
RPC=http://127.0.0.1:8545
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost

OWNER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
KEEPER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
SELLER_KEY=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
ALICE=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
BOB=0x90F79bf6EB2c4f870365E785982E1f101E93b906

anvil --silent --port 8545 --block-time 1 & ANVIL=$!
trap 'kill $ANVIL' EXIT
sleep 1

# Robinhood Chain is Arbitrum-based; install a stand-in ArbSys precompile at 0x64.
ARBSYS=$(cd $CONTRACTS && forge inspect MockArbSys deployedBytecode)
cast rpc anvil_setCode 0x0000000000000000000000000000000000000064 "$ARBSYS" --rpc-url $RPC >/dev/null

OUT=$(cd $CONTRACTS && OWNER_KEY=$OWNER_KEY KEEPER_KEY=$KEEPER_KEY SELLER_KEY=$SELLER_KEY ALICE=$ALICE BOB=$BOB \
  forge script script/LocalDemo.s.sol --rpc-url $RPC --broadcast 2>&1)
LAUNCHER=$(echo "$OUT" | awk '/LAUNCHER/{print $2}')
MARKET=$(echo "$OUT" | awk '/MARKET/{print $2}')
RAFFLES=$(echo "$OUT" | awk '/RAFFLES/{print $2}')
L=($(cast call $LAUNCHER "launches(uint256)(address,address,address,address,address,address)" 0 --rpc-url $RPC))
ROUTER=${L[2]}; VAULT=${L[3]}; NFT=${L[4]}
echo "launcher=$LAUNCHER vault=$VAULT router=$ROUTER"

SNAPDIR=$(mktemp -d)
keeper() {
  RPC_URL=$RPC CHAIN_ID=31337 KEEPER_PRIVATE_KEY=$KEEPER_KEY LAUNCHER=$LAUNCHER START_BLOCK=0 \
    SNAPSHOT_DIR=$SNAPDIR MIN_HARVEST_ETH=0.001 SWEEP_DISABLED=1 node src/index.js --once
}
check() { if [ "$1" != "$2" ]; then echo "FAIL: $3 (got $1, want $2)"; exit 1; fi; echo "ok: $3"; }

# 1. Keeper harvests escrowed fees: 1 ETH -> 0.8 vault / 0.2 treasury.
keeper
check "$(cast balance $VAULT --rpc-url $RPC)" "800000000000000000" "harvest sent 80% to vault"

# 2. The vault buys the listed NFT (manual here; on mainnet the keeper fills via OpenSea/Seaport).
DATA=$(cast calldata "fill(uint256)" 42)
cast send $VAULT "postCeiling(uint256)" 0.2ether --private-key $KEEPER_KEY --rpc-url $RPC >/dev/null
cast send $VAULT "buy(address,bytes,uint256,uint256)" $MARKET $DATA 42 0.1ether --private-key $KEEPER_KEY --rpc-url $RPC >/dev/null
check "$(cast call $NFT 'ownerOf(uint256)(address)' 42 --rpc-url $RPC)" "$VAULT" "vault holds NFT 42"

# 3. Keeper snapshots holders and opens a raffle.
keeper
test -f $SNAPDIR/$(echo $VAULT | tr A-F a-f)-0.json && echo "ok: snapshot file written"
check "$(cast call $RAFFLES 'raffleCount(address)(uint256)' $VAULT --rpc-url $RPC)" "1" "raffle opened"

# 4. After the 15 min delay: commit, then draw, then deliver.
cast rpc evm_increaseTime 901 --rpc-url $RPC >/dev/null; cast rpc evm_mine --rpc-url $RPC >/dev/null
keeper                                      # commitDraw + wait + draw in one pass
keeper                                      # deliver to winner
WINNER=$(cast call $NFT 'ownerOf(uint256)(address)' 42 --rpc-url $RPC)
if [ "$WINNER" = "$ALICE" ] || [ "$WINNER" = "$BOB" ]; then echo "ok: NFT 42 delivered to holder $WINNER"; else echo "FAIL: owner $WINNER"; exit 1; fi
# 5. Snapshot server serves the file with CORS and nothing else.
node -e "import('./src/server.js').then(m => m.serveSnapshots('$SNAPDIR', 8799, () => {}))" & SRV=$!
sleep 1
F=$(echo $VAULT | tr A-F a-f)-0.json
check "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8799/$F)" "200" "snapshot served"
check "$(curl -s -D - -o /dev/null http://127.0.0.1:8799/$F | grep -ci 'access-control-allow-origin: \*')" "1" "CORS header"
check "$(curl -s -o /dev/null -w '%{http_code}' --path-as-is http://127.0.0.1:8799/../package.json)" "404" "no path traversal"
kill $SRV
echo "E2E PASSED"
