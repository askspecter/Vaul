// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IPonsFactory} from "../src/interfaces/IPons.sol";

contract MockNFT is ERC721("Mock", "MOCK") {
    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

/// @dev Fixed-price marketplace standing in for Seaport.
contract MockMarket {
    struct Listing { address seller; uint256 price; }
    IERC721 public immutable nft;
    mapping(uint256 => Listing) public listings;

    constructor(IERC721 nft_) { nft = nft_; }

    function list(uint256 id, uint256 price) external {
        nft.transferFrom(msg.sender, address(this), id);
        listings[id] = Listing(msg.sender, price);
    }

    function fill(uint256 id) external payable {
        Listing memory l = listings[id];
        require(msg.value == l.price, "price");
        delete listings[id];
        nft.transferFrom(address(this), msg.sender, id);
        payable(l.seller).transfer(msg.value);
    }
}

/// @dev Credits fees to recipients; claim() pays the caller, like the Pons escrow.
contract MockEscrow {
    mapping(address => uint256) public balanceOf;

    function credit(address recipient) external payable {
        balanceOf[recipient] += msg.value;
    }

    function claim() external {
        uint256 amount = balanceOf[msg.sender];
        balanceOf[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok);
    }
}

contract MockToken is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {
        _mint(msg.sender, 1_000_000_000 ether);
    }
}

/// @dev Deploys a real ERC20 (supply held by this contract, standing in for the curve).
contract MockPons {
    MockEscrow public immutable escrow = new MockEscrow();
    uint256 public constant launchFee = 0.0005 ether;
    address public lastRecipient;
    uint16 public lastTax;

    /// @dev Simulates a buy on the curve.
    function give(address token, address to, uint256 amount) external {
        MockToken(token).transfer(to, amount);
    }

    function feeEscrow() external view returns (address) {
        return address(escrow);
    }

    function launchToken(IPonsFactory.TokenParams calldata params, uint256, address pairToken)
        external
        payable
        returns (address token, address curve)
    {
        require(msg.value == launchFee && pairToken == address(0), "mock launch");
        lastRecipient = params.creatorFeeRecipient;
        lastTax = params.creatorTaxBps;
        token = address(new MockToken(params.name, params.symbol));
        curve = address(this);
    }
}

/// @dev Stand-in for the ArbSys precompile (0x64), which forge does not emulate.
contract MockArbSys {
    function arbBlockNumber() external view returns (uint256) {
        return block.number;
    }

    function arbBlockHash(uint256 n) external view returns (bytes32) {
        require(n < block.number && block.number - n <= 256, "invalid block");
        return blockhash(n);
    }
}
