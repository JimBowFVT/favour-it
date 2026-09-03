# Favourit Product Status

## Current
- React frontend prototype with Favourit visual language.
- Home, Explore, Deal Detail, Create Deal, Community, Premium, Profile and Auth views.
- Local mock FAV balance and mock order/creation flows.
- Seed marketplace data in `src/data/deals.js`.
- Responsive styling for tablet/mobile.

## Backend foundation
- PostgreSQL/Supabase schema added in `supabase/schema.sql`.
- Core entities: profiles, wallets, deals, orders and immutable ledger entries.
- RLS policies establish the initial access boundary.
- Balance-changing operations are intentionally server-side only.

## Next implementation order
1. Supabase project + environment variables.
2. Auth and profile creation.
3. Server-side wallet/ledger functions.
4. Daily FAV reward with anti-abuse rules.
5. Real deal creation/search.
6. Order creation + escrow state machine.
7. Messaging and dispute workflow.
8. Reviews/favorites/community.
9. Premium/subscriptions.
10. Admin/moderation + audit logs.
11. Automated tests, security review and production deployment.

## Product decisions still requiring founder input
- Final FAV monetary/redemption model and whether FAV can leave Favourit.
- Exact Premium price and daily reward amount.
- Initial marketplace transaction fee.
- Launch geography and legal entity/jurisdiction.
