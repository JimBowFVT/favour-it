# FAV Crypto Bridge — Base Sepolia Phase

## Goal

Expose an optional on-chain FAV representation without moving Favourit's marketplace, rewards, orders, or escrow onto the blockchain.

The internal ledger remains the source of truth for marketplace activity. On-chain FAV is created only when a verified user reserves eligible `earned_fav` for a crypto unlock.

## Fixed decisions for this phase

- Chain: Base Sepolia (`84532`).
- Token precision: 6 decimals.
- Initial max supply: 10,000,000 FAV.
- Initial circulating supply: 0 FAV.
- Buyer marketplace fee: 3%.
- Seller marketplace fee: 3%.
- Crypto unlock fee: 2.5%.
- Daily/promo/legacy FAV is not directly crypto-withdrawable.
- Seller proceeds from completed marketplace services become `earned_fav` and are unlock-eligible.
- Crypto unlock is disabled by default until a real deployment is recorded and verified.

## Locked Base Sepolia administration

The confirmed initial testnet admin is the public EVM address:

`0xB15bd11EBF03feceE5F92F260def797542E0f570`

It receives `DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE`, and `CAP_MANAGER_ROLE`. The private key for this address must never be stored in Supabase, GitHub Actions, application environment variables, or source control.

For testnet automation, `MINTER_ROLE` defaults to the disposable Base Sepolia deployer address when no dedicated minter is supplied. This keeps the admin wallet separate from server-side minting. Before mainnet, the admin/cap/pause roles should move to a multisig/timelock and minting should use a separately protected relayer.

The machine-readable policy is committed at `contracts/deployments/base-sepolia-config.json`.

## Wallet verification

1. The authenticated user connects an EIP-1193-compatible wallet provider.
2. Favourit creates a 10-minute one-time challenge tied to the user, address, and Base Sepolia chain id.
3. The wallet signs the human-readable challenge with `personal_sign`.
4. `verify-wallet` recovers the signer from the signature.
5. A service-role-only RPC consumes the challenge and stores the verified wallet.

The application never asks for a seed phrase or private key. The current browser-wallet adapter is testnet plumbing; the same EIP-1193 verification path can be supplied by the future embedded-wallet provider.

## Unlock reservation

`create_crypto_unlock_request` is atomic and idempotent by `client_request_id`:

1. Confirm crypto unlock is enabled and the token address is recorded.
2. Confirm a verified Base Sepolia wallet exists.
3. Calculate the configured unlock fee in integer micro-FAV.
4. Debit the gross amount from `wallets.available_fav`.
5. Debit the same gross amount from `fav_balance_sources.earned_fav` only.
6. Store an immutable destination, token address, gross/fee/net amounts, and a deterministic 32-byte mint reference.
7. Add an accounting ledger entry describing the reservation.

The user can cancel only while the request is still `pending`; cancellation restores both wallet balance and `earned_fav` provenance.

## On-chain idempotency

The token exposes:

`mintWithReference(bytes32 reference, address to, uint256 amount)`

Each reference can be processed once. The contract rejects zero references and zero-value mints, stores `processedMintReferences[reference]` before minting, and the state rolls back if minting fails. This protects against duplicate minting when an off-chain worker retries after a timeout or crash.

## Queue state machine

`pending → processing → broadcast → confirmed`

Failure paths:

- `pending → cancelled`: user cancels; gross FAV is restored.
- `processing → pending`: transient pre-broadcast error; FAV stays reserved.
- `processing/broadcast → failed`: confirmed on-chain failure; gross FAV is restored.

A successful confirmation credits the 2.5% fee to the internal platform account. The net amount is the amount minted on-chain.

## Worker posture

Repository functions are included for processing and reconciliation. They are bound to the verified Base Sepolia deployment stored in `crypto_chain_config` and reject a signer whose public address does not match the recorded minter.

Required secrets for an automated testnet worker:

- `FAV_BRIDGE_SECRET`
- `FAV_MINTER_PRIVATE_KEY`
- optional `BASE_SEPOLIA_RPC_URL`

Do not use the long-term admin wallet private key as an application secret.

## Deployment

`scripts/deploy-fav-base-sepolia.sh` hard-stops unless the RPC reports chain id `84532` and always uses the confirmed `10,000,000 FAV` initial cap. If no minter is explicitly supplied, the disposable deployer becomes the testnet minter; the configured admin remains separate.

The GitHub workflow `.github/workflows/deploy-fav-base-sepolia.yml` is manual and uses a protected environment. Its default admin input is the confirmed public admin address. Its deployer key should be disposable/testnet-only and funded only with Base Sepolia ETH.

After deployment the workflow runs `scripts/verify-fav-base-sepolia.sh`, which checks:

- Base Sepolia chain id.
- token name `Favourit` and symbol `FAV`.
- exactly 6 decimals.
- 10,000,000 FAV maximum initial supply.
- zero initial circulating supply.
- admin, pause and cap-manager roles on the confirmed admin address.
- minter role on the recorded testnet minter.

Only a verified manifest is uploaded as a workflow artifact.

## Supabase deployment gate

The database intentionally keeps `unlock_enabled = false` until all of the following are present:

- recorded token address and deployment transaction,
- the locked admin address,
- the deployed minter address,
- a completed deployment verification timestamp.

`set_fav_crypto_unlock_enabled(true)` rejects activation until those checks are satisfied. This prevents a partially configured deployment from creating user withdrawal requests.

## End-to-end test sequence

1. Deploy the contract on Base Sepolia.
2. Verify the contract with the read-only deployment verifier.
3. Record contract address + deployment transaction in Supabase.
4. Record the deployed admin/minter role addresses.
5. Mark the deployment verified only after the read-only verifier passes.
6. Confirm token name, symbol, decimals, max supply, zero initial supply and roles independently.
7. Run a wallet-link test.
8. Seed a controlled test seller earning.
9. Enable crypto unlock only for testnet.
10. Run one small unlock end-to-end.
11. Wait for the configured confirmation count.
12. Verify internal provenance + platform fee + on-chain supply reconcile exactly.

## Not in this phase

- Mainnet deployment.
- DEX liquidity or public token sale.
- Fiat redemption promise.
- On-chain marketplace escrow.
- On-chain → internal FAV deposits.
- Automated production custody.
- Final KYC/AML policy or production embedded-wallet vendor.

Those require separate product, treasury, security, and legal decisions before production activation.
