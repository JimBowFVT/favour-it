import { useCallback, useEffect, useState } from 'react';
import './App.css';
import './Prototype.css';
import './components/OrdersMvp.css';
import './components/DealCheckoutBrief.css';
import { deals as seedDeals } from './data/deals';
import { statusLabels } from './data/orders';
import { getMyWallet, formatFav } from './lib/wallet';
import { createOrderAndHoldFav, getMyOrders, releaseOrder, refundOrder } from './lib/orders';
import { startOrder, deliverOrder } from './lib/sellerOrders';
import { createReview } from './lib/reviews';
import { getEconomyConfig } from './lib/economy';
import { getPublishedDeals, getMyDeals, getDealById, createDeal as createDealRemote, updateDeal as updateDealRemote, setDealStatus } from './lib/deals';
import { getMyFavoriteDealIds, setFavorite } from './lib/favorites';
import { signOut } from './lib/auth';
import FavouritLoader from './components/FavouritLoader';
import Community from './components/Community';
import PremiumPage from './components/PremiumPage';
import ExploreDealsPage from './components/ExploreDealsPage';
import DealDetailPage from './components/DealDetailPage';
import CreateDealPage from './components/CreateDealPage';
import ManageDealsPage from './components/ManageDealsPage';
import WalletPage from './components/WalletPage';
import AppSidebar from './components/AppSidebar';


const DEFAULT_ECONOMY = { buyer_marketplace_fee_bps: 300, seller_marketplace_fee_bps: 300, crypto_unlock_fee_bps: 250 };
const ACTIVE_ORDER_STATUSES = new Set(['funded', 'in_progress', 'delivered', 'disputed']);

function Logo() {
  return <div className="logo"><span>Favour</span><i>it</i></div>;
}

function Avatar({ initials, large = false }) {
  return <div className={large ? 'avatar avatar-lg' : 'avatar'}>{initials || 'FV'}</div>;
}

function initialsFor(name = 'Favourit seller') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'FV';
}

function Orders({ orders, onOpen, fav, viewerId }) {
  const [mode, setMode] = useState('buying');
  const purchases = orders.filter(order => order.buyerId === viewerId);
  const sales = orders.filter(order => order.sellerId === viewerId);
  const activeMode = mode === 'buying' && !purchases.length && sales.length ? 'selling' : mode;
  const visibleOrders = activeMode === 'selling' ? sales : purchases;
  const activeCount = visibleOrders.filter(order => ACTIVE_ORDER_STATUSES.has(order.status)).length;
  const awaitingAction = visibleOrders.filter(order => activeMode === 'selling'
    ? ['funded', 'in_progress'].includes(order.status)
    : order.status === 'delivered').length;
  const completedCount = visibleOrders.filter(order => order.status === 'completed').length;

  return <section className="page-section">
    <div className="page-title orders-workspace-head">
      <div>
        <div className="eyebrow">MARKETPLACE ORDERS</div>
        <h1>Your work, <span>protected.</span></h1>
        <p>Buyers and sellers share one order timeline, while FAV stays protected until delivery is accepted.</p>
      </div>
      <div className="wallet-mini"><small>AVAILABLE</small><strong>{formatFav(fav)} FAV</strong></div>
    </div>

    <div className="order-mode-tabs" role="tablist" aria-label="Order role">
      <button type="button" className={activeMode === 'buying' ? 'active' : ''} onClick={() => setMode('buying')}>Buying <b>{purchases.length}</b></button>
      <button type="button" className={activeMode === 'selling' ? 'active' : ''} onClick={() => setMode('selling')}>Selling <b>{sales.length}</b></button>
    </div>

    <div className="order-summary-grid">
      <div><small>ACTIVE</small><strong>{activeCount}</strong><span>orders still moving</span></div>
      <div><small>NEEDS YOUR ACTION</small><strong>{awaitingAction}</strong><span>{activeMode === 'selling' ? 'start or deliver work' : 'review delivered work'}</span></div>
      <div><small>COMPLETED</small><strong>{completedCount}</strong><span>successfully closed</span></div>
    </div>

    {visibleOrders.length ? <div className="orders-list">{visibleOrders.map(order => {
      const selling = activeMode === 'selling';
      const counterpart = selling ? order.buyer : order.seller;
      const amount = selling ? order.sellerPayout : order.buyerTotal;
      return <button className="order-row" key={order.id} onClick={() => onOpen(order)}>
        <div className="order-id">{String(order.id).slice(0, 8)}</div>
        <div className="order-info"><strong>{order.title}</strong><span>{selling ? 'Buyer' : 'Seller'}: {counterpart} · {order.packageTitle || order.category}</span></div>
        <div className="order-amount"><strong>{formatFav(Math.round(amount * 1000000))} FAV</strong><small>{selling ? 'seller proceeds after fee' : `includes ${formatFav(Math.round(order.buyerFee * 1000000))} FAV buyer fee`}</small></div>
        <span className={`status status-${order.status}`}>{statusLabels[order.status] || order.status}</span>
        <span className="order-arrow">→</span>
      </button>;
    })}</div> : <div className="empty-state"><h2>{activeMode === 'selling' ? 'No sales yet.' : 'No purchases yet.'}</h2><p>{activeMode === 'selling' ? 'When someone buys one of your deals, the order will appear here.' : 'Explore the marketplace and fund your first protected FAV order.'}</p></div>}

    <div className="orders-info">
      <div><b>1</b><span>Buyer funds the service and marketplace fee into protected escrow</span></div>
      <div><b>2</b><span>Seller starts work and marks the agreed package as delivered</span></div>
      <div><b>3</b><span>Buyer approves delivery, FAV releases, then can leave a review</span></div>
    </div>
  </section>;
}

