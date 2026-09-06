import { useEffect, useMemo, useState } from 'react';
import { getDealById } from '../lib/deals';
import { formatFav } from '../lib/wallet';
import { formatPercentFromBps } from '../lib/economy';
import { calculateBpsFeeUnits } from '../data/economy';
import './DealDetailPage.css';

const SERVICE_TYPE_COPY = {
  deliverable: { label: 'Digital deliverable', note: 'A defined result delivered through Favourit.' },
  session: { label: 'Live session', note: 'A booked remote session with a clear scope.' },
  managed: { label: 'Managed service', note: 'Ongoing work delivered over an agreed period.' },
  audit: { label: 'Audit & consultation', note: 'Analysis, recommendations and expert guidance.' },
};

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function initialsFor(name = 'Favourit seller') {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'FV';
}

function fallbackPackages(deal) {
  if (Array.isArray(deal?.packages) && deal.packages.length) return deal.packages;
  return [{
    tier: 'basic',
    title: 'Basic',
    description: 'Core service package',
    price: Number(deal?.price || 0),
    priceFav: Number(deal?.price || 0) * 1000000,
    deliveryDays: Number(deal?.deliveryDays || 1),
    revisions: 1,
  }];
}

function packagePrice(servicePackage) {
  const micro = Number(servicePackage?.priceFav ?? servicePackage?.price_fav ?? 0);
  if (micro > 0) return micro;
  return Number(servicePackage?.price || 0) * 1000000;
}

function SellerAvatar({ deal }) {
  if (deal?.sellerAvatarUrl) return <img className="deal-detail-avatar" src={deal.sellerAvatarUrl} alt="" />;
  return <span className="deal-detail-avatar fallback">{initialsFor(deal?.seller)}</span>;
}

function ReviewCard({ review }) {
  const name = review.reviewer_name || review.reviewer_username || 'Favourit buyer';
  return <article className="deal-review-card">
    <div><span className="deal-review-avatar">{initialsFor(name)}</span><span><strong>{name}</strong><small>{review.reviewer_username ? `@${review.reviewer_username}` : 'Verified order'}</small></span><b>★ {review.rating}</b></div>
    {review.body && <p>{review.body}</p>}
  </article>;
}

