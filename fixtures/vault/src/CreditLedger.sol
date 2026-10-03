// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Original synthetic credit ledger. No assets, chain calls, or real funds.
contract CreditLedger {
    address public immutable owner;
    mapping(address => uint256) public credits;
    uint256 public totalCredits;

    constructor() { owner = msg.sender; }

    function issue(address recipient, uint256 amount) external {
        require(msg.sender == owner, "owner only");
        require(recipient != address(0), "recipient");
        credits[recipient] += amount;
        totalCredits += amount;
    }

    /// @notice Bounded local exit from the ledger; no external dependencies.
    function retire(uint256 amount) external {
        require(credits[msg.sender] >= amount, "insufficient");
        credits[msg.sender] -= amount;
        totalCredits -= amount;
    }

    function wholeUnits(address account, uint256 unitSize) external view returns (uint256) {
        require(unitSize > 0, "unit size");
        return credits[account] / unitSize;
    }
}
