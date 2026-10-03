// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Registry} from "../src/Registry.sol";
import {BatchLister} from "../src/BatchLister.sol";

contract BatchListerTest is Test {
    address owner = makeAddr("owner");
    Registry registry;
    BatchLister lister;

    function setUp() public {
        registry = new Registry(owner, makeAddr("keeper"), makeAddr("treasury"));
        lister = new BatchLister(registry, owner);
    }

    function _keys(uint256 n, uint256 salt) internal pure returns (address[] memory keys) {
        keys = new address[](n);
        for (uint256 i; i < n; i++) keys[i] = address(uint160(uint256(keccak256(abi.encode(salt, i)))));
    }

    function test_listsInChunksAndReturnsOwnership() public {
        vm.prank(owner);
        registry.transferOwnership(address(lister));

        address[] memory a = _keys(20, 1);
        address[] memory b = _keys(7, 2);
        vm.startPrank(owner);
        uint256 g = gasleft();
        lister.list(a, true);
        emit log_named_uint("gas for 20 listings", g - gasleft());
        lister.listAndGiveBack(b);
        vm.stopPrank();

        assertEq(registry.owner(), owner);
        for (uint256 i; i < a.length; i++) assertTrue(registry.isCollection(a[i]));
        for (uint256 i; i < b.length; i++) assertTrue(registry.isCollection(b[i]));
    }

    function test_onlyOwnerAndAlwaysRecoverable() public {
        vm.prank(owner);
        registry.transferOwnership(address(lister));

        vm.expectRevert("not owner");
        lister.list(_keys(1, 3), true);
        vm.expectRevert("not owner");
        lister.giveBack();

        vm.prank(owner);
        lister.giveBack();
        assertEq(registry.owner(), owner);
    }
}
