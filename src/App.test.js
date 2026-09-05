import { calculateFee, calculateSellerPayout, favToUnits, getDailyReward, unitsToFAV, usdValueToFAV } from './data/economy';
import { deals as exploreSeedDeals } from './data/deals';
import { resolveServiceCategory, serviceCategories, serviceFamilies } from './data/serviceCategories';
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

describe('Explore service taxonomy', () => {
  test('keeps the approved marketplace at 44 grouped categories', () => {
    expect(serviceCategories).toHaveLength(44);
    expect(new Set(serviceCategories.map(category => category.id)).size).toBe(44);
    expect(new Set(serviceCategories.map(category => category.label)).size).toBe(44);
    const familyIds = new Set(serviceFamilies.map(family => family.id));
    expect(serviceCategories.every(category => familyIds.has(category.family))).toBe(true);
  });

  test('maps legacy broad categories into approved service categories', () => {
    expect(resolveServiceCategory('Design')?.label).toBe('Graphic Design & Branding');
    expect(resolveServiceCategory('Development')?.label).toBe('Web Development');
    expect(resolveServiceCategory('Lifestyle')?.label).toBe('Coaching & Learning');
  });

  test('gives every Explore sample a valid Basic package and approved category', () => {
    expect(exploreSeedDeals.length).toBeGreaterThan(0);
    exploreSeedDeals.forEach(deal => {
      expect(resolveServiceCategory(deal.category)).not.toBeNull();
      expect(deal.packages.some(servicePackage => servicePackage.tier === 'basic')).toBe(true);
      deal.packages.forEach(servicePackage => {
        expect(servicePackage.price).toBeGreaterThan(0);
        expect(servicePackage.deliveryDays).toBeGreaterThanOrEqual(1);
        expect(servicePackage.revisions).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
