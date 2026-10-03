// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Arbitrum precompile. Robinhood Chain is an Arbitrum Orbit chain, where
/// `block.number`/`blockhash` refer to the parent chain; ArbSys exposes the chain's own blocks.
interface IArbSys {
    function arbBlockNumber() external view returns (uint256);
    function arbBlockHash(uint256 blockNumber) external view returns (bytes32);
}

IArbSys constant ARB_SYS = IArbSys(address(0x64));
