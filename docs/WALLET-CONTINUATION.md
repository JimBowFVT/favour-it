# Wallet, FAV and sidebar continuation

7 September 2026. Base: `2a772ffd2000c05a84fb20e7ed9364cd7ab016d4`.
Branch: `fix/wallet-coins-sidebar-continuation`.

## Implemented

The existing React app has a responsive sidebar and a Wallet destination; the header balance opens the same wallet. Wallet shows server-reported available, held and remaining earned balances, source provenance, protected orders, searchable/filterable activity, transaction detail and transaction-linked support. Unknown amounts are not silently rendered as zero. Six-decimal formatting and fee rounding avoid floating-point loss; the new wallet RPCs carry integer amounts as strings.

Exports retrieve every page of one server-frozen statement, validate counts/cursors/cutoff, prevent spreadsheet formulas in user descriptions, and stop when the signed-in account changes. CSV includes the full matching transaction list; JSON additionally includes server-reconciled opening/closing balances. Unknown balances remain null; filters do not turn whole-wallet balances into filtered balances.

Daily rewards are explicit: read status, optionally record today's visit, then claim the returned offer. There is no reward claim during sign-in or token refresh. The existing legacy claim RPC is revoked for authenticated users on the inspected project. This change does not alter reward schedules, budgets or balances.

Crypto preserves the server's maturity fields and reads account eligibility separately. Mature earnings do not bypass identity/age/consent checks. Connecting is disabled for ineligible accounts. Deployment verification and unlock enablement are independent requirements. Amount/fee math uses exact integer ceilings; ambiguous unlock retries retain the same client request ID while the component remains mounted.

## Server prerequisites (already present on inspected project)

Project: `gswtcihxxvjigfbwzvsv`.

- `20260907112255 wallet_activity_and_saved_checkout`
- `20260907111650 manual_streak_rewards`
- `20260906192310 signup_age_and_crypto_eligibility`
- Existing FAV provenance, maturity, crypto wallet and order APIs.

These live migrations are ahead of main's tracked migration files. This branch consumes them; it does not reconstruct or replay them. Do not run a blanket database push/reset to install this frontend. A fresh database needs reconciled authoritative migration history before it can serve this UI. No production SQL writes, user impersonation, token deployment, wallet transfers or reward claims were performed during this continuation.

Observed chain state: Base Sepolia, no recorded token address/deployment verification, unlock disabled. Displaying the crypto panel does not mean a token is deployed, FAV is redeemable, or a provider account has been created. Provider onboarding, business verification and a reviewed token deployment remain separate tasks.

## Verification

Run `npm ci`, `npm run test:wallet`, and `npm test -- --watchAll=false --runInBand`.
The branch workflow runs pure arithmetic/API regressions, React component regressions, strict lint on the wallet components/helpers, and a preview compilation. It records diagnostics and exact tested source. Its preview build keeps baseline warnings visible and is **not** the strict release gate. The main PR workflow now propagates build errors through its logging pipeline instead of hiding them.

Before release, verify the connected application with two test accounts, keyboard/mobile navigation, order links, CSV/JSON downloads, a failed/retried request and a sign-out while a request is pending. Never use real transfers as a UI smoke test. Component fixtures are not proof of a live end-to-end order/crypto transaction.

## Handoff limits

Codex's uncommitted Windows changes were not accessible; this is a preserved, separate continuation from GitHub main, not a recovered copy of that work. Do not overwrite a dirty local working tree. Original username-onboarding and signup/date-of-birth changes are separate outstanding integration work. The marketing branch/PR #33 is not part of this change. No public site publication or change to main is implied by opening this branch.
