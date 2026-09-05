# FAV on-chain contract

This directory contains the first on-chain layer for Favourit.

## Contract posture

`FavouritToken.sol` is intentionally small:

- ERC-20 name `Favourit`, symbol `FAV`;
- 6 decimals, matching the existing Supabase ledger exactly (`1 FAV = 1,000,000 micro-FAV`);
- zero initial circulating supply;
- role-gated minting for future eligible earnings unlocks;
- an explicit supply cap that can only be increased by `CAP_MANAGER_ROLE`;
- emergency pause controlled by `PAUSER_ROLE`;
- no transfer tax, blacklist, honeypot logic, automatic redemption, or marketplace fee logic.

The marketplace remains off-chain. Daily/promotional FAV stays non-withdrawable in the internal ledger. Only eligible seller earnings will later be allowed into the crypto unlock flow.

## Supply

The contract does **not** hard-code the business supply decision. The cap is a constructor argument so the planned 10,000,000 FAV ceiling can still be changed before the first deployment. After deployment, the cap can only be raised transparently on-chain.

The production admin/cap-manager/minter roles should ultimately be held by protected multisig/timelock infrastructure rather than one personal key.

## Network

The first deployment target is **Base Sepolia** (chain ID `84532`) only. Mainnet deployment is intentionally out of scope until the bridge/KYC architecture and production treasury controls are approved.

## Dependency

CI pins OpenZeppelin Contracts v5.7.0 at commit:

`cab19933c33c2ad1d4c7a84864a3601dddfd16f3`

## Tests

From the repository root, after installing Foundry and the pinned OpenZeppelin source under `contracts/lib/openzeppelin-contracts`:

```bash
forge test --root contracts -vv
```

Tests cover ledger precision, authorization, cap enforcement, cap increases, emergency pause behavior, and exact transfers.
