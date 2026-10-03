// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Registry} from "./Registry.sol";
import {SweepVault} from "./SweepVault.sol";
import {ARB_SYS} from "./interfaces/IArbSys.sol";

/// @notice Raffles for every Raffle-policy vault. The keeper publishes a holder snapshot
/// (Merkle root of ticket ranges); after SNAPSHOT_DELAY anyone commits a future chain
/// block, anyone draws from its hash, and anyone delivers the NFT with the winner's proof.
contract Raffles {
    uint256 public constant SNAPSHOT_DELAY = 15 minutes;
    /// @dev Chain blocks (~0.1s each) between committing a draw and the block whose hash seeds it.
    uint256 public constant DRAW_OFFSET = 20;

    Registry public immutable registry;

    struct Raffle {
        uint256 tokenId;
        bytes32 root; // leaves: keccak256(bytes.concat(keccak256(abi.encode(account, start, end)))), tickets [start, end)
        uint256 totalTickets;
        uint64 publishedAt;
        uint64 drawBlock; // 0 until a draw is committed
        uint256 winningTicket;
        bool drawn;
        bool claimed;
    }

    mapping(address vault => Raffle[]) private _raffles;
    mapping(address vault => mapping(uint256 tokenId => bool)) public inRaffle;

    event RaffleOpened(address indexed vault, uint256 indexed id, uint256 indexed tokenId, bytes32 root, uint256 totalTickets);
    event DrawCommitted(address indexed vault, uint256 indexed id, uint64 drawBlock);
    event DrawExpired(address indexed vault, uint256 indexed id, uint64 drawBlock);
    event RaffleDrawn(address indexed vault, uint256 indexed id, uint256 winningTicket);
    event RaffleClaimed(address indexed vault, uint256 indexed id, address indexed winner, uint256 tokenId);

    error NotKeeper();
    error NotRaffleVault();
    error NftUnavailable();
    error EmptySnapshot();
    error AlreadyCommitted();
    error TooEarly();
    error NotCommitted();
    error NotClaimable();
    error NotWinningRange();
    error BadProof();

    constructor(Registry registry_) {
        registry = registry_;
    }

    function openRaffle(SweepVault vault, uint256 tokenId, bytes32 root, uint256 totalTickets) external returns (uint256 id) {
        if (msg.sender != registry.keeper()) revert NotKeeper();
        if (vault.raffles() != address(this) || vault.policy() != SweepVault.Policy.Raffle) revert NotRaffleVault();
        if (vault.collection().ownerOf(tokenId) != address(vault) || inRaffle[address(vault)][tokenId]) revert NftUnavailable();
        if (totalTickets == 0 || root == bytes32(0)) revert EmptySnapshot();

        inRaffle[address(vault)][tokenId] = true;
        Raffle[] storage list = _raffles[address(vault)];
        id = list.length;
        list.push(Raffle(tokenId, root, totalTickets, uint64(block.timestamp), 0, 0, false, false));
        emit RaffleOpened(address(vault), id, tokenId, root, totalTickets);
    }

    /// @notice Step 1, callable by anyone once the snapshot has been public for SNAPSHOT_DELAY:
    /// pins a block that does not exist yet, so nobody knows its hash at commit time.
    function commitDraw(address vault, uint256 id) external {
        Raffle storage r = _raffles[vault][id];
        if (r.drawn || r.drawBlock != 0) revert AlreadyCommitted();
        if (block.timestamp < r.publishedAt + SNAPSHOT_DELAY) revert TooEarly();
        r.drawBlock = uint64(ARB_SYS.arbBlockNumber() + DRAW_OFFSET);
        emit DrawCommitted(vault, id, r.drawBlock);
    }

    /// @notice Step 2, callable by anyone after the pinned block. Block hashes are only
    /// readable for 256 blocks; if that window was missed the commit is cleared and
    /// `commitDraw` must be called again (logged via DrawExpired).
    function draw(address vault, uint256 id) external {
        Raffle storage r = _raffles[vault][id];
        if (r.drawn || r.drawBlock == 0) revert NotCommitted();
        uint256 current = ARB_SYS.arbBlockNumber();
        if (current <= r.drawBlock) revert TooEarly();

        if (current - r.drawBlock > 256) {
            emit DrawExpired(vault, id, r.drawBlock);
            r.drawBlock = 0;
            return;
        }
        bytes32 seed = ARB_SYS.arbBlockHash(r.drawBlock);
        r.winningTicket = uint256(keccak256(abi.encode(seed, vault, id))) % r.totalTickets;
        r.drawn = true;
        emit RaffleDrawn(vault, id, r.winningTicket);
    }

    /// @notice Delivers the NFT to the winner. Callable by anyone with the winner's proof.
    function claim(address vault, uint256 id, address account, uint256 start, uint256 end, bytes32[] calldata proof)
        external
    {
        Raffle storage r = _raffles[vault][id];
        if (!r.drawn || r.claimed) revert NotClaimable();
        if (start > r.winningTicket || r.winningTicket >= end) revert NotWinningRange();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, start, end))));
        if (!MerkleProof.verifyCalldata(proof, r.root, leaf)) revert BadProof();

        r.claimed = true;
        SweepVault(payable(vault)).sendPrize(r.tokenId, account);
        emit RaffleClaimed(vault, id, account, r.tokenId);
    }

    function raffles(address vault, uint256 id) external view returns (Raffle memory) {
        return _raffles[vault][id];
    }

    function raffleCount(address vault) external view returns (uint256) {
        return _raffles[vault].length;
    }
}
