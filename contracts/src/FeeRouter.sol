// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPonsFeeEscrow, IPonsCurve} from "./interfaces/IPons.sol";
import {Registry} from "./Registry.sol";

/// @notice Registered with Pons as a coin's creator-fee recipient. Anyone can call
/// `harvest`, which sweeps the coin's curve fees into the Pons escrow (only the
/// recipient may do this before graduation), claims them, and forwards VAULT_BPS
/// to the coin's vault and the rest to the protocol treasury.
/// It has no function to change the Pons fee recipient, so the pairing is permanent.
/// Deployed once as an implementation; each coin gets a minimal-proxy clone.
contract FeeRouter {
    uint256 public constant VAULT_BPS = 8_000;

    Registry public immutable registry;
    IPonsFeeEscrow public immutable escrow;

    address public launcher;
    address public vault;
    address public curve;

    event Harvested(uint256 toVault, uint256 toTreasury);

    constructor(Registry registry_, IPonsFeeEscrow escrow_) {
        registry = registry_;
        escrow = escrow_;
        launcher = address(1); // the implementation itself is never used directly
    }

    /// @dev Called by the Launcher in the same transaction that creates the clone.
    function initialize(address vault_) external {
        require(launcher == address(0), "initialized");
        launcher = msg.sender;
        vault = vault_;
    }

    /// @dev The curve only exists after Pons launches the coin, so the launcher sets it once.
    function setCurve(address curve_) external {
        require(msg.sender == launcher && curve == address(0), "curve set");
        curve = curve_;
    }

    receive() external payable {}

    function pending() external view returns (uint256) {
        return escrow.balanceOf(address(this)) + address(this).balance;
    }

    function harvest() external {
        // Pre-graduation fees sit on the curve until swept. After graduation the curve
        // rejects this and Pons' sweep operator credits pool fees, so failure is ignored.
        if (curve != address(0)) {
            (bool swept,) = curve.call(abi.encodeCall(IPonsCurve.sweepFees, (0)));
            swept;
        }
        if (escrow.balanceOf(address(this)) > 0) escrow.claim();

        uint256 amount = address(this).balance;
        if (amount == 0) return;
        uint256 toVault = amount * VAULT_BPS / 10_000;
        uint256 toTreasury = amount - toVault;

        (bool ok,) = vault.call{value: toVault}("");
        require(ok, "vault transfer failed");
        (ok,) = registry.treasury().call{value: toTreasury}("");
        require(ok, "treasury transfer failed");
        emit Harvested(toVault, toTreasury);
    }
}
