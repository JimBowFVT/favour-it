import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import './AdminPanel.css';

const ADMIN_EMAIL = 'adamzoharlevi@gmail.com';

export default function AdminPanel() {
  const [allowed, setAllowed] = useState(null);
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function checkAccess() {
    const { data: { user } } = await supabase.auth.getUser();
    const isAllowed = Boolean(user?.email && user.email.toLowerCase() === ADMIN_EMAIL);
    if (!isAllowed) {
      setAllowed(false);
      setLoading(false);
      return false;
    }
    const { data, error: accessError } = await supabase.rpc('is_favourit_admin');
    if (accessError) throw accessError;
    setAllowed(Boolean(data));
    return Boolean(data);
  }

  async function loadUsers(term = search) {
    setError('');
    try {
      const data = await supabase.rpc('admin_list_users', { p_search: term.trim() });
      if (data.error) throw data.error;
      setUsers(data.data || []);
    } catch (err) {
      setError(err.message || 'Could not load users.');
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const ok = await checkAccess();
        if (active && ok) await loadUsers('');
      } catch (err) {
        if (active) setError(err.message || 'Could not verify admin access.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function setMiddleman(user, enabled) {
    setWorkingId(user.user_id);
    setError('');
    setNotice('');
    try {
      const { error: actionError } = await supabase.rpc('admin_set_middleman_role', {
        p_user_id: user.user_id,
        p_enabled: enabled,
      });
      if (actionError) throw actionError;
      setNotice(enabled ? `${user.email || user.username || 'User'} is now a Middleman.` : `${user.email || user.username || 'User'} is no longer a Middleman.`);
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Could not change the role.');
    } finally {
      setWorkingId('');
    }
  }

  if (loading) return <div className="admin-shell"><div className="admin-loading">Checking admin access…</div></div>;
  if (!allowed) return <div className="admin-shell"><div className="admin-denied"><span>403</span><h1>Admin access only</h1><p>This area is restricted to the Favourit administrator.</p><a href="/">Return to Favourit</a></div></div>;

  return <main className="admin-shell">
    <header className="admin-header">
      <div>
        <div className="eyebrow">FAVOURIT CONTROL CENTER</div>
        <h1>Admin <span>Panel</span></h1>
        <p>Manage trusted roles and keep the marketplace under control.</p>
      </div>
      <div className="admin-identity"><small>ADMIN</small><strong>{ADMIN_EMAIL}</strong></div>
    </header>

    <section className="admin-card admin-users-card">
      <div className="admin-card-heading">
        <div><h2>User management</h2><p>Search a user and give or remove Middleman access.</p></div>
        <div className="admin-role-pill">● Middleman</div>
      </div>
      <form className="admin-search" onSubmit={e => { e.preventDefault(); loadUsers(); }}>
        <span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search email, username or name…"/><button className="primary" type="submit">Search</button>
      </form>
      {notice && <div className="admin-notice">✓ {notice}</div>}
      {error && <div className="admin-error">{error}</div>}
      <div className="admin-table">
        <div className="admin-row admin-row-head"><span>User</span><span>Role</span><span>Joined</span><span>Action</span></div>
        {users.map(user => <div className="admin-row" key={user.user_id}>
          <div className="admin-user"><div className="admin-avatar">{(user.display_name || user.username || user.email || 'U').slice(0,1).toUpperCase()}</div><div><strong>{user.display_name || user.username || 'Unnamed user'}</strong><small>{user.email || 'No email'}</small></div></div>
          <span className={`admin-role ${user.role}`}>{user.role}</span>
          <span className="admin-date">{user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</span>
          <div>{user.role === 'middleman' ? <button className="danger-button" disabled={workingId === user.user_id} onClick={() => setMiddleman(user, false)}>{workingId === user.user_id ? 'Saving…' : 'Remove'}</button> : user.role === 'admin' ? <span className="protected-role">Protected</span> : <button className="secondary" disabled={workingId === user.user_id} onClick={() => setMiddleman(user, true)}>{workingId === user.user_id ? 'Saving…' : 'Make Middleman'}</button>}</div>
        </div>)}
        {!users.length && <div className="admin-empty">No users found.</div>}
      </div>
    </section>

    <section className="admin-grid">
      <div className="admin-card admin-info"><span className="admin-icon">◈</span><h3>Middleman permissions</h3><p>Middlemen can mediate assigned orders, read the buyer–seller conversation, view escrow and resolve disputes.</p></div>
      <div className="admin-card admin-info"><span className="admin-icon">✓</span><h3>Protected role changes</h3><p>Only the allowlisted administrator can access this panel. Admin accounts cannot be replaced by the Middleman role.</p></div>
    </section>
  </main>;
}
