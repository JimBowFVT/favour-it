#!/usr/bin/env bash
set -euo pipefail

# Deploy FAV to Base Sepolia only.
# The public admin address, disposable testnet deployer and initial cap are locked
# in the committed deployment policy. This script never prints the deployer
# private key and never writes it to disk.
#
# Required:
#   FAV_DEPLOYER_PRIVATE_KEY=0x...     # private key for the locked disposable Base Sepolia deployer
#
# Optional:
#   FAV_ADMIN_ADDRESS=0x...            # if set, MUST match the committed policy
#   FAV_MINTER_ADDRESS=0x...           # defaults to the locked disposable deployer address for testnet
#   BASE_SEPOLIA_RPC_URL=https://...   # defaults to Base public Sepolia RPC
#   DEPLOYMENT_OUTPUT=/path/file.json  # defaults to contracts/deployments/base-sepolia-latest.json

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POLICY_PATH="${ROOT_DIR}/contracts/deployments/base-sepolia-config.json"
RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
ADMIN_ADDRESS_INPUT="${FAV_ADMIN_ADDRESS:-}"
MINTER_ADDRESS_INPUT="${FAV_MINTER_ADDRESS:-}"
DEPLOYER_PRIVATE_KEY="${FAV_DEPLOYER_PRIVATE_KEY:-}"
OUTPUT_PATH="${DEPLOYMENT_OUTPUT:-${ROOT_DIR}/contracts/deployments/base-sepolia-latest.json}"
EXPECTED_CHAIN_ID="84532"

fail() {
  printf 'FAV deployment aborted: %s\n' "$1" >&2
  exit 1
}

