// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CallSlices} from "../src/CallSlices.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract CallSlicesTest is Test {
    CallSlices slices;
    address admin = makeAddr("admin");
    address minter = makeAddr("minter");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    string constant BASE = "https://app.pizzadao.org/api/slices/metadata/";

    function setUp() public {
        slices = new CallSlices(admin, minter, BASE, "https://example/contract");
    }

    function _one(address to, uint256 id, bytes32 key)
        internal
        pure
        returns (address[] memory a, uint256[] memory i, bytes32[] memory k)
    {
        a = new address[](1);
        i = new uint256[](1);
        k = new bytes32[](1);
        a[0] = to;
        i[0] = id;
        k[0] = key;
    }

    function _mint(address to, uint256 id, bytes32 key) internal returns (uint256) {
        (address[] memory a, uint256[] memory i, bytes32[] memory k) = _one(to, id, key);
        vm.prank(minter);
        return slices.mintMany(a, i, k);
    }

    function test_metadata() public view {
        assertEq(slices.name(), "Call Slices");
        assertEq(slices.symbol(), "SLICE");
        assertFalse(slices.transferable());
        assertEq(slices.contractURI(), "https://example/contract");
    }

    function test_roles() public view {
        assertTrue(slices.hasRole(slices.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(slices.hasRole(slices.MINTER_ROLE(), minter));
        assertFalse(slices.hasRole(slices.DEFAULT_ADMIN_ROLE(), minter));
        assertFalse(slices.hasRole(slices.MINTER_ROLE(), admin));
    }

    function test_mintMany_onlyMinter() public {
        (address[] memory a, uint256[] memory i, bytes32[] memory k) = _one(alice, 1, keccak256("a"));
        vm.prank(alice);
        vm.expectRevert();
        slices.mintMany(a, i, k);
        vm.prank(admin); // admin is not a minter by default
        vm.expectRevert();
        slices.mintMany(a, i, k);
    }

    function test_mint_works() public {
        assertEq(_mint(alice, 7, keccak256("a")), 1);
        assertEq(slices.balanceOf(alice, 7), 1);
        assertEq(slices.totalSupply(7), 1);
        assertTrue(slices.claimUsed(keccak256("a")));
    }

    function test_mint_emitsEvent() public {
        (address[] memory a, uint256[] memory i, bytes32[] memory k) = _one(alice, 3, keccak256("e"));
        vm.expectEmit(true, true, true, true);
        emit CallSlices.SliceMinted(alice, 3, keccak256("e"));
        vm.prank(minter);
        slices.mintMany(a, i, k);
    }

    function test_skipsUsedClaimKey() public {
        _mint(alice, 1, keccak256("k"));
        // Same key, different recipient (e.g. member changed wallets): skipped, not minted.
        assertEq(_mint(bob, 1, keccak256("k")), 0);
        assertEq(slices.balanceOf(bob, 1), 0);
    }

    function test_skipsExistingHolder() public {
        _mint(alice, 1, keccak256("k1"));
        assertEq(_mint(alice, 1, keccak256("k2")), 0);
        assertEq(slices.balanceOf(alice, 1), 1);
        assertFalse(slices.claimUsed(keccak256("k2")));
    }

    function test_skipsZeroAddress() public {
        assertEq(_mint(address(0), 1, keccak256("z")), 0);
    }

    function test_batch_mixed_skips_but_mints_rest() public {
        _mint(alice, 1, keccak256("used"));
        address[] memory a = new address[](3);
        uint256[] memory i = new uint256[](3);
        bytes32[] memory k = new bytes32[](3);
        (a[0], i[0], k[0]) = (bob, 1, keccak256("used")); // skipped
        (a[1], i[1], k[1]) = (bob, 2, keccak256("n1"));
        (a[2], i[2], k[2]) = (alice, 2, keccak256("n2"));
        vm.prank(minter);
        assertEq(slices.mintMany(a, i, k), 2);
        assertEq(slices.balanceOf(bob, 1), 0);
        assertEq(slices.balanceOf(bob, 2), 1);
        assertEq(slices.balanceOf(alice, 2), 1);
        assertEq(slices.totalSupply(2), 2);
    }

    function test_lengthMismatchReverts() public {
        address[] memory a = new address[](2);
        uint256[] memory i = new uint256[](1);
        bytes32[] memory k = new bytes32[](2);
        vm.prank(minter);
        vm.expectRevert(CallSlices.LengthMismatch.selector);
        slices.mintMany(a, i, k);
    }

    function test_nonTransferable_revertsTransfer() public {
        _mint(alice, 1, keccak256("a"));
        vm.prank(alice);
        vm.expectRevert(CallSlices.NonTransferable.selector);
        slices.safeTransferFrom(alice, bob, 1, 1, "");
    }

    function test_nonTransferable_revertsBatchTransfer() public {
        _mint(alice, 1, keccak256("a"));
        uint256[] memory ids = new uint256[](1);
        uint256[] memory vals = new uint256[](1);
        ids[0] = 1;
        vals[0] = 1;
        vm.prank(alice);
        vm.expectRevert(CallSlices.NonTransferable.selector);
        slices.safeBatchTransferFrom(alice, bob, ids, vals, "");
    }

    function test_burn_allowed() public {
        _mint(alice, 1, keccak256("a"));
        vm.prank(alice);
        slices.burn(alice, 1, 1);
        assertEq(slices.balanceOf(alice, 1), 0);
        assertEq(slices.totalSupply(1), 0);
        // the claim key stays used: a burned slice cannot be re-minted with the same key
        assertEq(_mint(alice, 1, keccak256("a")), 0);
    }

    function test_adminToggleTransferable() public {
        _mint(alice, 1, keccak256("a"));
        vm.prank(admin);
        slices.setTransferable(true);
        assertTrue(slices.transferable());
        vm.prank(alice);
        slices.safeTransferFrom(alice, bob, 1, 1, "");
        assertEq(slices.balanceOf(bob, 1), 1);
        vm.prank(admin);
        slices.setTransferable(false);
        vm.prank(bob);
        vm.expectRevert(CallSlices.NonTransferable.selector);
        slices.safeTransferFrom(bob, alice, 1, 1, "");
    }

    function test_setTransferable_onlyAdmin() public {
        vm.prank(minter);
        vm.expectRevert();
        slices.setTransferable(true);
        vm.prank(alice);
        vm.expectRevert();
        slices.setTransferable(true);
    }

    function test_uri() public {
        assertEq(slices.uri(42), string.concat(BASE, "42"));
        vm.prank(admin);
        slices.setURI("ipfs://cid/");
        assertEq(slices.uri(1), "ipfs://cid/1");
        assertEq(slices.uri(1234567), "ipfs://cid/1234567");
    }

    function test_setURI_onlyAdmin() public {
        vm.prank(minter);
        vm.expectRevert();
        slices.setURI("x");
    }

    function test_setContractURI() public {
        vm.prank(admin);
        slices.setContractURI("ipfs://c");
        assertEq(slices.contractURI(), "ipfs://c");
        vm.prank(alice);
        vm.expectRevert();
        slices.setContractURI("evil");
    }

    function test_locked_followsToggle() public {
        assertTrue(slices.locked(1));
        vm.prank(admin);
        slices.setTransferable(true);
        assertFalse(slices.locked(1));
    }

    function test_supportsInterface() public view {
        assertTrue(slices.supportsInterface(0xd9b67a26)); // ERC1155
        assertTrue(slices.supportsInterface(0x7965db0b)); // AccessControl
        assertTrue(slices.supportsInterface(0xb45a3c0e)); // ERC5192
        assertTrue(slices.supportsInterface(0x01ffc9a7)); // ERC165
    }

    function test_adminCanRotateMinter() public {
        address newMinter = makeAddr("newMinter");
        bytes32 role = slices.MINTER_ROLE();
        vm.startPrank(admin);
        slices.revokeRole(role, minter);
        slices.grantRole(role, newMinter);
        vm.stopPrank();
        (address[] memory a, uint256[] memory i, bytes32[] memory k) = _one(alice, 1, keccak256("a"));
        vm.prank(minter);
        vm.expectRevert();
        slices.mintMany(a, i, k);
        vm.prank(newMinter);
        slices.mintMany(a, i, k);
        assertEq(slices.balanceOf(alice, 1), 1);
    }

    function test_minterCannotGrantRoles() public {
        bytes32 role = slices.MINTER_ROLE();
        vm.prank(minter);
        vm.expectRevert();
        slices.grantRole(role, bob);
    }

    // Gas profile: run `forge snapshot` / `forge test --gas-report` to see per-batch cost.
    function _batch(uint256 n) internal returns (uint256 gasUsed) {
        address[] memory a = new address[](n);
        uint256[] memory i = new uint256[](n);
        bytes32[] memory k = new bytes32[](n);
        for (uint256 x = 0; x < n; x++) {
            a[x] = address(uint160(0x1000 + x));
            i[x] = 5;
            k[x] = keccak256(abi.encode("batch", n, x));
        }
        vm.prank(minter);
        uint256 g = gasleft();
        slices.mintMany(a, i, k);
        gasUsed = g - gasleft();
    }

    function test_gas_mintMany_1() public { assertEq(slices.totalSupply(5), 0); _batch(1); assertEq(slices.totalSupply(5), 1); }
    function test_gas_mintMany_10() public { _batch(10); assertEq(slices.totalSupply(5), 10); }
    function test_gas_mintMany_50() public { _batch(50); assertEq(slices.totalSupply(5), 50); }

    function testFuzz_idempotentKey(address to, uint256 id, bytes32 key) public {
        vm.assume(to != address(0) && to.code.length == 0);
        _mint(to, id, key);
        assertEq(_mint(to, id, key), 0);
        assertEq(slices.balanceOf(to, id), 1);
    }
}
