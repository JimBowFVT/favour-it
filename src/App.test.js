import { calculateFee, calculateSellerPayout, favToUnits, getDailyReward, unitsToFAV, usdValueToFAV } from './data/economy';
import { filterDeals, sortDeals } from './lib/marketplace';

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

describe('Marketplace helpers', () => {
  const deals = [
    { title: 'Logo design', category: 'Design', seller: 'Maya', description: 'Brand identity', price: 50, rating: 4.8 },
    { title: 'React bug fix', category: 'Development', seller: 'Noam', description: 'Frontend help', price: 20, rating: 4.9 },
    { title: 'Social media kit', category: 'Design', seller: 'Ari', description: 'Content templates', price: 80, rating: 4.6 },
  ];
  test('filters by category and searches descriptions', () => {
    expect(filterDeals(deals, { category: 'Design' })).toHaveLength(2);
    expect(filterDeals(deals, { query: 'frontend' })).toHaveLength(1);
  });
  test('sorts without mutating the source list', () => {
    expect(sortDeals(deals, 'price-low').map(d => d.price)).toEqual([20, 50, 80]);
    expect(deals.map(d => d.price)).toEqual([50, 20, 80]);
    expect(sortDeals(deals, 'rating')[0].rating).toBe(4.9);
  });
});
