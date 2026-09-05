import { useEffect, useState } from 'react';
import './App.css';
import './Prototype.css';
import { categories, deals as seedDeals } from './data/deals';
import { statusLabels } from './data/orders';
import { getMyWallet, formatFav } from './lib/wallet';
import { createOrderAndHoldFav, getMyOrders, releaseOrder, refundOrder } from './lib/orders';
import { getPublishedDeals, getDealById, createDeal as createDealRemote } from './lib/deals';
import { getMyFavoriteDealIds, setFavorite } from './lib/favorites';
import { signOut } from './lib/auth';
import FavouritLoader from './components/FavouritLoader';
import Community from './components/Community';
import PremiumPage from './components/PremiumPage';
import ExploreDealsPage from './components/ExploreDealsPage';

const navItems = ['Home', 'Explore', 'Orders', 'Community', 'Upgrade'];

function Logo() { return <div className="logo"><span>Favour</span><i>it</i></div>; }
function Avatar({ initials, large = false }) { return <div className={large ? 'avatar avatar-lg' : 'avatar'}>{initials || 'FV'}</div>; }
function initialsFor(name = 'Favourit seller') { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'FV'; }

function Orders({ orders, onOpen, fav }) {
  return <section className="page-section">
    <div className="page-title"><div><div className="eyebrow">MY ORDERS</div><h1>Your work, <span>protected.</span></h1><p>Track every purchase from funded escrow to final delivery.</p></div><div className="wallet-mini"><small>AVAILABLE</small><strong>{formatFav(fav)} FAV</strong></div></div>
    {orders.length ? <div className="orders-list">{orders.map(order => <button className="order-row" key={order.id} onClick={() => onOpen(order)}><div className="order-id">{String(order.id).slice(0, 8)}</div><div className="order-info"><strong>{order.title}</strong><span>{order.seller} · {order.category}</span></div><div className="order-amount"><strong>{formatFav(order.amount * 1000000)} FAV</strong><small>fee {formatFav(order.fee * 1000000)} FAV</small></div><span className={`status status-${order.status}`}>{statusLabels[order.status] || order.status}</span><span className="order-arrow">→</span></button>)}</div> : <div className="empty-state"><h2>No orders yet.</h2><p>Explore the marketplace and fund your first protected FAV order.</p></div>}
    <div className="orders-info"><div><b>1</b><span>Payment secured in escrow</span></div><div><b>2</b><span>Seller delivers the work</span></div><div><b>3</b><span>You approve and release</span></div></div>
  </section>;
}

function OrderDetail({ order, onBack, onRelease, onRefund, busy }) {
  return <section className="page-section"><button className="back-button" onClick={onBack}>← Back to Orders</button><div className="order-detail"><div className="detail-description"><div className="eyebrow">ORDER {String(order.id).slice(0, 8)}</div><h1>{order.title}</h1><div className="seller detail-seller"><Avatar initials={initialsFor(order.seller)} large /><div><strong>{order.seller}</strong><small>{order.category} · Favourit seller</small></div></div><div className="timeline"><div className="timeline-item done"><b>Payment secured</b><span>FAV is held in escrow</span></div><div className={`timeline-item ${['in_progress', 'delivered', 'completed'].includes(order.status) ? 'done' : ''}`}><b>Work in progress</b><span>Seller is working on your order</span></div><div className={`timeline-item ${['delivered', 'completed'].includes(order.status) ? 'done' : ''}`}><b>Delivery</b><span>Review the seller's delivery</span></div><div className={`timeline-item ${order.status === 'completed' ? 'done' : ''}`}><b>Completed</b><span>FAV is released to the seller</span></div></div></div><aside className="buy-card order-side"><div className="eyebrow">ORDER STATUS</div><span className={`status status-${order.status}`}>{statusLabels[order.status] || order.status}</span><h2>{formatFav(order.amount * 1000000)} <em>FAV</em></h2><div className="order-breakdown"><span>Service <b>{formatFav(order.amount * 1000000)} FAV</b></span><span>Platform fee <b>{formatFav(order.fee * 1000000)} FAV</b></span><span>Total held <b>{formatFav(order.amount * 1000000)} FAV</b></span></div>{!['completed', 'cancelled'].includes(order.status) && <><button className="primary full" disabled={busy} onClick={onRelease}>{busy ? 'Processing…' : 'Approve & release FAV'}</button><button className="secondary full" disabled={busy} onClick={onRefund}>Request refund</button></>}<small className="escrow-note">◈ FAV remains protected until a release or approved refund.</small></aside></div></section>;
}

