# FAV Economy — Product Rule

## The core rule

FAV rewards are **value-based, not coin-count-based**.

Favourit should never promise “10 FAV every day” regardless of the currency's value. Instead, the system defines the intended purchasing value of the reward (for example, $1/day standard and $2/day Premium) and converts that value into FAV using the current internal reference value.

Example:

| Reference value | Standard reward value | FAV distributed |
|---:|---:|---:|
| $1 / FAV | $1 | 1 FAV |
| $10 / FAV | $1 | 0.1 FAV |
| $100 / FAV | $1 | 0.01 FAV |
| $1,000 / FAV | $1 | 0.001 FAV |
| $1,000,000 / FAV | $1 | 0.000001 FAV |

Premium is currently modeled at twice the standard daily purchasing value.

## Precision

The backend stores FAV as **micro-FAV units**:

`1 FAV = 1,000,000 micro-FAV`

This means FAV can become extremely valuable without forcing the marketplace to use impossible whole-number prices.

## Reference value vs market price

`reference_usd_per_fav` is an internal economic parameter. It is **not** a guaranteed exchange rate and does not mean Favourit promises to redeem FAV for that amount of fiat.

If FAV eventually becomes publicly traded, the market price can move independently. Before enabling external trading, fiat redemption, or transfers, Favourit must model the economic and legal consequences and obtain appropriate professional advice.

## Launch posture

The MVP keeps FAV inside the Favourit ecosystem:

- no public blockchain requirement yet;
- no external wallet transfers;
- no fiat redemption promise;
- services are purchased with FAV;
- service sales are the primary way users accumulate meaningful FAV;
- daily rewards remain intentionally small;
- the backend, not the frontend, decides reward amounts.

## Why this survives appreciation

If the reference value increases by 10×, the reward in FAV automatically decreases by 10× while preserving the intended reward value. This prevents Favourit from accidentally distributing an economically enormous number of coins just because the unit price changed.

The same principle should eventually be used for promotional rewards, referral rewards, and other emissions: define the **economic value first**, then convert to FAV.

## Future controller

The reference value should not be changed casually. A future economy controller should consider:

- marketplace purchasing power;
- FAV velocity and circulating supply;
- active users and Premium users;
- service prices;
- FAV earned from completed services;
- FAV purchased from Favourit;
- FAV held and spent;
- redemption demand, if ever enabled;
- fraud and reward farming;
- Favourit's revenue and reserves.

Any future market-price oracle or public-token mechanism should be added only after the legal/economic model is ready.
