# Favourit Transaction Flow

## MVP order lifecycle

1. Buyer opens a published Deal.
2. Buyer starts an order.
3. Database transaction locks the Deal and buyer wallet.
4. The buyer's available micro-FAV moves to held/escrow.
5. The Order is created as `funded`.
6. Seller delivers through the Favourit workflow.
7. Buyer releases the order when satisfied.
8. Escrow is released atomically.
9. Seller receives the gross amount minus the Favourit fee.
10. Ledger entries record the resulting accounting events.

## Refunds and disputes

A refund returns escrowed FAV to the buyer when the order is eligible. A future moderation layer will support disputes and partial settlements without allowing clients to directly edit balances.

## Accounting rule

The frontend must never be the source of truth for FAV balances, fees, escrow, rewards, or order transitions. These values must be calculated and changed by trusted server/database functions.

## FAV philosophy

FAV is a marketplace currency exchanged for services. Favourit does not promise to redeem FAV for fiat. At MVP, unrestricted external transfers and public trading are disabled. This reduces platform redemption liability while the marketplace establishes real utility and liquidity.

## Precision

All persisted FAV monetary amounts use micro-FAV units:

`1 FAV = 1,000,000 micro-FAV`

Never use JavaScript floating-point values for authoritative accounting.
