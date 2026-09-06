import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatFav, getMyFavBalanceBreakdown } from '../lib/wallet';
import {
  BASE_SEPOLIA,
  calculateCryptoUnlockQuote,
  cancelCryptoUnlock,
  connectAndVerifyCryptoWallet,
  disconnectCryptoWallet,
  getCryptoChainStatus,
  getMyCryptoUnlocks,
  getMyCryptoWallet,
  parseFavInput,
  requestCryptoUnlock,
  shortAddress,
} from '../lib/crypto';
import './CryptoWalletPanel.css';

const STATUS_COPY = {
  pending: 'Queued',
  processing: 'Processing',
  broadcast: 'Confirming',
  confirmed: 'On-chain',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function TxLink({ hash }) {
  if (!hash) return null;
  return <a href={`${BASE_SEPOLIA.explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>;
}

export default function CryptoWalletPanel({ onWalletChanged }) {
  const [chain, setChain] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [unlocks, setUnlocks] = useState([]);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextChain, nextWallet, nextBreakdown, nextUnlocks] = await Promise.all([
        getCryptoChainStatus(),
        getMyCryptoWallet(),
        getMyFavBalanceBreakdown(),
        getMyCryptoUnlocks(),
      ]);
      setChain(nextChain);
      setWallet(nextWallet);
      setBreakdown(nextBreakdown);
      setUnlocks(nextUnlocks);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Could not load crypto wallet status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const amountMicroFav = useMemo(() => parseFavInput(amount), [amount]);
  const quote = useMemo(
    () => calculateCryptoUnlockQuote(amountMicroFav, breakdown?.crypto_unlock_fee_bps || 250),
    [amountMicroFav, breakdown?.crypto_unlock_fee_bps],
  );
  const eligible = Number(breakdown?.crypto_eligible_fav || 0);
  const pending = Number(breakdown?.pending_crypto_unlock_fav || 0);
  const deploymentVerified = Boolean(chain?.token_address && chain?.deployment_verified_at);
  const canUnlock = Boolean(
    deploymentVerified &&
    chain?.unlock_enabled &&
    wallet?.is_active &&
    amountMicroFav &&
    quote.net_fav > 0 &&
    amountMicroFav <= eligible &&
    !busy
  );

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await connectAndVerifyCryptoWallet();
      await load();
    } catch (connectError) {
      setError(connectError.message || 'Could not verify your wallet.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy || !wallet) return;
    setBusy(true);
    setError('');
    try {
      await disconnectCryptoWallet();
      await load();
    } catch (disconnectError) {
      setError(disconnectError.message || 'Could not disconnect this wallet.');
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (!canUnlock) return;
    setBusy(true);
    setError('');
    try {
      await requestCryptoUnlock(amountMicroFav);
      setAmount('');
      await load();
      await onWalletChanged?.();
    } catch (unlockError) {
      setError(unlockError.message || 'Could not queue this crypto unlock.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async requestId => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await cancelCryptoUnlock(requestId);
      await load();
      await onWalletChanged?.();
    } catch (cancelError) {
      setError(cancelError.message || 'Could not cancel this crypto unlock.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="crypto-wallet-panel">
    <div className="crypto-wallet-heading">
      <div>
        <div className="eyebrow">FAV CRYPTO · TESTNET</div>
        <h2>Optional on-chain wallet</h2>
        <p>Only FAV earned from completed services is eligible for the crypto unlock path. Rewards and legacy balances stay inside Favourit.</p>
      </div>
      <span className={`crypto-network-badge ${deploymentVerified ? 'ready' : ''}`}>{BASE_SEPOLIA.name}</span>
    </div>

    {loading ? <div className="crypto-wallet-loading">Loading crypto status…</div> : <>
      <div className="crypto-wallet-stats">
        <div><small>CRYPTO ELIGIBLE</small><strong>{formatFav(eligible)} FAV</strong><span>earned seller balance</span></div>
        <div><small>RESERVED</small><strong>{formatFav(pending)} FAV</strong><span>pending unlocks</span></div>
        <div><small>TESTNET CAP</small><strong>{formatFav(Number(chain?.initial_cap_micro_fav || 10_000_000_000_000))} FAV</strong><span>maximum initial supply</span></div>
      </div>

      <div className="crypto-wallet-grid">
        <div className="crypto-wallet-card">
          <div className="crypto-card-title"><h3>Verified wallet</h3>{wallet && <span>✓ verified</span>}</div>
          {wallet ? <>
            <strong className="crypto-address">{shortAddress(wallet.wallet_address)}</strong>
            <small>{BASE_SEPOLIA.name} · verified {new Date(wallet.verified_at).toLocaleDateString()}</small>
            <div className="crypto-wallet-actions"><button className="secondary" type="button" disabled={busy} onClick={connect}>Verify a different wallet</button><button className="text-button" type="button" disabled={busy || pending > 0} onClick={disconnect}>Disconnect</button></div>
            {pending > 0 && <small>Finish or cancel pending unlocks before changing wallet state.</small>}
          </> : <>
            <p>Connect a testnet EVM wallet and sign a one-time message. The signature proves ownership and does not send a blockchain transaction.</p>
            <button className="secondary full" type="button" disabled={busy} onClick={connect}>{busy ? 'Waiting for wallet…' : 'Connect & verify testnet wallet'}</button>
          </>}
        </div>

        <div className="crypto-wallet-card">
          <div className="crypto-card-title"><h3>Unlock earned FAV</h3><span>{Number(breakdown?.crypto_unlock_fee_bps || 250) / 100}% fee</span></div>
          {!chain?.token_address ? <div className="crypto-notice"><strong>Testnet token deployment pending</strong><span>Wallet verification is ready, but no FAV can move on-chain until the Base Sepolia contract is deployed and recorded.</span></div> : !chain?.deployment_verified_at ? <div className="crypto-notice"><strong>Deployment verification pending</strong><span>The contract address is recorded, but Favourit will not unlock FAV until its supply, roles and chain configuration are independently verified.</span></div> : !chain?.unlock_enabled ? <div className="crypto-notice"><strong>Crypto unlock is disabled</strong><span>The verified testnet token exists, but Favourit has not enabled the unlock queue yet.</span></div> : <>
            <label className="crypto-amount-field"><span>Amount to unlock</span><div><input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0.000000" /><b>FAV</b></div></label>
            {amountMicroFav ? <div className="crypto-quote"><span>Unlock fee <b>{formatFav(quote.fee_fav)} FAV</b></span><span>On-chain amount <b>{formatFav(quote.net_fav)} FAV</b></span></div> : null}
            {amountMicroFav > eligible && <small className="crypto-error">Amount exceeds your eligible earned FAV.</small>}
            <button className="primary full" type="button" disabled={!canUnlock} onClick={unlock}>{busy ? 'Queuing…' : 'Queue crypto unlock'}</button>
          </>}
        </div>
      </div>

      <div className="crypto-history">
        <div className="crypto-card-title"><h3>Crypto unlock history</h3><span>{unlocks.length} recent</span></div>
        {unlocks.length ? <div className="crypto-history-list">{unlocks.map(item => <article key={item.id}>
          <div><strong>{formatFav(Number(item.net_fav || 0))} FAV</strong><small>to {shortAddress(item.destination_address)}</small></div>
          <div><span className={`crypto-status status-${item.status}`}>{STATUS_COPY[item.status] || item.status}</span><small>{new Date(item.created_at).toLocaleString()}</small></div>
          <div className="crypto-history-actions"><TxLink hash={item.tx_hash} />{item.status === 'pending' && <button type="button" disabled={busy} onClick={() => cancel(item.id)}>Cancel</button>}</div>
        </article>)}</div> : <p className="crypto-empty">No crypto unlock requests yet.</p>}
      </div>
    </>}

    {error && <div className="crypto-panel-error" role="alert">{error}</div>}
    <small className="crypto-security-note">Base Sepolia testnet only. Never share a seed phrase or private key with Favourit. Wallet linking uses a signature only.</small>
  </section>;
}
