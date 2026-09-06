#!/usr/bin/env bash
set -euo pipefail

# Deterministic end-to-end smoke test for the FAV on-chain leg.
#
# This intentionally uses Anvil's public development keys and a loopback RPC only.
# It does NOT use Favourit's real Base Sepolia deployer secret. The production/testnet
# deployment script keeps its strict locked-deployer policy; this test independently
# exercises the same contract constructor, verifier, mint reference and 6-decimal units.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_URL="http://127.0.0.1:8545"
CHAIN_ID="84532"
CAP_UNITS="10000000000000"
MINT_AMOUNT="975000"

# Standard Anvil dev accounts. These keys are public test fixtures and must never be
# reused for any real network or funded wallet.
MINTER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ADMIN_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
MINTER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
ADMIN_ADDRESS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
RECIPIENT_ADDRESS="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
MINT_REFERENCE="0x8f7d8cc515c8025471f7e4c03fd24d1a81bfe4c5bc4bbd30f5e2446851f04343"

fail() {
  printf 'Local FAV E2E failed: %s\n' "$1" >&2
  exit 1
}

for command in anvil forge cast python3; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required"
done

[[ -d "$ROOT_DIR/contracts/lib/openzeppelin-contracts/contracts" ]] || fail "pinned OpenZeppelin contracts are not installed"

ANVIL_LOG="$(mktemp)"
DEPLOY_OUTPUT="$(mktemp)"
cleanup() {
  if [[ -n "${ANVIL_PID:-}" ]]; then
    kill "$ANVIL_PID" >/dev/null 2>&1 || true
    wait "$ANVIL_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$ANVIL_LOG" "$DEPLOY_OUTPUT"
}
trap cleanup EXIT

anvil --chain-id "$CHAIN_ID" --host 127.0.0.1 --port 8545 --silent >"$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!

for _ in $(seq 1 40); do
  if cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

ACTUAL_CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || true)"
[[ "$ACTUAL_CHAIN_ID" == "$CHAIN_ID" ]] || {
  cat "$ANVIL_LOG" >&2 || true
  fail "Anvil did not start with chain id $CHAIN_ID"
}

# Guard the fixture itself so accidental key/address edits fail loudly.
DERIVED_MINTER="$(cast wallet address --private-key "$MINTER_KEY")"
DERIVED_ADMIN="$(cast wallet address --private-key "$ADMIN_KEY")"
[[ "${DERIVED_MINTER,,}" == "${MINTER_ADDRESS,,}" ]] || fail "local minter fixture mismatch"
[[ "${DERIVED_ADMIN,,}" == "${ADMIN_ADDRESS,,}" ]] || fail "local admin fixture mismatch"
[[ "${MINTER_ADDRESS,,}" != "${ADMIN_ADDRESS,,}" ]] || fail "local admin and minter must be separate"

printf 'Deploying FAV to deterministic local chain %s...\n' "$CHAIN_ID"
(
  cd "$ROOT_DIR"
  # Keep --constructor-args last: current Foundry treats all following tokens as
  # constructor values, so placing RPC flags after it can corrupt argument parsing.
  forge create \
    --root contracts \
    src/FavouritToken.sol:FavouritToken \
    --rpc-url "$RPC_URL" \
    --private-key "$MINTER_KEY" \
    --broadcast \
    --json \
    --constructor-args "$ADMIN_ADDRESS" "$MINTER_ADDRESS" "$CAP_UNITS"
) >"$DEPLOY_OUTPUT"

TOKEN_ADDRESS="$(python3 - "$DEPLOY_OUTPUT" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
address = payload.get('deployedTo') or payload.get('deployed_to')
if not isinstance(address, str) or not address.startswith('0x') or len(address) != 42:
    raise SystemExit('forge deployment did not return a valid contract address')
print(address)
PY
)"

# Reuse the production read-only verifier against the local chain. Only the addresses
# and RPC differ; metadata, supply cap, roles and zero initial supply stay identical.
BASE_SEPOLIA_RPC_URL="$RPC_URL" \
FAV_TOKEN_ADDRESS="$TOKEN_ADDRESS" \
FAV_ADMIN_ADDRESS="$ADMIN_ADDRESS" \
FAV_MINTER_ADDRESS="$MINTER_ADDRESS" \
  bash "$ROOT_DIR/scripts/verify-fav-base-sepolia.sh"

# Mint the exact net result of a 1.000000 FAV unlock after the locked 2.5% fee.
cast send "$TOKEN_ADDRESS" \
  'mintWithReference(bytes32,address,uint256)' \
  "$MINT_REFERENCE" "$RECIPIENT_ADDRESS" "$MINT_AMOUNT" \
  --rpc-url "$RPC_URL" \
  --private-key "$MINTER_KEY" >/dev/null

BALANCE="$(cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$RECIPIENT_ADDRESS" --rpc-url "$RPC_URL")"
SUPPLY="$(cast call "$TOKEN_ADDRESS" 'totalSupply()(uint256)' --rpc-url "$RPC_URL")"
PROCESSED="$(cast call "$TOKEN_ADDRESS" 'processedMintReferences(bytes32)(bool)' "$MINT_REFERENCE" --rpc-url "$RPC_URL")"

[[ "$BALANCE" == "$MINT_AMOUNT" ]] || fail "recipient balance $BALANCE != $MINT_AMOUNT"
[[ "$SUPPLY" == "$MINT_AMOUNT" ]] || fail "total supply $SUPPLY != $MINT_AMOUNT"
[[ "$PROCESSED" == "true" ]] || fail "mint reference was not marked processed"

# The same bridge reference must never mint twice, even if a worker retries.
if cast send "$TOKEN_ADDRESS" \
  'mintWithReference(bytes32,address,uint256)' \
  "$MINT_REFERENCE" "$RECIPIENT_ADDRESS" "$MINT_AMOUNT" \
  --rpc-url "$RPC_URL" \
  --private-key "$MINTER_KEY" >/dev/null 2>&1; then
  fail "duplicate mint reference unexpectedly succeeded"
fi

BALANCE_AFTER_RETRY="$(cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$RECIPIENT_ADDRESS" --rpc-url "$RPC_URL")"
SUPPLY_AFTER_RETRY="$(cast call "$TOKEN_ADDRESS" 'totalSupply()(uint256)' --rpc-url "$RPC_URL")"
[[ "$BALANCE_AFTER_RETRY" == "$MINT_AMOUNT" ]] || fail "duplicate retry changed recipient balance"
[[ "$SUPPLY_AFTER_RETRY" == "$MINT_AMOUNT" ]] || fail "duplicate retry changed total supply"

printf 'Local FAV E2E passed. token=%s minted=%s micro-FAV recipient=%s\n' \
  "$TOKEN_ADDRESS" "$MINT_AMOUNT" "$RECIPIENT_ADDRESS"
