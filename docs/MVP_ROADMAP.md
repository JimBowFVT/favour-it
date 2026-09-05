# Favourit MVP Roadmap

## Product model

Favourit is a skills marketplace where **Deals are the product** and FAV is the in-platform purchasing currency.

A Deal lifecycle is:

`Create → Publish → Discover → View → Buy → Escrow → Work → Delivery → Accept → Complete → Review`

Orders are part of the Marketplace/Deals system, not a separate product area.

## Current product areas

### Foundation
- Auth and session bootstrap
- Profiles and usernames
- Account settings
- Public profiles
- Blocked accounts
- Block/unblock without deleting existing DM history
- User reporting

### Marketplace / Deals
- Published deals
- Search
- Category filtering
- Sorting
- Favorites
- Deal details
- Deal creation
- FAV-priced purchasing
- Escrow-backed order flow
- Seller start/delivery controls
- Completion/release
- Dispute/refund path
- Reviews
- Order notifications

### FAV Wallet & Economy
- Wallet
- Ledger-based accounting
- Value-based daily reward
- Premium reward multiplier foundation
- Transaction fees
- Internal closed-loop economy posture

### Messages
- Conversations
- Realtime messaging with polling fallback
- Unread/read state
- Typing indicator with 5-second TTL
- Profile navigation from DM identity
- Block enforcement for new direct messages while preserving history

### Community
- People discovery
- Friend requests
- Friends
- Direct-message entry point
- Public skill groups
- Group membership
- Member-only group chat
- Group message reporting
- Moderator message removal
- Group moderators
- Admin moderator assignment

### Admin / Moderation
- Middleman role
- Order mediation
- Dispute resolution
- Community moderation foundations
- Audit logging foundations

## Current priority order

1. **Stability audit** — compile/runtime errors, Supabase errors, race conditions, broken states.
2. **Marketplace completion** — verify the complete Deal lifecycle from buyer funding through seller payout and review.
3. **Community hardening** — friend management, group moderation UX, notifications, mobile behavior, and edge cases.
4. **Messages hardening** — verify realtime/polling fallback, typing TTL, read state, blocking, and profile navigation.
5. **Wallet/economy verification** — double-spend protection, idempotency, reward farming resistance, accounting invariants.
6. **Premium completion** — purchase flow, active membership, benefits, expiration, and reward multiplier.
7. **Admin completeness** — users, reports, disputes, community moderation, suspicious activity, and audit tools.
8. **Security pass** — RLS/RPC permissions, rate limits, authorization, validation, abuse prevention, and upload safety.
9. **UX/mobile polish** — responsive layouts, custom dialogs, loading/empty/error states, accessibility, and performance.
10. **Closed beta readiness** — analytics, support flows, policies, legal review, test accounts, and launch checklist.

## Community backlog

These are intentionally deferred until the current Community foundation is stable:

- Better friend management (remove friend, request cancellation UX, relationship states)
- Community notifications and notification center integration
- Group member moderation UI
- Group moderator tools and moderation history
- Better report dialogs instead of browser prompts
- Group search/discovery improvements
- Community profile cards with skills/deals context
- Mobile group chat polish
- Abuse/rate-limit feedback in the UI
- Optional future group categories and user-created communities

## Definition of MVP done

A new user can:

1. Create an account and establish a profile.
2. Receive the appropriate FAV daily reward.
3. Discover a Deal.
4. Purchase it using FAV.
5. Have the FAV secured in escrow.
6. Communicate with the seller.
7. See the seller deliver the work.
8. Accept the delivery or enter a dispute.
9. Complete the Deal and release the seller's FAV.
10. Leave a review.
11. Spend earned FAV on another member's Deal.

At the same time, moderators/admins must be able to handle reports, disputes, abuse, and accounting-sensitive actions without direct database manipulation.
