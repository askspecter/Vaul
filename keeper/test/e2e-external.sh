#!/usr/bin/env bash
# End-to-end test of the other-chain flow on two local chains: "robinhood" (with a stand-in
# ArbSys) and a "target" chain (id 8453, like Base). The bridge and OpenSea are replaced by
# test/hooks.js; contracts, the withdrawal timelock, the buy, the raffle and the delivery are real.
set -euo pipefail
cd "$(dirname "$0")/.."
CONTRACTS=$PWD/../contracts
RH=http://127.0.0.1:8545
TG=http://127.0.0.1:8547
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost

OWNER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
KEEPER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
SELLER_KEY=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a
KEEPER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
ALICE=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
BOB=0x90F79bf6EB2c4f870365E785982E1f101E93b906

anvil --silent --port 8545 --block-time 1 & A1=$!
anvil --silent --port 8547 --chain-id 8453 & A2=$!
trap 'kill $A1 $A2' EXIT
sleep 1
cast rpc anvil_setCode 0x0000000000000000000000000000000000000064 "$(cd $CONTRACTS && forge inspect MockArbSys deployedBytecode)" --rpc-url $RH >/dev/null

# Target chain: an NFT collection and a marketplace listing token 7 at 0.1 ETH.
deploy() { (cd $CONTRACTS && forge create --private-key $OWNER_KEY --broadcast "$@" 2>/dev/null | awk '/Deployed to/{print $3}'); }
NFT=$(deploy test/Mocks.sol:MockNFT --rpc-url $TG)
MARKET=$(deploy test/Mocks.sol:MockMarket --rpc-url $TG --constructor-args $NFT)
SELLER=$(cast wallet address $SELLER_KEY)
cast send $NFT "mint(address,uint256)" $SELLER 7 --private-key $OWNER_KEY --rpc-url $TG >/dev/null
cast send $NFT "approve(address,uint256)" $MARKET 7 --private-key $SELLER_KEY --rpc-url $TG >/dev/null
cast send $MARKET "list(uint256,uint256)" 7 0.1ether --private-key $SELLER_KEY --rpc-url $TG >/dev/null

# Robinhood side: contracts, a Raffle coin paired with the target collection, holders, fees.
OUT=$(cd $CONTRACTS && OWNER_KEY=$OWNER_KEY KEEPER_KEY=$KEEPER_KEY ALICE=$ALICE BOB=$BOB TARGET_CHAIN=8453 TARGET_NFT=$NFT \
  forge script script/ExternalDemo.s.sol --rpc-url $RH --broadcast 2>&1)
EXT=$(echo "$OUT" | awk '/EXTERNAL_LAUNCHER/{print $2}')
RHL=$(echo "$OUT" | awk '$1=="LAUNCHER"{print $2}')
L=($(cast call $EXT "launches(uint256)(address,address,address,address,address,address)" 0 --rpc-url $RH)); VAULT=${L[3]}
RAFFLES=$(cast call $VAULT "raffles()(address)" --rpc-url $RH)
echo "external launcher=$EXT vault=$VAULT nft(target)=$NFT"

COLL=$(mktemp); echo "[{\"chainId\":8453,\"address\":\"$NFT\",\"name\":\"Target Cats\",\"slug\":\"target-cats\"}]" > $COLL
SNAP=$(mktemp -d)
keeper() {
  RPC_URL=$RH CHAIN_ID=31337 KEEPER_PRIVATE_KEY=$KEEPER_KEY LAUNCHER=$RHL EXTERNAL_LAUNCHER=$EXT START_BLOCK=0 \
  COLLECTIONS_FILE=$COLL SNAPSHOT_DIR=$SNAP MIN_HARVEST_ETH=0.001 OPENSEA_API_KEY=test \
  KEEPER_TEST_HOOKS=./test/hooks.js TARGET_CHAIN=8453 TARGET_RPC=$TG TARGET_MARKET=$MARKET TARGET_NFT=$NFT \
  node src/index.js --once 2>&1 | grep -v "^$" | sed 's/^/    /' | cut -c1-220 || true
}
check() { if [ "$1" != "$2" ]; then echo "FAIL: $3 (got $1, want $2)"; exit 1; fi; echo "ok: $3"; }
warp() { cast rpc evm_increaseTime $1 --rpc-url $RH >/dev/null; cast rpc evm_mine --rpc-url $RH >/dev/null; }

echo "-- pass 1: harvest + announce withdrawal"; keeper
check "$(cast call $VAULT 'pendingAmount()(uint256)' --rpc-url $RH | awk '{print $1}' | cut -c1-2)" "10" "withdrawal of ~0.1 ETH announced"

echo "-- pass 2 (before the hour): nothing leaves"; keeper
check "$(cast call $VAULT 'totalWithdrawn()(uint256)' --rpc-url $RH | awk '{print $1}')" "0" "timelock holds funds"

warp 3601
echo "-- pass 3: execute, bridge, buy on target, record, open raffle"; keeper
check "$(cast call $NFT 'ownerOf(uint256)(address)' 7 --rpc-url $TG)" "$KEEPER" "keeper holds NFT 7 on target chain"
check "$(cast call $VAULT 'held(uint256)(bool)' 7 --rpc-url $RH)" "true" "purchase recorded on Robinhood"
check "$(cast call $RAFFLES 'raffleCount(address)(uint256)' $VAULT --rpc-url $RH)" "1" "raffle opened"

warp 901
echo "-- pass 4: commit + draw"; keeper
echo "-- pass 5: claim (prize owed)"; keeper
echo "-- pass 6: deliver on target + mark delivered"; keeper
WINNER=$(cast call $NFT 'ownerOf(uint256)(address)' 7 --rpc-url $TG)
if [ "$WINNER" = "$ALICE" ] || [ "$WINNER" = "$BOB" ]; then echo "ok: NFT 7 delivered to holder $WINNER on target chain"; else echo "FAIL: owner $WINNER"; exit 1; fi
check "$(cast call $VAULT 'prizeOwedTo(uint256)(address)' 7 --rpc-url $RH)" "0x0000000000000000000000000000000000000000" "delivery marked on Robinhood"
echo "E2E EXTERNAL PASSED"
