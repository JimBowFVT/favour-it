import { calculateCryptoUnlockQuote, parseFavInput, shortAddress } from './crypto';

describe('FAV crypto helpers', () => {
  test('parses FAV input exactly to six-decimal micro-FAV units', () => {
    expect(parseFavInput('1')).toBe(1_000_000);
    expect(parseFavInput('1.000001')).toBe(1_000_001);
    expect(parseFavInput('0.5')).toBe(500_000);
    expect(parseFavInput('10.123456')).toBe(10_123_456);
    expect(parseFavInput('1.0000001')).toBeNull();
    expect(parseFavInput('-1')).toBeNull();
  });

  test('calculates the 2.5% unlock fee in integer micro-FAV', () => {
    expect(calculateCryptoUnlockQuote(1_000_000, 250)).toEqual({
      gross_fav: 1_000_000,
      fee_fav: 25_000,
      net_fav: 975_000,
    });
    expect(calculateCryptoUnlockQuote(1, 250)).toEqual({
      gross_fav: 1,
      fee_fav: 1,
      net_fav: 0,
    });
  });

  test('shortens wallet addresses without changing short values', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
    expect(shortAddress('0x1234')).toBe('0x1234');
  });
});
