// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface PolicyVm {
    function expectRevert() external;
    function ffi(string[] calldata) external returns (bytes memory);
    function readFile(string calldata) external returns (string memory);
    function envString(string calldata) external returns (string memory);
}

/// @notice Benign checks of the harness policy; no network, exploit or real secret.
contract IsolationPolicyTest {
    PolicyVm constant vm = PolicyVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testFfiDenied() public {
        string[] memory command = new string[](1);
        command[0] = "/bin/true";
        vm.expectRevert();
        this.probeFfi(command);
    }

    function testFilesystemCheatcodeDenied() public {
        vm.expectRevert();
        this.probeRead();
    }

    function testHostCanaryNotInherited() public {
        vm.expectRevert();
        this.probeEnv();
    }
    function probeFfi(string[] calldata command) external { vm.ffi(command); }
    function probeRead() external { vm.readFile("/source/src/CreditLedger.sol"); }
    function probeEnv() external { vm.envString("GEBAL_ISOLATION_CANARY"); }
}
