import { useMemo, useState } from 'react';
import './App.css';
import { categories, deals } from './data/deals';

const navItems = ['Home', 'Explore', 'Community', 'Upgrade'];
function Logo() { return <div className="logo"><span>Favour</span><i>it</i></div>; }
function Avatar({ initials }) { return <div className="avatar">{initials}</div>; }

function App() {
  const [active, setActive] = useState('Home');
  const [query, setQuery] = useState('');
  const [fav, setFav] = useState(850);
  const filteredDeals = useMemo(() => { const value = query.trim().toLowerCase(); return value ? deals.filter(d => `${d.title} ${d.category} ${d.seller}`.toLowerCase().includes(value)) : deals.slice(0, 4); }, [query]);
  return <div className="app-shell">
    <header className="nav"><Logo /><nav>{navItems.map(item => <button key={item} className={active === item ? 'nav-link active' : 'nav-link'} onClick={() => setActive(item)}>{item}</button>)}</nav><div className="nav-actions"><button className="fav-pill" onClick={() => setFav(v => v + 10)}>◈ {fav.toLocaleString()} FAV</button><button className="icon-button">⌁</button><Avatar initials="JD" /></div></header>
    <main>
      <section className="hero"><div className="hero-copy"><div className="eyebrow">THE MARKETPLACE FOR TALENT</div><h1>Your skills<br /><span>are your currency.</span></h1><p>Find people who can do what you need. Offer what you do best. Make every deal simple, protected, and worth it.</p><div className="hero-actions"><button className="primary" onClick={() => setActive('Explore')}>Explore deals <span>→</span></button><button className="secondary">Offer a skill</button></div><div className="trust-row"><span>✓ Escrow protected</span><span>✓ Community rated</span><span>✓ Powered by FAV</span></div></div><div className="hero-orbit"><div className="glow" /><div className="coin coin-main">FAV</div><div className="coin coin-one">✦</div><div className="coin coin-two">F</div><div className="orbit-card"><small>YOUR BALANCE</small><strong>{fav.toLocaleString()} <em>FAV</em></strong><span>+120 this week</span></div></div></section>
      <section className="section-head"><div><div className="eyebrow">DISCOVER</div><h2>What can you get done?</h2></div><button className="text-button" onClick={() => setActive('Explore')}>View all deals →</button></section>
      <div className="category-row">{categories.map(c => <button key={c} className="category" onClick={() => setQuery(c)}>{c}</button>)}</div>
      <section className="deal-grid">{filteredDeals.map(d => <article className="deal-card" key={d.id}><div className="deal-art"><span>{d.category}</span><b>{d.accent}</b></div><div className="deal-content"><div className="seller"><Avatar initials={d.accent} /><div><strong>{d.seller}</strong><small>Top seller · {d.delivery}</small></div><span className="rating">★ {d.rating}</span></div><h3>{d.title}</h3><div className="deal-bottom"><span>from <strong>{d.price} FAV</strong></span><button>♡</button></div></div></article>)}</section>
      <section className="value-grid"><div className="value-card"><div className="value-icon">◈</div><h3>Protected by design</h3><p>Your FAV stays in escrow until the deal is complete. Less worry, more doing.</p></div><div className="value-card featured"><div className="value-icon">✦</div><h3>Earn from what you know</h3><p>Turn any legitimate skill into FAV. Then use what you earn to get something else done.</p></div><div className="value-card"><div className="value-icon">↗</div><h3>Built for community</h3><p>Ratings, messages, friends and groups help good work travel further.</p></div></section>
    </main><footer><Logo /><p>Your skills are your currency.</p><span>© 2026 Favourit</span></footer>
  </div>;
}
export default App;
