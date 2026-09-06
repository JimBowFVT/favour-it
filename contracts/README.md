# FAV on-chain contract

This directory contains Favourit's optional on-chain layer. Marketplace balances, escrow, rewards, and provenance remain in Supabase; only eligible seller earnings can later be unlocked into ERC-20 FAV.

## Confirmed testnet posture

- Network: **Base Sepolia** (`84532`).
- Initial max supply: **10,000,000 FAV**.
- Precision: **6 decimals**, exactly matching `1 FAV = 1,000,000 micro-FAV` in the internal ledger.
- Initial circulating supply: **0 FAV**.
- Locked first-phase admin: **`0xB15bd11EBF03feceE5F92F260def797542E0f570`**.
- First-phase admin model: one externally owned admin wallet; production must migrate to stronger treasury controls before mainnet.
- Crypto unlock remains disabled in the application until a deployment is recorded, verified, a seller-earnings maturity policy is configured, and unlock is deliberately enabled.

## Contract properties

`FavouritToken.sol` is deliberately small:

- ERC-20 name `Favourit`, symbol `FAV`;
- role-gated bridge minting;
- every mint requires a unique 32-byte off-chain reference;
- processed mint references are stored on-chain, making bridge retries idempotent;
- explicit max-supply ceiling with role-gated increases;
- emergency pause controlled by `PAUSER_ROLE`;
- no transfer tax, blacklist, honeypot logic, automatic redemption, or marketplace fee logic.

The unique mint reference is a critical bridge invariant: if a worker crashes after submitting or mining a transaction, replaying the same unlock request cannot create FAV twice.

## Roles

- `DEFAULT_ADMIN_ROLE`: manages contract roles.
- `CAP_MANAGER_ROLE`: can transparently increase the published cap.
- `PAUSER_ROLE`: can pause/unpause transfers and minting in an emergency.
- `MINTER_ROLE`: can call `mintWithReference` for verified unlock requests.

For Base Sepolia the disposable testnet deployer may initially receive `MINTER_ROLE`, while the locked public admin address receives admin/cap/pause roles. Before automated production unlocks, use a dedicated protected minter/relayer rather than storing the admin wallet's private key in an application server.

## Dependency

CI pins OpenZeppelin Contracts v5.7.0 at commit:

`cab19933c33c2ad1d4c7a84864a3601dddfd16f3`

## Tests

From the repository root, after installing Foundry and the pinned OpenZeppelin source under `contracts/lib/openzeppelin-contracts`:

```bash
forge test --root contracts -vv
```

Tests cover 6-decimal precision, the 10,000,000 FAV cap, authorization, duplicate mint-reference protection, cap enforcement, cap increases, and pause behavior.

## Base Sepolia deployment

The committed policy file `contracts/deployments/base-sepolia-config.json` is the source of truth for the network, 10M cap, and public admin address. The deployment script refuses to run on another chain or with an admin address that differs from that policy.

```bash
export FAV_DEPLOYER_PRIVATE_KEY=0xDISPOSABLE_TESTNET_DEPLOYER_KEY
# Optional; blank means the disposable testnet deployer receives MINTER_ROLE.
export FAV_MINTER_ADDRESS=0xYOUR_PUBLIC_MINTER_WALLET

bash scripts/deploy-fav-base-sepolia.sh
```

`FAV_ADMIN_ADDRESS` is not required. If supplied, it must exactly match the locked public admin policy. This prevents an accidental deployment whose privileged roles point at a typo or the wrong wallet.

Do **not** paste a private key into source code, chat, an issue, a PR, or a deployment manifest. The deployer key can be a disposable Base Sepolia-only key. The admin wallet only appears as a public address.

A manual GitHub Actions workflow is also included. It requires the exact confirmation phrase `DEPLOY_FAV_BASE_SEPOLIA`, reads the admin address from the locked policy, and expects the environment secret `FAV_TESTNET_DEPLOYER_PRIVATE_KEY`. `BASE_SEPOLIA_RPC_URL` is optional because the deployment script has the Base Sepolia public RPC as a fallback.

After deployment the bytecode/roles/cap are verified before the manifest is accepted. Deployment recording does **not** automatically enable withdrawals. Unlock stays off until the verified deployment metadata, role addresses, and seller-earnings maturity gate are all satisfied.
