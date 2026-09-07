import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatFav, getMyFavBalanceBreakdown } from '../lib/wallet';
import { favDecimal, microFavInteger } from '../lib/favAmounts';
import { readUnlockAttempt, saveUnlockAttempt, clearUnlockAttempt, isDefiniteRpcRejection } from '../lib/cryptoRecovery';
import {
  BASE_SEPOLIA,
  calculateCryptoUnlockQuote,
  cancelCryptoUnlock,
  connectAndVerifyCryptoWallet,
  disconnectCryptoWallet,
  getCryptoChainStatus,
  getMyCryptoUnlocks,
  getMyCryptoWallet,
  getMyCryptoEligibility,
  acceptCryptoConsent,
  getCryptoUnlockByClientId,
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

function formatMaturity(hours) {
  const value = Number(hours);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value % 24 === 0) return `${value / 24} day${value === 24 ? '' : 's'}`;
  return `${value} hour${value === 1 ? '' : 's'}`;
}

export default function CryptoWalletPanel({ onWalletChanged, userId }) {
  const [chain, setChain] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [unlocks, setUnlocks] = useState([]);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [eligibility, setEligibility] = useState(null);
  const loadVersion = useRef(0);
  const actionLock = useRef(false);
  const mounted = useRef(true);
  const [attempt, setAttempt] = useState(null);
  const [consent, setConsent] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const [nextChain, nextWallet, nextBreakdown, nextUnlocks, nextEligibility] = await Promise.all([
        getCryptoChainStatus(userId),
        getMyCryptoWallet(BASE_SEPOLIA.chainId, userId),
        getMyFavBalanceBreakdown(userId),
        getMyCryptoUnlocks(50, userId),
        getMyCryptoEligibility(userId),
      ]);
      let saved = readUnlockAttempt(window.localStorage, userId);
      if (saved) {
        const recorded = await getCryptoUnlockByClientId(saved.id, userId);
        if (version !== loadVersion.current) return;
        if (recorded) {
          clearUnlockAttempt(window.localStorage, userId, saved.id);
          setNotice(`Your earlier request is recorded: ${STATUS_COPY[recorded.status] || recorded.status}. It was not submitted again.`);
          saved = null;
        }
      }
      if (version !== loadVersion.current) return;
      setAttempt(saved);
      if (saved) setAmount(favDecimal(saved.amount));
      setEligibility(nextEligibility);
      setChain(nextChain);
      setWallet(nextWallet);
      setBreakdown(nextBreakdown);
      setUnlocks(nextUnlocks);
      setError('');
    } catch (loadError) {
      if (version !== loadVersion.current) return;
      setChain(null); setWallet(null); setBreakdown(null); setEligibility(null); setUnlocks([]);
      setError(loadError.message || 'Could not load crypto wallet status.');
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; loadVersion.current += 1; }; }, [load]);

  const amountMicroFav = useMemo(() => parseFavInput(amount), [amount]);
  const quote = useMemo(
    () => calculateCryptoUnlockQuote(amountMicroFav, breakdown?.crypto_unlock_fee_bps),
    [amountMicroFav, breakdown?.crypto_unlock_fee_bps],
  );
  const eligible = breakdown?.crypto_eligible_fav ?? null;
  const maturing = breakdown?.crypto_maturing_fav ?? null;
  const pending = breakdown?.pending_crypto_unlock_fav ?? null;
  const maturityLabel = formatMaturity(breakdown?.crypto_unlock_maturity_hours);
  const nextEligibleAt = breakdown?.next_crypto_eligible_at ? new Date(breakdown.next_crypto_eligible_at) : null;
  const deploymentVerified = Boolean(chain?.chain_id === BASE_SEPOLIA.chainId && chain?.token_address && chain?.minter_address && chain?.deployment_verified_at);
  const knownAmounts = eligible != null && maturing != null && pending != null;
  const feeKnown = Number.isInteger(breakdown?.crypto_unlock_fee_bps) && breakdown.crypto_unlock_fee_bps >= 0 && breakdown.crypto_unlock_fee_bps <= 10000;
  const canUnlock = Boolean(
    !attempt && knownAmounts && feeKnown &&
    eligibility?.crypto_eligible === true &&
    Boolean(maturityLabel) &&
    !loading &&
    deploymentVerified &&
    chain?.unlock_enabled === true &&
    wallet?.is_active === true &&
    amountMicroFav &&
    quote.net_fav > 0 &&
    microFavInteger(amountMicroFav) <= microFavInteger(eligible) &&
    !busy
  );

  const act = async operation => {
    if (!mounted.current || actionLock.current || loading) return;
    actionLock.current = true;
    setBusy(true); setError('');
    const version = loadVersion.current;
    try { await operation(() => mounted.current && version === loadVersion.current); }
    catch (err) { if (version === loadVersion.current) setError(err.message || 'Crypto action failed.'); }
    finally { actionLock.current = false; if (mounted.current) setBusy(false); }
  };
  const connect = () => act(async current => {
    if (attempt || eligibility?.crypto_eligible !== true) return;
    await connectAndVerifyCryptoWallet(null, userId);
    if (current()) await load();
  });
  const disconnect = () => act(async current => {
    if (attempt || !wallet || !knownAmounts || microFavInteger(pending) > 0) return;
    await disconnectCryptoWallet(BASE_SEPOLIA.chainId, userId);
    if (current()) await load();
  });
  const unlock = retry => act(async current => {
    if (!retry && !canUnlock) return;
    let request = attempt;
    if (retry) {
      if (!request) return;
      const recorded = await getCryptoUnlockByClientId(request.id, userId);
      if (!current()) return;
      if (recorded) {
        clearUnlockAttempt(window.localStorage, userId, request.id);
        setAttempt(null); setNotice(`Request already recorded: ${STATUS_COPY[recorded.status] || recorded.status}.`);
        await load(); return;
      }
      if (wallet?.wallet_address?.toLowerCase() !== request.address.toLowerCase()) throw new Error('The linked wallet changed. Contact support to reconcile this saved request before continuing.');
    } else {
      const id = window.crypto?.randomUUID?.();
      if (!id) throw new Error('This browser cannot generate a secure request id.');
      request = saveUnlockAttempt(window.localStorage, { id, userId, address: wallet.wallet_address, amount: String(amountMicroFav), chainId: BASE_SEPOLIA.chainId });
      setAttempt(request);
    }
    try {
      const receipt = await requestCryptoUnlock(Number(request.amount), request.id, userId);
      if (!receipt?.id) throw new Error('The request receipt could not be confirmed. Refresh or retry the saved request.');
      clearUnlockAttempt(window.localStorage, userId, request.id);
      if (!current()) return;
      setAttempt(null); setAmount(''); setNotice(`Request recorded: ${STATUS_COPY[receipt.status] || receipt.status}.`);
    } catch (err) {
      if (isDefiniteRpcRejection(err)) {
        clearUnlockAttempt(window.localStorage, userId, request.id);
        if (current()) setAttempt(null);
      }
      throw err;
    }
    if (current()) { await load(); if (mounted.current) await onWalletChanged?.(); }
  });
  const cancel = requestId => act(async current => {
    await cancelCryptoUnlock(requestId, userId);
    if (current()) { await load(); if (mounted.current) await onWalletChanged?.(); }
  });
  const saveConsent = () => act(async current => {
    if (!consent || eligibility?.is_adult !== true) return;
    await acceptCryptoConsent(userId);
    if (current()) { setConsent(false); await load(); }
  });

  return <section className="crypto-wallet-panel">
    <div className="crypto-wallet-heading">
      <div>
        <div className="eyebrow">FAV CRYPTO · TESTNET</div>
        <h2>Optional on-chain wallet</h2>
        <p>Only matured FAV earned from completed services is eligible for the crypto unlock path. Rewards and legacy balances stay inside Favourit.</p>
      </div>
      <span className={`crypto-network-badge ${deploymentVerified ? 'ready' : ''}`}>{BASE_SEPOLIA.name}</span>
    </div>

    <button className="secondary" type="button" onClick={load} disabled={busy || loading}>Refresh crypto status</button>
    {notice && <div className="crypto-notice" role="status">{notice}</div>}
    {attempt && <div className="crypto-notice" role="status"><strong>A previous request still needs confirmation</strong><span>Reference: {attempt.id}. New requests are blocked. Retrying uses the same saved ID, including after a reload.</span><button className="secondary" type="button" disabled={busy || loading} onClick={() => unlock(true)}>Check / retry saved request</button></div>}
    {loading ? <div className="crypto-wallet-loading">Loading crypto status…</div> : !breakdown || !chain || !eligibility ? <button className="secondary" type="button" onClick={load}>Retry crypto status</button> : <>
      {!eligibility.crypto_eligible && <div className="crypto-notice"><strong>Crypto access is not enabled for this account</strong><span>Server-verified adult status, identity checks and crypto consent are required. Connecting a wallet alone does not establish eligibility. Identity verification onboarding has not been enabled in this build. Your FAV remains available inside Favourit.</span></div>}
      {eligibility.crypto_consent_required && eligibility.is_adult && <div className="crypto-wallet-card"><h3>Optional crypto consent</h3><p>Base Sepolia is a test network. Only matured service earnings can be eligible. Fees are shown before a request; FAV has no guaranteed cash redemption. Never share wallet recovery phrases or private keys. Consent does not verify identity or enable a deployment.</p><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I have read and understand this crypto notice.</label><button className="secondary" type="button" disabled={!consent || busy} onClick={saveConsent}>Record my crypto consent</button></div>}
      {!eligibility.is_adult && <p className="crypto-security-note">Crypto requires verified age 18+. Your internal marketplace wallet is separate.</p>}
      <div className="crypto-wallet-stats">
        <div><small>MATURED EARNINGS</small><strong>{formatFav(eligible)} FAV</strong><span>subject to account and launch checks</span></div>
        <div><small>MATURING</small><strong>{formatFav(maturing)} FAV</strong><span>{maturityLabel ? `${maturityLabel} safety window` : 'policy not configured'}</span></div>
        <div><small>RESERVED</small><strong>{formatFav(pending)} FAV</strong><span>pending unlocks</span></div>
        <div><small>TESTNET CAP</small><strong>{formatFav(chain?.initial_cap_micro_fav)} FAV</strong><span>configured maximum, not circulating supply</span></div>
      </div>
      {nextEligibleAt && Number.isFinite(nextEligibleAt.getTime()) && <div className="crypto-notice"><strong>Next earned FAV maturity</strong><span>{nextEligibleAt.toLocaleString()}</span></div>}

      <div className="crypto-wallet-grid">
        <div className="crypto-wallet-card">
          <div className="crypto-card-title"><h3>Verified wallet</h3>{wallet && <span>✓ verified</span>}</div>
          {wallet ? <>
            <strong className="crypto-address">{shortAddress(wallet.wallet_address)}</strong>
            <small>{BASE_SEPOLIA.name} · verified {new Date(wallet.verified_at).toLocaleDateString()}</small>
            <div className="crypto-wallet-actions"><button className="secondary" type="button" disabled={busy || Boolean(attempt) || !eligibility?.crypto_eligible} onClick={connect}>Verify a different wallet</button><button className="text-button" type="button" disabled={busy || Boolean(attempt) || !knownAmounts || pending > 0} onClick={disconnect}>Disconnect</button></div>
            {pending > 0 && <small>Finish or cancel pending unlocks before changing wallet state.</small>}
          </> : <>
            <p>Connect a testnet EVM wallet and sign a one-time message. The signature proves ownership and does not send a blockchain transaction.</p>
            <button className="secondary full" type="button" disabled={busy || Boolean(attempt) || !eligibility?.crypto_eligible} onClick={connect}>{busy ? 'Waiting for wallet…' : 'Connect & verify testnet wallet'}</button>
          </>}
        </div>

        <div className="crypto-wallet-card">
          <div className="crypto-card-title"><h3>Unlock earned FAV</h3><span>{feeKnown ? `${breakdown.crypto_unlock_fee_bps / 100}% fee` : 'Fee unavailable'}</span></div>
          {!chain?.token_address ? <div className="crypto-notice"><strong>Testnet token deployment pending</strong><span>No FAV can move on-chain until the Base Sepolia contract is deployed and recorded.</span></div> : !deploymentVerified ? <div className="crypto-notice"><strong>Deployment verification pending</strong><span>The contract address is recorded, but Favourit will not unlock FAV until its supply, minter, roles and Base Sepolia configuration are independently verified.</span></div> : !maturityLabel ? <div className="crypto-notice"><strong>Seller maturity policy pending</strong><span>Favourit will not enable crypto unlocks until the seller-earnings safety window is explicitly configured.</span></div> : !chain?.unlock_enabled ? <div className="crypto-notice"><strong>Crypto unlock is disabled</strong><span>The verified testnet token exists, but Favourit has not enabled the unlock queue yet.</span></div> : <>
            <label className="crypto-amount-field"><span>Amount to unlock</span><div><input aria-label="Amount to unlock" disabled={busy || Boolean(attempt)} value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0.000000" /><b>FAV</b></div></label>
            {amountMicroFav && feeKnown ? <div className="crypto-quote"><span>Unlock fee <b>{formatFav(quote.fee_fav)} FAV</b></span><span>On-chain amount <b>{formatFav(quote.net_fav)} FAV</b></span></div> : null}
            {amountMicroFav > eligible && <small className="crypto-error">Amount exceeds your matured, crypto-eligible FAV.</small>}
            <button className="primary full" type="button" disabled={!canUnlock} onClick={() => unlock(false)}>{busy ? 'Queuing…' : 'Queue crypto unlock'}</button>
          </>}
        </div>
      </div>

      <div className="crypto-history">
        <div className="crypto-card-title"><h3>Crypto unlock history</h3><span>{unlocks.length} recent</span></div>
        {unlocks.length ? <div className="crypto-history-list">{unlocks.map(item => <article key={item.id}>
          <div><strong>{formatFav(item.net_fav)} FAV</strong><small>to {shortAddress(item.destination_address)}</small></div>
          <div><span className={`crypto-status status-${item.status}`}>{STATUS_COPY[item.status] || item.status}</span><small>{new Date(item.created_at).toLocaleString()}</small></div>
          <div className="crypto-history-actions"><TxLink hash={item.tx_hash} />{item.status === 'pending' && <button type="button" disabled={busy} onClick={() => cancel(item.id)}>Cancel</button>}</div>
        </article>)}</div> : <p className="crypto-empty">No crypto unlock requests yet.</p>}
      </div>
    </>}

    {error && <div className="crypto-panel-error" role="alert">{error}</div>}
    <small className="crypto-security-note">Base Sepolia testnet only. Never share a seed phrase or private key with Favourit. Wallet linking uses a signature only.</small>
  </section>;
}
