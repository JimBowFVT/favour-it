# Release and measurement

Owner: Adam Levi · 7 September 2026

## What is implemented

- A responsive English landing page at `/founding-creators`, using the existing React application. Ordinary application routes retain their existing behavior.
- A dedicated marketing build mode, `REACT_APP_MARKETING_SITE_ONLY=true`, for an owner-only Sites preview. This mode shows the landing page at the site's root. It does not expose the admin application.
- Offer-and-need intake with explicit pilot, contact and adult-participation consent; the weekly digest is a separate optional choice. Intake defaults to closed and fails closed when configuration is unavailable.
- A private application inbox inside the existing `/adminpanel`: status, notes, consent-aware CSV export and the intake open/close control. An invitation status does not create a marketplace account, grant FAV or admit someone automatically.
- Interview, outreach, content and operating documents; a separate private working workbook; and a reviewed-data metrics tool.

The service examples and hero artwork are labelled illustrations. There are no testimonials or invented members. No messages, posts, interviews, purchases, FAV allocations or scheduled automations have been performed by this kit.

## Validation at implementation

The React suite passes all 32 tests, including the application receipt/error states and consent-aware admin exports. The measurement suite passes ten tests for cohort windows, exclusions and exact FAV arithmetic. The database regression passed inside a rollback transaction; a follow-up query confirmed no marketing schema or RPC remained after rollback. The workbook's formulas and all seven sheet layouts were checked with blank real-world results.

The existing application's strict production build (`CI=true`) reports pre-existing hook dependency and unused-variable warnings in AccountSettings, AdminPanel, DirectMessagingV2, MiddlemanPanel, PrivateGroupBridge, PublicProfile and UsernameSection. Those are outside this marketing release. The undefined `globalThis` lint error was fixed with a declaration only; crypto behavior is unchanged. Inspection of the GitHub job log confirmed the failure was previously hidden by the logging pipeline. The build step now explicitly uses Bash with pipeline failure propagation so a failed compilation cannot become a green check. Do not merge or permanently apply the marketing migration until that required check passes. A private marketing preview can be reviewed while these release issues remain.

## Product work still required before real trading

This release adds the marketing entry point and intake. It does not certify the existing marketplace order lifecycle. Verify checkout totals, delivery, revisions, approval, disputes/refunds, support ownership and feasible FAV balances with the actual deployed application before asking outsiders to contribute work.

Public previews of real member services and profiles, offer-and-need account onboarding, structured package fields and the first-session product journey remain product work. The landing page currently uses clearly labelled examples; it does not expose private profiles or listings. Use the intake and manual matching workflow to collect needs until those product features are verified.

## Environment and build

Use Node 20 for the repository's existing CI. Install from the updated lockfile with `npm ci`. The Supabase client is pinned to the existing declared minimum, 2.57.4; application framework versions are unchanged.

Copy `.env.marketing.example` to a local ignored environment file. Set the existing project's URL and browser-safe anon/publishable key. Never put a service-role or secret key in a React environment variable. CRA embeds `REACT_APP_*` values in the browser bundle.

Run:

```text
npm ci
npm test -- --watchAll=false --runInBand
npm run test:marketing
npm run build
```

Normal builds keep the existing app at `/` and the landing page at `/founding-creators`. Set `REACT_APP_MARKETING_SITE_ONLY=true` only for the separate marketing preview build. Keep this flag unset in the marketplace deployment.

## Database rollout

The new migration is `supabase/migrations/20260907110950_founding_creators_intake.sql`. It is additive: a private schema, intake/configuration tables and narrow RPCs. It does not change orders, profiles, wallets, rewards or token contracts.

The hosted database contains migrations newer than the source checkout. Do not run an indiscriminate database push, reset, or replay of older migrations. Reconcile migration history and apply only this reviewed additive migration through the established release process. The migration filename came from the Supabase CLI; its Windows file-write operation failed, so the generated file was created locally with that exact name.

Before release, combine the migration and `marketing/tools/intake-regression.sql` inside one explicit `BEGIN` / `ROLLBACK` test transaction on the intended project. The regression uses temporary session claims and fixtures. Confirm the rollback removed the test schema if it did not exist before the test. Never run the fixture file against stored applications outside a rollback transaction.

After the migration is released, verify:

