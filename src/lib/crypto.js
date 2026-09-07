/* global globalThis */
import { supabase } from './supabase';
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

export async function getMyCryptoEligibility() {
  const { data, error } = await supabase.rpc('get_my_account_eligibility');
  if (error) throw error;
  return data;
}

export async function getCryptoChainStatus() {
  const { data, error } = await supabase.rpc('get_crypto_chain_status');
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function getMyCryptoWallet(chainId = BASE_SEPOLIA.chainId) {
  const { data, error } = await supabase
    .from('crypto_wallets')
    .select('id, chain_id, wallet_address, verified_at, last_used_at, is_active')
    .eq('chain_id', chainId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getMyCryptoUnlocks(limit = 10) {
  const { data, error } = await supabase
    .from('crypto_unlock_requests')
    .select('id, chain_id, token_address, destination_address, gross_fav, fee_fav, net_fav, status, tx_hash, created_at, confirmed_at, failed_at, cancelled_at, last_error')
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(Number(limit || 10), 50)));
  if (error) throw error;
  return data || [];
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

export async function connectAndVerifyCryptoWallet(provider = null) {
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

  const { data: challenge, error: challengeError } = await supabase.rpc('create_wallet_link_challenge', {
    p_wallet_address: address,
    p_chain_id: BASE_SEPOLIA.chainId,
  });
  if (challengeError) throw challengeError;

  const challengeValue = Array.isArray(challenge) ? challenge[0] : challenge;
  if (!challengeValue?.challenge_id || !challengeValue?.message) throw new Error('Favourit could not create a wallet verification challenge.');

  const signature = await ethereum.request({
    method: 'personal_sign',
    params: [challengeValue.message, address],
  });

  const { data: verification, error: verifyError } = await supabase.functions.invoke('verify-wallet', {
    body: {
      challengeId: challengeValue.challenge_id,
      signature,
    },
  });
  if (verifyError) throw verifyError;
  if (!verification?.verified) throw new Error(verification?.error || 'Wallet verification failed.');

  return verification.wallet || {
    wallet_address: address,
    chain_id: BASE_SEPOLIA.chainId,
    verified_at: new Date().toISOString(),
    is_active: true,
  };
}

export async function disconnectCryptoWallet(chainId = BASE_SEPOLIA.chainId) {
  const { data, error } = await supabase.rpc('disconnect_my_crypto_wallet', {
    p_chain_id: chainId,
  });
  if (error) throw error;
  return data;
}

export async function requestCryptoUnlock(amountMicroFav, clientRequestId = null) {
  const amount = Number(amountMicroFav);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a valid FAV amount.');

  const requestId = clientRequestId || globalThis.crypto?.randomUUID?.();
  if (!requestId) throw new Error('This browser cannot generate a secure request id.');

  const { data, error } = await supabase.rpc('create_crypto_unlock_request', {
    p_amount_fav: amount,
    p_client_request_id: requestId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function cancelCryptoUnlock(requestId) {
  const { data, error } = await supabase.rpc('cancel_my_crypto_unlock_request', {
    p_request_id: requestId,
  });
  if (error) throw error;
  return data;
}
