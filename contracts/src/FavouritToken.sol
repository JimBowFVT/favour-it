// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";

/// @title Favourit (FAV)
/// @notice ERC-20 representation of eligible Favourit earnings that have been unlocked on-chain.
/// @dev Marketplace balances and reward provenance remain off-chain. This contract intentionally
///      has no transfer tax, blacklist, redemption promise, or automatic marketplace logic.
contract FavouritToken is ERC20Pausable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant CAP_MANAGER_ROLE = keccak256("CAP_MANAGER_ROLE");

    uint256 public maxSupply;

    error ZeroAddress();
    error InvalidInitialCap();
    error CapNotIncreased(uint256 currentCap, uint256 requestedCap);
    error MaxSupplyExceeded(uint256 cap, uint256 requestedSupply);

    event MaxSupplyIncreased(uint256 indexed previousCap, uint256 indexed newCap);

    /// @param initialAdmin Address that manages roles and the emergency pause role.
    /// @param initialMinter Address allowed to mint unlocked FAV, expected to become a protected bridge/treasury signer.
    /// @param initialCap Maximum token supply at deployment, expressed in 6-decimal base units.
    constructor(address initialAdmin, address initialMinter, uint256 initialCap) ERC20("Favourit", "FAV") {
        if (initialAdmin == address(0) || initialMinter == address(0)) revert ZeroAddress();
        if (initialCap == 0) revert InvalidInitialCap();

        maxSupply = initialCap;

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(PAUSER_ROLE, initialAdmin);
        _grantRole(CAP_MANAGER_ROLE, initialAdmin);
        _grantRole(MINTER_ROLE, initialMinter);
    }

    /// @dev Matches the existing Favourit ledger exactly: 1 FAV = 1,000,000 micro-FAV.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint on-chain FAV after an eligible off-chain balance has been locked/burned by the bridge flow.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        uint256 supply = totalSupply();
        if (amount > maxSupply - supply) revert MaxSupplyExceeded(maxSupply, supply + amount);
        _mint(to, amount);
    }

    /// @notice Raise the token supply ceiling. The cap can never be silently reduced below a previously published ceiling.
    /// @dev In production CAP_MANAGER_ROLE should be controlled by a multisig/timelock rather than a personal wallet.
    function increaseMaxSupply(uint256 newCap) external onlyRole(CAP_MANAGER_ROLE) {
        uint256 previousCap = maxSupply;
        if (newCap <= previousCap) revert CapNotIncreased(previousCap, newCap);
        maxSupply = newCap;
        emit MaxSupplyIncreased(previousCap, newCap);
    }

    /// @notice Emergency stop for transfers and minting.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