function DealDetail({ deal, onBack, onBuy, fav, busy, favorite, onFavorite }) {
  if (!deal) return null;
  return <section className="page-section"><button className="back-button" onClick={onBack}>← Back to Explore</button><div className="detail-layout"><div><div className="detail-art"><span>{deal.category}</span><strong>{deal.accent || initialsFor(deal.seller)}</strong></div><div className="detail-description"><div className="seller detail-seller"><Avatar initials={deal.accent || initialsFor(deal.seller)} large /><div><strong>{deal.seller}</strong><small>Favourit seller · ★ {deal.rating || 'New'} · {deal.reviews || 0} reviews</small></div><button className="favorite-detail" aria-pressed={favorite} onClick={() => onFavorite(deal.id)}>{favorite ? '♥ Liked' : '♡ Like deal'}</button></div><h1>{deal.title}</h1><p>{deal.description || 'Get a polished, reliable result from a Favourit freelancer. Everything is handled inside Favourit with protected payment and clear delivery expectations.'}</p><div className="detail-stats"><span>⚡ {deal.delivery} delivery</span><span>★ {deal.rating || 'New'} rating</span><span>◈ Escrow protected</span></div></div></div><aside className="buy-card"><div className="eyebrow">STANDARD PACKAGE</div><h2>{formatFav(deal.price * 1000000)} <em>FAV</em></h2><p>One complete delivery · protected payment</p><button className="primary full" disabled={busy} onClick={onBuy}>{busy ? 'Funding escrow…' : `Continue — ${formatFav(deal.price * 1000000)} FAV`}</button><div className="balance-note">Your balance: <strong>{formatFav(fav)} FAV</strong></div><hr /><div className="included"><span>✓ Payment held in escrow</span><span>✓ Secure messages</span><span>✓ Dispute protection</span></div></aside></div></section>;
}

function CreateDeal({ onBack, onCreated, busy }) {
  const [form, setForm] = useState({ title: '', category: '', description: '', price: '', delivery: '3 days' });
  const update = (key, value) => setForm(value => ({ ...value, [key]: value }));
  const patch = (key, value) => setForm(current => ({ ...current, [key]: value }));
  return <section className="page-section"><button className="back-button" onClick={onBack}>← Back</button><div className="form-header"><div className="eyebrow">CREATE A DEAL</div><h1>Turn your service into <span>FAV.</span></h1><p>Choose the closest approved service category, define exactly what the buyer receives and keep the work inside Favourit.</p></div><div className="form-card"><label>Deal title<input maxLength="120" value={form.title} onChange={event => patch('title', event.target.value)} placeholder="I will..." /></label><label>Service category<select value={form.category} onChange={event => patch('category', event.target.value)}><option value="">Select a category</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label><label>Description<textarea maxLength="5000" value={form.description} onChange={event => patch('description', event.target.value)} rows="5" placeholder="Describe the scope, deliverable or session the buyer will receive..." /><small className="field-hint">{form.description.length}/5000</small></label><div className="form-two"><label>Price in FAV<input value={form.price} onChange={event => patch('price', event.target.value)} type="number" min="0.01" max="1000000000" step="0.01" placeholder="250" /></label><label>Delivery time<select value={form.delivery} onChange={event => patch('delivery', event.target.value)}><option>1 day</option><option>2 days</option><option>3 days</option><option>5 days</option><option>7 days</option><option>14 days</option><option>30 days</option></select></label></div><div className="upload-box">＋ <strong>Add attachments</strong><small>Secure file delivery will be connected through Favourit storage.</small></div><div className="form-actions"><button className="secondary" onClick={onBack}>Cancel</button><button className="primary" disabled={busy || !form.title.trim() || !form.category || form.description.trim().length < 10 || !form.price} onClick={() => onCreated(form)}>{busy ? 'Publishing…' : 'Publish deal →'}</button></div></div></section>;
}

