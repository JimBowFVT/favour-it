# FAV Base Sepolia deployment runbook

This is the operational checklist for the first FAV testnet deployment. It deliberately keeps the long-term admin key out of CI and server infrastructure.

## Locked deployment policy

- Network: Base Sepolia (`84532`)
- Token: Favourit (`FAV`)
- Decimals: `6`
- Initial circulating supply: `0 FAV`
- Initial cap: `10,000,000 FAV`
- Admin / cap manager / pauser: `0xB15bd11EBF03feceE5F92F260def797542E0f570`
- Crypto unlock: disabled after deployment until verification + maturity policy + worker configuration are complete

## One-time testnet deployer setup

Create a **new disposable EVM wallet used only for Base Sepolia**. Do not use the FAV admin wallet for automated deployment or minting.

1. Fund the disposable address with a small amount of Base Sepolia ETH from a reputable testnet faucet.
2. In GitHub, configure the protected environment `fav-base-sepolia`.
3. Add the disposable wallet private key as the environment secret `FAV_TESTNET_DEPLOYER_PRIVATE_KEY`.
4. Optionally add `BASE_SEPOLIA_RPC_URL`. The script can use Base's public Sepolia RPC if this is absent.
5. Never paste the private key into source code, an issue, a pull request, a commit, chat, logs, or Supabase.

The disposable deployer becomes `MINTER_ROLE` for this testnet phase when the workflow's optional `minter_address` input is left blank. The long-term public admin address remains separate.

## Deployment workflow

Run `.github/workflows/deploy-fav-base-sepolia.yml` manually.

- Confirmation must be exactly: `DEPLOY_FAV_BASE_SEPOLIA`
- Leave `minter_address` blank for the first disposable testnet minter, unless a separate funded/testnet relayer has already been prepared.

The workflow:

1. validates the locked policy;
2. installs the pinned OpenZeppelin dependency;
3. runs all Foundry contract tests;
4. deploys only if the RPC chain id is `84532`;
5. verifies name, symbol, decimals, cap, zero supply, admin roles and minter role;
6. uploads a deployment manifest artifact.

A deployment does **not** automatically enable crypto withdrawals.

## After deployment

Before any test unlock:

1. Download and inspect the workflow deployment manifest.
2. Run the repository deployment verifier again against the recorded contract.
3. Record the deployment through the protected Favourit/Supabase verification flow.
4. Confirm the database records:
   - token address,
   - deployment transaction hash,
   - locked admin address,
   - minter address,
   - verification timestamp.
5. Configure a seller-earnings maturity period. This is a business/risk decision and is intentionally not hardcoded.
6. Configure the bridge worker with a protected **minter** key, never the admin key.
7. Keep `unlock_enabled=false` until one controlled seller-earning lot and wallet-link test have been prepared.
8. Run one minimal testnet unlock and reconcile the internal ledger, fee, mint reference, token supply and destination balance.

## Minter rotation

The contract supports rotating `MINTER_ROLE` without changing admin/cap/pause control. The intended progression is:

`disposable testnet deployer → dedicated testnet relayer → protected production relayer`

The old minter must be revoked only after the new minter role is confirmed on-chain. Contract tests cover this rotation and verify that the revoked minter can no longer mint.

## Mainnet stop condition

Do not reuse this workflow or its keys for mainnet. Mainnet requires separate legal, treasury, multisig/timelock, relayer, monitoring, KYC/AML, incident-response and contract-audit decisions.
