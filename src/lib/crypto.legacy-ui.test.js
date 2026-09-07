import { getCryptoChainStatus, getMyCryptoWallet, requestCryptoUnlock } from './crypto';
import { getMyFavBalanceBreakdown } from './wallet';
import { readUnlockAttempt, saveUnlockAttempt } from './cryptoRecovery';
import { supabase } from './supabase';

jest.mock('./supabase', () => ({ supabase: { auth: { getSession: jest.fn() }, rpc: jest.fn(), from: jest.fn() } }));
const owner = 'member-a';
const address = `0x${'1'.repeat(40)}`;
const id = '11111111-1111-4111-8111-111111111111';
let eligible, recorded, result;
beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear(); eligible = true; recorded = null;
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => id } });
  result = { id: 'server-request', gross_fav: 1000000, status: 'pending', destination_address: address, chain_id: 84532 };
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: owner }, access_token: 'fixture-jwt' } } });
  supabase.rpc.mockImplementation(async name => {
    if (name === 'get_my_account_eligibility') return { data: { crypto_eligible: eligible } };
    if (name === 'get_my_fav_balance_breakdown') return { data: { crypto_maturing_fav: 96000000, crypto_eligible_fav: 1000000, crypto_unlock_maturity_hours: 120 } };
    if (name === 'create_crypto_unlock_request') return result instanceof Error ? { error: result } : { data: result };
    return { data: { chain_id: 84532 } };
  });
  supabase.from.mockImplementation(table => {
    const query = { select: jest.fn(), eq: jest.fn(), maybeSingle: jest.fn() };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({ data: table === 'crypto_wallets' ? { wallet_address: address, is_active: true } : recorded });
    return query;
  });
});
test('the unchanged settings panel can use original no-argument calls, bound to the current account', async () => {
  expect(await getCryptoChainStatus()).toEqual({ chain_id: 84532 });
  expect((await getMyCryptoWallet()).wallet_address).toBe(address);
  const breakdown = await getMyFavBalanceBreakdown();
  expect(breakdown.crypto_maturing_fav).toBe('96000000');
  expect(breakdown.crypto_unlock_maturity_hours).toBe(120);
});
test('original amount-only unlock call persists and retries the identical ID on ambiguous failure', async () => {
  const success = result; result = new Error('Network response lost');
  await expect(requestCryptoUnlock(1000000)).rejects.toThrow('Network response lost');
  expect(readUnlockAttempt(localStorage, owner).id).toBe(id);
  result = success;
  await expect(requestCryptoUnlock(1000000)).resolves.toEqual(success);
  const calls = supabase.rpc.mock.calls.filter(([name]) => name === 'create_crypto_unlock_request');
  expect(calls).toHaveLength(2);
  expect(calls[0][1]).toEqual({ p_amount_fav: 1000000, p_client_request_id: id });
  expect(calls[1][1]).toEqual(calls[0][1]);
  expect(readUnlockAttempt(localStorage, owner)).toBeNull();
});
test('recorded requests reconcile without resubmitting even if eligibility later expires', async () => {
  saveUnlockAttempt(localStorage, { id, userId: owner, address, amount: '1000000', chainId: 84532 });
  recorded = result; eligible = false;
  expect(await requestCryptoUnlock(1000000)).toEqual(result);
  expect(supabase.rpc.mock.calls.some(([name]) => name === 'create_crypto_unlock_request')).toBe(false);
});
test('the old button cannot bypass identity/age/consent eligibility', async () => {
  eligible = false;
  await expect(requestCryptoUnlock(1000000)).rejects.toThrow('verified age');
  expect(supabase.rpc.mock.calls.some(([name]) => name === 'create_crypto_unlock_request')).toBe(false);
  expect(readUnlockAttempt(localStorage, owner)).toBeNull();
});
test('a different amount cannot replace an unresolved request', async () => {
  saveUnlockAttempt(localStorage, { id, userId: owner, address, amount: '1000000', chainId: 84532 });
  await expect(requestCryptoUnlock(2000000)).rejects.toThrow('original amount');
  expect(readUnlockAttempt(localStorage, owner).amount).toBe('1000000');
  expect(supabase.rpc).not.toHaveBeenCalled();
});
test('an explicitly different expected account is still denied', async () => {
  await expect(getMyCryptoWallet(84532, 'member-b')).rejects.toThrow('account changed');
  expect(supabase.from).not.toHaveBeenCalled();
});
