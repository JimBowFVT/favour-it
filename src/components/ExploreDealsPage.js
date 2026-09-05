import { useMemo, useState } from 'react';
import { formatFav } from '../lib/wallet';
import {
  featuredCategoryIds,
  getServiceFamily,
  resolveServiceCategory,
  serviceCategories,
  serviceFamilies,
  serviceSearchText,
} from '../data/serviceCategories';
import './ExploreDeals.css';

const SERVICE_TYPE_LABELS = {
  deliverable: 'Deliverable',
  session: 'Live session',
  managed: 'Managed service',
  audit: 'Audit & consultation',
};

function initialsFor(name = 'Favourit seller') {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'FV';
}

function deliveryDays(deal) {
  const direct = Number(deal?.deliveryDays);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return Number.parseInt(String(deal?.delivery || '').match(/\d+/)?.[0] || '999', 10);
}

function enrichedDeal(deal) {
  const category = resolveServiceCategory(deal?.category);
  const family = getServiceFamily(deal?.category);
  return { ...deal, _category: category, _family: family, _deliveryDays: deliveryDays(deal) };
}

function DealCard({ deal, onOpen, favorite, onFavorite }) {
  const category = deal._category || resolveServiceCategory(deal.category);
  const family = deal._family || getServiceFamily(deal.category);
  const accent = deal.accent || initialsFor(deal.seller);
  const packageCount = Array.isArray(deal.packages) && deal.packages.length ? deal.packages.length : 1;
  const serviceType = SERVICE_TYPE_LABELS[deal.serviceType] || SERVICE_TYPE_LABELS.deliverable;
  return <article className={`explore-deal-card ${deal.sample ? 'is-sample' : ''}`}>
    <button className="explore-deal-open" type="button" onClick={() => onOpen(deal)}>
      <div className="explore-deal-art" data-accent={accent}>
        <span className="explore-deal-category">{category?.label || deal.category || 'Service'}</span>
        <span className="explore-deal-badges"><small>{serviceType}</small>{packageCount > 1 && <small>{packageCount} packages</small>}{deal.sample && <small className="sample">Sample</small>}</span>
      </div>
      <div className="explore-deal-body">
        <div className="explore-deal-seller">
          <span className="explore-deal-avatar">{accent}</span>
          <span><strong>{deal.seller}</strong><small>{family?.label || 'Favourit service'} · {deal.delivery}</small></span>
          <small className="explore-deal-rating">★ {deal.rating || 'New'}</small>
        </div>
        <h3>{deal.title}</h3>
        <div className="explore-deal-meta"><span><small>Starting at</small><strong>{formatFav(deal.price * 1000000)} FAV</strong></span><small>{Number(deal.reviews || 0)} reviews</small></div>
      </div>
    </button>
    {deal.sample
      ? <span className="explore-sample-mark" title="Example listing shown until real services are published">Preview</span>
      : <button aria-label={favorite ? 'Unlike deal' : 'Like deal'} title={favorite ? 'Unlike deal' : 'Like deal'} className={favorite ? 'favorite active' : 'favorite'} type="button" onClick={() => onFavorite(deal.id)}>{favorite ? '♥' : '♡'}</button>}
  </article>;
}

function DealRail({ title, subtitle, deals, onOpen, favorites, onFavorite }) {
  if (!deals.length) return null;
  return <section>
    <div className="explore-section-head"><div><h2>{title}</h2><p>{subtitle}</p></div><span>{deals.length} services</span></div>
    <div className="explore-rail">{deals.map(deal => <DealCard key={deal.id} deal={deal} onOpen={onOpen} favorite={favorites.has(String(deal.id))} onFavorite={onFavorite} />)}</div>
  </section>;
}

