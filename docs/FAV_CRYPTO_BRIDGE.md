# FAV Crypto Bridge — Base Sepolia Phase

## Goal

Expose an optional on-chain FAV representation without moving Favourit's marketplace, rewards, orders, or escrow onto the blockchain.

The internal ledger remains the source of truth for marketplace activity. On-chain FAV is created only when a verified user reserves eligible seller earnings for a crypto unlock.

## Fixed decisions for this phase

- Chain: Base Sepolia (`84532`).
- Token precision: 6 decimals.
- Initial max supply: 10,000,000 FAV.
- Initial circulating supply: 0 FAV.
- Buyer marketplace fee: 3%.
- Seller marketplace fee: 3%.
- Crypto unlock fee: 2.5%.
- Seller-earnings crypto maturity: **5 days (120 hours)** after completion.
- Daily/promo/purchased/legacy FAV is not directly crypto-withdrawable.
- Seller proceeds from completed marketplace services become `earned_fav` and are the only source that may mature into crypto-eligible FAV.
- Crypto unlock is disabled by default until a real deployment is recorded and independently verified.

## Locked Base Sepolia administration

The confirmed initial testnet admin is the public EVM address:

`0xB15bd11EBF03feceE5F92F260def797542E0f570`

It receives `DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE`, and `CAP_MANAGER_ROLE`. The private key for this address must never be stored in Supabase, GitHub Actions, application environment variables, or source control.

The locked disposable Base Sepolia deployer/minter for this phase is:

`0xF58C2b4d86BeFE571b62B0cCbC6f947B48BC7b41`

Its private key is stored only as the protected `fav-base-sepolia` GitHub environment secret `FAV_TESTNET_DEPLOYER_PRIVATE_KEY`. The deployment workflow derives the public address from that secret and aborts if it does not exactly match the locked address above. The deployer must remain distinct from the long-term admin.

For testnet automation, `MINTER_ROLE` defaults to this disposable Base Sepolia deployer address when no dedicated minter is supplied. Before mainnet, the admin/cap/pause roles should move to a multisig/timelock and minting should use a separately protected relayer.

The machine-readable policy is committed at `contracts/deployments/base-sepolia-config.json`. The deploy script reads this policy directly and rejects an unexpected admin or deployer identity.

## Wallet verification

1. The authenticated user connects an EIP-1193-compatible wallet provider.
2. Favourit creates a 10-minute one-time challenge tied to the user, address, and Base Sepolia chain id.
3. The wallet signs the human-readable challenge with `personal_sign`.
4. `verify-wallet` recovers the signer from the signature.
5. A service-role-only RPC consumes the challenge and stores the verified wallet.

The application never asks for a seed phrase or private key. The current browser-wallet adapter is testnet plumbing; the same EIP-1193 verification path can be supplied by the future embedded-wallet provider.

## Seller earnings maturity and provenance lots

Every completed seller payout creates a `fav_earned_lots` row. The lot records the original amount, remaining amount, order origin, earning timestamp, and the timestamp at which that specific earning becomes crypto eligible.

The locked testnet maturity period is **5 days (120 hours)**. A seller can use completed-service earnings inside Favourit immediately, but those earnings cannot be reserved for an on-chain crypto unlock until the lot's `crypto_eligible_at` timestamp is reached. The maturity duration is captured when each seller payout lot is created, so changing policy later does not retroactively shorten an existing lot.

Exact lot accounting prevents two important bypasses:

- spending matured earnings internally also consumes the corresponding mature lots, so a later sale cannot reuse stale maturity;
- refunds restore the exact consumed lot provenance where possible instead of turning refunded value into immediately withdrawable crypto eligibility.

Legacy pre-lot seller earnings are preserved as spendable internal FAV but remain non-matured until an explicit future policy handles them.

## Unlock reservation

`create_crypto_unlock_request` is atomic and idempotent by `client_request_id`:

