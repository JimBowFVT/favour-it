// FAV launch economy — value-based rewards.
// IMPORTANT: FAV rewards are defined by their intended purchasing value, not by
// a fixed number of coins. If the reference value of 1 FAV changes, the number
// of FAV units distributed per day changes automatically while the intended
// reward value stays stable.
//
// This is an internal reference model for the MVP, not a promise that FAV has
// a fixed fiat market price. External trading/redemption remains disabled.
export const FAV_ECONOMY = {
  currency: 'FAV',

  // Accounting precision. 1 FAV = 1,000,000 micro-FAV units.
  // This lets FAV become very valuable without making small marketplace prices
  // impossible to represent.
  unitsPerFAV: 1_000_000,

  // Internal reference only. It can be changed by the economy controller after
  // observing real marketplace purchasing power and demand.
  referenceUsdPerFAV: 100,

  // Rewards are specified in USD-equivalent purchasing value, then converted
  // into FAV using the current reference value.
  standardDailyRewardUsd: 1,
  premiumDailyRewardUsd: 2,
  onboardingRewardDays: 3,
  onboardingDailyRewardUsd: 0,

  transactionFeePercent: 5,
  minimumDealPriceUsdEquivalent: 1,
  escrowEnabled: true,
  fiatRedemptionEnabled: false,
  externalTransfersEnabled: false,
};

export const walletTransactions = [
  { id: 'tx-1', type: 'reward', label: 'Daily FAV reward', amount: 0.01, direction: 'in', date: 'Today' },
  { id: 'tx-2', type: 'escrow', label: 'Order escrow', amount: 2.4, direction: 'out', date: 'Yesterday' },
  { id: 'tx-3', type: 'sale', label: 'Deal completed', amount: 3.2, direction: 'in', date: 'Aug 31' },
];

export function usdValueToFAV(usdValue, referenceUsdPerFAV = FAV_ECONOMY.referenceUsdPerFAV) {
  const value = Number(usdValue);
  const reference = Number(referenceUsdPerFAV);
  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference <= 0) return 0;
  return value / reference;
}

export function favToUnits(fav) {
  return Math.round(Number(fav) * FAV_ECONOMY.unitsPerFAV);
}

export function unitsToFAV(units) {
  return Number(units) / FAV_ECONOMY.unitsPerFAV;
}

export function getDailyReward(accountAgeDays, isPremium = false, referenceUsdPerFAV = FAV_ECONOMY.referenceUsdPerFAV) {
  if (Number(accountAgeDays) <= FAV_ECONOMY.onboardingRewardDays) {
    return usdValueToFAV(FAV_ECONOMY.onboardingDailyRewardUsd, referenceUsdPerFAV);
  }
  const usdReward = isPremium
    ? FAV_ECONOMY.premiumDailyRewardUsd
    : FAV_ECONOMY.standardDailyRewardUsd;
  return usdValueToFAV(usdReward, referenceUsdPerFAV);
}

export function calculateFee(amount) {
  return Math.ceil(Number(amount) * (FAV_ECONOMY.transactionFeePercent / 100));
}

export function calculateSellerPayout(amount) {
  const value = Number(amount);
  return Math.max(0, value - calculateFee(value));
}
