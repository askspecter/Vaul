// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IPonsFactory} from "./interfaces/IPons.sol";
import {Registry} from "./Registry.sol";
import {FeeRouter} from "./FeeRouter.sol";
import {SweepVault} from "./SweepVault.sol";

/// @notice Launches a Pons V2 coin whose creator fees are routed to a vault that
/// can only buy NFTs from one collection. Pairing and NFT policy are fixed at launch.
/// Vaults and routers are minimal-proxy clones, which keeps every deployment small.
contract Launcher {
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
        IERC721 collection;
        SweepVault.Policy policy;
    }

    Launch[] public launches;
    mapping(address token => uint256) public idOf;

    event Launched(
        uint256 indexed id,
        address indexed creator,
        address indexed collection,
        address token,
        address curve,
        address router,
        address vault,
        SweepVault.Policy policy
    );

    constructor(IPonsFactory pons_, Registry registry_, address vaultImplementation_, address routerImplementation_) {
        pons = pons_;
        registry = registry_;
        vaultImplementation = vaultImplementation_;
        routerImplementation = routerImplementation_;
        require(SweepVault(payable(vaultImplementation_)).registry() == registry_, "vault registry");
        require(FeeRouter(payable(routerImplementation_)).registry() == registry_, "router registry");
        require(address(FeeRouter(payable(routerImplementation_)).escrow()) == pons_.feeEscrow(), "router escrow");
    }

    /// @notice msg.value must equal the Pons launch fee (read `pons.launchFee()`).
    function launch(LaunchParams calldata p) external payable returns (uint256 id) {
        require(registry.isCollection(address(p.collection)), "collection not listed");
        require(msg.value == pons.launchFee(), "wrong launch fee");

        SweepVault vault = SweepVault(payable(Clones.clone(vaultImplementation)));
        vault.initialize(p.collection, p.policy);
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
            address(0) // priced in native ETH
        );

        router.setCurve(curve);

        id = launches.length;
        launches.push(Launch(token, curve, address(router), address(vault), address(p.collection), msg.sender));
        idOf[token] = id;
        emit Launched(id, msg.sender, address(p.collection), token, curve, address(router), address(vault), p.policy);
    }

    function launchCount() external view returns (uint256) {
        return launches.length;
    }
}
