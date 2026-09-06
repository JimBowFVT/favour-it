import {
  FAV_ECONOMY,
  usdValueToFAV,
  favToUnits,
  unitsToFAV,
  getDailyReward,
  calculateFee,
  calculateSellerPayout,
  calculateBuyerTotal,
  calculateCryptoUnlockNet,
} from './economy';

describe('FAV economy', () => {
  test('converts economic value to FAV', () => {
    expect(usdValueToFAV(1, 100)).toBeCloseTo(0.01);
    expect(usdValueToFAV(1, 1_000_000)).toBeCloseTo(0.000001);
  });

  test('keeps micro-FAV conversion reversible', () => {
    const units = favToUnits(12.345678);
    expect(units).toBe(12_345_678);
    expect(unitsToFAV(units)).toBeCloseTo(12.345678);
  });

  test('daily reward follows FAV reference value', () => {
    expect(getDailyReward(3, false, 100)).toBeCloseTo(0.01);
    expect(getDailyReward(4, false, 100)).toBeCloseTo(0.01);
    expect(getDailyReward(4, true, 100)).toBeCloseTo(0.02);
    expect(getDailyReward(4, false, 1_000_000)).toBeCloseTo(0.000001);
  });

  test('marketplace uses 3% on each side with micro-FAV precision', () => {
    expect(calculateFee(100)).toBe(3);
    expect(calculateSellerPayout(100)).toBe(97);
    expect(calculateBuyerTotal(100)).toBe(103);
    expect(calculateFee(1)).toBeCloseTo(0.03);
  });

  test('crypto unlock uses the configured 2.5% fee', () => {
    expect(calculateCryptoUnlockNet(100)).toBe(97.5);
  });

  test('launch economy keeps marketplace transfers internal until crypto unlock is enabled', () => {
    expect(FAV_ECONOMY.fiatPurchaseEnabled).toBe(false);
    expect(FAV_ECONOMY.fiatRedemptionEnabled).toBe(false);
    expect(FAV_ECONOMY.userToUserTransfersEnabled).toBe(false);
    expect(FAV_ECONOMY.externalTransfersEnabled).toBe(false);
  });
});