export default function DealDetailPage({ deal, onBack, onBuy, fav, busy, favorite, onFavorite, buyerFeeBps = 300 }) {
  const [detail, setDetail] = useState(deal);
  const [loading, setLoading] = useState(false);
  const packages = useMemo(() => fallbackPackages(detail), [detail]);
  const [selectedTier, setSelectedTier] = useState(packages[0]?.tier || 'basic');

  useEffect(() => {
    setDetail(deal);
    setSelectedTier(fallbackPackages(deal)[0]?.tier || 'basic');
    if (!isUuid(deal?.id)) return undefined;
    let active = true;
    setLoading(true);
    getDealById(deal.id).then(next => {
      if (!active || !next) return;
      setDetail(next);
      const available = fallbackPackages(next);
      setSelectedTier(current => available.some(item => item.tier === current) ? current : available[0]?.tier || 'basic');
    }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [deal]);

  const selected = packages.find(item => item.tier === selectedTier) || packages[0];
  const servicePriceMicro = packagePrice(selected);
  const buyerFeeMicro = calculateBpsFeeUnits(servicePriceMicro, buyerFeeBps);
  const buyerTotalMicro = servicePriceMicro + buyerFeeMicro;
  const serviceType = SERVICE_TYPE_COPY[detail?.serviceType] || SERVICE_TYPE_COPY.deliverable;
  const reviews = Array.isArray(detail?.reviewItems) ? detail.reviewItems : [];
  const portfolio = Array.isArray(detail?.portfolio) ? detail.portfolio : [];
  const faqs = Array.isArray(detail?.faqs) ? detail.faqs : [];
  const purchasable = isUuid(detail?.id) && !detail?.sample;
  const canMessage = purchasable && Boolean(detail?.sellerUsername);

  const messageSeller = () => {
    if (!canMessage) return;
    window.dispatchEvent(new CustomEvent('favourit:open-direct-message', { detail: { username: detail.sellerUsername } }));
  };
  const openSeller = () => {
    if (!detail?.sellerUsername) return;
    window.dispatchEvent(new CustomEvent('favourit:open-profile', { detail: { username: detail.sellerUsername } }));
  };

  if (!detail) return null;

  return <section className="page-section deal-detail-page">
    <button className="back-button" type="button" onClick={onBack}>← Back to Explore</button>
    <div className="deal-detail-layout">
      <div className="deal-detail-main">
        <div className="deal-detail-gallery">
          <div className="deal-detail-art"><span>{detail.category}</span><strong>{initialsFor(detail.seller)}</strong><small>{serviceType.label}</small></div>
          {portfolio.length > 0 && <div className="deal-portfolio-strip">{portfolio.slice(0, 3).map((item, index) => <a key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noreferrer"><span>WORK SAMPLE {index + 1}</span><strong>{item.title}</strong><small>View sample ↗</small></a>)}</div>}
        </div>

        <div className="deal-detail-copy">
          <div className="deal-detail-kicker"><span>{serviceType.label}</span>{detail.sample && <small>Explore sample listing</small>}{loading && <small>Refreshing deal…</small>}</div>
          <h1>{detail.title}</h1>
          <div className="deal-seller-card">
            <button type="button" className="deal-seller-profile" onClick={openSeller} disabled={!detail.sellerUsername}>
              <SellerAvatar deal={detail} />
              <span><strong>{detail.seller}{detail.sellerVerified ? ' ✓' : ''}</strong><small>{detail.sellerUsername ? `@${detail.sellerUsername}` : 'Favourit seller'}</small></span>
            </button>
            <div className="deal-seller-stats"><span><b>{detail.rating ? `★ ${detail.rating}` : 'New'}</b><small>{detail.reviews || 0} reviews</small></span><span><b>{detail.completedOrders || 0}</b><small>completed</small></span></div>
            <button type="button" className="secondary deal-message-seller" disabled={!canMessage} onClick={messageSeller}>Message seller</button>
            <button type="button" className={`favorite-detail ${favorite ? 'active' : ''}`} disabled={!purchasable} aria-pressed={favorite} onClick={() => onFavorite(detail.id)}>{detail.sample ? 'Sample' : favorite ? '♥ Saved' : '♡ Save'}</button>
          </div>

          <section className="deal-detail-section"><h2>About this service</h2><p>{detail.description || 'The seller has not added a longer description yet.'}</p><div className="deal-service-type-note"><b>{serviceType.label}</b><span>{serviceType.note}</span></div></section>
          <section className="deal-detail-section"><h2>What the seller needs from you</h2>{detail.buyerRequirements ? <p className="deal-requirements">{detail.buyerRequirements}</p> : <p className="deal-muted">The seller will confirm any required information in Messages after the order starts.</p>}</section>
          {portfolio.length > 0 && <section className="deal-detail-section"><h2>Portfolio</h2><div className="deal-portfolio-grid">{portfolio.map((item, index) => <a key={`${item.url}-${index}`} href={item.url} target="_blank" rel="noreferrer"><span>Sample {index + 1}</span><strong>{item.title}</strong><small>Open work sample ↗</small></a>)}</div></section>}
          <section className="deal-detail-section"><div className="deal-section-heading"><h2>Seller reputation</h2><span>{detail.reviews || 0} reviews</span></div>{reviews.length ? <div className="deal-reviews-grid">{reviews.map(review => <ReviewCard key={review.id} review={review} />)}</div> : <div className="deal-empty-block"><strong>No written reviews yet.</strong><span>New sellers can still earn trust through protected Favourit orders.</span></div>}</section>
          {faqs.length > 0 && <section className="deal-detail-section"><h2>Frequently asked questions</h2><div className="deal-faq-list">{faqs.map((item, index) => <details key={`${item.question}-${index}`}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div></section>}
        </div>
      </div>

      <aside className="deal-package-card">
        <div className="deal-package-tabs">{packages.map(item => <button type="button" key={item.tier} className={selected?.tier === item.tier ? 'active' : ''} onClick={() => setSelectedTier(item.tier)}>{item.title || item.tier}</button>)}</div>
        <div className="deal-package-body">
          <div className="eyebrow">{String(selected?.tier || 'basic').toUpperCase()} PACKAGE</div>
          <h2>{formatFav(servicePriceMicro)} <em>FAV</em></h2>
          <p>{selected?.description || 'A clear service package protected by Favourit escrow.'}</p>
          <div className="deal-package-facts">
            <span><b>⌁</b><strong>{selected?.deliveryDays || 1} day{Number(selected?.deliveryDays) === 1 ? '' : 's'}</strong><small>{detail.serviceType === 'session' ? 'to schedule' : 'delivery'}</small></span>
            <span><b>↻</b><strong>{selected?.revisions ?? 0}</strong><small>{Number(selected?.revisions) === 1 ? 'revision' : 'revisions'}</small></span>
            {selected?.sessionMinutes && <span><b>◷</b><strong>{selected.sessionMinutes} min</strong><small>session</small></span>}
          </div>
          <div className="deal-checkout-fees" aria-label="Order total">
            <span><small>Service price</small><b>{formatFav(servicePriceMicro)} FAV</b></span>
            <span><small>Buyer marketplace fee · {formatPercentFromBps(buyerFeeBps)}</small><b>{formatFav(buyerFeeMicro)} FAV</b></span>
            <span className="deal-checkout-total"><small>Total held in escrow</small><b>{formatFav(buyerTotalMicro)} FAV</b></span>
          </div>
          <button className="primary full" type="button" disabled={busy || !purchasable} onClick={() => onBuy(selected?.tier || 'basic')}>{!purchasable ? 'Sample listing — publish a real deal to order' : busy ? 'Funding escrow…' : `Continue — ${formatFav(buyerTotalMicro)} FAV`}</button>
          <button className="secondary full" type="button" disabled={!canMessage} onClick={messageSeller}>Ask the seller first</button>
          <div className="balance-note">Your balance: <strong>{formatFav(fav)} FAV</strong></div>
          <div className="deal-protection"><span>✓ Payment + buyer fee held in escrow</span><span>✓ Package captured on the order</span><span>✓ Secure Messages</span><span>✓ Dispute protection</span></div>
        </div>
      </aside>
    </div>
  </section>;
}
