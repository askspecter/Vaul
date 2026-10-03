// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Registry} from "../src/Registry.sol";
import {Launcher} from "../src/Launcher.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {SweepVault} from "../src/SweepVault.sol";
import {Raffles} from "../src/Raffles.sol";
import {IPonsFeeEscrow} from "../src/interfaces/IPons.sol";
import {IPonsFactory} from "../src/interfaces/IPons.sol";
import {MockNFT, MockMarket, MockEscrow, MockPons, MockArbSys} from "./Mocks.sol";

contract LaunchNFTTest is Test {
    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address seller = makeAddr("seller");

    Registry registry;
    MockPons pons;
    Launcher launcher;
    Raffles raffles;
    MockNFT nft;
    MockMarket market;

    function setUp() public {
        vm.etch(address(0x64), address(new MockArbSys()).code);
        registry = new Registry(owner, keeper, treasury);
        pons = new MockPons();
        raffles = new Raffles(registry);
        SweepVault vaultImpl = new SweepVault(registry, address(raffles));
        FeeRouter routerImpl = new FeeRouter(registry, IPonsFeeEscrow(pons.feeEscrow()));
        launcher = new Launcher(IPonsFactory(address(pons)), registry, address(vaultImpl), address(routerImpl));
        nft = new MockNFT();
        market = new MockMarket(nft);
        vm.startPrank(owner);
        registry.setMarketplace(address(market), true);
        registry.setCollection(address(nft), true);
        vm.stopPrank();
        vm.deal(creator, 1 ether);
    }

    function _params(SweepVault.Policy policy) internal view returns (Launcher.LaunchParams memory p) {
        p.name = "Floor Muncher";
        p.symbol = "MUNCH";
        p.creatorTaxBps = 100;
        p.collection = nft;
        p.policy = policy;
    }

    function _launch(SweepVault.Policy policy) internal returns (FeeRouter router, SweepVault vault) {
        uint256 fee = pons.launchFee();
        vm.prank(creator);
        uint256 id = launcher.launch{value: fee}(_params(policy));
        (,, address r, address v,,) = launcher.launches(id);
        return (FeeRouter(payable(r)), SweepVault(payable(v)));
    }

    function _fund(FeeRouter router, uint256 fees) internal {
        MockEscrow escrow = pons.escrow();
        vm.deal(address(this), fees);
        escrow.credit{value: fees}(address(router));
        router.harvest();
    }

    function _list(uint256 id, uint256 price) internal {
        nft.mint(seller, id);
        vm.startPrank(seller);
        nft.approve(address(market), id);
        market.list(id, price);
        vm.stopPrank();
    }

    function _buy(SweepVault vault, uint256 id, uint256 price) internal {
        vm.startPrank(keeper);
        vault.postCeiling(price);
        vault.buy(address(market), abi.encodeCall(MockMarket.fill, (id)), id, price);
        vm.stopPrank();
    }

    function test_launchRegistersRouterWithPons() public {
        (FeeRouter router, SweepVault vault) = _launch(SweepVault.Policy.Raffle);
        assertEq(pons.lastRecipient(), address(router));
        assertEq(pons.lastTax(), 100);
        assertEq(router.vault(), address(vault));
        assertEq(router.curve(), address(pons));
        assertEq(vault.raffles(), address(raffles));
        assertEq(address(vault.collection()), address(nft));
        (,,,,, address c) = launcher.launches(0);
        assertEq(c, creator);
    }

    function test_launchRequiresListedCollectionAndExactFee() public {
        Launcher.LaunchParams memory p = _params(SweepVault.Policy.Hold);
        p.collection = IERC721(address(new MockNFT()));
        vm.prank(creator);
        vm.expectRevert("collection not listed");
        launcher.launch{value: 0.0005 ether}(p);

        vm.prank(creator);
        vm.expectRevert("wrong launch fee");
        launcher.launch{value: 0.001 ether}(_params(SweepVault.Policy.Hold));
    }

    function test_harvestSplits80_20() public {
        (FeeRouter router, SweepVault vault) = _launch(SweepVault.Policy.Hold);
        _fund(router, 1 ether);
        assertEq(address(vault).balance, 0.8 ether);
        assertEq(treasury.balance, 0.2 ether);
        assertEq(router.pending(), 0);
    }

    function test_vaultBuysUnderCeiling() public {
        (FeeRouter router, SweepVault vault) = _launch(SweepVault.Policy.Hold);
        _fund(router, 1 ether);
        _list(7, 0.5 ether);
        _buy(vault, 7, 0.5 ether);
        assertEq(nft.ownerOf(7), address(vault));
        assertEq(address(vault).balance, 0.3 ether);
        assertEq(seller.balance, 0.5 ether);
    }

    function test_vaultRejectsAboveCeilingExpiredOrUnlisted() public {
        (FeeRouter router, SweepVault vault) = _launch(SweepVault.Policy.Hold);
        _fund(router, 1 ether);
        _list(1, 0.5 ether);
        bytes memory data = abi.encodeCall(MockMarket.fill, (1));

        vm.startPrank(keeper);
        vault.postCeiling(0.4 ether);
        vm.expectRevert("above ceiling");
        vault.buy(address(market), data, 1, 0.5 ether);

        vault.postCeiling(0.6 ether);
        skip(1 hours);
        vm.expectRevert("ceiling expired");
        vault.buy(address(market), data, 1, 0.5 ether);

        vault.postCeiling(0.6 ether);
        vm.expectRevert("marketplace not allowed");
        vault.buy(alice, data, 1, 0.5 ether);
        vm.stopPrank();

        vm.expectRevert("not keeper");
        vault.buy(address(market), data, 1, 0.5 ether);
    }

    function test_burnPolicy() public {
        (FeeRouter router, SweepVault vault) = _launch(SweepVault.Policy.Burn);
        _fund(router, 1 ether);
        _list(3, 0.5 ether);
        _buy(vault, 3, 0.5 ether);
        assertEq(nft.ownerOf(3), vault.BURN_ADDRESS());
    }

    function test_rejectsOtherCollections() public {
        (, SweepVault vault) = _launch(SweepVault.Policy.Hold);
        MockNFT other = new MockNFT();
        other.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert("wrong collection");
        other.safeTransferFrom(alice, address(vault), 1);
    }

    function test_raffleFlow() public {
        (FeeRouter router, SweepVault vault) = _launch(SweepVault.Policy.Raffle);
        _fund(router, 1 ether);
        _list(9, 0.5 ether);
        _buy(vault, 9, 0.5 ether);

        // alice owns tickets [0, 60), bob owns [60, 100)
        address bob = makeAddr("bob");
        bytes32 leafA = keccak256(bytes.concat(keccak256(abi.encode(alice, uint256(0), uint256(60)))));
        bytes32 leafB = keccak256(bytes.concat(keccak256(abi.encode(bob, uint256(60), uint256(100)))));
        bytes32 root = leafA < leafB ? keccak256(abi.encode(leafA, leafB)) : keccak256(abi.encode(leafB, leafA));
        vm.prank(keeper);
        uint256 id = raffles.openRaffle(vault, 9, root, 100);

        vm.expectRevert(Raffles.TooEarly.selector);
        raffles.commitDraw(address(vault), id);
        vm.expectRevert(Raffles.NotCommitted.selector);
        raffles.draw(address(vault), id);

        skip(15 minutes);
        raffles.commitDraw(address(vault), id);
        uint64 drawBlock = raffles.raffles(address(vault), id).drawBlock;
        vm.expectRevert(Raffles.TooEarly.selector);
        raffles.draw(address(vault), id);
        vm.roll(drawBlock + 1);
        raffles.draw(address(vault), id);
        Raffles.Raffle memory r = raffles.raffles(address(vault), id);
        uint256 winning = r.winningTicket;
        assertTrue(r.drawn);

        bytes32[] memory proof = new bytes32[](1);
        if (winning < 60) {
            proof[0] = leafB;
            raffles.claim(address(vault), id, alice, 0, 60, proof);
            assertEq(nft.ownerOf(9), alice);
        } else {
            proof[0] = leafA;
            raffles.claim(address(vault), id, bob, 60, 100, proof);
            assertEq(nft.ownerOf(9), bob);
        }

        vm.expectRevert(Raffles.NotClaimable.selector);
        raffles.claim(address(vault), id, alice, 0, 60, proof);
    }

    function test_raffleExpiredDrawCanBeRecommitted() public {
        (FeeRouter router, SweepVault vault) = _launch(SweepVault.Policy.Raffle);
        _fund(router, 1 ether);
        _list(2, 0.5 ether);
        _buy(vault, 2, 0.5 ether);
        vm.prank(keeper);
        uint256 id = raffles.openRaffle(vault, 2, keccak256("root"), 10);

        skip(15 minutes);
        raffles.commitDraw(address(vault), id);
        uint64 drawBlock = raffles.raffles(address(vault), id).drawBlock;
        vm.roll(drawBlock + 300); // hash no longer readable

        raffles.draw(address(vault), id);
        assertFalse(raffles.raffles(address(vault), id).drawn);
        assertEq(raffles.raffles(address(vault), id).drawBlock, 0);

        raffles.commitDraw(address(vault), id); // anyone can re-commit
        uint64 again = raffles.raffles(address(vault), id).drawBlock;
        vm.roll(again + 1);
        raffles.draw(address(vault), id);
        assertTrue(raffles.raffles(address(vault), id).drawn);
    }

    function test_clonesCannotBeReinitialized() public {
        (FeeRouter router, SweepVault vault) = _launch(SweepVault.Policy.Hold);
        vm.expectRevert("initialized");
        vault.initialize(IERC721(address(1)), SweepVault.Policy.Burn);
        vm.expectRevert("initialized");
        router.initialize(alice);
        vm.expectRevert("curve set");
        router.setCurve(alice);

        SweepVault impl = SweepVault(payable(launcher.vaultImplementation()));
        FeeRouter routerImpl = FeeRouter(payable(launcher.routerImplementation()));
        vm.expectRevert("initialized");
        impl.initialize(nft, SweepVault.Policy.Hold);
        vm.expectRevert("initialized");
        routerImpl.initialize(alice);
    }

    function test_onlyRafflesCanSendPrize() public {
        (FeeRouter router, SweepVault vault) = _launch(SweepVault.Policy.Raffle);
        _fund(router, 1 ether);
        _list(5, 0.5 ether);
        _buy(vault, 5, 0.5 ether);
        vm.expectRevert("not raffles");
        vault.sendPrize(5, alice);
    }

    function test_rafflesRejectNonRaffleVaultsAndNonKeeper() public {
        (FeeRouter router, SweepVault vault) = _launch(SweepVault.Policy.Hold);
        _fund(router, 1 ether);
        _list(6, 0.5 ether);
        _buy(vault, 6, 0.5 ether);
        vm.prank(keeper);
        vm.expectRevert(Raffles.NotRaffleVault.selector);
        raffles.openRaffle(vault, 6, keccak256("r"), 1);
        vm.expectRevert(Raffles.NotKeeper.selector);
        raffles.openRaffle(vault, 6, keccak256("r"), 1);
    }

    function testFuzz_harvestSplitIsExact(uint96 fees) public {
        (FeeRouter router, SweepVault vault) = _launch(SweepVault.Policy.Hold);
        _fund(router, fees);
        assertEq(address(vault).balance + treasury.balance, fees);
        assertEq(address(vault).balance, uint256(fees) * 8_000 / 10_000);
    }
}
