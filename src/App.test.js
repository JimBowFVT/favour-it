import { calculateFee, calculateSellerPayout, favToUnits, getDailyReward, unitsToFAV, usdValueToFAV } from './data/economy';

describe('FAV economy', () => {
  test('converts USD value to FAV using the reference value', () => {
    expect(usdValueToFAV(1, 100)).toBeCloseTo(0.01);
    expect(usdValueToFAV(10, 100)).toBeCloseTo(0.1);
  });

  test('round-trips FAV through micro-FAV units', () => {
    const units = favToUnits(1.234567);
    expect(units).toBe(1234567);
    expect(unitsToFAV(units)).toBeCloseTo(1.234567);
  });

  test('keeps daily reward value stable when FAV reference price changes', () => {
    expect(getDailyReward(4, false, 100)).toBeCloseTo(0.01);
    expect(getDailyReward(4, false, 1000)).toBeCloseTo(0.001);
    expect(getDailyReward(4, true, 100)).toBeCloseTo(0.02);
  });

  test('three-day onboarding window receives zero reward', () => {
    expect(getDailyReward(0, false, 100)).toBe(0);
    expect(getDailyReward(2, true, 100)).toBe(0);
    expect(getDailyReward(3, true, 100)).toBeCloseTo(0.02);
  });

  test('calculates platform fee and seller payout', () => {
    expect(calculateFee(100)).toBe(5);
    expect(calculateSellerPayout(100)).toBe(95);
  });
});
