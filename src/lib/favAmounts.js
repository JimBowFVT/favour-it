/* global BigInt */
// Micro-FAV is an integer unit. Never route bigint ledger values through Number.
const SCALE = BigInt(1000000);
export function microFavInteger(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error('The server returned an invalid or imprecise FAV amount.');
}
export function favDecimal(value) {
  const amount = microFavInteger(value);
  const negative = amount < BigInt(0);
  const absolute = negative ? -amount : amount;
  const fraction = (absolute % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${absolute / SCALE}${fraction ? `.${fraction}` : ''}`;
}
export function formatMicroFav(value, locale) {
  if (value === null || value === undefined) return '—';
  try {
    const decimal = favDecimal(value);
    const [whole, fraction] = decimal.split('.');
    const separator = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value || '.';
    const formattedWhole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(whole));
    // BigInt('-0') has no sign; preserve negative sub-FAV amounts explicitly.
    return `${whole === '-0' ? '-' : ''}${formattedWhole}${fraction ? separator + fraction : ''}`;
  } catch (_) { return '—'; }
}
export function parseFavInput(value) {
  const text = String(value ?? '').trim();
  if (text.length > 32 || !/^\d+(?:\.\d{0,6})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}
export function calculateCryptoUnlockQuote(grossMicroFav, feeBps = 250) {
  const gross = Number(grossMicroFav ?? 0);
  const bps = Number(feeBps);
  if (!Number.isSafeInteger(gross) || gross <= 0 || !Number.isInteger(bps) || bps < 0 || bps > 10000) {
    return { gross_fav: 0, fee_fav: 0, net_fav: 0 };
  }
  const fee = Number((BigInt(gross) * BigInt(bps) + BigInt(9999)) / BigInt(10000));
  return { gross_fav: gross, fee_fav: fee, net_fav: gross - fee };
}
