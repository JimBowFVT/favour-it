# UI rollback — supersedes the wallet/sidebar completion handoff

7 September 2026. PR #34 remains a draft, not a release approval.

## Owner's correction

The requested sidebar belongs only to Explore. The global navbar must remain the original navbar. The owner explicitly withdrew the assistant's UI changes from the two wallet implementation rounds.

## Restored presentation

`src/App.js`, `src/components/AuthGate.js`, and `src/components/CryptoWalletPanel.js` are restored byte-for-byte from the pre-redesign repository snapshot `2a772ffd2000c05a84fb20e7ed9364cd7ab016d4`.

The six original top-nav destinations are Home, Explore, Orders, My Deals, Community and Upgrade. The added global sidebar, its collapsed/mobile drawer, the Wallet destination, header-wallet shortcut and `#wallet` special route are removed. The added WalletPage, DailyRewardCard and WalletAccountSetup screens and their new styles are deleted, not merely hidden. The added crypto consent/recovery/refresh widgets and signup birth-date field are withdrawn with those UI changes.

ExploreDealsPage and every original stylesheet are byte-identical to that snapshot. The prior detailed conversation design was not recovered, so no replacement Explore sidebar is invented. Any original design edits still local to Codex/Windows remain untouched and are not claimed as recovered.

## Retained non-visual work

Exact amount/fee helpers, account-bound request checks, server-status username confirmation, no automatic reward claim, immutable order snapshots, dependency-lock repair and non-visual compile fixes are retained. Original crypto-panel call signatures are supported by service adapters. Identity/age eligibility is checked before mutation, and ambiguous amount-only unlock retries preserve the same durable per-account request ID. A different amount cannot replace an unresolved request. Recorded requests are reconciled without resubmitting.

The existing username screen and existing loader are reused instead of the newly invented account-status page. No new layout or controls replace the removed designs.

## Deliberate limits after the requested UI rollback

The new standalone wallet, rewards, consent, recovery and date-of-birth setup screens are no longer available. Their service helpers do not constitute an approved UI. In particular, the original signup form does not collect the birth date required by the already-deployed server contract; the retained client/server age validation refuses a missing date. Do not manufacture a date or relax the server validation to make this restored form submit. Signup/account-completion integration must be reconciled with the owner's original design before release. Existing-user login and the original navigation markup remain available. Browser review also found a pre-existing source mismatch: the restored header uses `topbar`/`brand-button` while the original CSS styles `nav`/`logo-button`. This rollback deliberately does not invent replacement navbar styling or claim to reproduce an uncommitted local design. Reconcile that source mismatch with the owner-approved original before release.

No Supabase schema, balances, rewards, grants, token configuration or external accounts are modified by this UI rollback. Main is not merged or overwritten, and no local Windows files or public deployment are updated.

## Verification

`tests/ui-restoration-baseline.json` records the original SHA-256 fingerprints for the three restored presentation files, ExploreDealsPage and all original CSS: 42 files in total. `tests/ui-restoration.test.cjs` also rejects the removed global-sidebar/new-wallet references and components.

Run:

```sh
npm ci
npm run test:wallet
node --test tests/ui-restoration.test.cjs
CI=true npm test -- --watchAll=false --runInBand
CI=true npm run build
```

The previous completion screenshots, browser script and UI-specific passing-test counts refer to the withdrawn design and are not evidence for this revision. The PR records the new checks and commit.
