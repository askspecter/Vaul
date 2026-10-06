// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @notice Uniswap v4 hook for the one native-ETH / token pool it is deployed for (e.g. ETH/$VAUL).
/// Every swap pays FEE_BPS of its unspecified side (the output of an exact-in swap, the input of
/// an exact-out swap), on top of the pool's LP fee:
///   - paid in the token  (buys):  sent to the dead address, so every buy burns the token;
///   - paid in ETH        (sells): sent to `vault`, a Vaul vault that turns it into NFTs or cards.
/// Every buy burns, every sell sweeps. The fee, the token, the vault and the pool are fixed at
/// deployment; nobody can change them or take the fees elsewhere.
contract SweepHook is IHooks {
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MAX_FEE_BPS = 300;

    IPoolManager public immutable poolManager;
    Currency public immutable token;
    address payable public immutable vault;
    uint256 public immutable feeBps;
    /// @dev Only this address may create the pool, so nobody can initialise it at a bad price first.
    address public immutable initializer;

    bool public poolCreated;
    uint256 public totalBurned; // token amount sent to DEAD
    uint256 public totalSwept; // ETH sent to the vault

    event Burned(uint256 amount);
    event Swept(uint256 amount);

    error NotPoolManager();
    error HookNotImplemented();
    error WrongPool();
    error NotInitializer();
    error FeeTooHigh();

    constructor(IPoolManager poolManager_, Currency token_, address payable vault_, uint256 feeBps_, address initializer_) {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (Currency.unwrap(token_) == address(0) || vault_ == address(0)) revert WrongPool();
        poolManager = poolManager_;
        token = token_;
        vault = vault_;
        feeBps = feeBps_;
        initializer = initializer_;
        // The address must carry exactly these permission bits (mined with CREATE2).
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: false,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    /// @dev One pool only: native ETH / `token`, created by `initializer`.
    function beforeInitialize(address sender, PoolKey calldata key, uint160) external onlyPoolManager returns (bytes4) {
        if (sender != initializer) revert NotInitializer();
        if (
            poolCreated || !key.currency0.isAddressZero() || Currency.unwrap(key.currency1) != Currency.unwrap(token)
                || address(key.hooks) != address(this)
        ) revert WrongPool();
        poolCreated = true;
        return IHooks.beforeInitialize.selector;
    }

    function afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, int128)
    {
        // The fee is taken in the unspecified currency of the swap.
        bool specifiedIs0 = (params.amountSpecified < 0 == params.zeroForOne);
        (Currency feeCurrency, int128 amount) = specifiedIs0 ? (key.currency1, delta.amount1()) : (key.currency0, delta.amount0());
        if (amount < 0) amount = -amount;
        uint256 fee = uint256(uint128(amount)) * feeBps / 10_000;
        if (fee == 0) return (IHooks.afterSwap.selector, 0);

        if (feeCurrency.isAddressZero()) {
            totalSwept += fee;
            poolManager.take(feeCurrency, vault, fee);
            emit Swept(fee);
        } else {
            totalBurned += fee;
            poolManager.take(feeCurrency, DEAD, fee);
            emit Burned(fee);
        }
        return (IHooks.afterSwap.selector, int128(int256(fee)));
    }

    // ----------------------------------------------------------- unused hooks

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, BalanceDelta)
    {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, BalanceDelta)
    {
        revert HookNotImplemented();
    }

    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        pure
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
