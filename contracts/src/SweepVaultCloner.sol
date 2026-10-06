// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ExternalVault} from "./ExternalVault.sol";
import {SweepVault} from "./SweepVault.sol";

/// @notice One-shot deployer for the vault that SweepHook fills: clones the ExternalVault
/// implementation at a deterministic address and initialises it in the same transaction, so
/// nobody can initialise the clone with other settings first. Deployed through the CREATE2
/// deployer, so the vault's address is known before anything is sent.
contract SweepVaultCloner {
    address public immutable vault;

    constructor(address implementation, bytes32 salt, uint64 chainId, bytes32 collection, bool isEvm, SweepVault.Policy policy) {
        vault = Clones.cloneDeterministic(implementation, salt);
        ExternalVault(payable(vault)).initialize(chainId, collection, isEvm, policy);
    }
}
