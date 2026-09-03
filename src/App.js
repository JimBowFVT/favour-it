import { useMemo, useState } from 'react';
import './App.css';
import { categories, deals } from './data/deals';

const navItems = ['Home', 'Explore', 'Community', 'Upgrade'];

function Logo() {
  return <div className="logo"><span>Favour</span><i>it</i></div>;
}

function Avatar({ initials, large = false }) {
  return <div className={large ? 'avatar avatar-lg' : 'avatar'}>{initials}</div>;
}

function DealCard({ deal, onOpen }) {
  return <article className="deal-card" onClick={() => onOpen(deal)}>
    <div className="deal-art"><span>{deal.category}</span><b>{deal.accent}</b></div>
    <div className="deal-content">
      <div className="seller"><Avatar initials={deal.accent} /><div><strong>{deal.seller}</strong><small>Top seller · {deal.delivery}</small></div><span className="rating">★ {deal.rating}</span></div>
      <h3>{deal.title}</h3>
      <div className="deal-bottom"><span>from <strong>{deal.price} FAV</strong></span><button onClick={(e) => e.stopPropagation()}>♡</button></div>
    </div>
  </article>;
}

function Explore({ query, setQuery, onOpen, onCreate }) {
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value ? deals.filter(d => `${d.title} ${d.category} ${d.seller}`.toLowerCase().includes(value)) : deals;
  }, [query]);

  return <section className="page-section">
    <div className="page-title"><div><div className="eyebrow">MARKETPLACE</div><h1>Find your next <span>favourite.</span></h1><p>Browse skills, services and ideas from people in the Favourit community.</p></div><button className="primary" onClick={onCreate}>+ Offer a skill</button></div>
    <div className="search-row"><div className="search-box">⌕<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search deals, skills or people..." /></div><button className="filter-button">Filters <span>☷</span></button></div>
    <div className="category-row">{['All', ...categories].map(c => <button key={c} className={query === (c === 'All' ? '' : c) ? 'category selected' : 'category'} onClick={() => setQuery(c === 'All' ? '' : c)}>{c}</button>)}</div>
    <div className="results-meta"><span>{filtered.length} deals available</span><button>Sort: Recommended ▾</button></div>
    <div className="deal-grid wide-grid">{filtered.map(d => <DealCard key={d.id} deal={d} onOpen={onOpen} />)}</div>
  </section>;
}

function DealDetail({ deal, onBack, onBuy, fav }) {
  if (!deal) return null;
  return <section className="page-section detail-page">
    <button className="back-button" onClick={onBack}>← Back to Explore</button>
    <div className="detail-layout">
      <div><div className="detail-art"><span>{deal.category}</span><strong>{deal.accent}</strong></div><div className="detail-description"><div className="seller detail-seller"><Avatar initials={deal.accent} large /><div><strong>{deal.seller}</strong><small>Top seller · ★ {deal.rating} · {deal.reviews} reviews</small></div></div><h1>{deal.title}</h1><p>Get a polished, reliable result from an experienced Favourit creator. Everything is handled inside Favourit with protected payment and clear delivery expectations.</p><div className="detail-stats"><span>⚡ {deal.delivery} delivery</span><span>★ {deal.rating} rating</span><span>◈ Escrow protected</span></div></div></div>
      <aside className="buy-card"><div className="eyebrow">STANDARD PACKAGE</div><h2>{deal.price} <em>FAV</em></h2><p>One complete delivery · revisions included</p><button className="primary full" onClick={onBuy}>Continue — {deal.price} FAV</button><div className="balance-note">Your balance: <strong>{fav.toLocaleString()} FAV</strong></div><hr /><div className="included"><span>✓ Payment held in escrow</span><span>✓ Secure messages</span><span>✓ Dispute protection</span></div></aside>
    </div>
  </section>;
}

function CreateDeal({ onBack, onCreated }) {
  return <section className="page-section form-page"><button className="back-button" onClick={onBack}>← Back</button><div className="form-header"><div className="eyebrow">CREATE A DEAL</div><h1>Turn your skill into <span>FAV.</span></h1><p>Tell the community what you can do. Keep it clear, specific and easy to buy.</p></div><div className="form-card"><label>Deal title<input placeholder="I will..." /></label><label>Category<select defaultValue=""><option value="" disabled>Select a category</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label><label>Description<textarea rows="5" placeholder="Describe what the buyer will receive..." /></label><div className="form-two"><label>Price in FAV<input type="number" placeholder="250" /></label><label>Delivery time<select defaultValue="3 days"><option>1 day</option><option>2 days</option><option>3 days</option><option>5 days</option><option>7 days</option></select></label></div><div className="upload-box">＋ <strong>Add attachments</strong><small>Images, documents or examples · up to 10 files</small></div><div className="form-actions"><button className="secondary" onClick={onBack}>Cancel</button><button className="primary" onClick={onCreated}>Publish deal →</button></div></div></section>;
}

function Community() {
  return <section className="page-section"><div className="page-title"><div><div className="eyebrow">COMMUNITY</div><h1>People make <span>Favourit.</span></h1><p>Connect with creators, friends and groups around the skills you care about.</p></div><button className="secondary">Find people</button></div><div className="community-grid"><div className="community-card"><div className="community-icon">♢</div><h2>Friends</h2><p>Follow great sellers and keep up with the people you trust.</p><button className="text-button">View friends →</button></div><div className="community-card featured"><div className="community-icon">✦</div><h2>Groups</h2><p>Join conversations around design, code, business, music and more.</p><button className="text-button">Explore groups →</button></div><div className="community-card"><div className="community-icon">☷</div><h2>Messages</h2><p>Talk directly with buyers and sellers before and during every deal.</p><button className="text-button">Open inbox →</button></div></div><div className="activity-card"><div><div className="eyebrow">RECENT ACTIVITY</div><h2>Your community is active.</h2></div><div className="activity-row"><Avatar initials="AM" /><span><strong>Alex Morgan</strong> published a new Design deal</span><small>12m</small></div><div className="activity-row"><Avatar initials="NC" /><span><strong>Noah Chen</strong> completed a Development order</span><small>1h</small></div></div></section>;
}

