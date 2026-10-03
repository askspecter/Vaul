// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Registry} from "../src/Registry.sol";
import {Raffles} from "../src/Raffles.sol";
import {SweepVault} from "../src/SweepVault.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {Launcher} from "../src/Launcher.sol";
import {IPonsFactory, IPonsFeeEscrow} from "../src/interfaces/IPons.sol";

/// Deploys LaunchNFT to Robinhood Chain (chain id 4663) on top of Pons V2.
/// Every transaction stays well under 1.2M gas so mobile wallets can send it.
///
///   KEEPER=0x.. TREASURY=0x.. [REGISTRY=0x.. to reuse one] forge script script/Deploy.s.sol \
///     --rpc-url robinhood --account <keystore-name> --broadcast
contract Deploy is Script {
    address constant PONS_V2_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant SEAPORT_1_6 = 0x0000000000000068F116a894984e2DB1123eB395;

    function run() external {
        require(block.chainid == 4663, "not Robinhood Chain");
        IPonsFactory pons = IPonsFactory(PONS_V2_FACTORY);

        vm.startBroadcast();
        Registry registry = Registry(vm.envOr("REGISTRY", address(0)));
        if (address(registry) == address(0)) {
            registry = new Registry(msg.sender, vm.envAddress("KEEPER"), vm.envAddress("TREASURY"));
            registry.setMarketplace(SEAPORT_1_6, true);
        }
        Raffles raffles = new Raffles(registry);
        SweepVault vaultImpl = new SweepVault(registry, address(raffles));
        FeeRouter routerImpl = new FeeRouter(registry, IPonsFeeEscrow(pons.feeEscrow()));
        Launcher launcher = new Launcher(pons, registry, address(vaultImpl), address(routerImpl));
        vm.stopBroadcast();

        console.log("Registry:", address(registry));
        console.log("Raffles:", address(raffles));
        console.log("Launcher:", address(launcher));
    }
}