command -v forge >/dev/null 2>&1 || fail "Foundry forge is required"
command -v cast >/dev/null 2>&1 || fail "Foundry cast is required"
command -v python3 >/dev/null 2>&1 || fail "python3 is required to read/write deployment policy"
[[ -d "$ROOT_DIR/contracts/lib/openzeppelin-contracts/contracts" ]] || fail "Pinned OpenZeppelin contracts are not installed under contracts/lib/openzeppelin-contracts"
[[ -f "$POLICY_PATH" ]] || fail "Base Sepolia deployment policy is missing"
[[ -n "$DEPLOYER_PRIVATE_KEY" ]] || fail "FAV_DEPLOYER_PRIVATE_KEY is required"
[[ "$DEPLOYER_PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]] || fail "FAV_DEPLOYER_PRIVATE_KEY is not a 32-byte hex key"

readarray -t POLICY_VALUES < <(python3 - "$POLICY_PATH" <<'PY'
import json
import sys

policy = json.load(open(sys.argv[1]))
required = {
    "chainId": 84532,
    "decimals": 6,
    "initialCapFav": 10_000_000,
    "initialCapMicroFav": 10_000_000_000_000,
    "initialSupplyFav": 0,
    "unlockMaturityHours": 120,
    "unlockEnabledByDefault": False,
    "mainnetDeploymentAllowed": False,
}
for key, expected in required.items():
    if policy.get(key) != expected:
        raise SystemExit(f"deployment policy mismatch for {key}: {policy.get(key)!r} != {expected!r}")
admin = str(policy.get("adminAddress", "")).strip()
deployer = str(policy.get("expectedTestnetDeployerAddress", "")).strip()
if not admin.startswith("0x") or len(admin) != 42:
    raise SystemExit("deployment policy adminAddress is invalid")
if not deployer.startswith("0x") or len(deployer) != 42:
    raise SystemExit("deployment policy expectedTestnetDeployerAddress is invalid")
if admin.lower() == deployer.lower():
    raise SystemExit("deployment policy must separate admin and disposable deployer")
print(admin)
print(deployer)
print(int(policy["initialCapMicroFav"]))
print(int(policy["initialCapFav"]))
PY
)

POLICY_ADMIN_ADDRESS="${POLICY_VALUES[0]:-}"
POLICY_DEPLOYER_ADDRESS="${POLICY_VALUES[1]:-}"
INITIAL_CAP_UNITS="${POLICY_VALUES[2]:-}"
INITIAL_CAP_FAV="${POLICY_VALUES[3]:-}"
[[ -n "$POLICY_ADMIN_ADDRESS" && -n "$POLICY_DEPLOYER_ADDRESS" && -n "$INITIAL_CAP_UNITS" && -n "$INITIAL_CAP_FAV" ]] || fail "deployment policy could not be loaded"

if [[ -n "$ADMIN_ADDRESS_INPUT" && "${ADMIN_ADDRESS_INPUT,,}" != "${POLICY_ADMIN_ADDRESS,,}" ]]; then
  fail "FAV_ADMIN_ADDRESS does not match the locked deployment policy"
fi
ADMIN_ADDRESS="$POLICY_ADMIN_ADDRESS"

[[ "$ADMIN_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "locked admin address is not a valid EVM address"
[[ "$POLICY_DEPLOYER_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "locked testnet deployer address is not a valid EVM address"

CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
[[ "$CHAIN_ID" == "$EXPECTED_CHAIN_ID" ]] || fail "RPC chain id is ${CHAIN_ID}; expected Base Sepolia ${EXPECTED_CHAIN_ID}"

ADMIN_ADDRESS="$(cast to-check-sum-address "$ADMIN_ADDRESS")"
POLICY_DEPLOYER_ADDRESS="$(cast to-check-sum-address "$POLICY_DEPLOYER_ADDRESS")"
DEPLOYER_ADDRESS="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
DEPLOYER_ADDRESS="$(cast to-check-sum-address "$DEPLOYER_ADDRESS")"
[[ "$DEPLOYER_ADDRESS" == "$POLICY_DEPLOYER_ADDRESS" ]] || fail "deployer private key does not match the locked disposable testnet deployer ${POLICY_DEPLOYER_ADDRESS}"
[[ "$DEPLOYER_ADDRESS" != "$ADMIN_ADDRESS" ]] || fail "disposable deployer must not be the long-term admin address"

MINTER_ADDRESS="${MINTER_ADDRESS_INPUT:-$DEPLOYER_ADDRESS}"
[[ "$MINTER_ADDRESS" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "FAV_MINTER_ADDRESS is not a valid EVM address"
MINTER_ADDRESS="$(cast to-check-sum-address "$MINTER_ADDRESS")"

BALANCE_WEI="$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC_URL")"
[[ "$BALANCE_WEI" != "0" ]] || fail "locked disposable deployer has no Base Sepolia ETH for gas"

mkdir -p "$(dirname "$OUTPUT_PATH")"
TMP_OUTPUT="$(mktemp)"
trap 'rm -f "$TMP_OUTPUT"' EXIT

printf 'Deploying Favourit (FAV) to Base Sepolia...\n'
printf '  chain id: %s\n' "$CHAIN_ID"
printf '  deployer: %s (locked testnet policy)\n' "$DEPLOYER_ADDRESS"
printf '  admin:    %s (locked policy)\n' "$ADMIN_ADDRESS"
printf '  minter:   %s\n' "$MINTER_ADDRESS"
printf '  cap:      %s FAV\n' "$INITIAL_CAP_FAV"
printf '  gas ETH:  %s wei\n' "$BALANCE_WEI"

if [[ "$MINTER_ADDRESS" == "$ADMIN_ADDRESS" ]]; then
  fail "minter must not be the long-term admin address"
fi

(
  cd "$ROOT_DIR"
  # Keep constructor args last. Foundry's current CLI consumes every following token
  # as a constructor value, so RPC/private-key flags after this option break deployment.
  forge create \
    --root contracts \
    src/FavouritToken.sol:FavouritToken \
    --rpc-url "$RPC_URL" \
    --private-key "$DEPLOYER_PRIVATE_KEY" \
    --broadcast \
    --json \
    --constructor-args "$ADMIN_ADDRESS" "$MINTER_ADDRESS" "$INITIAL_CAP_UNITS"
) | tee "$TMP_OUTPUT"

python3 - "$TMP_OUTPUT" "$OUTPUT_PATH" "$CHAIN_ID" "$ADMIN_ADDRESS" "$MINTER_ADDRESS" "$DEPLOYER_ADDRESS" "$INITIAL_CAP_UNITS" "$INITIAL_CAP_FAV" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

raw_path, out_path, chain_id, admin, minter, deployer, cap, cap_fav = sys.argv[1:]
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
    "initialCapFav": int(cap_fav),
    "initialSupplyFav": 0,
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

printf '\nDeployment complete. Crypto unlock remains disabled until the deployment is verified, recorded in Supabase, and explicitly enabled.\n'
