// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Registry} from "./Registry.sol";

/// @notice Holds a coin's share of fees and can spend it on exactly one thing:
/// NFTs from the paired collection, bought through an allow-listed marketplace
/// at or below a keeper-posted ceiling. There is deliberately no withdraw path.
/// Deployed once as an implementation; each coin gets a minimal-proxy clone.
contract SweepVault is IERC721Receiver, ReentrancyGuard {
    enum Policy { Raffle, Hold, Burn }

    uint256 public constant CEILING_TTL = 1 hours;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    Registry public immutable registry;
    /// @notice The only contract allowed to hand NFTs to raffle winners.
    address public immutable raffles;

    IERC721 public collection;
    Policy public policy;
    bool private initialized;

    uint256 public ceiling;
    uint256 public ceilingExpiry;

    event CeilingPosted(uint256 ceiling, uint256 expiry);
    event Bought(address indexed marketplace, uint256 indexed tokenId, uint256 price);
    event Burned(uint256 indexed tokenId);
    event PrizeSent(uint256 indexed tokenId, address indexed to);

    modifier onlyKeeper() {
        require(msg.sender == registry.keeper(), "not keeper");
        _;
    }

    constructor(Registry registry_, address raffles_) {
        registry = registry_;
        raffles = raffles_;
        initialized = true; // the implementation itself is never used directly
    }

    /// @dev Called by the Launcher in the same transaction that creates the clone.
    function initialize(IERC721 collection_, Policy policy_) external {
        require(!initialized, "initialized");
        initialized = true;
        collection = collection_;
        policy = policy_;
    }

    receive() external payable {}

    function postCeiling(uint256 ceiling_) external onlyKeeper {
        ceiling = ceiling_;
        ceilingExpiry = block.timestamp + CEILING_TTL;
        emit CeilingPosted(ceiling_, ceilingExpiry);
    }

    /// @notice Buy `tokenId` by forwarding `price` wei and `data` to an allow-listed marketplace.
    /// Reverts unless the vault owns the NFT afterwards and spent no more than `price`.
    function buy(address marketplace, bytes calldata data, uint256 tokenId, uint256 price)
        external
        onlyKeeper
        nonReentrant
    {
        require(registry.isMarketplace(marketplace), "marketplace not allowed");
        require(block.timestamp < ceilingExpiry, "ceiling expired");
        require(price <= ceiling, "above ceiling");

        uint256 balanceBefore = address(this).balance;
        (bool ok,) = marketplace.call{value: price}(data);
        require(ok, "marketplace call failed");

        require(collection.ownerOf(tokenId) == address(this), "nft not received");
        require(balanceBefore - address(this).balance <= price, "overspent");
        emit Bought(marketplace, tokenId, price);

        if (policy == Policy.Burn) {
            collection.transferFrom(address(this), BURN_ADDRESS, tokenId);
            emit Burned(tokenId);
        }
    }

    /// @notice Delivers a raffled NFT. Only the Raffles contract can call this, and it
    /// only does so for a drawn raffle with a valid winner proof.
    function sendPrize(uint256 tokenId, address to) external {
        require(msg.sender == raffles && policy == Policy.Raffle, "not raffles");
        collection.safeTransferFrom(address(this), to, tokenId);
        emit PrizeSent(tokenId, to);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        require(msg.sender == address(collection), "wrong collection");
        return IERC721Receiver.onERC721Received.selector;
    }
}
