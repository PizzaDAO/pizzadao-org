// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title Call Slices
/// @notice PizzaDAO proof-of-attendance for crew calls. One ERC-1155 token id per call
///         (the id is the app database id of the call). Non-transferable by default; holders
///         may always burn their own slices. An admin can later enable transfers.
/// @dev MINTER_ROLE is held by a hot server key (mint only). DEFAULT_ADMIN_ROLE is held by a
///      separate, cold address that can rotate minters, change URIs and toggle transfers.
contract CallSlices is ERC1155, ERC1155Burnable, ERC1155Supply, AccessControl {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    string public constant name = "Call Slices";
    string public constant symbol = "SLICE";

    /// @notice When false (default) slices can only be minted or burned, never moved.
    bool public transferable;
    /// @notice claimKey => already used. Makes server retries idempotent.
    mapping(bytes32 => bool) public claimUsed;

    string private _baseTokenURI;
    string private _contractURI;

    error NonTransferable();
    error LengthMismatch();

    event SliceMinted(address indexed to, uint256 indexed id, bytes32 indexed claimKey);
    event TransferableSet(bool transferable);
    event ContractURISet(string uri);

    constructor(address admin, address minter, string memory baseURI_, string memory contractURI_) ERC1155("") {
        require(admin != address(0), "admin=0");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (minter != address(0)) _grantRole(MINTER_ROLE, minter);
        _baseTokenURI = baseURI_;
        _contractURI = contractURI_;
    }

    // ------------------------------------------------------------------ minting

    /// @notice Mint one slice per (to[i], ids[i]). Entries whose claimKey was already used, or
    ///         whose recipient already holds that id, are skipped (no revert), so one stale
    ///         entry never sinks a batch and a retried transaction can never double-mint.
    /// @return minted how many entries were actually minted
    function mintMany(address[] calldata to, uint256[] calldata ids, bytes32[] calldata claimKeys)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 minted)
    {
        uint256 n = to.length;
        if (ids.length != n || claimKeys.length != n) revert LengthMismatch();
        for (uint256 i = 0; i < n; i++) {
            bytes32 key = claimKeys[i];
            if (claimUsed[key] || to[i] == address(0) || balanceOf(to[i], ids[i]) > 0) continue;
            claimUsed[key] = true;
            // _update directly (not _mint): no ERC1155Receiver acceptance callback. Slices are
            // soulbound, and one contract recipient without onERC1155Received (or with a
            // reverting one) must never be able to revert the whole batch.
            uint256[] memory idArr = new uint256[](1);
            uint256[] memory valArr = new uint256[](1);
            idArr[0] = ids[i];
            valArr[0] = 1;
            _update(address(0), to[i], idArr, valArr);
            emit SliceMinted(to[i], ids[i], key);
            minted++;
        }
    }

    // -------------------------------------------------------------------- admin

    /// @notice Set the base URI. uri(id) = base + decimal id. Can later point at IPFS.
    function setURI(string calldata newBase) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = newBase;
    }

    function setContractURI(string calldata newURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _contractURI = newURI;
        emit ContractURISet(newURI);
    }

    function setTransferable(bool value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        transferable = value;
        emit TransferableSet(value);
    }

    // --------------------------------------------------------------------- views

    function uri(uint256 id) public view override returns (string memory) {
        return string.concat(_baseTokenURI, id.toString());
    }

    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    /// @dev While slices are non-transferable, approvals are pointless and misleading
    ///      (marketplaces/phishing sites ask for them), so they are refused.
    function setApprovalForAll(address operator, bool approved) public override {
        if (!transferable) revert NonTransferable();
        super.setApprovalForAll(operator, approved);
    }

    // ----------------------------------------------------------------- internals

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply)
    {
        // Mints (from == 0) and burns (to == 0) are always allowed.
        if (!transferable && from != address(0) && to != address(0)) revert NonTransferable();
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
