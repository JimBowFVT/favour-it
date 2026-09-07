import { supabase } from './supabase';
import { createAccountRequests } from './accountRequests';
export { parseFavInput, calculateCryptoUnlockQuote } from './favAmounts';

export const BASE_SEPOLIA = {
  chainId: 84532,
  chainIdHex: '0x14a34',
  name: 'Base Sepolia',
  rpcUrl: 'https://sepolia.base.org',
  explorerUrl: 'https://sepolia.basescan.org',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
};

export function shortAddress(address = '') {
  const value = String(address);
  if (value.length < 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function resolveEip1193Provider(provider = null) {
  if (provider?.request) return provider;
  const injected = typeof window !== 'undefined' ? window.ethereum : null;
  if (injected?.request) return injected;
  return null;
}

function accountRequests(userId) {
  if (!userId) throw new Error('Sign in again before opening crypto.');
  return createAccountRequests(supabase, userId);
}
async function accountRpc(name, args, userId) {
  const requests = await accountRequests(userId);
  return requests.run(() => supabase.rpc(name, args));
}
export const getMyCryptoEligibility = userId => accountRpc('get_my_account_eligibility', {}, userId);
export const acceptCryptoConsent = userId => accountRpc('accept_crypto_consent', { p_version: 'crypto-v1' }, userId);
export const getCryptoChainStatus = userId => accountRpc('get_crypto_chain_status', {}, userId);

export async function getMyCryptoWallet(chainId = BASE_SEPOLIA.chainId, userId) {
  const requests = await accountRequests(userId);
  const owner = userId;
  return requests.run(() => supabase.from('crypto_wallets')
    .select('id, chain_id, wallet_address, verified_at, last_used_at, is_active')
    .eq('user_id', owner).eq('chain_id', chainId).eq('is_active', true).maybeSingle());
}
export async function getMyCryptoUnlocks(limit = 10, userId) {
  const requests = await accountRequests(userId);
  const owner = userId;
  return (await requests.run(() => supabase.from('crypto_unlock_requests')
    .select('id, client_request_id, chain_id, token_address, destination_address, gross_fav, fee_fav, net_fav, status, tx_hash, created_at, confirmed_at, failed_at, cancelled_at, last_error')
    .eq('user_id', owner).order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(Number(limit || 10), 50))))) || [];
}
export async function getCryptoUnlockByClientId(requestId, userId) {
  const requests = await accountRequests(userId);
  return requests.run(() => supabase.from('crypto_unlock_requests')
    .select('id, client_request_id, gross_fav, fee_fav, net_fav, status, destination_address, chain_id')
    .eq('user_id', userId).eq('client_request_id', requestId).maybeSingle());
}

async function switchToBaseSepolia(ethereum) {
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: BASE_SEPOLIA.chainIdHex }],
    });
  } catch (error) {
    if (Number(error?.code) !== 4902) throw error;
    await ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: BASE_SEPOLIA.chainIdHex,
        chainName: BASE_SEPOLIA.name,
        rpcUrls: [BASE_SEPOLIA.rpcUrl],
        blockExplorerUrls: [BASE_SEPOLIA.explorerUrl],
        nativeCurrency: BASE_SEPOLIA.nativeCurrency,
      }],
    });
  }
}

export async function connectAndVerifyCryptoWallet(provider = null, expectedUserId) {
  const requests = await accountRequests(expectedUserId);
  const originalSession = await requests.run(session => ({ data: session }));
  const userId = originalSession.user.id;
  if ((await getMyCryptoEligibility(userId))?.crypto_eligible !== true) throw new Error('Complete server-verified crypto eligibility before linking a wallet.');
  const ethereum = resolveEip1193Provider(provider);
  if (!ethereum) throw new Error('No compatible wallet provider is available yet.');

  const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
  const address = String(accounts?.[0] || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error('Your wallet did not return a valid EVM address.');

  await switchToBaseSepolia(ethereum);
  const activeChainId = await ethereum.request({ method: 'eth_chainId' });
  if (String(activeChainId).toLowerCase() !== BASE_SEPOLIA.chainIdHex) {
    throw new Error('Please switch your wallet to Base Sepolia.');
  }

  await requests.run(session => ({ data: session }));
  const challenge = await requests.run(() => supabase.rpc('create_wallet_link_challenge', {
    p_wallet_address: address,
    p_chain_id: BASE_SEPOLIA.chainId,
  }));

  const challengeValue = Array.isArray(challenge) ? challenge[0] : challenge;
  if (!challengeValue?.challenge_id || !challengeValue?.message) throw new Error('Favourit could not create a wallet verification challenge.');

  const signature = await ethereum.request({
    method: 'personal_sign',
    params: [challengeValue.message, address],
  });

  await requests.run(session => ({ data: session }));
  const currentAccounts = await ethereum.request({ method: 'eth_accounts' });
  if (String(currentAccounts?.[0] || '').toLowerCase() !== address) throw new Error('The selected wallet changed. Restart wallet verification.');
  if (String(await ethereum.request({ method: 'eth_chainId' })).toLowerCase() !== BASE_SEPOLIA.chainIdHex) throw new Error('The wallet network changed. Restart wallet verification.');
  await requests.run(session => ({ data: session }));
  const verification = await requests.run(() => supabase.functions.invoke('verify-wallet', {
    headers: { Authorization: `Bearer ${originalSession.access_token}` },
    body: {
      challengeId: challengeValue.challenge_id,
      signature,
    },
  }));
  if (!verification?.verified) throw new Error(verification?.error || 'Wallet verification failed.');

  return verification.wallet || {
    wallet_address: address,
    chain_id: BASE_SEPOLIA.chainId,
    verified_at: new Date().toISOString(),
    is_active: true,
  };
}

export function disconnectCryptoWallet(chainId = BASE_SEPOLIA.chainId, userId) {
  return accountRpc('disconnect_my_crypto_wallet', { p_chain_id: chainId }, userId);
}
export function requestCryptoUnlock(amountMicroFav, clientRequestId, userId) {
  const amount = Number(amountMicroFav);
  if (!Number.isSafeInteger(amount) || amount <= 0 || !clientRequestId) throw new Error('A valid amount and saved request ID are required.');
  return accountRpc('create_crypto_unlock_request', { p_amount_fav: amount, p_client_request_id: clientRequestId }, userId);
}
export function cancelCryptoUnlock(requestId, userId) {
  return accountRpc('cancel_my_crypto_unlock_request', { p_request_id: requestId }, userId);
}
