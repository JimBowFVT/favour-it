# Favourit Backend API Contract

This document defines the first server contract for replacing the current React mock state with real server-controlled data.

## Principles

- The browser is never trusted for FAV balances.
- Every balance-changing operation is atomic and idempotent.
- Orders hold value in escrow before seller payout.
- Authorization is checked server-side for every protected resource.
- Ledger entries are append-only and auditable.

## Authentication

The first implementation should use Supabase Auth.

Protected endpoints require an authenticated user session.

## Wallet

### GET /api/wallet
Returns:

```json
{
  "balance": 850,
  "currency": "FAV",
  "pending": 0,
  "lifetimeEarned": 0,
  "lifetimeSpent": 0
}
```

### GET /api/wallet/transactions
Returns paginated ledger activity for the authenticated user.

The client may display the result but cannot create ledger entries directly.

## Daily reward

### POST /api/rewards/daily/claim
Server checks eligibility, calculates the current reward, creates the reward ledger entry, and records the claim in one transaction.

Repeated requests for the same user/day must return the existing claim instead of minting twice.

## Deals

### GET /api/deals
Supports search, category, price range, rating, sorting, and pagination.

### POST /api/deals
Creates a deal owned by the authenticated seller.

### GET /api/deals/:id
Returns the public deal plus seller profile summary and rating information.

### PATCH /api/deals/:id
Only the owner can edit an active deal.

### DELETE /api/deals/:id
Only the owner can remove/disable an eligible deal.

## Orders / Escrow

### POST /api/orders
Input:

```json
{
  "dealId": "uuid"
}
```

Server flow:

1. Validate deal and price.
2. Validate buyer is not purchasing their own deal.
3. Lock/check buyer funds.
4. Move FAV from available balance into escrow.
5. Create order and escrow records atomically.

### POST /api/orders/:id/complete
Buyer accepts completed work. Server releases escrow to the seller, deducts the configured marketplace fee, and writes ledger entries atomically.

### POST /api/orders/:id/cancel
Only valid cancellation states may be cancelled. Refund behavior is determined by the order state and cancellation policy.

### POST /api/orders/:id/dispute
Opens a dispute and freezes normal completion/release until moderation resolves it.

## Reviews

### POST /api/orders/:id/review
A review is allowed only after an eligible completed order and only by an authorized participant.

## Notifications

The backend creates notifications for important events such as:

- order created
- seller submission
- order completed
- dispute opened
- dispute resolved
- daily reward available
- Premium status changes

## Error format

All API errors should use a consistent shape:

```json
{
  "error": {
    "code": "INSUFFICIENT_FAV",
    "message": "Not enough FAV to place this order."
  }
}
```

Clients should branch on stable error codes rather than parsing message text.

## Idempotency

Balance-changing POST requests should accept an `Idempotency-Key` header. The server must prevent duplicate rewards, purchases, releases, refunds, and payouts when clients retry requests.

## Money-like data rules

FAV amounts are stored as integers in the smallest indivisible unit. Never use JavaScript floating point arithmetic for balances or fees.

## Implementation order

1. Auth/session
2. Profiles
3. Wallet + ledger
4. Daily rewards
5. Deals
6. Orders + escrow
7. Disputes
8. Reviews
9. Notifications
10. Premium and billing
11. Admin/moderation
