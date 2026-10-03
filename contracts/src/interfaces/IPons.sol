// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Subset of the Pons V2 launchpad used by LaunchNFT (Robinhood Chain, chain id 4663).
/// Signatures follow docs.ponsfamily.com/docs/v2 and were checked against deployed bytecode.
interface IPonsFactory {
    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    struct TokenParams {
        string name;
        string symbol;
        string logo;
        string description;
        Socials socials;
        address creatorFeeRecipient;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        bytes32 expectedEconomics;
        bytes32 salt;
    }

    function launchToken(TokenParams calldata params, uint256 launchConfigId, address pairToken)
        external
        payable
        returns (address token, address curve);

    function launchFee() external view returns (uint256);
    function maxCreatorTaxBps() external view returns (uint16);
    function previewLaunchEconomics(uint256 launchConfigId, address pairToken) external view returns (bytes32);
    function feeEscrow() external view returns (address);
}

interface IPonsFeeEscrow {
    function claim() external;
    function balanceOf(address recipient) external view returns (uint256);
}

interface IPonsCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut);
    /// @dev Moves accrued curve fees into the fee escrow. Callable by the creator-fee recipient.
    function sweepFees(uint256 minBuybackTokensOut) external;
}
