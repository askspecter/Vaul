// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Registry} from "../src/Registry.sol";
import {Launcher} from "../src/Launcher.sol";
import {SweepVault} from "../src/SweepVault.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {Raffles} from "../src/Raffles.sol";
import {IPonsFeeEscrow} from "../src/interfaces/IPons.sol";
import {IPonsFactory} from "../src/interfaces/IPons.sol";
import {MockNFT, MockMarket, MockPons} from "../test/Mocks.sol";

/// Local anvil setup for keeper integration tests.
/// Env: OWNER_KEY, KEEPER_KEY, SELLER_KEY, ALICE, BOB.
contract LocalDemo is Script {
    Registry registry;
    MockPons pons;
    Launcher launcher;
    MockNFT nft;
    MockMarket market;

    function run() external {
        uint256 ownerKey = vm.envUint("OWNER_KEY");
        vm.startBroadcast(ownerKey);
        _deploy(vm.addr(ownerKey), vm.addr(vm.envUint("KEEPER_KEY")));
        _launchAndSeed(vm.envAddress("ALICE"), vm.envAddress("BOB"), vm.addr(vm.envUint("SELLER_KEY")));
        vm.stopBroadcast();

        vm.startBroadcast(vm.envUint("SELLER_KEY"));
        nft.approve(address(market), 42);
        market.list(42, 0.1 ether);
        vm.stopBroadcast();

        console.log("LAUNCHER", address(launcher));
        console.log("MARKET", address(market));
    }

    function _deploy(address owner, address keeper) internal {
        registry = new Registry(owner, keeper, owner);
        pons = new MockPons();
        Raffles raffles = new Raffles(registry);
        SweepVault vaultImpl = new SweepVault(registry, address(raffles));
        FeeRouter routerImpl = new FeeRouter(registry, IPonsFeeEscrow(pons.feeEscrow()));
        launcher = new Launcher(IPonsFactory(address(pons)), registry, address(vaultImpl), address(routerImpl));
        console.log("RAFFLES", address(raffles));
        nft = new MockNFT();
        market = new MockMarket(nft);
        registry.setCollection(address(nft), true);
        registry.setMarketplace(address(market), true);
    }

    function _launchAndSeed(address alice, address bob, address seller) internal {
        Launcher.LaunchParams memory p;
        p.name = "Local Coin";
        p.symbol = "LOCAL";
        p.collection = nft;
        p.policy = SweepVault.Policy.Raffle;
        launcher.launch{value: pons.launchFee()}(p);
        (address token,, address router,,,) = launcher.launches(0);

        pons.give(token, alice, 600 ether);
        pons.give(token, bob, 400 ether);
        pons.escrow().credit{value: 1 ether}(router); // creator fees waiting in escrow
        nft.mint(seller, 42);
    }
}
