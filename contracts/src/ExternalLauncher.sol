// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IPonsFactory} from "./interfaces/IPons.sol";
import {Registry} from "./Registry.sol";
import {FeeRouter} from "./FeeRouter.sol";
import {SweepVault} from "./SweepVault.sol";
import {ExternalVault} from "./ExternalVault.sol";

/// @notice Launches a Pons V2 coin paired with a collection on another chain (Ethereum, Base,
/// Solana…). Same flow as Launcher, but the vault is an ExternalVault. Pairing and policy are
/// fixed at launch. Collections are listed in the Registry under `collectionKey(chainId, id)`.
contract ExternalLauncher {
    IPonsFactory public immutable pons;
    Registry public immutable registry;
    address public immutable vaultImplementation;
    address public immutable routerImplementation;

    struct Launch {
        address token;
        address curve;
        address router;
        address vault;
        address collection;
        address creator;
    }

    struct LaunchParams {
        string name;
        string symbol;
        string logo;
        string description;
        IPonsFactory.Socials socials;
        uint16 creatorTaxBps;
        uint256 launchConfigId;
        bytes32 expectedEconomics;
        bytes32 salt;
        uint64 chainId;
        bytes32 collection; // EVM: the address left-padded; Solana: the collection address bytes
        bool isEvm;
        SweepVault.Policy policy;
    }

    Launch[] public launches;

    event Launched(
        uint256 indexed id,
        address indexed creator,
        address indexed collection,
        uint64 chainId,
        address token,
        address curve,
        address router,
        address vault,
        SweepVault.Policy policy
    );

    /// @notice Registry key for a collection on another chain. Hashing in the chain id keeps it
    /// from ever matching a Robinhood Chain collection address.
    function collectionKey(uint64 chainId, bytes32 collection) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode(chainId, collection)))));
    }

    constructor(IPonsFactory pons_, Registry registry_, address vaultImplementation_, address routerImplementation_) {
        pons = pons_;
        registry = registry_;
        vaultImplementation = vaultImplementation_;
        routerImplementation = routerImplementation_;
        require(ExternalVault(payable(vaultImplementation_)).registry() == registry_, "vault registry");
        require(FeeRouter(payable(routerImplementation_)).registry() == registry_, "router registry");
    }

    /// @notice msg.value must equal the Pons launch fee (read `pons.launchFee()`).
    function launch(LaunchParams calldata p) external payable returns (uint256 id) {
        require(p.chainId != block.chainid, "use Launcher for this chain");
        address key = collectionKey(p.chainId, p.collection);
        require(registry.isCollection(key), "collection not listed");
        require(msg.value == pons.launchFee(), "wrong launch fee");

        ExternalVault vault = ExternalVault(payable(Clones.clone(vaultImplementation)));
        vault.initialize(p.chainId, p.collection, p.isEvm, p.policy);
        FeeRouter router = FeeRouter(payable(Clones.clone(routerImplementation)));
        router.initialize(address(vault));

        (address token, address curve) = pons.launchToken{value: msg.value}(
            IPonsFactory.TokenParams({
                name: p.name,
                symbol: p.symbol,
                logo: p.logo,
                description: p.description,
                socials: p.socials,
                creatorFeeRecipient: address(router),
                creatorTaxBps: p.creatorTaxBps,
                buybackEnabled: false,
                expectedEconomics: p.expectedEconomics,
                salt: p.salt
            }),
            p.launchConfigId,
            address(0)
        );
        router.setCurve(curve);

        id = launches.length;
        launches.push(Launch(token, curve, address(router), address(vault), key, msg.sender));
        emit Launched(id, msg.sender, key, p.chainId, token, curve, address(router), address(vault), p.policy);
    }

    function launchCount() external view returns (uint256) {
        return launches.length;
    }
}
