// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CallSlices} from "../src/CallSlices.sol";

/// Dry run (simulation only, sends nothing):
///   ADMIN_ADDRESS=0x.. MINTER_ADDRESS=0x.. forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL
/// A real deploy happens ONLY when --broadcast is passed explicitly (see contracts/README.md).
contract Deploy is Script {
    function run() external returns (CallSlices slices) {
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address minter = vm.envAddress("MINTER_ADDRESS");
        string memory baseURI = vm.envOr("SLICES_BASE_URI", string("https://app.pizzadao.org/api/slices/metadata/"));
        string memory contractURI =
            vm.envOr("SLICES_CONTRACT_URI", string("https://app.pizzadao.org/api/slices/contract-metadata"));

        require(admin != address(0) && minter != address(0), "ADMIN_ADDRESS / MINTER_ADDRESS required");
        require(admin != minter, "admin and minter must differ");

        vm.startBroadcast(); // simulation only unless --broadcast is passed
        slices = new CallSlices(admin, minter, baseURI, contractURI);
        vm.stopBroadcast();

        console.log("CallSlices:", address(slices));
        console.log("admin:", admin);
        console.log("minter:", minter);
    }
}
