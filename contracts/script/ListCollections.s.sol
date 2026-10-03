// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Registry} from "../src/Registry.sol";

/// Lists (or delists) NFT collections that new coins may pair with.
///
///   REGISTRY=0x.. COLLECTIONS=0xabc..,0xdef.. [LISTED=false] forge script script/ListCollections.s.sol \
///     --rpc-url robinhood --account deployer --broadcast
contract ListCollections is Script {
    function run() external {
        Registry registry = Registry(vm.envAddress("REGISTRY"));
        address[] memory collections = vm.envAddress("COLLECTIONS", ",");
        bool listed = vm.envOr("LISTED", true);

        for (uint256 i; i < collections.length; i++) {
            require(IERC721(collections[i]).supportsInterface(type(IERC721).interfaceId), "not an ERC721");
        }
        vm.startBroadcast();
        for (uint256 i; i < collections.length; i++) {
            registry.setCollection(collections[i], listed);
            console.log(listed ? "listed" : "delisted", collections[i]);
        }
        vm.stopBroadcast();
    }
}
