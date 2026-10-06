// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {SweepHook} from "../src/SweepHook.sol";
import {SweepVaultCloner} from "../src/SweepVaultCloner.sol";
import {SweepVault} from "../src/SweepVault.sol";

/// Computes everything needed to deploy the $VAUL Sweep Hook from a phone wallet, with no
/// private key here: the two CREATE2-deployer transactions (vault, hook) and the addresses
/// they create. The hook salt is mined so the address carries exactly the hook's permission
/// bits. Writes ../assets/sweep-hook.json for the site's setup panel.
/// Env: OWNER (the wallet that will create the pool), optional VAULT_TAG (default cc-pokemon).
contract SweepHookPlan is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant VAUL = 0x927b50e4cE03671d5a505922750edcc9Cb734ad4;
    address constant VAULT_IMPL = 0xCc743d0A46534B049F1B0E6246B7A6Ee62701870; // ExternalLauncher.vaultImplementation()
    uint64 constant SOLANA = 792703809;
    uint256 constant FEE_BPS = 100; // 1%
    uint160 constant FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;

    function run() external {
        address owner = vm.envAddress("OWNER");
        string memory tag = vm.envOr("VAULT_TAG", string("cc-pokemon"));
        bytes32 collection = bytes32(bytes(tag)); // Solana Card Vault ids are the tag, left-aligned

        // 1. Vault (cloned + initialised by a one-shot cloner).
        bytes32 clonerSalt = keccak256("vaul.sweep.vault.cloner.v1");
        bytes32 vaultSalt = keccak256("vaul.sweep.vault.v1");
        bytes memory clonerInit = abi.encodePacked(
            type(SweepVaultCloner).creationCode,
            abi.encode(VAULT_IMPL, vaultSalt, SOLANA, collection, false, SweepVault.Policy.Raffle)
        );
        address cloner = vm.computeCreate2Address(clonerSalt, keccak256(clonerInit), CREATE2_DEPLOYER);
        address vault = Clones.predictDeterministicAddress(VAULT_IMPL, vaultSalt, cloner);

        // 2. Hook at an address whose low 14 bits are exactly FLAGS.
        bytes memory hookInit = abi.encodePacked(
            type(SweepHook).creationCode, abi.encode(IPoolManager(POOL_MANAGER), Currency.wrap(VAUL), payable(vault), FEE_BPS, owner)
        );
        bytes32 initHash = keccak256(hookInit);
        bytes32 hookSalt;
        address hook;
        for (uint256 i = 0; i < 2_000_000; i++) {
            hookSalt = bytes32(i);
            hook = vm.computeCreate2Address(hookSalt, initHash, CREATE2_DEPLOYER);
            if (uint160(hook) & Hooks.ALL_HOOK_MASK == FLAGS) break;
        }
        require(uint160(hook) & Hooks.ALL_HOOK_MASK == FLAGS, "no salt found");

        console.log("vault ", vault);
        console.log("cloner", cloner);
        console.log("hook  ", hook);
        string memory o = "plan";
        vm.serializeAddress(o, "poolManager", POOL_MANAGER);
        vm.serializeAddress(o, "create2Deployer", CREATE2_DEPLOYER);
        vm.serializeAddress(o, "token", VAUL);
        vm.serializeAddress(o, "owner", owner);
        vm.serializeString(o, "vaultTag", tag);
        vm.serializeAddress(o, "vault", vault);
        vm.serializeAddress(o, "cloner", cloner);
        vm.serializeAddress(o, "hook", hook);
        vm.serializeUint(o, "feeBps", FEE_BPS);
        vm.serializeUint(o, "lpFee", 3000);
        vm.serializeInt(o, "tickSpacing", 60);
        vm.serializeBytes(o, "vaultTx", abi.encodePacked(clonerSalt, clonerInit));
        string memory json = vm.serializeBytes(o, "hookTx", abi.encodePacked(hookSalt, hookInit));
        vm.writeJson(json, "../assets/sweep-hook.json");
    }
}
