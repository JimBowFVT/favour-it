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
- Crypto unlock is disabled by default until a real deployment is recorded.

## Wallet verification

1. The authenticated user connects an EIP-1193 wallet.
2. Favourit creates a 10-minute one-time challenge tied to the user, address, and Base Sepolia chain id.
3. The wallet signs the human-readable challenge with `personal_sign`.
4. `verify-wallet` recovers the signer from the signature.
5. A service-role-only RPC consumes the challenge and stores the verified wallet.

The application never asks for a seed phrase or private key.

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

Each reference can be processed once. The contract stores `processedMintReferences[reference]` before minting, and the state rolls back if minting fails. This protects against duplicate minting when an off-chain worker retries after a timeout or crash.

## Queue state machine

`pending → processing → broadcast → confirmed`

Failure paths:

- `pending → cancelled`: user cancels; gross FAV is restored.
- `processing → pending`: transient pre-broadcast error; FAV stays reserved.
- `processing/broadcast → failed`: confirmed on-chain failure; gross FAV is restored.

A successful confirmation credits the 2.5% fee to the internal platform account. The net amount is the amount minted on-chain.

## Worker posture

Repository functions are included for processing and reconciliation, but they are intentionally not production-ready credentials-wise until a dedicated minter strategy is chosen.

Required secrets for an automated testnet worker:

- `FAV_BRIDGE_SECRET`
- `FAV_MINTER_PRIVATE_KEY`
- optional `BASE_SEPOLIA_RPC_URL`

Do not use the long-term admin wallet private key as an application secret. For automation, assign `MINTER_ROLE` to a dedicated protected testnet relayer while the user's public wallet can retain admin/cap/pause roles.

## Deployment

`scripts/deploy-fav-base-sepolia.sh` hard-stops unless the RPC reports chain id `84532` and always uses the confirmed `10,000,000 FAV` initial cap.

The GitHub workflow `.github/workflows/deploy-fav-base-sepolia.yml` is manual and uses a protected environment. Its deployer key should be disposable/testnet-only. The deployer does not need to retain token administration after construction.

After deployment:

1. Record contract address and deployment transaction with the protected `record_fav_token_deployment` RPC.
2. Confirm token name, symbol, decimals, max supply, zero initial supply, role holders, and source code.
3. Run a wallet-link test.
4. Seed a controlled test seller earning.
5. Enable crypto unlock only for testnet.
6. Run one small unlock end-to-end.
7. Verify internal provenance + platform fee + on-chain supply reconcile exactly.

## Not in this phase

- Mainnet deployment.
- DEX liquidity or public token sale.
- Fiat redemption promise.
- On-chain marketplace escrow.
- On-chain → internal FAV deposits.
- Automated production custody.
- KYC/AML policy decisions for real-value withdrawals.

Those require separate product, treasury, security, and legal decisions before production activation.
