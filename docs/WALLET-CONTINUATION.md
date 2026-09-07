# Wallet and FAV implementation handoff

Updated 7 September 2026. PR #34, branch `fix/wallet-coins-sidebar-continuation`.
Original source base: `2a772ffd2000c05a84fb20e7ed9364cd7ab016d4`.

## Completed application work

The existing React application contains the responsive sidebar and Wallet destination. The header balance and `#wallet` open the same workspace. Wallet displays server-reported available, escrow-held and remaining earned balances, provenance sources, protected-order links, filtered/paginated activity, transaction detail and transaction-linked support. Opening Wallet is not a balance mutation. Unknown or imprecise amounts fail visibly rather than becoming a fictitious zero.

Micro-FAV formatting and fee ceilings use exact integer arithmetic. Wallet overview amounts stay integer strings from the server through the sidebar. Crypto breakdown rejects unsafe JSON numbers rather than silently rounding them. Historical orders prefer the original title/category snapshot over edited listing data.

CSV and JSON exports retrieve every page of one frozen server statement with cutoff, cursor, duplicate and row-count checks. CSV neutralizes formulas in descriptive text while preserving signed numeric amount columns. JSON additionally contains server-reconciled opening/closing balances; unknown balances remain null. Those are whole-wallet balances, not balances of a filtered subset.

Account-bound requests capture the initiating JWT, check the active account before/after response, and support timeout/cancellation. Account switches clear previous-account data. Request timeouts are not treated as proof that a mutation failed. The browser does not grant financial permissions; existing RLS and transactional RPCs remain authoritative.

## Rewards and setup

Rewards are manual: read status, optionally record today's visit, explicitly claim the server-issued offer, then refresh only after a server receipt. No claim occurs during login, token refresh, mounting or the UTC-day reset. Status is refreshed at the server's next reset without interrupting an in-progress claim.

Signup collects the date of birth required by the deployed signup trigger. Existing accounts can record a missing date once from Wallet. The client mirrors the deployed minimum account age of 13; the database validates it. A self-declared date does not verify identity or enable crypto. No government ID is requested for ordinary wallet/reward setup.

The username gate now respects `username_chosen` from the server. A generated username or browser cache cannot dismiss setup. The gate rechecks persisted status after a successful claim, remains open on error, and works after refresh. Changes in the user's inaccessible Windows/Codex working tree were not recovered or overwritten; this implementation fixes the verified repository defects independently.

## Optional coin/testnet path

The crypto panel separately checks server-verified adult/identity eligibility, explicit versioned consent, known matured earnings, the maturity policy, Base Sepolia deployment verification, an active linked wallet and unlock enablement. The initial cap is labelled a cap, not circulating supply or cash value. Consent alone cannot establish verified identity.

Before submitting an unlock, the client durably saves one per-account request ID, amount and destination. Ambiguous failures preserve it across component unmounts and page refreshes. Returning to Wallet queries that exact ID; a recorded request is acknowledged without resubmission. An unresolved request freezes new requests, and an explicit retry uses the same ID. Corrupt/unavailable storage fails closed. The server's existing idempotency and accounting rules remain unchanged.

This does not provide cross-device or simultaneous-multi-tab exactly-once intent coordination. Independent tabs/devices may create distinct intentional request IDs. Server transactions enforce actual balance availability. Do not claim that a local outbox replaces server idempotency or reconciliation.

## Verification evidence

Local verification after the completion changes:

- **70 JavaScript tests pass:** 51 React/Jest tests in eight suites and 19 exact-amount/API/outbox regression tests. No skipped cases.
- Strict lint passes on the changed application files and wallet helpers, without disabling rules. The legacy unused `DirectMessaging.js` is not part of that lint target.
- The production build passes with `CI=true`. Baseline hook/unused-variable build failures were fixed in the affected components; release checks were not weakened.
- Chromium ran **12 grouped fixture scenarios**, including exact balance, no automatic claim, explicit offer/claim, pagination, detail focus, support, complete CSV/JSON downloads, failure/retry, locked crypto, mobile navigation/Escape, no mobile overflow and account switching. No JavaScript errors were recorded. Screenshots carry a fixture-data label.
- Read-only Supabase checks passed: anonymous wallet APIs are denied, a synthetic nonexistent account cannot read another user's transactions, expected-account guards reject statements/support for a different account, the legacy reward RPC is revoked, and disabled unlocks reject requests. See `scripts/qa/wallet-readonly-regression.sql`.
- Live aggregate inspection: eight wallets, zero negative balances, zero source-sum mismatches, zero earned-lot excess and zero unlock requests. Private compliance, reward-offer and statement tables have RLS and no direct anon/member SELECT grant.

The browser test renders the actual local production bundle using `set_content`, with in-memory backend, Storage and BroadcastChannel fixtures. It is **not a deployed-site test, real authentication, a real reward claim or a live blockchain transfer**. Live SQL authorization tests are separate from browser fixture tests. The PR records the final GitHub CI result and tested commit.

## Reproduce

```sh
npm ci
npm run test:wallet
CI=true npm test -- --watchAll=false --runInBand
CI=true npm run build
```

For the optional browser fixture test, install Python Playwright and provide a Chromium executable. Build only this isolated test copy with dummy configuration:

```sh
CI=true REACT_APP_SUPABASE_URL=https://wallet-preview.supabase.co REACT_APP_SUPABASE_ANON_KEY=fixture-browser-safe-key npm run build
CHROMIUM_PATH=/usr/bin/chromium WALLET_QA_OUTPUT=qa-output/browser python scripts/qa/wallet_browser_smoke.py
```

Never deploy that fixture-configured build as the live app. A normal app build needs the actual project's browser-safe publishable/anon key. Never use a service-role key in React variables.

## Backend prerequisites and remaining activation gates

Project: `gswtcihxxvjigfbwzvsv`. The inspected project already has:

- `20260907112255 wallet_activity_and_saved_checkout`
- `20260907111650 manual_streak_rewards`
- `20260906192310 signup_age_and_crypto_eligibility`
- Existing ledger, provenance, maturity, escrow and crypto APIs.

The hosted migration history is ahead of the repository checkout. **Do not run a blanket database push/reset.** This frontend consumes existing contracts and does not replay or reconstruct missing historical migrations. A fresh database needs authoritative migration reconciliation first.

At the final server inspection, Base Sepolia had no recorded token/minter/deployment verification and `unlock_enabled=false`. Wallet verification and worker Edge Functions exist, but no identity-provider onboarding function was present. No production SQL writes, actual account impersonation, real reward claims, token deployment or transfers were performed.

**Token activation is not complete.** It still requires the owner's provider accounts/configuration (including the intended embedded-wallet setup), reviewed identity-provider integration and signed callbacks, a disposable funded testnet deployer/minter under the locked deployment policy, independent deployment verification and an explicit activation decision. The long-term admin private key must never be stored in GitHub or Supabase. Do not advertise fiat redemption, guaranteed token sales or mainnet support.

This PR is not an automatic merge, public site publication or update to the user's Windows checkout. Preserve dirty local work when trying the branch. The founding-creators marketing PR #33 remains separate.
