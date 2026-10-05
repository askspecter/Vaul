#!/usr/bin/env bash
# End-to-end test of a Card Vault: a Raffle coin paired with the Pokémon cards of a mixed card
# collection on a local "Polygon" (chain 137), paid for in USDC. OpenSea and the bridge are
# replaced by test/hooks-cards.js; contracts, the tagged collection id, the category filter,
# the USDC approval and buy, the raffle and the delivery are real.
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
# The keeper only pays with tokens it knows, so the stand-in USDC lives at Polygon's USDC address.
USDC=0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
TAG=0x706f6b656d6f6e00000000000000000000000000000000000000000000000000 # "pokemon"

anvil --silent --port 8545 --block-time 1 & A1=$!
anvil --silent --port 8547 --chain-id 137 & A2=$!
trap 'kill $A1 $A2' EXIT
sleep 1
cast rpc anvil_setCode 0x0000000000000000000000000000000000000064 "$(cd $CONTRACTS && forge inspect MockArbSys deployedBytecode)" --rpc-url $RH >/dev/null
cast rpc anvil_setCode $USDC "$(cd $CONTRACTS && forge inspect MockUSDC deployedBytecode)" --rpc-url $TG >/dev/null

# Target chain: a mixed card collection with a basketball card (#5, 1 USDC) and a Pokémon card (#7, 3 USDC).
deploy() { (cd $CONTRACTS && forge create --private-key $OWNER_KEY --broadcast "$@" 2>/dev/null | awk '/Deployed to/{print $3}'); }
NFT=$(deploy test/Mocks.sol:MockNFT --rpc-url $TG)
MARKET=$(deploy test/Mocks.sol:MockTokenMarket --rpc-url $TG --constructor-args $NFT $USDC)
SELLER=$(cast wallet address $SELLER_KEY)
for ID in 5 7; do
  cast send $NFT "mint(address,uint256)" $SELLER $ID --private-key $OWNER_KEY --rpc-url $TG >/dev/null
  cast send $NFT "approve(address,uint256)" $MARKET $ID --private-key $SELLER_KEY --rpc-url $TG >/dev/null
done
cast send $MARKET "list(uint256,uint256)" 5 1000000 --private-key $SELLER_KEY --rpc-url $TG >/dev/null
cast send $MARKET "list(uint256,uint256)" 7 3000000 --private-key $SELLER_KEY --rpc-url $TG >/dev/null

# Robinhood side: contracts and a Raffle coin paired with "pokemon" ⧺ the collection address.
OUT=$(cd $CONTRACTS && OWNER_KEY=$OWNER_KEY KEEPER_KEY=$KEEPER_KEY ALICE=$ALICE BOB=$BOB TARGET_CHAIN=137 TARGET_NFT=$NFT TARGET_TAG=$TAG \
  forge script script/ExternalDemo.s.sol --rpc-url $RH --broadcast 2>&1)
EXT=$(echo "$OUT" | awk '/EXTERNAL_LAUNCHER/{print $2}')
RHL=$(echo "$OUT" | awk '$1=="LAUNCHER"{print $2}')
L=($(cast call $EXT "launches(uint256)(address,address,address,address,address,address)" 0 --rpc-url $RH)); VAULT=${L[3]}
RAFFLES=$(cast call $VAULT "raffles()(address)" --rpc-url $RH)
echo "external launcher=$EXT vault=$VAULT cards(target)=$NFT collection id=$(cast call $VAULT 'externalCollection()(bytes32)' --rpc-url $RH)"

COLL=$(mktemp); cat > $COLL <<JSON
[{"chainId":137,"address":"$NFT","tag":"pokemon","kind":"cards","name":"Pokémon Cards","slug":"cards","match":["pokemon","pokémon"]},
 {"chainId":137,"address":"$NFT","tag":"onepiece","kind":"cards","name":"One Piece Cards","slug":"cards","match":["one piece"]}]
JSON
SNAP=$(mktemp -d)
keeper() {
  RPC_URL=$RH CHAIN_ID=31337 KEEPER_PRIVATE_KEY=$KEEPER_KEY LAUNCHER=$RHL EXTERNAL_LAUNCHER=$EXT START_BLOCK=0 \
  COLLECTIONS_FILE=$COLL SNAPSHOT_DIR=$SNAP MIN_HARVEST_ETH=0.001 OPENSEA_API_KEY=test \
  KEEPER_TEST_HOOKS=./test/hooks-cards.js TARGET_CHAIN=137 TARGET_RPC=$TG TARGET_MARKET=$MARKET TARGET_NFT=$NFT TARGET_USDC=$USDC \
  node src/index.js --once 2>&1 | grep -v "^$" | sed 's/^/    /' | cut -c1-220 || true
}
check() { if [ "$1" != "$2" ]; then echo "FAIL: $3 (got $1, want $2)"; exit 1; fi; echo "ok: $3"; }
warp() { cast rpc evm_increaseTime $1 --rpc-url $RH >/dev/null; cast rpc evm_mine --rpc-url $RH >/dev/null; }

echo "-- pass 1: harvest + announce withdrawal for the Pokémon card (3 USDC = 0.0015 ETH)"; keeper
check "$(cast call $VAULT 'pendingAmount()(uint256)' --rpc-url $RH | awk '{print $1}')" "1500000000000000" "withdrawal sized for card #7, not the cheaper basketball card"

warp 3601
echo "-- pass 2: execute, bridge to USDC, approve, buy, record, open raffle"; keeper
check "$(cast call $NFT 'ownerOf(uint256)(address)' 7 --rpc-url $TG)" "$KEEPER" "keeper holds Pokémon card #7"
check "$(cast call $NFT 'ownerOf(uint256)(address)' 5 --rpc-url $TG)" "$MARKET" "basketball card #5 left alone"
check "$(cast call $USDC 'balanceOf(address)(uint256)' $SELLER --rpc-url $TG | awk '{print $1}')" "3000000" "seller paid 3 USDC"
check "$(cast call $VAULT 'held(uint256)(bool)' 7 --rpc-url $RH)" "true" "purchase recorded on Robinhood"
check "$(cast call $RAFFLES 'raffleCount(address)(uint256)' $VAULT --rpc-url $RH)" "1" "raffle opened"

warp 901
echo "-- pass 3: commit + draw"; keeper
echo "-- pass 4: claim (prize owed)"; keeper
echo "-- pass 5: deliver on Polygon + mark delivered"; keeper
WINNER=$(cast call $NFT 'ownerOf(uint256)(address)' 7 --rpc-url $TG)
if [ "$WINNER" = "$ALICE" ] || [ "$WINNER" = "$BOB" ]; then echo "ok: card #7 delivered to holder $WINNER"; else echo "FAIL: owner $WINNER"; exit 1; fi
check "$(cast call $VAULT 'prizeOwedTo(uint256)(address)' 7 --rpc-url $RH)" "0x0000000000000000000000000000000000000000" "delivery marked on Robinhood"
echo "E2E CARDS PASSED"
