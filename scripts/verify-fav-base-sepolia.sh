#!/usr/bin/env bash
set -euo pipefail

# Read-only verifier for the FAV Base Sepolia deployment.
# It checks token metadata, zero initial supply, 10M cap and role assignments.
# No private key is required.

RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
TOKEN_ADDRESS="${FAV_TOKEN_ADDRESS:-}"
ADMIN_ADDRESS="${FAV_ADMIN_ADDRESS:-0xB15bd11EBF03feceE5F92F260def797542E0f570}"
MINTER_ADDRESS="${FAV_MINTER_ADDRESS:-}"
EXPECTED_CHAIN_ID="84532"
EXPECTED_CAP="10000000000000"

fail() {
  printf 'FAV verification failed: %s\n' "$1" >&2
  exit 1
}

# Recent Foundry versions annotate large integers (for example: "10000000000000 [1e13]").
# Verification compares the canonical integer token, not the optional human annotation.
uint_value() {
  awk '{print $1}'
}

command -v cast >/dev/null 2>&1 || fail "Foundry cast is required"
[[ "$TOKEN_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "FAV_TOKEN_ADDRESS is required and must be a valid EVM address"
[[ "$ADMIN_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "FAV_ADMIN_ADDRESS is invalid"
[[ "$MINTER_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "FAV_MINTER_ADDRESS is required and must be a valid EVM address"

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL" | uint_value)"
[[ "$CHAIN_ID" == "$EXPECTED_CHAIN_ID" ]] || fail "RPC chain id is ${CHAIN_ID}; expected Base Sepolia ${EXPECTED_CHAIN_ID}"

TOKEN_ADDRESS="$(cast to-check-sum-address "$TOKEN_ADDRESS")"
ADMIN_ADDRESS="$(cast to-check-sum-address "$ADMIN_ADDRESS")"
MINTER_ADDRESS="$(cast to-check-sum-address "$MINTER_ADDRESS")"

NAME="$(cast call "$TOKEN_ADDRESS" 'name()(string)' --rpc-url "$RPC_URL" | tr -d '"')"
SYMBOL="$(cast call "$TOKEN_ADDRESS" 'symbol()(string)' --rpc-url "$RPC_URL" | tr -d '"')"
DECIMALS="$(cast call "$TOKEN_ADDRESS" 'decimals()(uint8)' --rpc-url "$RPC_URL" | uint_value)"
MAX_SUPPLY="$(cast call "$TOKEN_ADDRESS" 'maxSupply()(uint256)' --rpc-url "$RPC_URL" | uint_value)"
TOTAL_SUPPLY="$(cast call "$TOKEN_ADDRESS" 'totalSupply()(uint256)' --rpc-url "$RPC_URL" | uint_value)"
DEFAULT_ADMIN_ROLE="$(cast call "$TOKEN_ADDRESS" 'DEFAULT_ADMIN_ROLE()(bytes32)' --rpc-url "$RPC_URL")"
PAUSER_ROLE="$(cast call "$TOKEN_ADDRESS" 'PAUSER_ROLE()(bytes32)' --rpc-url "$RPC_URL")"
CAP_MANAGER_ROLE="$(cast call "$TOKEN_ADDRESS" 'CAP_MANAGER_ROLE()(bytes32)' --rpc-url "$RPC_URL")"
MINTER_ROLE="$(cast call "$TOKEN_ADDRESS" 'MINTER_ROLE()(bytes32)' --rpc-url "$RPC_URL")"

[[ "$NAME" == "Favourit" ]] || fail "unexpected token name: ${NAME}"
[[ "$SYMBOL" == "FAV" ]] || fail "unexpected token symbol: ${SYMBOL}"
[[ "$DECIMALS" == "6" ]] || fail "unexpected decimals: ${DECIMALS}"
[[ "$MAX_SUPPLY" == "$EXPECTED_CAP" ]] || fail "unexpected max supply: ${MAX_SUPPLY}"
[[ "$TOTAL_SUPPLY" == "0" ]] || fail "initial total supply is not zero: ${TOTAL_SUPPLY}"

ADMIN_OK="$(cast call "$TOKEN_ADDRESS" 'hasRole(bytes32,address)(bool)' "$DEFAULT_ADMIN_ROLE" "$ADMIN_ADDRESS" --rpc-url "$RPC_URL")"
PAUSER_OK="$(cast call "$TOKEN_ADDRESS" 'hasRole(bytes32,address)(bool)' "$PAUSER_ROLE" "$ADMIN_ADDRESS" --rpc-url "$RPC_URL")"
CAP_OK="$(cast call "$TOKEN_ADDRESS" 'hasRole(bytes32,address)(bool)' "$CAP_MANAGER_ROLE" "$ADMIN_ADDRESS" --rpc-url "$RPC_URL")"
MINTER_OK="$(cast call "$TOKEN_ADDRESS" 'hasRole(bytes32,address)(bool)' "$MINTER_ROLE" "$MINTER_ADDRESS" --rpc-url "$RPC_URL")"

[[ "$ADMIN_OK" == "true" ]] || fail "configured admin does not hold DEFAULT_ADMIN_ROLE"
[[ "$PAUSER_OK" == "true" ]] || fail "configured admin does not hold PAUSER_ROLE"
[[ "$CAP_OK" == "true" ]] || fail "configured admin does not hold CAP_MANAGER_ROLE"
[[ "$MINTER_OK" == "true" ]] || fail "configured minter does not hold MINTER_ROLE"

printf 'FAV Base Sepolia deployment verified successfully.\n'
printf '  token:      %s\n' "$TOKEN_ADDRESS"
printf '  admin:      %s\n' "$ADMIN_ADDRESS"
printf '  minter:     %s\n' "$MINTER_ADDRESS"
printf '  max supply: 10,000,000 FAV\n'
printf '  supply:     0 FAV\n'
printf '  chain id:   %s\n' "$CHAIN_ID"
