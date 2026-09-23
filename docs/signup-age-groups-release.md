# Signup, age policy and messaging stability

The registration form now sends the date of birth required by `signUp`. Accounts
under 13 are rejected in both the form and the database auth-user insert trigger.
Birth dates are captured once in a private table; later edits to user metadata do
not change crypto authorization. Dates use UTC calendar boundaries.

Members aged 13–17 can continue to use marketplace credits. Database triggers
block wallet-link challenges, active crypto wallets and unlock requests below 18,
including direct API writes and service-role processing. Rejected transactions
roll back preceding balance deductions. Cancellation, failed-request cleanup and
wallet disconnect remain available. These are additional guards; existing identity,
consent, balance provenance and maturity requirements remain unchanged.

Existing accounts without a recorded birth date remain crypto-ineligible. Do not
backfill their date from mutable user metadata. A trusted support workflow must
review the date and record it in `private.account_birth_dates`. No public profile
endpoint returns the date. This implements age declaration and enforcement, not
independent identity/age verification. The application has no separate crypto
buy/sell exchange endpoint in this checkout; these guards cover its available
wallet-link and conversion paths, not transfers on external exchanges.

Username onboarding stays open once required, until explicit server-confirmed
completion. Late hydration responses cannot overwrite a completed claim. The
migration resets only untouched UUID-generated handles incorrectly marked chosen
by the old migration, preserving explicitly selected handles.

Groups and message-request observers now update DOM attributes/text only when
needed, avoiding self-triggering loops. Group state resets once when the inbox
closes and is isolated when the signed-in account changes. Group-creation load
errors are visible in the group list.

## Validation

- `npm test -- --watchAll=false --runInBand --testMatch '**/*.test.js'`
- `node --test tests/age-policy.test.cjs tests/wallet-core.test.cjs tests/ui-restoration.test.cjs`
- `CI=true npm run build` (PowerShell: `$env:CI='true'; npm run build`)

Database tests execute the actual migration and Postgres triggers in PGlite with
a minimal Supabase schema fixture. They cover signup boundaries, under-18 rejection,
transaction rollback, birthday eligibility, mutable metadata, private-table access,
processing rechecks, cleanup and generated-handle repair. They do not replace
integration tests against the complete deployed database.

## Release requirements

The connected Supabase project was reported INACTIVE and its read-only schema
query timed out. No live database migration, account mutation or website deployment
was performed. The active website URL was not supplied during implementation.

Before release, identify the active Supabase project and compare its schema with
this repository, including any untracked eligibility/identity migrations. Apply
`20260923150303_signup_age_and_crypto_guards.sql` and deploy the matching frontend
together: the old form omits birth dates and will be rejected by the new trigger.
Run security advisors and staging integration tests for registration, username
claim/reload, Groups switching, credit purchases/sales and crypto requests using
13-, 17- and 18-year-old fixture accounts. Keep crypto disabled until the server
migration is installed. Recheck queued legacy requests with missing dates before
resuming processing; operators can cancel/refund through existing workflows.

An exhaustive live-site audit remains pending access to the active site/backend.
