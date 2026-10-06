// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SweepHook} from "../src/SweepHook.sol";

/// Fork test against the live Uniswap v4 PoolManager and the real $VAUL token on Robinhood Chain.
/// Run: forge test --match-contract SweepHookForkTest --fork-url https://rpc.mainnet.chain.robinhood.com
contract SweepHookForkTest is Test {
    IPoolManager constant PM = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant VAUL = 0x927b50e4cE03671d5a505922750edcc9Cb734ad4;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint160 constant FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;

    SweepHook hook;
    PoolKey key;
    PoolSwapTest swapper;
    PoolModifyLiquidityTest lp;
    address payable vault = payable(makeAddr("vault"));
    address trader = makeAddr("trader");

    receive() external payable {}

    function setUp() public {
        if (block.chainid != 4663) vm.skip(true);
        address at = address(uint160(uint256(keccak256("vaul.sweep.hook")) & ~uint256(Hooks.ALL_HOOK_MASK)) | FLAGS);
        deployCodeTo("SweepHook.sol:SweepHook", abi.encode(PM, Currency.wrap(VAUL), vault, 100, address(this)), at);
        hook = SweepHook(at);
        swapper = new PoolSwapTest(PM);
        lp = new PoolModifyLiquidityTest(PM);

        key = PoolKey(Currency.wrap(address(0)), Currency.wrap(VAUL), 3000, 60, IHooks(at));
        PM.initialize(key, TickMath.getSqrtPriceAtTick(0));

        deal(VAUL, address(this), 1_000_000 ether);
        vm.deal(address(this), 1_000 ether);
        IERC20(VAUL).approve(address(lp), type(uint256).max);
        lp.modifyLiquidity{value: 500 ether}(key, ModifyLiquidityParams(-6000, 6000, 1_000 ether, 0), "");

        vm.deal(trader, 10 ether);
        deal(VAUL, trader, 10_000 ether);
        vm.prank(trader);
        IERC20(VAUL).approve(address(swapper), type(uint256).max);
    }

    function _swap(bool buy, int256 amountSpecified, uint256 value) internal {
        vm.prank(trader);
        swapper.swap{value: value}(
            key,
            SwapParams(buy, amountSpecified, buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1),
            PoolSwapTest.TestSettings(false, false),
            ""
        );
    }

    function test_buyBurnsOnePercentOfTheTokensBought() public {
        uint256 deadBefore = IERC20(VAUL).balanceOf(DEAD);
        uint256 traderBefore = IERC20(VAUL).balanceOf(trader);
        _swap(true, -1 ether, 1 ether); // exact 1 ETH in

        uint256 burned = IERC20(VAUL).balanceOf(DEAD) - deadBefore;
        uint256 received = IERC20(VAUL).balanceOf(trader) - traderBefore;
        assertGt(burned, 0, "burned");
        assertEq(burned, hook.totalBurned());
        assertEq(burned, (received + burned) / 100, "1% of the swap output");
        assertEq(vault.balance, 0, "buys send no ETH to the vault");
    }

    function test_sellSweepsOnePercentOfTheEthToTheVault() public {
        uint256 ethBefore = trader.balance;
        _swap(false, -1 ether, 0); // exact 1 VAUL in

        uint256 swept = vault.balance;
        uint256 received = trader.balance - ethBefore;
        assertGt(swept, 0, "swept");
        assertEq(swept, hook.totalSwept());
        assertEq(swept, (received + swept) / 100, "1% of the ETH out");
        assertEq(hook.totalBurned(), 0);
    }

    function test_exactOutputBuyPaysTheFeeInEthToTheVault() public {
        uint256 ethBefore = trader.balance;
        _swap(true, 1 ether, 2 ether); // exactly 1 VAUL out, pay ETH (refund the rest)
        uint256 paid = ethBefore - trader.balance;
        assertGt(vault.balance, 0);
        assertEq(vault.balance, (paid - vault.balance) / 100, "1% on top of the ETH in");
    }

    function test_onlyOnePoolAndOnlyTheInitializer() public {
        PoolKey memory other = PoolKey(Currency.wrap(address(0)), Currency.wrap(VAUL), 10_000, 200, IHooks(address(hook)));
        vm.expectRevert();
        PM.initialize(other, TickMath.getSqrtPriceAtTick(0)); // second pool

        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        PM.initialize(other, TickMath.getSqrtPriceAtTick(0));
    }

    function test_hooksAreOnlyCallableByThePoolManager() public {
        vm.expectRevert(SweepHook.NotPoolManager.selector);
        hook.afterSwap(address(this), key, SwapParams(true, -1, 0), toBalanceDelta(0, 0), "");
    }
}