1. `get_founding_programme()` returns `applications_open: false` and Adam's public contact information.
2. Anonymous users cannot read either private table or call admin operations.
3. A regular authenticated member cannot list or change applications.
4. The established Favourit administrator can use the inbox. Existing admin authorization is reused.
5. Intake rejects missing consent and unsafe portfolio links. Duplicate emails cannot overwrite stored submissions.

The intake has a honeypot, bounded fields and a global cap of 100 new records per rolling 24 hours, protected against concurrent overshoot. This is suitable for a small supported pilot; it is not per-person rate limiting or verified email ownership. Review abuse controls before broad public promotion. Check Supabase security advisors after rollout and distinguish existing findings from this migration's objects.

## Opening collection and publishing

The Sites preview is owner-only. Do not put its restricted URL into recruitment messages. A public release needs an accessible landing URL, an appropriate privacy/support process and a clear audience. No custom domain has been purchased.

Keep applications closed while the 20 interviews and five-person page tests are underway. Once the research gate passes, confirm the wording, monitored contact inbox, application handling and product readiness. The existing admin panel includes a separate acknowledgement before collection can be opened. Opening collection does not open service trading or promise acceptance.

If the preview is served in marketing-only mode, manage applications from the ordinary Favourit application running this branch, not from the preview's root. The private preview deliberately routes every page to the landing page.

When the public page is available, replace `[PUBLIC LANDING URL]` in drafts. Use campaign metadata such as `?utm_source=linkedin&utm_medium=organic&utm_campaign=founding_creators`; use readable source labels and never put personal details in these parameters. Obtain explicit approval for each selected outbound message or publication before an assistant sends it. Adam can send the reviewed drafts himself.

## Measurement contract

Use `marketing/templates/metrics-input.json` as the structure. Its `unverified-template` label deliberately prevents accidental reporting. Store real inputs and outputs in ignored `marketing/private/` or `marketing/exports/` directories, outside shared source and Sites archives.

`marketing/tools/order-export.sql` is a read-only starting query against the inspected `public.orders` columns. It returns no records until reviewed cohort UUIDs replace its empty list. Its `serverVerified: false` and unknown test/reversal flags require review; do not treat raw exports as verified reports.

For one cohort and one UTC `asOf` cutoff, prepare:

- `members`: unique ID, actual accepted-at timestamp and acquisition source, excluding staff/test accounts. Do not use application date as member acceptance.
- `orders`: unique ID, buyer/seller IDs, creation and completion timestamps, server status, service amount as an integer **micro-FAV string**, and explicit boolean `serverVerified`, `isTest`, `reversed` flags. Cross-check cancellation, dispute and ledger reversal records; set `serverVerified: true`, `isTest: false`, `reversed: false` only after review.
- `needs`: unique ID, member ID, submission time and mutually accepted match time, if any. An introduction alone is not an accepted match.
- `assistance`: timestamp, minutes and related order ID. Track onboarding time separately in operations; the calculated per-order figure includes only logged help linked to counted orders.
- `source: "verified-server-export"` only after that reconciliation. All timestamps require a timezone. Use an integer string for FAV amounts to preserve exactness.

Then run:

```text
node marketing/tools/metrics.cjs marketing/private/reviewed-input.json marketing/exports/weekly-metrics.json
```

The tool calculates activation and repeat rates only for fully observed 30-day windows, and match rate only for fully observed seven-day windows. It excludes incomplete, test, reversed and unverified activity. Both order participants must appear in the reviewed member set and the order must be created after both acceptance times; document this cohort boundary when comparing reports. Zero eligible denominators produce `null`, not a claimed zero-percent result.

Earn-then-spend means a sale completed before a later purchase was created and completed. This is a participation measure, not proof that earned funds rather than promotional balances paid for that purchase. `earnedSpendProvenance` is left null until a separately reconciled ledger report supports it. Do not label the journey count as audited FAV circulation. FAV volume is denominated in FAV and is not cash revenue.

Copy the reviewed numerators, denominators and support totals to the workbook's Weekly results sheet. Its dates are planning dates; no activity is automatically imported. Keep complaint/dispute reasons and departure evidence in the weekly review. Publish only accurate, permissioned case studies.

## Expansion gates

- Research: 20 completed interviews and eight specific informed offers/needs; at least four of five target users pass each page test.
- First cohort: up to 30 members; target 12 transacting members, five earn-then-spend participants and three permissioned case studies.
- Broader promotion: two cohorts reach at least 30% repeat participation with a full 30-day observation window, and manual support time declines.

These are internal experiment thresholds. They do not prove product-market fit and calendar dates do not override readiness.
