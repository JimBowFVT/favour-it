#!/usr/bin/env bash
set -euo pipefail

# Deploy FAV to Base Sepolia only.
# This script never prints the deployer private key and never writes it to disk.
#
# Required:
#   FAV_ADMIN_ADDRESS=0x...            # public wallet that will control admin/cap/pause roles
#   FAV_DEPLOYER_PRIVATE_KEY=0x...     # disposable/funded Base Sepolia deployer key
#
# Optional:
#   FAV_MINTER_ADDRESS=0x...           # defaults to FAV_ADMIN_ADDRESS for the first testnet phase
#   BASE_SEPOLIA_RPC_URL=https://...   # defaults to Base public Sepolia RPC
#   DEPLOYMENT_OUTPUT=/path/file.json  # defaults to contracts/deployments/base-sepolia-latest.json

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
ADMIN_ADDRESS="${FAV_ADMIN_ADDRESS:-}"
MINTER_ADDRESS="${FAV_MINTER_ADDRESS:-${FAV_ADMIN_ADDRESS:-}}"
DEPLOYER_PRIVATE_KEY="${FAV_DEPLOYER_PRIVATE_KEY:-}"
OUTPUT_PATH="${DEPLOYMENT_OUTPUT:-${ROOT_DIR}/contracts/deployments/base-sepolia-latest.json}"
EXPECTED_CHAIN_ID="84532"
INITIAL_CAP_UNITS="10000000000000" # 10,000,000 FAV * 1,000,000 units/FAV

fail() {
  printf 'FAV deployment aborted: %s\n' "$1" >&2
  exit 1
}

command -v forge >/dev/null 2>&1 || fail "Foundry forge is required"
command -v cast >/dev/null 2>&1 || fail "Foundry cast is required"
command -v python3 >/dev/null 2>&1 || fail "python3 is required to write the deployment manifest"
[[ -d "$ROOT_DIR/contracts/lib/openzeppelin-contracts/contracts" ]] || fail "Pinned OpenZeppelin contracts are not installed under contracts/lib/openzeppelin-contracts"

[[ -n "$ADMIN_ADDRESS" ]] || fail "FAV_ADMIN_ADDRESS is required"
[[ -n "$MINTER_ADDRESS" ]] || fail "FAV_MINTER_ADDRESS could not be resolved"
[[ -n "$DEPLOYER_PRIVATE_KEY" ]] || fail "FAV_DEPLOYER_PRIVATE_KEY is required"

[[ "$ADMIN_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "FAV_ADMIN_ADDRESS is not a valid EVM address"
[[ "$MINTER_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "FAV_MINTER_ADDRESS is not a valid EVM address"
[[ "$DEPLOYER_PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]] || fail "FAV_DEPLOYER_PRIVATE_KEY is not a 32-byte hex key"

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$CHAIN_ID" == "$EXPECTED_CHAIN_ID" ]] || fail "RPC chain id is ${CHAIN_ID}; expected Base Sepolia ${EXPECTED_CHAIN_ID}"

ADMIN_ADDRESS="$(cast to-check-sum-address "$ADMIN_ADDRESS")"
MINTER_ADDRESS="$(cast to-check-sum-address "$MINTER_ADDRESS")"
DEPLOYER_ADDRESS="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"

mkdir -p "$(dirname "$OUTPUT_PATH")"
TMP_OUTPUT="$(mktemp)"
trap 'rm -f "$TMP_OUTPUT"' EXIT

printf 'Deploying Favourit (FAV) to Base Sepolia...\n'
printf '  chain id: %s\n' "$CHAIN_ID"
printf '  deployer: %s\n' "$DEPLOYER_ADDRESS"
printf '  admin:    %s\n' "$ADMIN_ADDRESS"
printf '  minter:   %s\n' "$MINTER_ADDRESS"
printf '  cap:      10,000,000 FAV\n'

(
  cd "$ROOT_DIR"
  forge create \
    --root contracts \
    src/FavouritToken.sol:FavouritToken \
    --constructor-args "$ADMIN_ADDRESS" "$MINTER_ADDRESS" "$INITIAL_CAP_UNITS" \
    --rpc-url "$RPC_URL" \
    --private-key "$DEPLOYER_PRIVATE_KEY" \
    --broadcast \
    --json
) | tee "$TMP_OUTPUT"

python3 - "$TMP_OUTPUT" "$OUTPUT_PATH" "$CHAIN_ID" "$ADMIN_ADDRESS" "$MINTER_ADDRESS" "$DEPLOYER_ADDRESS" "$INITIAL_CAP_UNITS" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

raw_path, out_path, chain_id, admin, minter, deployer, cap = sys.argv[1:]
raw = pathlib.Path(raw_path).read_text().strip()
try:
    deployment = json.loads(raw)
except json.JSONDecodeError as exc:
    raise SystemExit(f"forge output was not valid JSON: {exc}")

address = deployment.get("deployedTo") or deployment.get("deployed_to")
tx_hash = deployment.get("transactionHash") or deployment.get("transaction_hash")
if not address:
    raise SystemExit("forge output did not include deployed contract address")

manifest = {
    "network": "Base Sepolia",
    "chainId": int(chain_id),
    "token": "Favourit",
    "symbol": "FAV",
    "decimals": 6,
    "initialCapMicroFav": int(cap),
    "initialCapFav": 10_000_000,
    "tokenAddress": address.lower(),
    "deploymentTxHash": tx_hash.lower() if isinstance(tx_hash, str) else None,
    "adminAddress": admin,
    "minterAddress": minter,
    "deployerAddress": deployer,
    "deployedAt": datetime.now(timezone.utc).isoformat(),
}

path = pathlib.Path(out_path)
path.write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Deployment manifest written to {path}")
print(f"FAV token address: {manifest['tokenAddress']}")
PY

printf '\nDeployment complete. Crypto unlock remains disabled until the deployment is recorded in Supabase and explicitly enabled.\n'
