// Mirrors the deployed 13+ account policy. Crypto authorization is server-only and 18+ verified.
export function validateBirthDate(value, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > today) {
    throw new Error('Enter a valid date of birth.');
  }
  const age = now.getUTCFullYear() - date.getUTCFullYear() - (today.slice(5) < value.slice(5) ? 1 : 0);
  if (age < 13) throw new Error('You must be at least 13 to create a Favourit account.');
  return value;
}
