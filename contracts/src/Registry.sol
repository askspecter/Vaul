// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Global settings shared by every vault: who may post price ceilings,
/// which marketplaces a vault may call, and where the protocol share goes.
/// The owner can change these settings but can never move vault funds or NFTs.
contract Registry is Ownable {
    address public keeper;
    address public treasury;
    mapping(address => bool) public isMarketplace;
    mapping(address => bool) public isCollection;

    event KeeperSet(address keeper);
    event TreasurySet(address treasury);
    event MarketplaceSet(address marketplace, bool allowed);
    event CollectionSet(address collection, bool listed);

    constructor(address owner_, address keeper_, address treasury_) Ownable(owner_) {
        keeper = keeper_;
        treasury = treasury_;
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "treasury=0");
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setMarketplace(address marketplace, bool allowed) external onlyOwner {
        isMarketplace[marketplace] = allowed;
        emit MarketplaceSet(marketplace, allowed);
    }

    /// @notice Only listed collections can be paired with new launches. Delisting does
    /// not affect coins that already launched.
    function setCollection(address collection, bool listed) external onlyOwner {
        isCollection[collection] = listed;
        emit CollectionSet(collection, listed);
    }
}
