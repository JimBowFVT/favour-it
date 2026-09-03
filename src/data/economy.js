export const FAV_ECONOMY = {
  currency: 'FAV',
  standardDailyReward: 40,
  premiumDailyReward: 120,
  transactionFeePercent: 5,
  minimumDealPrice: 10,
  escrowEnabled: true,
};

export const walletTransactions = [
  { id: 'tx-1', type: 'reward', label: 'Daily FAV reward', amount: 40, direction: 'in', date: 'Today' },
  { id: 'tx-2', type: 'escrow', label: 'Order escrow', amount: 240, direction: 'out', date: 'Yesterday' },
  { id: 'tx-3', type: 'sale', label: 'Deal completed', amount: 320, direction: 'in', date: 'Aug 31' },
];

export function calculateFee(amount) {
  return Math.ceil(Number(amount) * (FAV_ECONOMY.transactionFeePercent / 100));
}

export function calculateSellerPayout(amount) {
  const value = Number(amount);
  return Math.max(0, value - calculateFee(value));
}
