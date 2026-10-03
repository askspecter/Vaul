// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Registry} from "../src/Registry.sol";
import {Launcher} from "../src/Launcher.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {SweepVault} from "../src/SweepVault.sol";
import {Raffles} from "../src/Raffles.sol";
import {IPonsFactory, IPonsFeeEscrow, IPonsCurve} from "../src/interfaces/IPons.sol";
import {MockNFT} from "./Mocks.sol";

/// Runs against a fork of Robinhood Chain mainnet using the real Pons V2 contracts.
/// Skipped unless FORK=1:  FORK=1 forge test --match-contract PonsFork -vv
contract PonsForkTest is Test {
    IPonsFactory constant PONS = IPonsFactory(0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e);
    uint256 constant WALLET_GAS_CAP = 1_200_000; // limit some mobile wallets impose per tx

    address treasury = makeAddr("treasury");
    Registry registry;
    Launcher launcher;
    MockNFT nft;

    function _deploy() internal {
        registry = new Registry(address(this), makeAddr("keeper"), treasury);
        Raffles raffles = new Raffles(registry);
        SweepVault vaultImpl = new SweepVault(registry, address(raffles));
        FeeRouter routerImpl = new FeeRouter(registry, IPonsFeeEscrow(PONS.feeEscrow()));
        launcher = new Launcher(PONS, registry, address(vaultImpl), address(routerImpl));
        nft = new MockNFT();
        registry.setCollection(address(nft), true);
    }

    function _params() internal view returns (Launcher.LaunchParams memory p) {
        p.name = "Fork Test";
        p.symbol = "FORK";
        p.creatorTaxBps = 100;
        p.expectedEconomics = PONS.previewLaunchEconomics(0, address(0));
        p.salt = keccak256("launchnft-fork-test");
        p.collection = nft;
        p.policy = SweepVault.Policy.Hold;
    }

    function test_launchTradeHarvestOnRealPons() public {
        if (!vm.envOr("FORK", false)) vm.skip(true);
        vm.createSelectFork("robinhood");
        assertEq(block.chainid, 4663);
        _deploy();

        address creator = makeAddr("creator");
        vm.deal(creator, 1 ether);
        uint256 fee = PONS.launchFee();
        vm.prank(creator);
        uint256 gasBefore = gasleft();
        launcher.launch{value: fee}(_params());
        emit log_named_uint("launch gas", gasBefore - gasleft());

        (address token, address curve, address r, address v,,) = launcher.launches(0);
        assertTrue(token.code.length > 0 && curve.code.length > 0, "pons deployed token + curve");
        assertEq(FeeRouter(payable(r)).curve(), curve);

        // Trade on the real curve so Pons accrues creator fees for our router.
        address trader = makeAddr("trader");
        vm.deal(trader, 5 ether);
        vm.roll(block.number + 100); // past any launch snipe window
        skip(1 hours);
        vm.prank(trader);
        IPonsCurve(curve).buy{value: 1 ether}(1 ether, 0, trader);

        // Anyone can harvest: it sweeps the curve, claims from the escrow and splits.
        vm.prank(makeAddr("anyone"));
        FeeRouter(payable(r)).harvest();
        uint256 total = v.balance + treasury.balance;
        emit log_named_decimal_uint("creator fees harvested (ETH)", total, 18);
        assertGt(total, 0, "fees reached vault");
        assertEq(v.balance, total * 8_000 / 10_000);
        assertEq(FeeRouter(payable(r)).pending(), 0);
    }
}
