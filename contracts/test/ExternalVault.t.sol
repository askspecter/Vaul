// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Registry} from "../src/Registry.sol";
import {Raffles} from "../src/Raffles.sol";
import {SweepVault} from "../src/SweepVault.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {ExternalVault} from "../src/ExternalVault.sol";
import {ExternalLauncher} from "../src/ExternalLauncher.sol";
import {IPonsFactory, IPonsFeeEscrow} from "../src/interfaces/IPons.sol";
import {MockPons, MockEscrow, MockArbSys} from "./Mocks.sol";

contract ExternalVaultTest is Test {
    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes32 constant MILADY = bytes32(uint256(uint160(0x5Af0D9827E0c53E4799BB226655A1de152A425a5))); // Ethereum
    bytes32 constant SOL_COLLECTION = keccak256("some solana collection address");
    uint64 constant SOLANA = 792703809;

    Registry registry;
    Raffles raffles;
    MockPons pons;
    ExternalLauncher launcher;

    function setUp() public {
        vm.etch(address(0x64), address(new MockArbSys()).code);
        registry = new Registry(owner, keeper, treasury);
        raffles = new Raffles(registry);
        pons = new MockPons();
        ExternalVault vaultImpl = new ExternalVault(registry, address(raffles));
        FeeRouter routerImpl = new FeeRouter(registry, IPonsFeeEscrow(pons.feeEscrow()));
        launcher = new ExternalLauncher(IPonsFactory(address(pons)), registry, address(vaultImpl), address(routerImpl));
        vm.startPrank(owner);
        registry.setCollection(launcher.collectionKey(1, MILADY), true);
        registry.setCollection(launcher.collectionKey(SOLANA, SOL_COLLECTION), true);
        vm.stopPrank();
        vm.deal(creator, 1 ether);
    }

    function _launch(SweepVault.Policy policy) internal returns (FeeRouter router, ExternalVault vault) {
        ExternalLauncher.LaunchParams memory p;
        p.name = "Milady Muncher";
        p.symbol = "MILM";
        p.chainId = 1;
        p.collection = MILADY;
        p.isEvm = true;
        p.policy = policy;
        uint256 fee = pons.launchFee();
        vm.prank(creator);
        uint256 id = launcher.launch{value: fee}(p);
        (,, address r, address v,,) = launcher.launches(id);
        router = FeeRouter(payable(r));
        vault = ExternalVault(payable(v));
    }

    function _fund(FeeRouter router, uint256 fees) internal {
        MockEscrow escrow = pons.escrow();
        vm.deal(address(this), fees);
        escrow.credit{value: fees}(address(router));
        router.harvest();
    }

    function test_launchPairsExternalCollection() public {
        (FeeRouter router, ExternalVault vault) = _launch(SweepVault.Policy.Raffle);
        assertEq(vault.externalChainId(), 1);
        assertEq(vault.externalCollection(), MILADY);
        assertTrue(vault.externalIsEvm());
        assertEq(router.vault(), address(vault));
        _fund(router, 1 ether);
        assertEq(address(vault).balance, 0.8 ether);
    }

    function test_launchRejectsLocalChainAndUnlisted() public {
        ExternalLauncher.LaunchParams memory p;
        p.chainId = uint64(block.chainid);
        p.collection = MILADY;
        vm.prank(creator);
        vm.expectRevert("use Launcher for this chain");
        launcher.launch{value: 0.0005 ether}(p);

        p.chainId = 1;
        p.collection = bytes32(uint256(0xBEEF));
        vm.prank(creator);
        vm.expectRevert("collection not listed");
        launcher.launch{value: 0.0005 ether}(p);
    }

    function test_withdrawalWaitsAnHourAndOnlyGoesToKeeper() public {
        (FeeRouter router, ExternalVault vault) = _launch(SweepVault.Policy.Hold);
        _fund(router, 1 ether);

        vm.expectRevert("not keeper");
        vault.announceWithdrawal(0.5 ether);

        vm.startPrank(keeper);
        vm.expectRevert("amount");
        vault.announceWithdrawal(1 ether); // more than the balance
        vault.announceWithdrawal(0.5 ether);
        vm.expectRevert("not ready");
        vault.executeWithdrawal();
        skip(1 hours);
        vault.executeWithdrawal();
        vm.stopPrank();

        assertEq(keeper.balance, 0.5 ether);
        assertEq(vault.totalWithdrawn(), 0.5 ether);
        assertEq(address(vault).balance, 0.3 ether);
    }

    function test_ownerCanCancelWithdrawal() public {
        (FeeRouter router, ExternalVault vault) = _launch(SweepVault.Policy.Hold);
        _fund(router, 1 ether);
        vm.prank(keeper);
        vault.announceWithdrawal(0.8 ether);

        vm.prank(keeper);
        vm.expectRevert("not owner");
        vault.cancelWithdrawal();

        vm.prank(owner);
        vault.cancelWithdrawal();
        skip(2 hours);
        vm.prank(keeper);
        vm.expectRevert("not ready");
        vault.executeWithdrawal();
        assertEq(address(vault).balance, 0.8 ether);
    }

    function test_recordPurchaseAndBurn() public {
        (, ExternalVault hold) = _launch(SweepVault.Policy.Hold);
        vm.startPrank(keeper);
        hold.recordPurchase(7, 2 ether, keccak256("l1tx"));
        vm.expectRevert("recorded");
        hold.recordPurchase(7, 2 ether, keccak256("l1tx"));
        vm.stopPrank();
        assertTrue(hold.held(7));
        assertEq(hold.ownerOf(7), address(hold));
        assertEq(hold.totalSpent(), 2 ether);

        (, ExternalVault burn) = _launch(SweepVault.Policy.Burn);
        vm.prank(keeper);
        burn.recordPurchase(8, 2 ether, keccak256("l1tx2"));
        assertFalse(burn.held(8));
    }

    function test_raffleRecordsPrizeAndDelivery() public {
        (, ExternalVault vault) = _launch(SweepVault.Policy.Raffle);
        vm.prank(keeper);
        vault.recordPurchase(42, 2 ether, keccak256("buy"));

        bytes32 leafA = keccak256(bytes.concat(keccak256(abi.encode(alice, uint256(0), uint256(60)))));
        bytes32 leafB = keccak256(bytes.concat(keccak256(abi.encode(bob, uint256(60), uint256(100)))));
        bytes32 root = leafA < leafB ? keccak256(abi.encode(leafA, leafB)) : keccak256(abi.encode(leafB, leafA));

        vm.prank(keeper);
        uint256 id = raffles.openRaffle(SweepVault(payable(address(vault))), 42, root, 100);
        skip(15 minutes);
        raffles.commitDraw(address(vault), id);
        vm.roll(raffles.raffles(address(vault), id).drawBlock + 1);
        raffles.draw(address(vault), id);

        uint256 winning = raffles.raffles(address(vault), id).winningTicket;
        bytes32[] memory proof = new bytes32[](1);
        address winner;
        if (winning < 60) {
            proof[0] = leafB;
            raffles.claim(address(vault), id, alice, 0, 60, proof);
            winner = alice;
        } else {
            proof[0] = leafA;
            raffles.claim(address(vault), id, bob, 60, 100, proof);
            winner = bob;
        }
        assertEq(vault.prizeOwedTo(42), winner);
        assertFalse(vault.held(42));

        vm.expectRevert("not keeper");
        vault.markDelivered(42, keccak256("l1send"));
        vm.prank(keeper);
        vault.markDelivered(42, keccak256("l1send"));
        assertEq(vault.prizeOwedTo(42), address(0));
    }

    function test_solanaPrizeNeedsWinnerDestination() public {
        ExternalLauncher.LaunchParams memory p;
        p.name = "Sol Muncher";
        p.symbol = "SOLM";
        p.chainId = SOLANA;
        p.collection = SOL_COLLECTION;
        p.isEvm = false;
        p.policy = SweepVault.Policy.Raffle;
        uint256 fee = pons.launchFee();
        vm.prank(creator);
        uint256 lid = launcher.launch{value: fee}(p);
        (,,, address v, address key,) = launcher.launches(lid);
        ExternalVault vault = ExternalVault(payable(v));
        assertEq(key, launcher.collectionKey(SOLANA, SOL_COLLECTION));
        assertFalse(vault.externalIsEvm());

        uint256 mint = uint256(keccak256("an nft mint"));
        vm.prank(keeper);
        vault.recordPurchase(mint, 1 ether, keccak256("sol tx"));

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(alice, uint256(0), uint256(10)))));
        vm.prank(keeper);
        uint256 id = raffles.openRaffle(SweepVault(payable(v)), mint, leaf, 10);
        skip(15 minutes);
        raffles.commitDraw(v, id);
        vm.roll(raffles.raffles(v, id).drawBlock + 1);
        raffles.draw(v, id);
        raffles.claim(v, id, alice, 0, 10, new bytes32[](0));
        assertEq(vault.prizeOwedTo(mint), alice);

        vm.prank(keeper);
        vm.expectRevert("no destination");
        vault.markDelivered(mint, keccak256("send"));

        vm.prank(bob);
        vm.expectRevert("not winner");
        vault.setPrizeDestination(mint, keccak256("bob sol"));

        bytes32 solAddr = keccak256("alice solana wallet");
        vm.prank(alice);
        vault.setPrizeDestination(mint, solAddr);
        vm.prank(keeper);
        vault.markDelivered(mint, keccak256("send"));
        assertEq(vault.prizeOwedTo(mint), address(0));
    }

    function test_onlyRafflesCanSendPrize() public {
        (, ExternalVault vault) = _launch(SweepVault.Policy.Raffle);
        vm.prank(keeper);
        vault.recordPurchase(1, 1 ether, bytes32(0));
        vm.expectRevert("not raffles");
        vault.sendPrize(1, alice);
    }

    function test_clonesCannotBeReinitialized() public {
        (, ExternalVault vault) = _launch(SweepVault.Policy.Hold);
        vm.expectRevert("initialized");
        vault.initialize(1, bytes32(uint256(1)), true, SweepVault.Policy.Burn);
        ExternalVault impl = ExternalVault(payable(launcher.vaultImplementation()));
        vm.expectRevert("initialized");
        impl.initialize(1, bytes32(uint256(1)), true, SweepVault.Policy.Burn);
    }
}
