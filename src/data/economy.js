// FAV launch economy — conservative bootstrap settings.
// These values are intentionally designed to avoid creating a large FAV liability
// before Favourit has meaningful revenue. The final economic model should be
// reviewed before enabling fiat redemption or external transfers.
export const FAV_ECONOMY = {
  currency: 'FAV',
  onboardingRewardDays: 3,
  onboardingDailyReward: 0,
  standardDailyReward: 10,
  premiumDailyReward: 25,
  transactionFeePercent: 5,
  minimumDealPrice: 10,
  escrowEnabled: true,
  fiatRedemptionEnabled: false,
  externalTransfersEnabled: false,
};

export const walletTransactions = [
  { id: 'tx-1', type: 'reward', label: 'Daily FAV reward', amount: 10, direction: 'in', date: 'Today' },
  { id: 'tx-2', type: 'escrow', label: 'Order escrow', amount: 240, direction: 'out', date: 'Yesterday' },
  { id: 'tx-3', type: 'sale', label: 'Deal completed', amount: 320, direction: 'in', date: 'Aug 31' },
];

export function getDailyReward(accountAgeDays, isPremium = false) {
  if (Number(accountAgeDays) <= FAV_ECONOMY.onboardingRewardDays) {
    return FAV_ECONOMY.onboardingDailyReward;
  }
  return isPremium ? FAV_ECONOMY.premiumDailyReward : FAV_ECONOMY.standardDailyReward;
}

export function calculateFee(amount) {
  return Math.ceil(Number(amount) * (FAV_ECONOMY.transactionFeePercent / 100));
}

export function calculateSellerPayout(amount) {
  const value = Number(amount);
  return Math.max(0, value - calculateFee(value));
}
