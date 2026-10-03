// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Registry} from "../src/Registry.sol";
import {Raffles} from "../src/Raffles.sol";
import {SweepVault} from "../src/SweepVault.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {ExternalVault} from "../src/ExternalVault.sol";
import {ExternalLauncher} from "../src/ExternalLauncher.sol";
import {Launcher} from "../src/Launcher.sol";
import {IPonsFactory, IPonsFeeEscrow} from "../src/interfaces/IPons.sol";
import {MockPons} from "../test/Mocks.sol";

/// Robinhood-side setup for the keeper's other-chain e2e test.
/// Env: OWNER_KEY, KEEPER_KEY, ALICE, BOB, TARGET_CHAIN, TARGET_NFT.
contract ExternalDemo is Script {
    function run() external {
        uint256 ownerKey = vm.envUint("OWNER_KEY");
        vm.startBroadcast(ownerKey);
        Registry registry = new Registry(vm.addr(ownerKey), vm.addr(vm.envUint("KEEPER_KEY")), vm.addr(ownerKey));
        Raffles raffles = new Raffles(registry);
        MockPons pons = new MockPons();
        ExternalVault vaultImpl = new ExternalVault(registry, address(raffles));
        FeeRouter routerImpl = new FeeRouter(registry, IPonsFeeEscrow(pons.feeEscrow()));
        ExternalLauncher launcher = new ExternalLauncher(IPonsFactory(address(pons)), registry, address(vaultImpl), address(routerImpl));
        Launcher rhLauncher = new Launcher(
            IPonsFactory(address(pons)), registry, address(new SweepVault(registry, address(raffles))), address(routerImpl)
        );
        console.log("LAUNCHER", address(rhLauncher));

        uint64 chainId = uint64(vm.envUint("TARGET_CHAIN"));
        bytes32 collection = bytes32(uint256(uint160(vm.envAddress("TARGET_NFT"))));
        registry.setCollection(launcher.collectionKey(chainId, collection), true);

        ExternalLauncher.LaunchParams memory p;
        p.name = "Base Muncher";
        p.symbol = "BMUNCH";
        p.chainId = chainId;
        p.collection = collection;
        p.isEvm = true;
        p.policy = SweepVault.Policy.Raffle;
        launcher.launch{value: pons.launchFee()}(p);
        (address token,, address router,,,) = launcher.launches(0);
        pons.give(token, vm.envAddress("ALICE"), 600 ether);
        pons.give(token, vm.envAddress("BOB"), 400 ether);
        pons.escrow().credit{value: 1 ether}(router);
        vm.stopBroadcast();

        console.log("EXTERNAL_LAUNCHER", address(launcher));
        console.log("REGISTRY", address(registry));
    }
}
