// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Registry} from "./Registry.sol";
import {SweepVault} from "./SweepVault.sol";

/// @notice Vault for a coin paired with a collection on another chain (Ethereum, Base, Solana…).
/// Fees accrue here per coin. The keeper buys on the other chain, so ETH leaves only through
/// an announced withdrawal to the keeper that waits WITHDRAW_DELAY, during which the registry
/// owner can cancel it. Every purchase and prize delivery is recorded here with the other
/// chain's transaction hash so anyone can audit it.
///
/// It mirrors the parts of SweepVault that Raffles uses: `collection()` returns this vault,
/// whose `ownerOf` reports the NFTs recorded as held, and `sendPrize` records the winner the
/// keeper must deliver to. On EVM chains the prize goes to the winner's same address; on
/// non-EVM chains (Solana) the winner first sets a destination with `setPrizeDestination`.
/// Collections and token ids are bytes32/uint256 so non-EVM ids (e.g. Solana mints) fit.
contract ExternalVault {
    uint256 public constant WITHDRAW_DELAY = 1 hours;

    Registry public immutable registry;
    address public immutable raffles;

    uint64 public externalChainId;
    bytes32 public externalCollection;
    bool public externalIsEvm;
    SweepVault.Policy public policy;
    bool private initialized;

    uint256 public pendingAmount;
    uint256 public pendingReadyAt;
    uint256 public totalWithdrawn;
    uint256 public totalSpent;

    mapping(uint256 tokenId => bool) public held;
    mapping(uint256 tokenId => address) public prizeOwedTo;
    mapping(uint256 tokenId => bytes32) public prizeDestination;

    event WithdrawalAnnounced(uint256 amount, uint256 readyAt);
    event WithdrawalCancelled(uint256 amount);
    event Withdrawn(address indexed keeper, uint256 amount);
    event Bought(address indexed marketplace, uint256 indexed tokenId, uint256 price);
    event ExternalPurchase(uint256 indexed tokenId, uint256 price, bytes32 externalTx);
    event Burned(uint256 indexed tokenId);
    event PrizeOwed(uint256 indexed tokenId, address indexed to);
    event PrizeDestinationSet(uint256 indexed tokenId, address indexed winner, bytes32 destination);
    event PrizeDelivered(uint256 indexed tokenId, address indexed to, bytes32 destination, bytes32 externalTx);

    modifier onlyKeeper() {
        require(msg.sender == registry.keeper(), "not keeper");
        _;
    }

    constructor(Registry registry_, address raffles_) {
        registry = registry_;
        raffles = raffles_;
        initialized = true; // the implementation itself is never used directly
    }

    /// @dev Called by the launcher in the same transaction that creates the clone.
    function initialize(uint64 chainId_, bytes32 collection_, bool isEvm_, SweepVault.Policy policy_) external {
        require(!initialized, "initialized");
        initialized = true;
        externalChainId = chainId_;
        externalCollection = collection_;
        externalIsEvm = isEvm_;
        policy = policy_;
    }

    receive() external payable {}

    // ------------------------------------------------------------- withdrawals

    function announceWithdrawal(uint256 amount) external onlyKeeper {
        require(amount > 0 && amount <= address(this).balance, "amount");
        pendingAmount = amount;
        pendingReadyAt = block.timestamp + WITHDRAW_DELAY;
        emit WithdrawalAnnounced(amount, pendingReadyAt);
    }

    function cancelWithdrawal() external {
        require(msg.sender == registry.owner(), "not owner");
        emit WithdrawalCancelled(pendingAmount);
        pendingAmount = 0;
        pendingReadyAt = 0;
    }

    function executeWithdrawal() external onlyKeeper {
        uint256 amount = pendingAmount;
        require(amount > 0 && block.timestamp >= pendingReadyAt, "not ready");
        pendingAmount = 0;
        pendingReadyAt = 0;
        totalWithdrawn += amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdrawn(msg.sender, amount);
    }

    // --------------------------------------------------------------- records

    function recordPurchase(uint256 tokenId, uint256 price, bytes32 externalTx) external onlyKeeper {
        require(!held[tokenId], "recorded");
        totalSpent += price;
        emit Bought(address(0), tokenId, price);
        emit ExternalPurchase(tokenId, price, externalTx);
        if (policy == SweepVault.Policy.Burn) {
            emit Burned(tokenId); // the keeper burns it on the other chain in the same flow
        } else {
            held[tokenId] = true;
        }
    }

    /// @notice For non-EVM chains the winner tells the keeper where to send the prize.
    function setPrizeDestination(uint256 tokenId, bytes32 destination) external {
        require(msg.sender == prizeOwedTo[tokenId] && destination != bytes32(0), "not winner");
        prizeDestination[tokenId] = destination;
        emit PrizeDestinationSet(tokenId, msg.sender, destination);
    }

    function markDelivered(uint256 tokenId, bytes32 externalTx) external onlyKeeper {
        address to = prizeOwedTo[tokenId];
        require(to != address(0), "nothing owed");
        bytes32 destination = externalIsEvm ? bytes32(uint256(uint160(to))) : prizeDestination[tokenId];
        require(destination != bytes32(0), "no destination");
        delete prizeOwedTo[tokenId];
        delete prizeDestination[tokenId];
        emit PrizeDelivered(tokenId, to, destination, externalTx);
    }

    // ------------------------------------------------- Raffles compatibility

    function collection() external view returns (address) {
        return address(this);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return held[tokenId] ? address(this) : address(0);
    }

    function sendPrize(uint256 tokenId, address to) external {
        require(msg.sender == raffles && policy == SweepVault.Policy.Raffle, "not raffles");
        require(held[tokenId], "not held");
        held[tokenId] = false;
        prizeOwedTo[tokenId] = to;
        emit PrizeOwed(tokenId, to);
    }
}
