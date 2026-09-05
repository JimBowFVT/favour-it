import { useEffect, useMemo, useState } from 'react';
import { formatFav } from '../lib/wallet';
import { getMyPremiumMembership, isPremiumActive } from '../lib/premium';
import { formatPercentFromBps, getDailyRewardFav, getEconomyConfig } from '../lib/economy';
import './PremiumPage.css';

const PLANNED_BENEFITS = [
  ['↗', 'Priority marketplace visibility', 'Better placement and discovery tools for active sellers.'],
  ['◈', 'Lower marketplace fees', 'Premium fee discounts will be introduced only when the fee engine supports them safely.'],
  ['⌁', 'Seller analytics', 'Conversion, profile, deal and earnings analytics in one place.'],
  ['⚡', 'Priority support', 'Faster support and dispute handling for Premium members.'],
];

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function PremiumPage({ fav }) {
  const [membership, setMembership] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCheckoutInfo, setShowCheckoutInfo] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [membershipData, economy] = await Promise.all([
          getMyPremiumMembership(),
          getEconomyConfig(),
        ]);
        if (!active) return;
        setMembership(membershipData);
        setConfig(economy);
      } catch (e) {
        if (active) setError(e.message || 'Could not load Premium information.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const premiumActive = isPremiumActive(membership);
  const standardReward = useMemo(() => getDailyRewardFav(config, false), [config]);
  const premiumReward = useMemo(() => getDailyRewardFav(config, true), [config]);
  const rewardMultiplier = standardReward > 0 ? premiumReward / standardReward : 0;
  const fee = formatPercentFromBps(config?.transaction_fee_bps || 0);

  return <section className="page-section premium-page premium-page-v2">
    <div className="premium-v2-hero">
      <div className="premium-v2-copy">
        <div className="eyebrow">FAVOURIT PREMIUM</div>
        <div className={`premium-status-pill ${premiumActive ? 'active' : ''}`}>{premiumActive ? '✦ Premium active' : 'Free plan'}</div>
        <h1>More value.<br/><span>More leverage.</span></h1>
        <p>Premium is built around reward value, not a fixed number of FAV. If FAV becomes more valuable, the daily amount adjusts instead of blindly distributing the same token quantity forever.</p>
        <div className="premium-v2-actions">
          {premiumActive
            ? <button className="primary" type="button" disabled>Active until {formatDate(membership.active_until)}</button>
            : <button className="primary" type="button" onClick={() => setShowCheckoutInfo(true)}>Upgrade to Premium →</button>}
          <span>Purchasing is intentionally not enabled until the payment/compliance flow is connected.</span>
        </div>
      </div>

      <aside className="premium-reward-card">
        <small>DAILY REWARD VALUE</small>
        <strong>{loading ? '…' : rewardMultiplier ? `${rewardMultiplier.toFixed(rewardMultiplier % 1 ? 1 : 0)}×` : 'Premium'}</strong>
        <span>vs Free</span>
        <div className="premium-reward-breakdown">
          <div><small>Free</small><b>{standardReward ? `${formatFav(Math.round(standardReward * 1_000_000))} FAV` : '—'}</b></div>
          <div><small>Premium</small><b>{premiumReward ? `${formatFav(Math.round(premiumReward * 1_000_000))} FAV` : '—'}</b></div>
        </div>
        <p>Amounts are calculated from the current internal FAV reference value.</p>
      </aside>
    </div>

    {error && <div className="premium-v2-error">{error}</div>}

    <div className="premium-v2-live-grid">
      <article className="premium-live-card featured">
        <span className="premium-live-label">LIVE IN MVP</span>
        <b>✦</b>
        <h2>Higher daily reward value</h2>
        <p>The server checks your active Premium membership when you claim your daily reward and uses the Premium reward value from the economy configuration.</p>
        <div className="premium-live-stat"><span>Current standard marketplace fee</span><strong>{fee}</strong></div>
      </article>
      <article className="premium-live-card">
        <span className="premium-live-label muted">ACCOUNT</span>
        <b>◉</b>
        <h2>Your plan</h2>
        <p>{premiumActive ? `Premium remains active through ${formatDate(membership.active_until)}.` : 'You are currently on the Free plan. Your marketplace access and wallet remain fully usable.'}</p>
        <div className="premium-live-stat"><span>Wallet</span><strong>{formatFav(fav)} FAV</strong></div>
      </article>
    </div>

    <div className="premium-v2-section-heading">
      <div><div className="eyebrow">PREMIUM ROADMAP</div><h2>What Premium is designed to unlock</h2></div>
      <span>Planned benefits are labeled honestly until the backend enforces them.</span>
    </div>

    <div className="premium-v2-benefits">
      {PLANNED_BENEFITS.map(([icon, title, body]) => <article key={title}><span className="premium-planned-badge">PLANNED</span><b>{icon}</b><h3>{title}</h3><p>{body}</p></article>)}
    </div>

    <div className="premium-v2-economy-note">
      <div><span>◈</span><div><strong>Value-based economy</strong><small>Premium does not promise a fixed FAV amount or a guaranteed fiat exchange rate.</small></div></div>
      <div><span>↔</span><div><strong>Closed-loop first</strong><small>Premium benefits stay inside Favourit while external transfers and fiat redemption remain disabled.</small></div></div>
    </div>

    {showCheckoutInfo && <div className="premium-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowCheckoutInfo(false); }}>
      <div className="premium-modal" role="dialog" aria-modal="true" aria-labelledby="premium-checkout-title">
        <button className="premium-modal-close" type="button" onClick={() => setShowCheckoutInfo(false)}>×</button>
        <div className="eyebrow">PREMIUM CHECKOUT</div>
        <h2 id="premium-checkout-title">The product is ready for a payment provider — the checkout is not live yet.</h2>
        <p>I’m keeping this button honest instead of pretending a subscription succeeded. The next Premium backend step is connecting the chosen payment provider, webhook verification and legal/compliance flow before activating paid memberships.</p>
        <button className="primary full" type="button" onClick={() => setShowCheckoutInfo(false)}>Got it</button>
      </div>
    </div>}
  </section>;
}
