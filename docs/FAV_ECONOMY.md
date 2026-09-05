# FAV Economy — Product Rule

## Core accounting rule

FAV rewards are **value-based, not coin-count-based**. The internal marketplace stores FAV in micro-FAV units:

`1 FAV = 1,000,000 micro-FAV`

The on-chain FAV token uses the same 6-decimal precision so an eligible internal amount can map exactly to the same number of token base units.

## Reference value vs market price

`reference_usd_per_fav` is an internal economic parameter used to size rewards and marketplace purchasing power. It is **not** a guaranteed exchange rate, redemption promise, or statement that the future ERC-20 market price must equal the reference value.

The current internal reference is `$100 / FAV`. A `$1` standard daily reward therefore produces `0.01 FAV` at that reference. If the reference changes, the number of FAV rewarded changes while the intended reward value stays controlled.

## Balance provenance

A user's visible balance can contain several internal sources. The marketplace can spend all of them, but the future crypto bridge treats them differently:

| Source | Spend inside Favourit | Crypto unlock |
|---|---:|---:|
| Daily / promotional FAV | Yes | No |
| Purchased FAV | Yes | No |
| Earned seller proceeds | Yes | Yes, after eligibility / verification rules |
| Legacy pre-provenance FAV | Yes | No by default |

The database tracks these as `reward_fav`, `purchased_fav`, `earned_fav`, and `legacy_fav` while preserving the existing top-level wallet balance.

When a buyer spends FAV, non-withdrawable sources are consumed before `earned_fav`. This avoids unnecessarily spending a seller's crypto-eligible earnings when other marketplace-only FAV is available.

## Rewards becoming seller earnings

A Daily Reward is not directly withdrawable. If it is used to purchase a legitimate service and the protected order completes, the seller has delivered real work. The seller's net proceeds become `earned_fav`, regardless of which internal source the buyer used.

That means Favourit can economically subsidize part of a seller payout when reward-funded FAV is spent. Settlement records the estimated reward-funded portion so reward budgets can later be controlled against marketplace revenue rather than emitted without measurement.

## Marketplace fees

The current product decision is a split 6% marketplace fee:

- buyer: **3%**, added to the listed service price;
- seller: **3%**, deducted from the listed service price.

For a `100 FAV` service:

- buyer places `103 FAV` into escrow;
- seller receives `97 FAV` after completion;
- Favourit receives `6 FAV` total marketplace fees.

All fee calculations are performed in micro-FAV and round upward to the nearest micro-FAV, matching server-side escrow accounting.

## Crypto unlock fee

Only eligible `earned_fav` will be available for the future **Unlock Crypto** flow. The currently selected unlock fee is **2.5%**.

Example for `97 FAV` of eligible seller earnings:

- requested unlock: `97 FAV`;
- 2.5% unlock fee: `2.425 FAV`;
- on-chain amount: `94.575 FAV`.

The unlock bridge is intentionally not active yet. No database function currently lets a client burn internal earned FAV and mint tokens without the future verification, wallet, idempotency, and chain-confirmation controls.

## On-chain token posture

The first smart contract layer is intentionally small:

- ERC-20 name `Favourit`, symbol `FAV`;
- 6 decimals;
- zero initial circulating supply;
- configurable initial maximum supply;
- role-gated minting for approved crypto unlocks;
- supply ceiling can only be increased transparently by a protected cap-manager role;
- emergency pause;
- no transfer taxes;
- no blacklist / honeypot behavior;
- no automatic fiat redemption promise.

The initial deployment target is Base Sepolia only. Production roles should ultimately be held by protected multisig/timelock infrastructure, not a personal wallet.

## Supply posture

FAV is intended to remain a scarce unit. A `10,000,000 FAV` initial cap is the current planning value, but it is **not hard-coded** into the contract. The deployment supplies the initial cap explicitly so the final supply decision can still be changed before the first testnet/mainnet deployment.

After deployment, increasing the ceiling is a visible on-chain governance/treasury action; the contract cannot silently reduce or bypass the published cap.

## Launch posture

The marketplace remains off-chain during this phase:

- services are priced and escrowed in internal micro-FAV;
- Daily Rewards stay marketplace-only;
- service sales create meaningful earned FAV;
- no public client endpoint can unlock FAV to crypto yet;
- no Favourit-operated fiat redemption is promised;
- the smart contract and provenance layer can be tested independently before any mainnet launch.

## Economy controller inputs

Future reward and supply policy should consider marketplace GMV, 3% + 3% fee revenue, reward-funded order volume, circulating internal FAV, earned/eligible FAV, unlock demand, fraud/reward farming, chargebacks/disputes, and treasury reserves. Reward emissions should be budgeted against those signals rather than treated as unlimited free supply.
