import { useEffect, useMemo, useState } from 'react';
import { formatFav } from '../lib/wallet';
import { assignOrderMiddleman, getAdminDashboardMetrics, getAdminMediationOrders, getAdminMiddlemen, unassignOrderMiddleman } from '../lib/staff';
import './AdminOperations.css';

const emptyMetrics = { users: 0, published_deals: 0, active_orders: 0, open_disputes: 0, middlemen: 0, open_reports: 0, available_fav: 0, held_fav: 0, platform_fav: 0 };
const compact = value => Number(value || 0).toLocaleString();
const fav = value => `${formatFav(Number(value || 0))} FAV`;

export default function AdminOperations() {
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [orders, setOrders] = useState([]);
  const [middlemen, setMiddlemen] = useState([]);
  const [filter, setFilter] = useState('attention');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setError('');
    try {
      const [stats, queue, staff] = await Promise.all([
        getAdminDashboardMetrics(),
        getAdminMediationOrders(),
        getAdminMiddlemen(),
      ]);
      setMetrics({ ...emptyMetrics, ...(stats || {}) });
      setOrders(queue);
      setMiddlemen(staff);
    } catch (e) {
      setError(e.message || 'Could not load operations data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return orders;
    if (filter === 'unassigned') return orders.filter(order => !order.middleman_id);
    if (filter === 'disputed') return orders.filter(order => order.status === 'disputed' || ['open', 'under_review'].includes(order.dispute_status));
    return orders.filter(order => order.status === 'disputed' || ['open', 'under_review'].includes(order.dispute_status) || !order.middleman_id);
  }, [orders, filter]);

  const assign = async (order, middlemanId) => {
    if (!middlemanId) return;
    setBusyId(order.order_id);
    setError('');
    setNotice('');
    try {
      await assignOrderMiddleman(order.order_id, middlemanId);
      const person = middlemen.find(item => item.user_id === middlemanId);
      setNotice(`${person?.display_name || `@${person?.username || 'Middleman'}`} was assigned to ${order.deal_title}.`);
      await refresh();
    } catch (e) {
      setError(e.message || 'Could not assign middleman.');
    } finally {
      setBusyId('');
    }
  };

  const unassign = async order => {
    setBusyId(order.order_id);
    setError('');
    setNotice('');
    try {
      await unassignOrderMiddleman(order.order_id);
      setNotice(`Middleman removed from ${order.deal_title}.`);
      await refresh();
    } catch (e) {
      setError(e.message || 'Could not unassign middleman.');
    } finally {
      setBusyId('');
    }
  };

  return <section className="admin-operations">
    <div className="admin-ops-heading">
      <div><div className="eyebrow">OPERATIONS</div><h2>Marketplace command center</h2><p>One view for economy health, active orders and human mediation.</p></div>
      <button className="secondary" type="button" onClick={refresh} disabled={loading}>↻ Refresh</button>
    </div>

    <div className="admin-metric-grid">
      <article><small>USERS</small><strong>{compact(metrics.users)}</strong><span>registered accounts</span></article>
      <article><small>ACTIVE ORDERS</small><strong>{compact(metrics.active_orders)}</strong><span>funded → disputed</span></article>
      <article className={Number(metrics.open_disputes) ? 'attention' : ''}><small>OPEN DISPUTES</small><strong>{compact(metrics.open_disputes)}</strong><span>need human review</span></article>
      <article className={Number(metrics.open_reports) ? 'attention' : ''}><small>OPEN REPORTS</small><strong>{compact(metrics.open_reports)}</strong><span>moderation queue</span></article>
      <article><small>PUBLISHED DEALS</small><strong>{compact(metrics.published_deals)}</strong><span>live marketplace offers</span></article>
      <article><small>MIDDLEMEN</small><strong>{compact(metrics.middlemen)}</strong><span>trusted mediators</span></article>
    </div>

    <div className="admin-economy-strip">
      <div><small>USER AVAILABLE</small><strong>{fav(metrics.available_fav)}</strong></div>
      <div><small>HELD IN ESCROW</small><strong>{fav(metrics.held_fav)}</strong></div>
      <div><small>PLATFORM FEES</small><strong>{fav(metrics.platform_fav)}</strong></div>
    </div>

    {notice && <div className="admin-notice">✓ {notice}</div>}
    {error && <div className="admin-error">{error}</div>}

    <div className="admin-queue-card">
      <div className="admin-queue-head">
        <div><h3>Mediation queue</h3><p>Assign a trusted Middleman before a dispute becomes a support bottleneck.</p></div>
        <div className="admin-queue-filters">
          {['attention','disputed','unassigned','all'].map(item => <button key={item} type="button" className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}
        </div>
      </div>

      {loading ? <div className="admin-empty">Loading marketplace operations…</div> : filtered.length ? <div className="admin-order-queue">
        {filtered.map(order => <article className={`admin-order-case ${order.status === 'disputed' ? 'disputed' : ''}`} key={order.order_id}>
          <div className="admin-case-main">
            <div className="admin-case-top"><span className={`admin-case-status ${order.status}`}>{order.status}</span><small>{String(order.order_id).slice(0,8)} · {new Date(order.created_at).toLocaleString()}</small></div>
            <h4>{order.deal_title}</h4>
            <div className="admin-case-people"><span>Buyer <b>@{order.buyer_username || 'member'}</b></span><span>Seller <b>@{order.seller_username || 'member'}</b></span><span>Escrow <b>{fav(order.amount_fav)}</b></span></div>
            {order.dispute_id && <div className="admin-case-dispute"><strong>{order.dispute_status || 'Dispute'}</strong><p>{order.dispute_reason || 'No dispute reason provided.'}</p></div>}
          </div>
          <div className="admin-case-assignment">
            <small>MIDDLEMAN</small>
            {order.middleman_id ? <><strong>{order.middleman_display_name || `@${order.middleman_username}`}</strong><span>@{order.middleman_username || 'middleman'} · assigned {order.assigned_at ? new Date(order.assigned_at).toLocaleDateString() : 'recently'}</span><button className="danger-button" type="button" disabled={busyId === order.order_id} onClick={() => unassign(order)}>Unassign</button></> : <><strong>Unassigned</strong><span>Choose a mediator for this order.</span><select disabled={busyId === order.order_id || !middlemen.length} defaultValue="" onChange={event => { const id = event.target.value; event.target.value = ''; assign(order, id); }}><option value="" disabled>{middlemen.length ? 'Assign Middleman…' : 'No Middlemen available'}</option>{middlemen.map(person => <option key={person.user_id} value={person.user_id}>{person.display_name || `@${person.username}`} · {person.active_assignments} active</option>)}</select></>}
          </div>
        </article>)}
      </div> : <div className="admin-empty">Nothing matches this queue. That is a good sign.</div>}
    </div>
  </section>;
}