function Premium({ fav }) {
  return <section className="page-section premium-page"><div className="premium-hero"><div><div className="eyebrow">FAVOURIT PREMIUM</div><h1>More FAV.<br /><span>More possibilities.</span></h1><p>Unlock a stronger daily reward, better visibility and tools that help you get more from the marketplace.</p><button className="primary">Upgrade to Premium →</button></div><div className="premium-orb"><strong>+120</strong><span>FAV / DAY</span></div></div><div className="premium-grid"><div><b>✦</b><h3>Higher daily FAV</h3><p>Get a boosted daily reward while keeping the economy sustainable.</p></div><div><b>↗</b><h3>More visibility</h3><p>Give your deals better placement and reach more buyers.</p></div><div><b>◈</b><h3>Lower fees</h3><p>Keep more of the FAV you earn from completed work.</p></div><div><b>⌁</b><h3>Premium badge</h3><p>Show the community that you are a committed Favourit member.</p></div></div><div className="wallet-strip"><span>Current wallet</span><strong>{fav.toLocaleString()} FAV</strong><small>Premium reward preview: +120 FAV/day</small></div></section>;
}

function App() {
  const [active, setActive] = useState('Home');
  const [query, setQuery] = useState('');
  const [fav, setFav] = useState(850);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [toast, setToast] = useState('');

  const go = (item) => { setSelectedDeal(null); setActive(item); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const buy = () => { const price = selectedDeal?.price || 0; if (fav >= price) { setFav(v => v - price); setToast(`Order started — ${price} FAV moved to escrow.`); } else setToast('Not enough FAV for this order.'); setTimeout(() => setToast(''), 3200); };

  const home = <>
    <section className="hero"><div className="hero-copy"><div className="eyebrow">THE MARKETPLACE FOR TALENT</div><h1>Your skills<br /><span>are your currency.</span></h1><p>Find people who can do what you need. Offer what you do best. Make every deal simple, protected, and worth it.</p><div className="hero-actions"><button className="primary" onClick={() => go('Explore')}>Explore deals <span>→</span></button><button className="secondary" onClick={() => go('Create Deal')}>Offer a skill</button></div><div className="trust-row"><span>✓ Escrow protected</span><span>✓ Community rated</span><span>✓ Powered by FAV</span></div></div><div className="hero-orbit"><div className="glow" /><div className="coin coin-main">FAV</div><div className="coin coin-one">✦</div><div className="coin coin-two">F</div><div className="orbit-card"><small>YOUR BALANCE</small><strong>{fav.toLocaleString()} <em>FAV</em></strong><span>+120 this week</span></div></div></section>
    <section className="section-head"><div><div className="eyebrow">DISCOVER</div><h2>What can you get done?</h2></div><button className="text-button" onClick={() => go('Explore')}>View all deals →</button></section><div className="category-row">{categories.map(c => <button key={c} className="category" onClick={() => { setQuery(c); go('Explore'); }}>{c}</button>)}</div><section className="deal-grid">{deals.slice(0,4).map(d => <DealCard key={d.id} deal={d} onOpen={setSelectedDeal} />)}</section><section className="value-grid"><div className="value-card"><div className="value-icon">◈</div><h3>Protected by design</h3><p>Your FAV stays in escrow until the deal is complete. Less worry, more doing.</p></div><div className="value-card featured"><div className="value-icon">✦</div><h3>Earn from what you know</h3><p>Turn any legitimate skill into FAV. Then use what you earn to get something else done.</p></div><div className="value-card"><div className="value-icon">↗</div><h3>Built for community</h3><p>Ratings, messages, friends and groups help good work travel further.</p></div></section>
  </>;

  let content = home;
  if (selectedDeal) content = <DealDetail deal={selectedDeal} fav={fav} onBack={() => setSelectedDeal(null)} onBuy={buy} />;
  else if (active === 'Explore') content = <Explore query={query} setQuery={setQuery} onOpen={setSelectedDeal} onCreate={() => go('Create Deal')} />;
  else if (active === 'Create Deal') content = <CreateDeal onBack={() => go('Explore')} onCreated={() => { setToast('Your deal is ready to publish.'); setTimeout(() => setToast(''), 3000); go('Explore'); }} />;
  else if (active === 'Community') content = <Community />;
  else if (active === 'Upgrade') content = <Premium fav={fav} />;

  return <div className="app-shell"><header className="nav"><button className="logo-button" onClick={() => go('Home')}><Logo /></button><nav>{navItems.map(item => <button key={item} className={active === item ? 'nav-link active' : 'nav-link'} onClick={() => go(item)}>{item}</button>)}</nav><div className="nav-actions"><button className="fav-pill" onClick={() => setToast(`${fav.toLocaleString()} FAV available`)}>◈ {fav.toLocaleString()} FAV</button><button className="icon-button">⌁</button><Avatar initials="JD" /></div></header><main>{content}</main><footer><Logo /><p>Your skills are your currency.</p><span>© 2026 Favourit</span></footer>{toast && <div className="toast">{toast}</div>}</div>;
}

export default App;
