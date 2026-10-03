// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Registry} from "./Registry.sol";

/// @notice Lists many collections in a few transactions. The registry owner temporarily
/// hands the Registry to this contract, calls `list` in chunks, then `giveBack` (or the
/// last chunk via `listAndGiveBack`). Only the owner fixed at deploy can call anything,
/// and `giveBack` works at any time, so ownership can always be recovered.
contract BatchLister {
    Registry public immutable registry;
    address public immutable owner;

    constructor(Registry registry_, address owner_) {
        registry = registry_;
        owner = owner_;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function list(address[] calldata keys, bool listed) public onlyOwner {
        for (uint256 i; i < keys.length; i++) {
            registry.setCollection(keys[i], listed);
        }
    }

    function giveBack() public onlyOwner {
        registry.transferOwnership(owner);
    }

    function listAndGiveBack(address[] calldata keys) external {
        list(keys, true);
        giveBack();
    }
}
