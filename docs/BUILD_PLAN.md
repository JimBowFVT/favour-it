# Favourit build plan

## Current product direction
Favourit is a talent marketplace where users can offer legitimate skills and purchase services using FAV. The initial product should use an internal FAV ledger rather than a public blockchain.

## Frontend status
The current React prototype includes:
- Home / marketing landing page
- Explore marketplace with search and category filtering
- Deal cards and deal detail view
- Create Deal form with local publishing flow
- Community overview
- Premium overview
- Profile / wallet activity dashboard
- Login / signup presentation flow
- Responsive layouts for tablet and mobile
- FAV balance and escrow purchase simulation

## Next backend milestone
Move FAV balance and all transaction decisions to the server. The client must never be trusted for balances, prices, permissions, escrow release, rewards, or fees.

Recommended first production backend:
- PostgreSQL
- Supabase Auth
- Supabase Storage where appropriate
- Server-side API/business logic
- Append-only FAV ledger
- Wallet + escrow transaction records
- Orders and order status history
- Disputes and moderation actions
- Reviews, favorites, messaging, notifications
- Premium subscriptions
- Daily reward claims
- Audit logs and idempotency keys

## Core transaction lifecycle
1. Buyer creates an order and the server validates price and availability.
2. Buyer funds the order with FAV.
3. Server atomically moves FAV into escrow.
4. Seller delivers through the platform.
5. Buyer accepts, or the order reaches its defined completion state.
6. Server releases escrow minus the configured Favourit fee.
7. A dispute freezes release until moderation resolves it.

## Economy safety
Daily rewards, purchased FAV, earned FAV, fees, redemptions and any external transfer rules must be modeled and stress-tested before launch. Real-money purchase/redemption and external crypto transfers require jurisdiction-specific legal/compliance review.

## Design principles
Keep the existing Favourit visual identity: dark navy background, blue/purple gradients, rounded cards, Poppins typography and the scripted `it` logo treatment. Improve consistency rather than replacing the design wholesale.