function OrderDetail({ order, viewerId, onBack, onRelease, onRefund, onStart, onDeliver, onReview, busy }) {
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const isBuyer = order.buyerId === viewerId;
  const isSeller = order.sellerId === viewerId;
  const counterparty = isSeller ? order.buyer : order.seller;
  const counterpartyUsername = isSeller ? order.buyerUsername : order.sellerUsername;
  const counterpartyLabel = isSeller ? 'Buyer' : 'Seller';
  const canRefund = isBuyer && ['funded', 'in_progress', 'delivered'].includes(order.status);
  const canRelease = isBuyer && order.status === 'delivered';
  const canStart = isSeller && order.status === 'funded';
  const canDeliver = isSeller && order.status === 'in_progress';
  const headlineAmount = isSeller ? order.sellerPayout : order.buyerTotal;
  const messageCounterparty = () => {
    if (!counterpartyUsername) return;
    window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username: counterpartyUsername } }));
  };

  return <section className="page-section">
    <button className="back-button" onClick={onBack}>← Back to Orders</button>
    <div className="order-detail">
      <div className="detail-description">
        <div className="eyebrow">ORDER {String(order.id).slice(0, 8)} · {isSeller ? 'SELLING' : 'BUYING'}</div>
        <h1>{order.title}</h1>
        <div className="seller detail-seller order-counterparty">
          <Avatar initials={initialsFor(counterparty)} large />
          <div><strong>{counterparty}</strong><small>{counterpartyLabel} · {order.category || 'Favourit service'} · {order.packageTitle || 'Service package'}</small></div>
        </div>

        {order.packageDescription && <p>{order.packageDescription}</p>}
        <div className="detail-stats">
          <span>Package: {order.packageTitle || order.packageTier}</span>
          {order.packageDeliveryDays && <span>⌁ {order.packageDeliveryDays} day{order.packageDeliveryDays === 1 ? '' : 's'}</span>}
          <span>↻ {order.packageRevisions ?? 0} revisions</span>
        </div>

        {order.buyerRequirements && <div className="order-scope-card"><h3>Seller requested before checkout</h3><p>{order.buyerRequirements}</p></div>}
        {order.buyerBrief && <div className="order-scope-card"><h3>Buyer brief submitted at checkout</h3><p>{order.buyerBrief}</p></div>}
        {order.dealDescription && <div className="order-scope-card"><h3>Original deal scope</h3><p>{order.dealDescription}</p></div>}

        <div className="timeline">
          <div className="timeline-item done"><b>Payment secured</b><span>Service price and buyer fee are held in escrow</span></div>
          <div className={`timeline-item ${['in_progress', 'delivered', 'completed'].includes(order.status) ? 'done' : ''}`}><b>Work in progress</b><span>Seller has started the selected package</span></div>
          <div className={`timeline-item ${['delivered', 'completed'].includes(order.status) ? 'done' : ''}`}><b>Delivery</b><span>Seller marks the package ready after sending the agreed work</span></div>
          <div className={`timeline-item ${order.status === 'completed' ? 'done' : ''}`}><b>Completed</b><span>Buyer approves and FAV is released to the seller</span></div>
        </div>
      </div>

      <aside className="buy-card order-side">
        <div className="eyebrow">ORDER STATUS</div>
        <span className={`status status-${order.status}`}>{statusLabels[order.status] || order.status}</span>
        <h2>{formatFav(Math.round(headlineAmount * 1000000))} <em>FAV</em></h2>

        <div className="order-breakdown">
          <span>{order.packageTitle || 'Service'} <b>{formatFav(Math.round(order.amount * 1000000))} FAV</b></span>
          {isSeller ? <>
            <span>Seller marketplace fee <b>-{formatFav(Math.round(order.sellerFee * 1000000))} FAV</b></span>
            <span>You receive <b>{formatFav(Math.round(order.sellerPayout * 1000000))} FAV</b></span>
          </> : <>
            <span>Buyer marketplace fee <b>{formatFav(Math.round(order.buyerFee * 1000000))} FAV</b></span>
            <span>Total secured <b>{formatFav(Math.round(order.buyerTotal * 1000000))} FAV</b></span>
          </>}
        </div>

        {counterpartyUsername && <button className="secondary full" type="button" onClick={messageCounterparty}>Message {counterpartyLabel.toLowerCase()}</button>}
        {canStart && <><div className="order-action-note">Payment is secured. Review the buyer's captured brief, then start the order when you are ready.</div><button className="primary full" disabled={busy} onClick={onStart}>{busy ? 'Updating…' : 'Start work →'}</button></>}
        {canDeliver && <><div className="order-action-note">Send the finished files, links or session outcome through Messages, then mark the package delivered for buyer review.</div><button className="primary full" disabled={busy} onClick={onDeliver}>{busy ? 'Updating…' : 'Mark as delivered →'}</button></>}
        {isSeller && order.status === 'delivered' && <div className="order-action-note">Delivery is waiting for buyer approval. Escrow remains protected until they release it or open a dispute.</div>}
        {isSeller && order.status === 'completed' && <div className="order-action-note">Order completed. Your seller proceeds have been released to your FAV balance.</div>}

        {canRelease && <button className="primary full" disabled={busy} onClick={onRelease}>{busy ? 'Processing…' : 'Approve & release FAV'}</button>}
        {isBuyer && ['funded', 'in_progress'].includes(order.status) && <div className="order-action-note">The seller has not marked delivery ready yet. Release becomes available after delivery.</div>}
        {canRefund && <button className="secondary full danger-soft" disabled={busy} onClick={onRefund}>Open refund dispute</button>}
        {order.status === 'disputed' && <div className="order-action-note">This order is in dispute review. Escrow stays locked until the dispute is resolved.</div>}
        {order.status === 'cancelled' && <div className="order-action-note">This order is closed and can no longer move through the delivery lifecycle.</div>}

        {isBuyer && order.status === 'completed' && <div className="order-review">
          <h3>Review this seller</h3>
          {order.review ? <div className="order-review-existing">
            <strong>{'★'.repeat(Number(order.review.rating || 0))}{'☆'.repeat(Math.max(0, 5 - Number(order.review.rating || 0)))}</strong>
            <span>{order.review.body || 'Rating submitted.'}</span>
          </div> : <>
            <p>Your review appears on the seller's marketplace profile and helps future buyers.</p>
            <div className="order-stars">{[1, 2, 3, 4, 5].map(star => <button key={star} type="button" aria-label={`${star} star${star === 1 ? '' : 's'}`} className={star <= reviewRating ? 'active' : ''} onClick={() => setReviewRating(star)}>★</button>)}</div>
            <textarea value={reviewBody} maxLength="1200" onChange={event => setReviewBody(event.target.value)} placeholder="What was it like working with this seller?" />
            <button className="primary full" disabled={busy} onClick={() => onReview(reviewRating, reviewBody)}>{busy ? 'Submitting…' : 'Submit review'}</button>
          </>}
        </div>}

        <small className="escrow-note">◈ The package, deal scope and checkout brief are snapshotted on the order, so later listing edits cannot change the agreement.</small>
      </aside>
    </div>
  </section>;
}