1. Confirm crypto unlock is enabled and the token deployment is verified.
2. Confirm the configured maturity policy exists.
3. Confirm a verified Base Sepolia wallet exists.
4. Confirm enough **matured seller-earning lots** exist.
5. Calculate the configured unlock fee in integer micro-FAV.
6. Debit the gross amount from `wallets.available_fav` and `fav_balance_sources.earned_fav`.
7. Reserve the exact matured lots FIFO in `crypto_unlock_earned_lots`.
8. Store an immutable destination, token address, gross/fee/net amounts, and a deterministic 32-byte mint reference.
9. Add an accounting ledger entry describing the reservation.

The user can cancel only while the request is still `pending`; cancellation restores wallet balance, `earned_fav`, and the exact reserved lots.

## On-chain idempotency

The token exposes:

`mintWithReference(bytes32 reference, address to, uint256 amount)`

Each reference can be processed once. The contract rejects zero references and zero-value mints, stores `processedMintReferences[reference]` before minting, and the state rolls back if minting fails. This protects against duplicate minting when an off-chain worker retries after a timeout or crash.

## Queue state machine

`pending → processing → broadcast → confirmed`

Failure paths:

- `pending → cancelled`: user cancels; gross FAV and maturity lots are restored.
- `processing → pending`: transient pre-broadcast error; FAV stays reserved.
- `processing/broadcast → failed`: confirmed on-chain failure; gross FAV and maturity lots are restored.

A successful confirmation credits the 2.5% fee to the internal platform account. The net amount is the amount minted on-chain.

## Worker posture

Repository functions are included for processing and reconciliation. They are bound to the verified Base Sepolia deployment stored in `crypto_chain_config` and reject a signer whose public address does not match the recorded minter.

Required secrets for an automated testnet worker:

- `FAV_BRIDGE_SECRET`
- `FAV_MINTER_PRIVATE_KEY`
- optional `BASE_SEPOLIA_RPC_URL`

Do not use the long-term admin wallet private key as an application secret.

## Deployment

`scripts/deploy-fav-base-sepolia.sh` hard-stops unless the RPC reports chain id `84532`. The 10,000,000 FAV cap, confirmed admin address, confirmed disposable deployer address and 120-hour maturity policy are read from committed policy. The deployer private key must resolve exactly to the locked disposable testnet deployer, and the deployer must have Base Sepolia ETH for gas.

The GitHub workflow `.github/workflows/deploy-fav-base-sepolia.yml` is manual and uses the protected `fav-base-sepolia` environment. It requires the explicit phrase `DEPLOY_FAV_BASE_SEPOLIA`; there is no editable admin-address or deployer-address input. If no dedicated minter is supplied, the locked disposable deployer becomes the testnet minter.

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
- a completed deployment verification timestamp,
- the configured 5-day seller-earnings maturity policy.

`set_fav_crypto_unlock_enabled(true)` rejects activation until those checks are satisfied. This prevents a partially configured deployment from creating user withdrawal requests.

The live database also keeps a service-only `fav_crypto_config_audit_log` for chain configuration changes and for changes to marketplace fees, unlock fee, or maturity policy. This gives the financial configuration an operational audit trail without exposing it to normal clients.

## End-to-end test sequence

1. Fund the locked disposable deployer with Base Sepolia test ETH.
2. Run the manual deployment workflow and let preflight verify the deployer secret, chain id and gas balance.
3. Deploy the contract on Base Sepolia.
4. Verify the contract with the read-only deployment verifier.
5. Record contract address + deployment transaction in Supabase.
6. Record the deployed admin/minter role addresses.
7. Mark the deployment verified only after the read-only verifier passes.
8. Confirm token name, symbol, decimals, max supply, zero initial supply and roles independently.
9. Confirm the 5-day seller-earnings maturity policy is live.
10. Run a wallet-link test.
11. Seed a controlled test seller earning and corresponding maturity lot.
12. Enable crypto unlock only for testnet.
13. Run one small unlock end-to-end.
14. Wait for the configured confirmation count.
15. Verify internal provenance + platform fee + on-chain supply reconcile exactly.

## Not in this phase

- Mainnet deployment.
- DEX liquidity or public token sale.
- Fiat redemption promise.
- On-chain marketplace escrow.
- On-chain → internal FAV deposits.
- Automated production custody.
- Final KYC/AML policy or production embedded-wallet vendor.

Those require separate product, treasury, security, and legal decisions before production activation.
