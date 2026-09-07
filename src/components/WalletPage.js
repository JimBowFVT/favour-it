import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatMicroFav } from '../lib/favAmounts';
import { createWalletApi, validateWalletFilters, walletStatementCsv, WALLET_TYPES, WALLET_STATUSES } from '../lib/walletActivity';
import CryptoWalletPanel from './CryptoWalletPanel';
import DailyRewardCard from './DailyRewardCard';
import './WalletPage.css';

const EMPTY_FILTERS = { type: 'all', status: 'all', search: '', from: '', to: '' };
const humanize = value => String(value || '').replace(/_/g, ' ');
function timestamp(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not available';
}
function Amount({ value }) { return <span className="wallet-amount" dir="ltr">{formatMicroFav(value)}{value != null ? ' FAV' : ''}</span>; }

export default function WalletPage({ userId, onBalance, onOpenOrder, onExplore }) {
  const api = useMemo(() => createWalletApi(supabase, userId), [userId]);
  const [overview, setOverview] = useState(null);
  const [page, setPage] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [detail, setDetail] = useState(null);
  const [support, setSupport] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [cryptoOpen, setCryptoOpen] = useState(false);
  const revision = useRef(0);
  const actionLock = useRef(false);
  const detailsHeading = useRef(null);

  const refresh = useCallback(async () => {
    const version = ++revision.current;
    actionLock.current = false;
    setBusy(''); setLoading(true); setError(''); setNotice('');
    setOverview(null); setPage(null); setDetail(null); setSupport('');
    try {
      const [nextOverview, nextPage] = await Promise.all([api.overview(), api.activity(filters)]);
      if (version !== revision.current) return;
      if (!Array.isArray(nextPage.items) || !nextPage.cutoff) throw new Error('The server returned an invalid activity page.');
      setOverview(nextOverview); setPage(nextPage);
      if (nextOverview.wallet) onBalance?.(nextOverview.wallet.available_fav);
    } catch (err) {
      if (version === revision.current) setError(err.message || 'Could not load your wallet.');
    } finally {
      if (version === revision.current) setLoading(false);
    }
  }, [api, filters, onBalance]);

  useEffect(() => {
    refresh();
    return () => { revision.current += 1; };
  }, [refresh]);
  useEffect(() => {
    if (!supabase) return undefined;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (session?.user?.id && session.user.id !== userId)) {
        revision.current += 1;
        setOverview(null); setPage(null); setDetail(null); setBlocked(true); setCryptoOpen(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [userId]);
  useEffect(() => { if (detail) detailsHeading.current?.focus(); }, [detail]);

  const action = async (name, task) => {
    if (actionLock.current || blocked || loading) return;
    actionLock.current = true;
    const version = revision.current;
    setBusy(name); setError(''); setNotice('');
    try { await task(() => version === revision.current); }
    catch (err) { if (version === revision.current) setError(err.message || 'The wallet action failed.'); }
    finally { if (version === revision.current) { actionLock.current = false; setBusy(''); } }
  };
  const loadMore = () => action('more', async current => {
    const next = await api.activity(filters, page.next_cursor, page.cutoff);
    if (!current()) return;
    if (!Array.isArray(next.items) || next.cutoff !== page.cutoff) throw new Error('Activity changed. Refresh your wallet.');
    const knownIds = new Set(page.items.map(item => item.id));
    setPage({ ...next, items: [...page.items, ...next.items.filter(item => !knownIds.has(item.id))] });
  });
  const openDetail = id => action('detail', async current => {
    const transaction = await api.transaction(id);
    if (current()) { setDetail(transaction); setSupport(''); }
  });
  const submitSupport = event => {
    event.preventDefault();
    action('support', async current => {
      await api.support(detail.id, support);
      if (current()) { setSupport(''); setNotice('Your support request was received. No balance or order was changed.'); }
    });
  };
  const download = format => action('export', async current => {
    const statement = await api.statement(filters);
    if (!current()) return;
    const csv = format === 'csv';
    const blob = new Blob([csv ? walletStatementCsv(statement) : JSON.stringify(statement, null, 2)], { type: csv ? 'text/csv;charset=utf-8' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `favourit-wallet-${statement.cutoff.slice(0, 10)}.${format}`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Downloaded ${statement.row_count} transactions from one server snapshot. JSON also includes reconciled balances; unavailable balances remain null.`);
  });
  const applyFilters = event => {
    event.preventDefault();
    try { setFilters(validateWalletFilters(draft)); }
    catch (err) { setError(err.message); }
  };

  if (blocked) return <section className="page-section wallet-page"><h1>Wallet closed</h1><p>Your signed-in account changed. Open Wallet again from your current account.</p></section>;

  return <section className="page-section wallet-page" aria-labelledby="wallet-title">
    <header className="wallet-heading">
      <div><div className="eyebrow">YOUR FAVOURIT WALLET</div><h1 id="wallet-title">Know where your <span>FAV goes.</span></h1><p>Marketplace balance, protected payments and your recorded activity. FAV amounts are not a cash exchange rate.</p></div>
      <button className="secondary" type="button" onClick={refresh} disabled={loading || Boolean(busy)}>{loading ? 'Refreshing…' : 'Refresh wallet'}</button>
    </header>
    {error && <div className="wallet-message wallet-error" role="alert">{error}</div>}
    {notice && <div className="wallet-message" role="status">{notice}</div>}
    {loading && <p role="status">Loading your wallet from the server…</p>}
    {overview && !overview.wallet && <div className="wallet-message" role="alert"><h2>Your wallet is unavailable</h2><p>No balance has been assumed or created. Contact support to reconcile your account before transacting.</p></div>}
    {overview?.wallet && <>
      <div className="wallet-summary">
        <article className="wallet-stat wallet-stat-primary"><h2>Available to spend</h2><strong><Amount value={overview.wallet.available_fav} /></strong><p>Usable inside the Favourit marketplace.</p><button className="text-button" type="button" onClick={onExplore}>Find a service →</button></article>
        <article className="wallet-stat"><h2>Held in escrow</h2><strong><Amount value={overview.wallet.held_fav} /></strong><p>Reserved for protected orders, not available to spend again.</p></article>
        <article className="wallet-stat"><h2>Earned balance</h2><strong><Amount value={overview.sources?.earned_fav} /></strong><p>Remaining service earnings. Maturity and account checks apply to the separate crypto path.</p></article>
      </div>
      <div className="wallet-sources"><span>Reward balance <Amount value={overview.sources?.reward_fav} /></span><span>Purchased balance <Amount value={overview.sources?.purchased_fav} /></span><span>Legacy balance <Amount value={overview.sources?.legacy_fav} /></span></div>
      <p className="wallet-caption">These sources are parts of your available balance, not extra funds. Updated {timestamp(overview.wallet.updated_at)}.</p>
      {overview.held_orders?.length > 0 && <section className="wallet-card"><h2>Payments protected in escrow</h2>{overview.held_orders.map(order => <button className="wallet-order" type="button" key={order.order_id} onClick={() => onOpenOrder(order.order_id)}><span><strong>{order.title}</strong><small>{humanize(order.status)}</small></span><Amount value={order.amount_fav} /><span aria-hidden="true">→</span></button>)}</section>}
    </>}

    {overview?.wallet && <DailyRewardCard key={userId} userId={userId} onClaimed={refresh} />}
    <section className="wallet-card" aria-labelledby="wallet-activity-title">
      <h2 id="wallet-activity-title">Wallet activity</h2>
      <form className="wallet-filters" onSubmit={applyFilters}>
        <label>Search<input value={draft.search} maxLength={200} onChange={e => setDraft({ ...draft, search: e.target.value })} placeholder="Description or reference" /></label>
        <label>Type<select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>{WALLET_TYPES.map(value => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
        <label>Status<select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>{WALLET_STATUSES.map(value => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
        <label>From (UTC)<input type="date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label>
        <label>To (UTC)<input type="date" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label>
        <button className="secondary" type="submit" disabled={Boolean(busy)}>Apply filters</button>
      </form>
      {page && !loading && <>
        <div className="wallet-export"><span>Snapshot: {timestamp(page.cutoff)}</span><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => download('csv')}>Export CSV</button><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => download('json')}>Export JSON</button></div>
        {!page.items.length ? <p className="wallet-empty">No recorded transactions match these filters.</p> : <div className="wallet-activity-list">{page.items.map(item => <button type="button" className="wallet-activity-row" key={item.id} onClick={() => openDetail(item.id)} disabled={Boolean(busy)}>
          <span><strong>{item.label || humanize(item.entry_type)}</strong><small>{item.description}</small><small>{timestamp(item.created_at)} · posted{item.order_status ? ` · order ${humanize(item.order_status)}` : ''}</small></span>
          <span><Amount value={item.amount_fav} /><small>Available balance change</small>{item.held_change_fav != null && item.held_change_fav !== '0' && <small>Escrow change: <Amount value={item.held_change_fav} /></small>}</span><span aria-hidden="true">→</span>
        </button>)}</div>}
        {page.next_cursor && <button type="button" className="secondary" disabled={Boolean(busy)} onClick={loadMore}>{busy === 'more' ? 'Loading…' : 'Load more transactions'}</button>}
      </>}
    </section>

    {detail && <section className="wallet-card wallet-detail" aria-labelledby="wallet-detail-title">
      <div className="wallet-export"><h2 id="wallet-detail-title" ref={detailsHeading} tabIndex={-1}>Transaction details</h2><button className="text-button" type="button" onClick={() => setDetail(null)} disabled={Boolean(busy)}>Close details</button></div>
      <p>{detail.description}</p><dl><dt>Reference</dt><dd>{detail.id}</dd><dt>Posted</dt><dd>{timestamp(detail.created_at)}</dd><dt>Available balance change</dt><dd><Amount value={detail.amount_fav} /></dd><dt>Escrow change</dt><dd><Amount value={detail.held_change_fav} /></dd>{[['Service price', detail.service_amount_fav], ['Buyer fee', detail.buyer_fee_fav], ['Seller fee', detail.seller_fee_fav]].map(([label, amount]) => amount == null ? null : <div className="wallet-detail-line" key={label}><dt>{label}</dt><dd><Amount value={amount} /></dd></div>)}</dl>
      {detail.order_id && <button className="secondary" type="button" onClick={() => onOpenOrder(detail.order_id)}>Open related order</button>}
      <form className="wallet-support" onSubmit={submitSupport}><label htmlFor="wallet-support-details">Report a problem with this transaction</label><textarea id="wallet-support-details" minLength={10} maxLength={3600} required value={support} onChange={e => setSupport(e.target.value)} placeholder="Describe the issue. Do not include passwords, private keys or recovery phrases." /><button type="submit" className="secondary" disabled={Boolean(busy) || support.trim().length < 10}>{busy === 'support' ? 'Sending…' : 'Send to support'}</button><small>This requests a review. It does not issue a refund or change your balance.</small></form>
    </section>}

    <details className="wallet-card wallet-crypto-details" onToggle={event => setCryptoOpen(event.currentTarget.open)}><summary>FAV coins & optional testnet wallet</summary><p>Your internal FAV balance and an external blockchain wallet are separate. A testnet token is not cash, and no sale or redemption is guaranteed.</p>{cryptoOpen && <CryptoWalletPanel key={userId} onWalletChanged={refresh} />}</details>
  </section>;
}