function Home({ fav, onExplore, onCreate, rewardMessage }) {
  return <section className="page-section home-page">
    <div className="hero">
      <div>
        <div className="eyebrow">WELCOME TO FAVOURIT</div>
        <h1>Your skills are your <span>currency.</span></h1>
        <p>Offer what you know, earn FAV, and use it to access skills from the rest of the community — with every purchase protected by escrow.</p>
        <div className="hero-actions"><button className="primary" onClick={onExplore}>Explore marketplace →</button><button className="secondary" onClick={onCreate}>Offer a service</button></div>
        {rewardMessage && <div className="reward-banner">✦ {rewardMessage}</div>}
      </div>
      <div className="hero-orb"><strong>{formatFav(fav)}</strong><span>FAV AVAILABLE</span></div>
    </div>
    <div className="value-grid">
      <div><b>◈</b><h3>You are secured</h3><p>Payments stay protected in escrow until the order is completed.</p></div>
      <div><b>↔</b><h3>Dealmaking</h3><p>Turn an approved remote professional service into something another member can buy.</p></div>
      <div><b>✦</b><h3>Use our coin</h3><p>FAV moves through the marketplace as purchasing power.</p></div>
    </div>
  </section>;
}

function Profile({ fav, myDeals, orders, onCreate, onOrders, onManageDeals, session, onSignOut, usernameStatus }) {
  const name = session?.user?.user_metadata?.display_name || session?.user?.email?.split('@')[0] || 'Favourit member';
  const userId = session?.user?.id;
  const initials = initialsFor(name);
  const purchases = orders.filter(order => order.buyerId === userId).length;
  const sales = orders.filter(order => order.sellerId === userId).length;
  const publishedDeals = myDeals.filter(deal => deal.status === 'published').length;

  return <section className="page-section">
    <div className="profile-hero">
      <div className="profile-main"><Avatar initials={initials} large /><div><div className="eyebrow">YOUR PROFILE</div><h1>{name}</h1><p className="profile-handle">@{usernameStatus?.username || 'username'}</p><p>Creator · Buyer · Favourit member</p><div className="profile-tags"><span>{session?.user?.email_confirmed_at ? '✓ Email verified' : 'Email not verified'}</span><span>◈ Favourit member</span></div></div></div>
      <button className="secondary" onClick={onSignOut}>Sign out</button>
    </div>
    <div className="profile-stats">
      <div><small>FAV BALANCE</small><strong>{formatFav(fav)}</strong><span>FAV</span></div>
      <div><small>LIVE DEALS</small><strong>{publishedDeals}</strong><span>services</span></div>
      <div><small>PURCHASES</small><strong>{purchases}</strong><span>orders</span></div>
      <div><small>SALES</small><strong>{sales}</strong><span>orders</span></div>
    </div>
    <div className="profile-grid">
      <div className="profile-panel"><div className="panel-heading"><h2>Favourit ID</h2></div><div className="transaction"><span className="tx-icon positive">@</span><div><strong>@{usernameStatus?.username || 'username'}</strong><small>Your public Favourit handle</small></div><b>30 day limit</b></div><p className="panel-copy">Your @ stays with your account. Use the @ control beside Messages to change it when the 30-day window opens.</p></div>
      <div className="profile-panel"><div className="panel-heading"><h2>Wallet</h2></div><div className="transaction"><span className="tx-icon positive">+</span><div><strong>Available FAV</strong><small>Live wallet balance</small></div><b>{formatFav(fav)} FAV</b></div></div>
      <div className="profile-panel"><div className="panel-heading"><h2>Seller workspace</h2></div><p className="panel-copy">Manage listings and sales separately while historical order scopes remain immutable.</p><button className="primary full" onClick={onManageDeals}>Manage my deals →</button><button className="secondary full" onClick={onCreate}>Offer a new service →</button><button className="secondary full" onClick={onOrders}>Open buyer & seller orders →</button></div>
    </div>
  </section>;
}

