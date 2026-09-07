import { microFavInteger } from './favAmounts';
const keyFor = userId => `favourit:crypto-unlock-attempt:v1:${userId}`;
const uuid = value => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value || '');
export function readUnlockAttempt(storage, userId) {
  if (!storage || !userId) throw new Error('Persistent request storage is unavailable. Crypto requests are disabled.');
  const raw = storage.getItem(keyFor(userId));
  if (!raw) return null;
  let attempt;
  try { attempt = JSON.parse(raw); } catch (_) { throw new Error('The saved crypto request needs review. Contact support before submitting another.'); }
  if (attempt.userId !== userId || !uuid(attempt.id) || attempt.chainId !== 84532 || !/^0x[0-9a-f]{40}$/i.test(attempt.address || '') || !/^\d+$/.test(attempt.amount || '') || microFavInteger(attempt.amount) <= 0 || microFavInteger(attempt.amount) > Number.MAX_SAFE_INTEGER) {
    throw new Error('The saved crypto request needs review. Contact support before submitting another.');
  }
  return attempt;
}
export function saveUnlockAttempt(storage, attempt) {
  const existing = readUnlockAttempt(storage, attempt.userId);
  if (existing && existing.id !== attempt.id) throw new Error('An earlier crypto request still needs confirmation. Refresh its status first.');
  storage.setItem(keyFor(attempt.userId), JSON.stringify(attempt));
  if (readUnlockAttempt(storage, attempt.userId)?.id !== attempt.id) throw new Error('Could not save the crypto request safely. Nothing was submitted.');
  return attempt;
}
export function clearUnlockAttempt(storage, userId, requestId) {
  const current = readUnlockAttempt(storage, userId);
  if (current?.id === requestId) storage.removeItem(keyFor(userId));
}
export function isDefiniteRpcRejection(error) {
  // These database errors mean the transaction aborted, unlike a network timeout.
  return ['P0001', '22023', '22P02', '42501'].includes(error?.code);
}
