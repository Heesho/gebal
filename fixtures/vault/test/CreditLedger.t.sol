// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import "../src/CreditLedger.sol";

contract LedgerUser {
    function issue(CreditLedger ledger) external returns (bool) {
        (bool ok,) = address(ledger).call(abi.encodeCall(ledger.issue, (address(this), 1)));
        return ok;
    }
    function retire(CreditLedger ledger, uint256 amount) external { ledger.retire(amount); }
}

/// @notice Original existing fixture tests; no FFI, fork, RPC, or executable generation.
contract CreditLedgerTest {
    function testAccountingAndBoundedExit() public {
        CreditLedger ledger = new CreditLedger();
        LedgerUser user = new LedgerUser();
        ledger.issue(address(user), 17);
        require(ledger.credits(address(user)) == ledger.totalCredits(), "accounting");
        user.retire(ledger, 17);
        require(ledger.totalCredits() == 0, "retirement");
    }
    function testAuthorization() public {
        CreditLedger ledger = new CreditLedger();
        LedgerUser user = new LedgerUser();
        require(!user.issue(ledger), "unauthorized issuance");
        require(ledger.totalCredits() == 0, "supply unchanged");
    }
    function testRounding() public {
        CreditLedger ledger = new CreditLedger();
        ledger.issue(address(this), 17);
        require(ledger.wholeUnits(address(this), 5) == 3, "round down");
    }
    function testFuzzAccounting(uint64 amount) public {
        CreditLedger ledger = new CreditLedger();
        ledger.issue(address(this), amount);
        ledger.retire(amount);
        require(ledger.totalCredits() == 0, "conservation");
    }
}