function App({ initialWallet, session, rewardMessage, usernameStatus }) {
  const [active, setActive] = useState(() => window.location.hash === '#wallet' ? 'Wallet' : 'Home');
  const [query, setQuery] = useState('');
  const [fav, setFav] = useState(initialWallet?.available_fav ?? null);
  const [sidebarOpen, setSidebarOpen] = useState(() => Boolean(window.matchMedia?.('(min-width: 1000px)').matches));
  const updateBalance = useCallback(amount => setFav(amount), []);
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1000px)');
    const update = event => setSidebarOpen(event.matches);
    media?.addEventListener?.('change', update);
    return () => media?.removeEventListener?.('change', update);
  }, []);
  useEffect(() => { if (initialWallet) setFav(initialWallet.available_fav); }, [initialWallet]);
  const [economy, setEconomy] = useState(DEFAULT_ECONOMY);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [editingDeal, setEditingDeal] = useState(null);
  const [toast, setToast] = useState('');
  const [deals, setDeals] = useState(seedDeals);
  const [myDeals, setMyDeals] = useState([]);
  const [orders, setOrders] = useState([]);
  const [favorites, setFavorites] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const notify = message => {
    setToast(message);
    window.clearTimeout(window.__favouritToast);
    window.__favouritToast = window.setTimeout(() => setToast(''), 3200);
  };

  const go = item => {
    setSelectedDeal(null);
    setSelectedOrder(null);
    setEditingDeal(null);
    setActive(item);
    window.history.replaceState(null, '', item === 'Wallet' ? '#wallet' : window.location.pathname + window.location.search);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const refreshWallet = async () => {
    const wallet = await getMyWallet();
    if (wallet) setFav(wallet.available_fav);
    return wallet;
  };

  const refreshOrders = async preferredOrderId => {
    const freshOrders = await getMyOrders();
    setOrders(freshOrders);
    if (preferredOrderId) {
      setSelectedOrder(freshOrders.find(order => String(order.id) === String(preferredOrderId)) || null);
    }
    return freshOrders;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [remoteDeals, sellerDeals, remoteOrders, wallet, favoriteIds, economyConfig] = await Promise.all([
          getPublishedDeals(), getMyDeals(), getMyOrders(), getMyWallet(), getMyFavoriteDealIds(), getEconomyConfig(),
        ]);
        if (cancelled) return;
        if (remoteDeals.length) setDeals(remoteDeals);
        setMyDeals(sellerDeals);
        setOrders(remoteOrders);
        setFav(wallet?.available_fav ?? null);
        setFavorites(new Set([...favoriteIds].map(String)));
        if (economyConfig) setEconomy({ ...DEFAULT_ECONOMY, ...economyConfig });
      } catch (error) {
        if (!cancelled) notify(error.message || 'Could not load your Favourit data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (rewardMessage) notify(rewardMessage); }, [rewardMessage]);

  useEffect(() => {
    const openSharedDeal = async event => {
      const dealId = event.detail?.dealId;
      if (!dealId) return;
      try {
        let deal = deals.find(item => String(item.id) === String(dealId));
        if (!deal) deal = await getDealById(dealId);
        if (!deal) throw new Error('This deal is no longer available.');
        setActive('Explore');
        setSelectedOrder(null);
        setEditingDeal(null);
        setSelectedDeal(deal);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (error) {
        notify(error.message || 'Could not open this deal.');
      }
    };
    window.addEventListener('favourit:open-deal', openSharedDeal);
    return () => window.removeEventListener('favourit:open-deal', openSharedDeal);
  }, [deals]);

  const toggleFavorite = async dealId => {
    const id = String(dealId);
    const next = !favorites.has(id);
    setFavorites(previous => { const updated = new Set(previous); next ? updated.add(id) : updated.delete(id); return updated; });
    try {
      await setFavorite(id, next);
      notify(next ? 'Deal liked.' : 'Like removed from deal.');
    } catch (error) {
      setFavorites(previous => { const updated = new Set(previous); next ? updated.delete(id) : updated.add(id); return updated; });
      notify(error.message || 'Could not update deal like.');
    }
  };

  const buy = async (packageTier = 'basic', buyerBrief = '') => {
    if (!selectedDeal || busy) return;
    setBusy(true);
    try {
      const order = await createOrderAndHoldFav(selectedDeal.id, packageTier, buyerBrief);
      await refreshWallet();
      const freshOrders = await refreshOrders();
      const fresh = freshOrders.find(item => String(item.id) === String(order?.id));
      if (!fresh) throw new Error('Order was funded but could not be loaded.');
      setSelectedDeal(null);
      setSelectedOrder(fresh);
      setActive('Orders');
      notify(`${fresh.packageTitle || 'Package'} funded — ${formatFav(Math.round(fresh.buyerTotal * 1000000))} FAV including the buyer fee moved to escrow.`);
    } catch (error) {
      notify(error.message || 'Could not fund this order.');
    } finally { setBusy(false); }
  };

  const release = async () => {
    if (!selectedOrder || busy) return;
    setBusy(true);
    try {
      const orderId = selectedOrder.id;
      await releaseOrder(orderId);
      await refreshOrders(orderId);
      await refreshWallet();
      notify('Order completed — escrow released to the seller. You can now leave a review.');
    } catch (error) {
      notify(error.message || 'Could not release escrow.');
    } finally { setBusy(false); }
  };

  const refund = async () => {
    if (!selectedOrder || busy) return;
    setBusy(true);
    try {
      const orderId = selectedOrder.id;
      await refundOrder(orderId);
      await refreshOrders(orderId);
      notify('Refund dispute opened — escrow remains protected while Favourit reviews it.');
    } catch (error) {
      notify(error.message || 'Could not open refund dispute.');
    } finally { setBusy(false); }
  };

  const startSale = async () => {
    if (!selectedOrder || busy) return;
    setBusy(true);
    try {
      const orderId = selectedOrder.id;
      await startOrder(orderId);
      await refreshOrders(orderId);
      notify('Work started. The buyer can now see that the order is in progress.');
    } catch (error) {
      notify(error.message || 'Could not start this order.');
    } finally { setBusy(false); }
  };

  const deliverSale = async () => {
    if (!selectedOrder || busy) return;
    setBusy(true);
    try {
      const orderId = selectedOrder.id;
      await deliverOrder(orderId);
      await refreshOrders(orderId);
      notify('Order marked delivered. The buyer can now approve and release the FAV.');
    } catch (error) {
      notify(error.message || 'Could not mark this order delivered.');
    } finally { setBusy(false); }
  };

  const submitReview = async (rating, body) => {
    if (!selectedOrder || busy) return;
    setBusy(true);
    try {
      const orderId = selectedOrder.id;
      await createReview({ orderId, rating, body });
      await refreshOrders(orderId);
      notify('Review published. Thanks for helping buyers evaluate this seller.');
    } catch (error) {
      notify(error.message || 'Could not submit your review.');
    } finally { setBusy(false); }
  };

  const publish = async form => {
    if (busy) return;
    setBusy(true);
    try {
      const deal = await createDealRemote(form);
      setDeals(current => [deal, ...current.filter(item => String(item.id) !== String(deal.id))]);
      setMyDeals(current => [deal, ...current.filter(item => String(item.id) !== String(deal.id))]);
      notify('Deal published with protected packages.');
      go('My Deals');
    } catch (error) {
      notify(error.message || 'Could not publish your deal.');
    } finally { setBusy(false); }
  };

  const openDealEditor = deal => {
    if (!deal || deal.status === 'archived') return;
    setSelectedDeal(null);
    setSelectedOrder(null);
    setEditingDeal(deal);
    setActive('Edit Deal');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveDeal = async form => {
    if (!editingDeal || busy) return;
    setBusy(true);
    try {
      const updated = await updateDealRemote(editingDeal.id, form);
      const merged = { ...editingDeal, ...updated };
      setMyDeals(current => current.map(item => String(item.id) === String(merged.id) ? merged : item));
      if (merged.status === 'published') {
        setDeals(current => current.map(item => String(item.id) === String(merged.id) ? { ...item, ...merged } : item));
      }
      notify('Deal changes saved. Existing order snapshots were not changed.');
      go('My Deals');
    } catch (error) {
      notify(error.message || 'Could not update your deal.');
    } finally { setBusy(false); }
  };

  const changeDealStatus = async (deal, status) => {
    if (!deal || busy) return;
    setBusy(true);
    try {
      const updated = await setDealStatus(deal.id, status);
      const merged = { ...deal, ...updated };
      setMyDeals(current => current.map(item => String(item.id) === String(merged.id) ? merged : item));
      if (status === 'published') {
        const publicDeal = await getDealById(merged.id);
        setDeals(current => [publicDeal || merged, ...current.filter(item => String(item.id) !== String(merged.id))]);
        notify('Deal published and visible to buyers.');
      } else {
        setDeals(current => current.filter(item => String(item.id) !== String(merged.id)));
        notify(status === 'paused' ? 'Deal paused and hidden from new buyers.' : 'Deal archived. Existing orders remain in history.');
      }
    } catch (error) {
      notify(error.message || 'Could not update deal status.');
    } finally { setBusy(false); }
  };

  const logout = async () => {
    try { await signOut(); }
    catch (error) { notify(error.message || 'Could not sign out.'); }
  };

  let content;
  if (selectedDeal) content = <DealDetailPage deal={selectedDeal} fav={fav} buyerFeeBps={Number(economy.buyer_marketplace_fee_bps || 300)} favorite={favorites.has(String(selectedDeal.id))} onFavorite={toggleFavorite} onBack={() => setSelectedDeal(null)} onBuy={buy} busy={busy} />;
  else if (selectedOrder) content = <OrderDetail key={selectedOrder.id} order={selectedOrder} viewerId={session?.user?.id} onBack={() => setSelectedOrder(null)} onRelease={release} onRefund={refund} onStart={startSale} onDeliver={deliverSale} onReview={submitReview} busy={busy} />;
  else if (active === 'Home') content = <Home fav={fav} onExplore={() => go('Explore')} onCreate={() => go('Create Deal')} rewardMessage={rewardMessage} />;
  else if (active === 'Explore') content = <ExploreDealsPage query={query} setQuery={setQuery} onOpen={setSelectedDeal} onCreate={() => go('Create Deal')} deals={deals} favorites={favorites} onFavorite={toggleFavorite} />;
  else if (active === 'Orders') content = <Orders orders={orders} onOpen={setSelectedOrder} fav={fav} viewerId={session?.user?.id} />;
  else if (active === 'My Deals') content = <ManageDealsPage deals={myDeals} onCreate={() => go('Create Deal')} onEdit={openDealEditor} onStatus={changeDealStatus} busy={busy} />;
  else if (active === 'Wallet') content = <WalletPage key={session?.user?.id} userId={session?.user?.id} onBalance={updateBalance} onExplore={() => go('Explore')} onOpenOrder={async id => {
    try { await refreshOrders(id); setActive('Orders'); setSelectedDeal(null); setEditingDeal(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (error) { notify(error.message || 'Could not open this order.'); }
  }} />;
  else if (active === 'Community') content = <Community />;
  else if (active === 'Upgrade') content = <PremiumPage fav={fav} />;
  else if (active === 'Profile') content = <Profile fav={fav} myDeals={myDeals} orders={orders} onCreate={() => go('Create Deal')} onOrders={() => go('Orders')} onManageDeals={() => go('My Deals')} session={session} onSignOut={logout} usernameStatus={usernameStatus} />;
  else if (active === 'Create Deal') content = <CreateDealPage key="new-deal" onBack={() => go('My Deals')} onCreated={publish} busy={busy} />;
  else if (active === 'Edit Deal' && editingDeal) content = <CreateDealPage key={editingDeal.id} initialDeal={editingDeal} onBack={() => go('My Deals')} onCreated={saveDeal} busy={busy} />;
  else content = <Home fav={fav} onExplore={() => go('Explore')} onCreate={() => go('Create Deal')} />;

  return <div className={`app-shell ${sidebarOpen ? 'sidebar-expanded' : ''}`}>
    <header className="topbar">
      <button className="brand-button" onClick={() => go('Home')}><Logo /></button>
      <AppSidebar active={active} open={sidebarOpen} onToggle={setSidebarOpen} onNavigate={go} fav={fav} />
      <div className="top-actions"><button type="button" className="balance" aria-label="Open FAV wallet" onClick={() => go('Wallet')}><small>FAV</small><strong>{formatFav(fav)}</strong></button><button className="profile-button" onClick={() => go('Profile')}>{initialsFor(session?.user?.user_metadata?.display_name || session?.user?.email)} <span>⌄</span></button></div>
    </header>
    <main>{loading && active !== 'Wallet' ? <FavouritLoader title="Loading your Favourit" subtitle="Preparing your marketplace…" /> : content}</main>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

export default App;