function Home({ fav, onExplore, onCreate, rewardMessage }) {
  return <section className="page-section home-page"><div className="hero"><div><div className="eyebrow">WELCOME TO FAVOURIT</div><h1>Your skills are your <span>currency.</span></h1><p>Offer what you know, earn FAV, and use it to access skills from the rest of the community — with every purchase protected by escrow.</p><div className="hero-actions"><button className="primary" onClick={onExplore}>Explore marketplace →</button><button className="secondary" onClick={onCreate}>Offer a service</button></div>{rewardMessage && <div className="reward-banner">✦ {rewardMessage}</div>}</div><div className="hero-orb"><strong>{formatFav(fav)}</strong><span>FAV AVAILABLE</span></div></div><div className="value-grid"><div><b>◈</b><h3>You are secured</h3><p>Payments stay protected in escrow until the order is completed.</p></div><div><b>↔</b><h3>Dealmaking</h3><p>Turn an approved remote professional service into something another member can buy.</p></div><div><b>✦</b><h3>Use our coin</h3><p>FAV moves through the marketplace as purchasing power.</p></div></div></section>;
}

function Profile({ fav, deals, orders, onCreate, onOrders, session, onSignOut, usernameStatus }) {
  const name = session?.user?.user_metadata?.display_name || session?.user?.email?.split('@')[0] || 'Favourit member';
  const initials = initialsFor(name);
  return <section className="page-section"><div className="profile-hero"><div className="profile-main"><Avatar initials={initials} large /><div><div className="eyebrow">YOUR PROFILE</div><h1>{name}</h1><p className="profile-handle">@{usernameStatus?.username || 'username'}</p><p>Creator · Buyer · Favourit member</p><div className="profile-tags"><span>✓ Account verified</span><span>◈ Favourit member</span></div></div></div><button className="secondary" onClick={onSignOut}>Sign out</button></div><div className="profile-stats"><div><small>FAV BALANCE</small><strong>{formatFav(fav)}</strong><span>FAV</span></div><div><small>DEALS PUBLISHED</small><strong>{deals.filter(deal => deal.sellerId === session?.user?.id).length}</strong><span>services</span></div><div><small>ORDERS</small><strong>{orders.length}</strong><span>purchases</span></div><div><small>ACCOUNT</small><strong>Active</strong><span>member</span></div></div><div className="profile-grid"><div className="profile-panel"><div className="panel-heading"><h2>Favourit ID</h2></div><div className="transaction"><span className="tx-icon positive">@</span><div><strong>@{usernameStatus?.username || 'username'}</strong><small>Your public Favourit handle</small></div><b>30 day limit</b></div><p className="panel-copy">Your @ stays with your account. Use the @ control beside Messages to change it when the 30-day window opens.</p></div><div className="profile-panel"><div className="panel-heading"><h2>Wallet</h2></div><div className="transaction"><span className="tx-icon positive">+</span><div><strong>Available FAV</strong><small>Live wallet balance</small></div><b>{formatFav(fav)} FAV</b></div></div><div className="profile-panel"><div className="panel-heading"><h2>Orders</h2></div><p className="panel-copy">Your purchases are funded through protected FAV escrow.</p><button className="primary full" onClick={onOrders}>View my orders →</button><button className="secondary full" onClick={onCreate}>Offer a new service →</button></div></div></section>;
}