export default function ExploreDealsPage({ query, setQuery, onOpen, onCreate, deals, favorites, onFavorite }) {
  const [categoryId, setCategoryId] = useState('all');
  const [familyId, setFamilyId] = useState('all');
  const [sort, setSort] = useState('recommended');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [delivery, setDelivery] = useState('any');
  const [rating, setRating] = useState('any');
  const [price, setPrice] = useState('any');

  const allDeals = useMemo(() => (Array.isArray(deals) ? deals : []).map(enrichedDeal), [deals]);
  const featuredCategories = useMemo(() => featuredCategoryIds.map(id => serviceCategories.find(category => category.id === id)).filter(Boolean), []);
  const selectedCategory = serviceCategories.find(category => category.id === categoryId) || null;
  const selectedFamily = serviceFamilies.find(family => family.id === familyId) || null;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const result = allDeals.filter(deal => {
      if (categoryId !== 'all' && deal._category?.id !== categoryId) return false;
      if (familyId !== 'all' && deal._category?.family !== familyId) return false;
      if (delivery !== 'any' && deal._deliveryDays > Number(delivery)) return false;
      if (rating !== 'any' && Number(deal.rating || 0) < Number(rating)) return false;
      if (price !== 'any' && Number(deal.price || 0) > Number(price)) return false;
      if (!term) return true;
      const haystack = [deal.title, deal.description, deal.seller, SERVICE_TYPE_LABELS[deal.serviceType], serviceSearchText(deal.category)].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(term);
    });
    const sorted = [...result];
    if (sort === 'price-low') sorted.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    else if (sort === 'price-high') sorted.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    else if (sort === 'rating') sorted.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || Number(b.reviews || 0) - Number(a.reviews || 0));
    else if (sort === 'newest') sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    else sorted.sort((a, b) => (Number(b.rating || 0) * Math.log10(Number(b.reviews || 0) + 10)) - (Number(a.rating || 0) * Math.log10(Number(a.reviews || 0) + 10)));
    return sorted;
  }, [allDeals, categoryId, familyId, delivery, rating, price, query, sort]);

  const recommended = useMemo(() => [...allDeals].sort((a, b) => (Number(b.rating || 0) * Math.log10(Number(b.reviews || 0) + 10)) - (Number(a.rating || 0) * Math.log10(Number(a.reviews || 0) + 10))).slice(0, 8), [allDeals]);
  const fastDelivery = useMemo(() => allDeals.filter(deal => deal._deliveryDays <= 2).sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0)).slice(0, 8), [allDeals]);
  const newAndWorthDiscovering = useMemo(() => [...allDeals].sort((a, b) => Number(a.reviews || 0) - Number(b.reviews || 0) || Number(b.rating || 0) - Number(a.rating || 0)).slice(0, 8), [allDeals]);

  const hasFilters = Boolean(query.trim() || categoryId !== 'all' || familyId !== 'all' || delivery !== 'any' || rating !== 'any' || price !== 'any');
  const reset = () => { setQuery(''); setCategoryId('all'); setFamilyId('all'); setDelivery('any'); setRating('any'); setPrice('any'); setSort('recommended'); };
  const chooseCategory = id => { setCategoryId(id); setFamilyId('all'); window.setTimeout(() => document.querySelector('.explore-all-services')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20); };
  const chooseFamily = id => { setFamilyId(id); setCategoryId('all'); window.setTimeout(() => document.querySelector('.explore-all-services')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20); };

  return <section className="page-section explore-page">
    <div className="explore-hero">
      <div className="explore-hero-top">
        <div><div className="eyebrow">EXPLORE FAVOURIT</div><h1>Find the right person for <span>what comes next.</span></h1><p>Remote professional services, coaching and digital expertise — clear scope, protected FAV payment and everything kept inside Favourit.</p></div>
        <button className="primary" type="button" onClick={onCreate}>+ Offer a service</button>
      </div>
      <div className="explore-search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search a service, skill, category or freelancer…" aria-label="Search Explore" /><button className="primary" type="button" onClick={() => document.querySelector('.explore-all-services')?.scrollIntoView({ behavior: 'smooth' })}>Search</button></div>
    </div>

    <div className="explore-featured-categories">
      <button className={`explore-chip ${categoryId === 'all' ? 'active' : ''}`} type="button" onClick={() => { setCategoryId('all'); setFamilyId('all'); }}>All services</button>
      {featuredCategories.map(category => <button key={category.id} className={`explore-chip ${categoryId === category.id ? 'active' : ''}`} type="button" onClick={() => chooseCategory(category.id)}>{category.label}</button>)}
    </div>

    <section className="explore-browse">
      <div className="explore-section-head"><div><h2>Browse by what you need</h2><p>44 approved service categories, grouped so Explore stays useful instead of chaotic.</p></div><span>{serviceCategories.length} categories</span></div>
      <div className="explore-family-grid">{serviceFamilies.map(family => {
        const categories = serviceCategories.filter(category => category.family === family.id);
        return <button key={family.id} type="button" className={`explore-family ${familyId === family.id ? 'active' : ''}`} onClick={() => chooseFamily(family.id)}>
          <span className="explore-family-icon">{family.icon}</span><strong>{family.label}</strong><small>{family.description}</small><em>{categories.slice(0, 3).map(item => item.label.replace(/ & .*/, '')).join(' · ')}{categories.length > 3 ? ` · +${categories.length - 3}` : ''}</em>
        </button>;
      })}</div>
    </section>

    {!hasFilters && <div className="explore-discovery">
      <DealRail title="Recommended on Favourit" subtitle="Strong services based on rating, reliability signals and marketplace activity." deals={recommended} onOpen={onOpen} favorites={favorites} onFavorite={onFavorite} />
      <DealRail title="Fast delivery" subtitle="Services that can get moving in one or two days." deals={fastDelivery} onOpen={onOpen} favorites={favorites} onFavorite={onFavorite} />
      <DealRail title="New & worth discovering" subtitle="Give newer sellers room to earn trust instead of rewarding only the biggest accounts." deals={newAndWorthDiscovering} onOpen={onOpen} favorites={favorites} onFavorite={onFavorite} />
    </div>}

    <section className="explore-all-services">
      <div className="explore-section-head"><div><h2>{selectedCategory?.label || selectedFamily?.label || 'Explore all services'}</h2><p>{hasFilters ? 'Results matching your current Explore filters.' : 'Browse the full marketplace and refine only when you need to.'}</p></div><span>{filtered.length} {filtered.length === 1 ? 'service' : 'services'}</span></div>
      <div className="explore-toolbar">
        <div className="search-box">⌕<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search services or people…" /></div>
        <select className="filter-select" value={sort} onChange={event => setSort(event.target.value)} aria-label="Sort Explore"><option value="recommended">Recommended</option><option value="rating">Highest rated</option><option value="newest">Newest</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select>
        <button type="button" className={`explore-toolbar-button ${filtersOpen ? 'active' : ''}`} onClick={() => setFiltersOpen(value => !value)}>Filters {hasFilters ? '•' : ''}</button>
      </div>
      {filtersOpen && <div className="explore-filter-panel">
        <label>Category<select value={categoryId} onChange={event => { setCategoryId(event.target.value); setFamilyId('all'); }}><option value="all">All categories</option>{serviceFamilies.map(family => <optgroup key={family.id} label={family.label}>{serviceCategories.filter(category => category.family === family.id).map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</optgroup>)}</select></label>
        <label>Delivery<select value={delivery} onChange={event => setDelivery(event.target.value)}><option value="any">Any delivery</option><option value="1">1 day</option><option value="2">Up to 2 days</option><option value="3">Up to 3 days</option><option value="7">Up to 7 days</option></select></label>
        <label>Seller rating<select value={rating} onChange={event => setRating(event.target.value)}><option value="any">Any rating</option><option value="4">4.0+</option><option value="4.5">4.5+</option><option value="4.8">4.8+</option></select></label>
        <label>Max price<select value={price} onChange={event => setPrice(event.target.value)}><option value="any">Any price</option><option value="150">150 FAV</option><option value="250">250 FAV</option><option value="500">500 FAV</option><option value="1000">1,000 FAV</option></select></label>
      </div>}
      {hasFilters && <div className="results-meta"><span>{selectedFamily && <span className="explore-active-filter">{selectedFamily.label}</span>}{selectedCategory && <span className="explore-active-filter">{selectedCategory.label}</span>}{query.trim() && <span className="explore-active-filter">“{query.trim()}”</span>}</span><button className="text-button" type="button" onClick={reset}>Clear all filters</button></div>}
      {filtered.length ? <div className="explore-all-grid">{filtered.map(deal => <DealCard key={deal.id} deal={deal} onOpen={onOpen} favorite={favorites.has(String(deal.id))} onFavorite={onFavorite} />)}</div> : <div className="explore-empty"><strong>No services match those filters.</strong><span>Try a broader category, delivery window or search phrase.</span><button className="secondary" type="button" onClick={reset}>Reset Explore</button></div>}
    </section>
  </section>;
}
