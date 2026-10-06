// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {SweepHook} from "../src/SweepHook.sol";
import {ExternalVault} from "../src/ExternalVault.sol";

/// Replays assets/sweep-hook.json exactly as the owner's wallet would send it, on a fork of
/// Robinhood Chain: the vault and hook land at the planned addresses with the planned settings,
/// the pool can only be created by the owner, and swaps burn and sweep.
/// Run: forge test --match-contract SweepHookPlanForkTest --fork-url https://rpc.mainnet.chain.robinhood.com
contract SweepHookPlanForkTest is Test {
    string json;
    address owner;
    address payable vault;
    SweepHook hook;
    IPoolManager pm;
    address vaul;

    receive() external payable {}

    function setUp() public {
        if (block.chainid != 4663) vm.skip(true);
        json = vm.readFile("../assets/sweep-hook.json");
        owner = vm.parseJsonAddress(json, ".owner");
        vault = payable(vm.parseJsonAddress(json, ".vault"));
        hook = SweepHook(vm.parseJsonAddress(json, ".hook"));
        pm = IPoolManager(vm.parseJsonAddress(json, ".poolManager"));
        vaul = vm.parseJsonAddress(json, ".token");
        address deployer = vm.parseJsonAddress(json, ".create2Deployer");

        vm.startPrank(owner);
        (bool ok,) = deployer.call(vm.parseJsonBytes(json, ".vaultTx"));
        assertTrue(ok, "vault tx");
        (ok,) = deployer.call(vm.parseJsonBytes(json, ".hookTx"));
        assertTrue(ok, "hook tx");
        vm.stopPrank();
    }

    function key() internal view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(address(0)), Currency.wrap(vaul), 3000, 60, IHooks(address(hook)));
    }

    function test_planDeploysWhatItSays() public view {
        assertGt(address(hook).code.length, 0);
        assertEq(address(hook.poolManager()), address(pm));
        assertEq(Currency.unwrap(hook.token()), vaul);
        assertEq(hook.vault(), vault);
        assertEq(hook.feeBps(), 100);
        assertEq(hook.initializer(), owner);
        ExternalVault v = ExternalVault(vault);
        assertEq(v.externalChainId(), 792703809);
        assertEq(v.externalCollection(), bytes32(bytes("cc-pokemon")));
        assertFalse(v.externalIsEvm());
        assertEq(uint8(v.policy()), 0); // Raffle
    }

    function test_ownerCreatesPoolAndSwapsBurnAndSweep() public {
        vm.expectRevert();
        pm.initialize(key(), TickMath.getSqrtPriceAtTick(0)); // not the owner
        vm.prank(owner);
        pm.initialize(key(), TickMath.getSqrtPriceAtTick(0));

        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(pm);
        PoolSwapTest swapper = new PoolSwapTest(pm);
        deal(vaul, address(this), 1_000_000 ether);
        vm.deal(address(this), 1_000 ether);
        IERC20(vaul).approve(address(lp), type(uint256).max);
        IERC20(vaul).approve(address(swapper), type(uint256).max);
        lp.modifyLiquidity{value: 500 ether}(key(), ModifyLiquidityParams(-6000, 6000, 1_000 ether, 0), "");

        uint256 dead = IERC20(vaul).balanceOf(0x000000000000000000000000000000000000dEaD);
        swapper.swap{value: 1 ether}(key(), SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1), PoolSwapTest.TestSettings(false, false), "");
        assertGt(IERC20(vaul).balanceOf(0x000000000000000000000000000000000000dEaD), dead, "buy burned");
        swapper.swap(key(), SwapParams(false, -1 ether, TickMath.MAX_SQRT_PRICE - 1), PoolSwapTest.TestSettings(false, false), "");
        assertGt(vault.balance, 0, "sell swept ETH into the vault");
    }
}