function App({ initialWallet, session, rewardMessage, usernameStatus }) {
  const [active, setActive] = useState('Home');
  const [query, setQuery] = useState('');
  const [fav, setFav] = useState(Number(initialWallet?.available_fav || 0));
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [toast, setToast] = useState('');
  const [deals, setDeals] = useState(seedDeals);
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
    setActive(item);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const refreshWallet = async () => {
    const wallet = await getMyWallet();
    if (wallet) setFav(Number(wallet.available_fav || 0));
    return wallet;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [remoteDeals, remoteOrders, wallet, favoriteIds] = await Promise.all([getPublishedDeals(), getMyOrders(), getMyWallet(), getMyFavoriteDealIds()]);
        if (cancelled) return;
        if (remoteDeals.length) setDeals(remoteDeals);
        setOrders(remoteOrders);
        setFav(Number(wallet?.available_fav || 0));
        setFavorites(new Set([...favoriteIds].map(String)));
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

  const buy = async () => {
    if (!selectedDeal || busy) return;
    setBusy(true);
    try {
      const order = await createOrderAndHoldFav(selectedDeal.id);
      await refreshWallet();
      const freshOrders = await getMyOrders();
      setOrders(freshOrders);
      const fresh = freshOrders.find(item => item.id === order?.id) || order;
      if (!fresh) throw new Error('Order was funded but could not be loaded.');
      setSelectedDeal(null);
      setSelectedOrder(fresh);
      setActive('Orders');
      notify(`Order funded — ${formatFav(fresh.amount * 1000000)} FAV moved to escrow.`);
    } catch (error) {
      notify(error.message || 'Could not fund this order.');
    } finally { setBusy(false); }
  };

  const release = async () => {
    if (!selectedOrder || busy) return;
    setBusy(true);
    try {
      await releaseOrder(selectedOrder.id);
      const freshOrders = await getMyOrders();
      setOrders(freshOrders);
      setSelectedOrder(freshOrders.find(order => order.id === selectedOrder.id) || { ...selectedOrder, status: 'completed' });
      await refreshWallet();
      notify('Order completed — escrow released to the seller.');
    } catch (error) {
      notify(error.message || 'Could not release escrow.');
    } finally { setBusy(false); }
  };

  const refund = async () => {
    if (!selectedOrder || busy) return;
    setBusy(true);
    try {
      await refundOrder(selectedOrder.id);
      const freshOrders = await getMyOrders();
      setOrders(freshOrders);
      setSelectedOrder(freshOrders.find(order => order.id === selectedOrder.id) || { ...selectedOrder, status: 'disputed' });
      notify('Refund request opened — Favourit will review the dispute.');
    } catch (error) {
      notify(error.message || 'Could not open refund request.');
    } finally { setBusy(false); }
  };

  const publish = async form => {
    if (busy) return;
    setBusy(true);
    try {
      const deal = await createDealRemote(form);
      setDeals(current => [deal, ...current]);
      notify('Deal published to the Favourit marketplace.');
      go('Explore');
    } catch (error) {
      notify(error.message || 'Could not publish your deal.');
    } finally { setBusy(false); }
  };

  const logout = async () => { try { await signOut(); } catch (error) { notify(error.message || 'Could not sign out.'); } };

  let content;
  if (active === 'Home') content = <Home fav={fav} onExplore={() => go('Explore')} onCreate={() => go('Create Deal')} rewardMessage={rewardMessage} />;
  else if (active === 'Explore') content = <ExploreDealsPage query={query} setQuery={setQuery} onOpen={setSelectedDeal} onCreate={() => go('Create Deal')} deals={deals} favorites={favorites} onFavorite={toggleFavorite} />;
  else if (active === 'Orders') content = <Orders orders={orders} onOpen={setSelectedOrder} fav={fav} />;
  else if (active === 'Community') content = <Community />;
  else if (active === 'Upgrade') content = <PremiumPage fav={fav} />;
  else if (active === 'Profile') content = <Profile fav={fav} deals={deals} orders={orders} onCreate={() => go('Create Deal')} onOrders={() => go('Orders')} session={session} onSignOut={logout} usernameStatus={usernameStatus} />;
  else if (active === 'Create Deal') content = <CreateDeal onBack={() => go('Explore')} onCreated={publish} busy={busy} />;
  else content = <Home fav={fav} onExplore={() => go('Explore')} onCreate={() => go('Create Deal')} />;

  return <div className="app-shell"><header className="topbar"><button className="brand-button" onClick={() => go('Home')}><Logo /></button><nav>{navItems.map(item => <button key={item} className={active === item ? 'active' : ''} onClick={() => go(item)}>{item}</button>)}</nav><div className="top-actions"><div className="balance"><small>FAV</small><strong>{formatFav(fav)}</strong></div><button className="profile-button" onClick={() => go('Profile')}>{initialsFor(session?.user?.user_metadata?.display_name || session?.user?.email)} <span>⌄</span></button></div></header><main>{loading ? <FavouritLoader title="Loading your Favourit" subtitle="Preparing your marketplace…" /> : content}</main>{selectedDeal && <DealDetail deal={selectedDeal} fav={fav} favorite={favorites.has(String(selectedDeal.id))} onFavorite={toggleFavorite} onBack={() => setSelectedDeal(null)} onBuy={buy} busy={busy} />} {selectedOrder && <OrderDetail order={selectedOrder} onBack={() => setSelectedOrder(null)} onRelease={release} onRefund={refund} busy={busy} />} {toast && <div className="toast" role="status">{toast}</div>}</div>;
}

export default App;
