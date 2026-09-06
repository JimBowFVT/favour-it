import { formatFav } from '../lib/wallet';
import './ManageDealsPage.css';

const STATUS_COPY = {
  published: { label: 'Live', copy: 'Buyers can find and purchase this deal.' },
  paused: { label: 'Paused', copy: 'Hidden from buyers until you republish it.' },
  draft: { label: 'Draft', copy: 'Not visible to buyers yet.' },
  archived: { label: 'Archived', copy: 'Permanently removed from future purchases.' },
};

function DealStatus({ status }) {
  const current = STATUS_COPY[status] || { label: status || 'Unknown', copy: '' };
  return <span className={`manage-deal-status status-${status || 'unknown'}`}>{current.label}</span>;
}

export default function ManageDealsPage({ deals = [], onCreate, onEdit, onStatus, busy }) {
  const published = deals.filter(item => item.status === 'published').length;
  const paused = deals.filter(item => item.status === 'paused').length;
  const archived = deals.filter(item => item.status === 'archived').length;

  const changeStatus = (deal, status) => {
    if (busy) return;
    if (status === 'archived') {
      const confirmed = window.confirm('Archive this deal? It will stay in order history but cannot be republished.');
      if (!confirmed) return;
    }
    onStatus(deal, status);
  };

  return <section className="page-section manage-deals-page">
    <div className="manage-deals-hero">
      <div>
        <div className="eyebrow">SELLER WORKSPACE</div>
        <h1>Your services, <span>under your control.</span></h1>
        <p>Edit future listing details, pause availability or archive services without changing the immutable scope of orders already purchased.</p>
      </div>
      <button className="primary" onClick={onCreate} disabled={busy}>+ Create a deal</button>
    </div>

    <div className="manage-deals-stats">
      <div><small>LIVE</small><strong>{published}</strong><span>published services</span></div>
      <div><small>PAUSED</small><strong>{paused}</strong><span>temporarily hidden</span></div>
      <div><small>ARCHIVED</small><strong>{archived}</strong><span>historical listings</span></div>
      <div><small>TOTAL</small><strong>{deals.length}</strong><span>seller listings</span></div>
    </div>

    {deals.length ? <div className="manage-deals-list">
      {deals.map(deal => {
        const status = STATUS_COPY[deal.status] || STATUS_COPY.draft;
        return <article className={`manage-deal-card ${deal.status === 'archived' ? 'is-archived' : ''}`} key={deal.id}>
          <div className="manage-deal-main">
            <div className="manage-deal-heading">
              <DealStatus status={deal.status} />
              <span>{deal.category}</span>
            </div>
            <h2>{deal.title}</h2>
            <p>{deal.description}</p>
            <div className="manage-deal-meta">
              <span><small>STARTING AT</small><strong>{formatFav(deal.priceFav)} FAV</strong></span>
              <span><small>PACKAGES</small><strong>{deal.packages?.length || 1}</strong></span>
              <span><small>FASTEST DELIVERY</small><strong>{deal.deliveryDays || 1} day{Number(deal.deliveryDays || 1) === 1 ? '' : 's'}</strong></span>
              <span><small>STATUS</small><strong>{status.copy}</strong></span>
            </div>
          </div>

          <div className="manage-deal-actions">
            {deal.status !== 'archived' && <button className="secondary" onClick={() => onEdit(deal)} disabled={busy}>Edit</button>}
            {deal.status === 'published' && <button className="secondary" onClick={() => changeStatus(deal, 'paused')} disabled={busy}>Pause</button>}
            {['paused', 'draft'].includes(deal.status) && <button className="primary" onClick={() => changeStatus(deal, 'published')} disabled={busy}>Publish</button>}
            {deal.status !== 'archived' && <button className="manage-deal-archive" onClick={() => changeStatus(deal, 'archived')} disabled={busy}>Archive</button>}
          </div>
        </article>;
      })}
    </div> : <div className="empty-state manage-deals-empty">
      <h2>You have not published a service yet.</h2>
      <p>Create a clear remote service with Basic, Standard and optional Premium packages.</p>
      <button className="primary" onClick={onCreate}>Create your first deal →</button>
    </div>}
  </section>;
}
