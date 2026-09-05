import { useEffect, useMemo, useState } from 'react';
import { formatFav } from '../lib/wallet';
import { getMyMiddlemanQueue, getMyStaffRole } from '../lib/staff';
import { getAssignedOrderConversation, getAssignedConversationMessages, markMiddlemanConversationRead, middlemanCancelOrder, middlemanResolveDispute } from '../lib/middleman';
import './MiddlemanPanel.css';

const fav = value => `${formatFav(Number(value || 0))} FAV`;
const statusLabel = value => String(value || '').replaceAll('_', ' ');

export default function MiddlemanPanel() {
  const [role, setRole] = useState(null);
  const [queue, setQueue] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');

  const selected = useMemo(() => queue.find(item => item.order_id === selectedId) || null, [queue, selectedId]);

  const refreshQueue = async keepSelection => {
    const data = await getMyMiddlemanQueue();
    setQueue(data);
    if (keepSelection && data.some(item => item.order_id === keepSelection)) setSelectedId(keepSelection);
    else if (!selectedId && data[0]) setSelectedId(data[0].order_id);
    else if (selectedId && !data.some(item => item.order_id === selectedId)) setSelectedId(data[0]?.order_id || '');
    return data;
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const staffRole = await getMyStaffRole();
        if (!active) return;
        setRole(staffRole);
        if (staffRole === 'middleman') await refreshQueue();
      } catch (e) {
        if (active) setError(e.message || 'Could not verify Middleman access.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId || role !== 'middleman') {
      setConversationId('');
      setMessages([]);
      return undefined;
    }
    let active = true;
    const load = async () => {
      setThreadLoading(true);
      try {
        const conversation = await getAssignedOrderConversation(selectedId);
        if (!active) return;
        const id = conversation?.conversation_id || '';
        setConversationId(id);
        if (!id) {
          setMessages([]);
          return;
        }
        const rows = await getAssignedConversationMessages(id);
        if (!active) return;
        setMessages(rows || []);
        await markMiddlemanConversationRead(id).catch(() => {});
      } catch (e) {
        if (active) setError(e.message || 'Could not load the order conversation.');
      } finally {
        if (active) setThreadLoading(false);
      }
    };
    load();
    const timer = window.setInterval(load, 3500);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedId, role]);

  const openDispute = async () => {
    if (!selected || busy) return;
    const reason = window.prompt('Why does this order need mediation? Give enough context for the audit log.');
    if (!reason?.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await middlemanCancelOrder(selected.order_id, reason.trim());
      setNotice('Order moved to dispute review. Funds remain protected while you investigate.');
      await refreshQueue(selected.order_id);
    } catch (e) {
      setError(e.message || 'Could not open mediation.');
    } finally { setBusy(false); }
  };

  const resolve = async resolution => {
    if (!selected?.dispute_id || busy) return;
    const labels = { refund_buyer: 'refund the buyer', release_seller: 'release funds to the seller', none: 'close the dispute without moving funds' };
    if (!window.confirm(`Confirm: ${labels[resolution]}? This action is audited and may move escrowed FAV.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await middlemanResolveDispute(selected.dispute_id, resolution, resolutionNote.trim());
      setResolutionNote('');
      setNotice(`Dispute resolved: ${labels[resolution]}.`);
      await refreshQueue(selected.order_id);
    } catch (e) {
      setError(e.message || 'Could not resolve dispute.');
    } finally { setBusy(false); }
  };

  if (loading) return <main className="middleman-shell"><div className="middleman-state"><span className="middleman-spinner"/><h2>Opening mediation desk…</h2></div></main>;
  if (role !== 'middleman') return <main className="middleman-shell"><div className="middleman-state"><strong>403</strong><h1>Middleman access only</h1><p>This workspace is available only to users who were explicitly assigned the Middleman role.</p><a href="/">Return to Favourit</a></div></main>;

  return <main className="middleman-shell">
    <header className="middleman-header">
      <div><div className="eyebrow">FAVOURIT TRUST & SAFETY</div><h1>Middleman <span>Desk</span></h1><p>Review assigned orders, inspect the buyer–seller conversation and make audited escrow decisions.</p></div>
      <div className="middleman-header-actions"><span>● Trusted role</span><a href="/">Back to Favourit</a></div>
    </header>

    {notice && <div className="middleman-notice">✓ {notice}</div>}
    {error && <div className="middleman-error">{error}</div>}

    <div className="middleman-layout">
      <aside className="middleman-queue">
        <div className="middleman-queue-head"><div><small>ASSIGNED CASES</small><strong>{queue.length}</strong></div><button type="button" onClick={() => refreshQueue(selectedId)}>↻</button></div>
        <div className="middleman-case-list">{queue.length ? queue.map(item => <button type="button" key={item.order_id} className={selectedId === item.order_id ? 'active' : ''} onClick={() => { setSelectedId(item.order_id); setError(''); setNotice(''); }}>
          <div><span className={`middleman-status ${item.order_status}`}>{statusLabel(item.order_status)}</span><time>{new Date(item.assigned_at).toLocaleDateString()}</time></div>
          <strong>{item.deal_title}</strong>
          <small>@{item.buyer_username || 'buyer'} ↔ @{item.seller_username || 'seller'}</small>
          {item.dispute_id && <em>Dispute: {statusLabel(item.dispute_status)}</em>}
        </button>) : <div className="middleman-empty"><strong>No active assignments.</strong><span>New cases assigned by an admin will appear here.</span></div>}</div>
      </aside>

      <section className="middleman-workspace">
        {!selected ? <div className="middleman-empty large"><strong>No case selected.</strong><span>Select an assigned order to begin review.</span></div> : <>
          <div className="middleman-case-header">
            <div><div className="eyebrow">ORDER {String(selected.order_id).slice(0,8)}</div><h2>{selected.deal_title}</h2><p>Assigned {new Date(selected.assigned_at).toLocaleString()}</p></div>
            <span className={`middleman-status large ${selected.order_status}`}>{statusLabel(selected.order_status)}</span>
          </div>

          <div className="middleman-case-metrics">
            <div><small>ESCROW</small><strong>{fav(selected.amount_fav)}</strong></div>
            <div><small>PLATFORM FEE</small><strong>{fav(selected.fee_fav)}</strong></div>
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('favourit:open-profile', { detail: { userId: selected.buyer_id } }))}><small>BUYER</small><strong>@{selected.buyer_username || 'buyer'}</strong></button>
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('favourit:open-profile', { detail: { userId: selected.seller_id } }))}><small>SELLER</small><strong>@{selected.seller_username || 'seller'}</strong></button>
          </div>

          {selected.dispute_id ? <div className="middleman-dispute-box"><div><small>OPEN DISPUTE</small><strong>{statusLabel(selected.dispute_status)}</strong></div><p>{selected.dispute_reason || 'No reason provided.'}</p></div> : <div className="middleman-pre-dispute"><div><strong>No dispute is open.</strong><span>If the evidence requires intervention, move the order into dispute review. This does not refund either side by itself.</span></div><button className="secondary" disabled={busy} type="button" onClick={openDispute}>Open mediation</button></div>}

          <div className="middleman-thread-card">
            <div className="middleman-thread-head"><div><strong>Order conversation</strong><span>Read-only evidence view</span></div>{conversationId && <span className="middleman-secure-pill">◈ Secured</span>}</div>
            <div className="middleman-messages">{threadLoading && !messages.length ? <div className="middleman-empty"><span>Loading conversation…</span></div> : messages.length ? messages.map(message => {
              const buyer = message.sender_id === selected.buyer_id;
              const seller = message.sender_id === selected.seller_id;
              const name = buyer ? selected.buyer_display_name || selected.buyer_username : seller ? selected.seller_display_name || selected.seller_username : 'System / staff';
              return <article key={message.id} className={buyer ? 'buyer' : seller ? 'seller' : ''}><header><strong>{name}</strong><span>{buyer ? 'Buyer' : seller ? 'Seller' : 'Staff'} · {new Date(message.created_at).toLocaleString()}</span></header><p>{message.body}</p></article>;
            }) : <div className="middleman-empty"><strong>No order chat yet.</strong><span>There is no conversation evidence attached to this order yet.</span></div>}</div>
          </div>

          {selected.dispute_id && <div className="middleman-resolution">
            <div className="middleman-resolution-copy"><div className="eyebrow">FINAL DECISION</div><h3>Resolve escrow</h3><p>Use the listing, order status, timestamps and chat evidence. Every decision is recorded in the moderation audit log.</p><textarea value={resolutionNote} maxLength={2000} onChange={event => setResolutionNote(event.target.value)} placeholder="Decision note / evidence summary…"/></div>
            <div className="middleman-resolution-actions"><button disabled={busy} className="refund" type="button" onClick={() => resolve('refund_buyer')}>↩ Refund buyer</button><button disabled={busy} className="release" type="button" onClick={() => resolve('release_seller')}>✓ Release seller</button><button disabled={busy} className="neutral" type="button" onClick={() => resolve('none')}>Close without transfer</button></div>
          </div>}
        </>}
      </section>
    </div>
  </main>;
}
