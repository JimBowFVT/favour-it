import {
  FAV_ECONOMY,
  usdValueToFAV,
  favToUnits,
  unitsToFAV,
  getDailyReward,
  calculateFee,
  calculateSellerPayout,
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

  test('fee and seller payout follow configured fee rate', () => {
    expect(calculateFee(100)).toBe(5);
    expect(calculateSellerPayout(100)).toBe(95);
    expect(calculateFee(1)).toBe(1);
  });

  test('launch economy has closed-loop transfer settings', () => {
    expect(FAV_ECONOMY.fiatPurchaseEnabled).toBe(false);
    expect(FAV_ECONOMY.fiatRedemptionEnabled).toBe(false);
    expect(FAV_ECONOMY.userToUserTransfersEnabled).toBe(false);
    expect(FAV_ECONOMY.externalTransfersEnabled).toBe(false);
  });
});
