import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export function applicationCsv(rows) {
  const escape = input => {
    let value = String(input ?? '');
    if (/^[\s]*[=+@-]|^[\t\r\n]/.test(value)) value = `'${value}`;
    return `"${value.replace(/"/g, '""')}"`;
  };
  const headers = ['Application ID','Created UTC','Name','Email','Area','Offer','Need','Portfolio','Availability','Status','Contact consent at submission','Digest consent','Consent version','Source','Medium','Campaign','Referral','Notes'];
  return [headers, ...rows.map(row => [row.id,row.created_at,row.name,row.email,row.area,row.offer,row.need,row.portfolio,row.availability,row.status,row.contact_consent,row.digest_consent,row.consent_version,row.attribution?.source,row.attribution?.medium,row.attribution?.campaign,row.attribution?.referral,row.notes])].map(row => row.map(escape).join(',')).join('\r\n');
}

const statuses = ['applied','interviewing','shortlisted','waitlisted','invited','declined','withdrawn'];
export default function AdminFoundingCreators({ client = supabase }) {
  const [rows,setRows] = useState([]); const [filter,setFilter] = useState('');
  const [open,setOpen] = useState(false); const [error,setError] = useState('');
  const [busy,setBusy] = useState(false); const [ready,setReady] = useState(false);
  const [gateConfirmed,setGateConfirmed] = useState(false);
  const [dirtyIds,setDirtyIds] = useState(new Set());
  const [notice,setNotice] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      if (!client) return;
      try {
        const [applications, programme] = await Promise.all([client.rpc('admin_list_founding_applications',{p_status:filter}),client.rpc('get_founding_programme')]);
        if (applications.error) throw applications.error;
        if (programme.error) throw programme.error;
        if (active) { setRows(applications.data || []); setDirtyIds(new Set()); setOpen(programme.data?.applications_open === true); setReady(true); setError(''); }
      } catch (e) { if(active) { setError(e.message); setReady(false); } }
    }
    load(); return () => { active=false; };
  },[client,filter]);
  async function setIntake() {
    setBusy(true); setError('');
    try { const {error:e}=await client.rpc('admin_set_founding_applications_open',{p_open:!open}); if(e) throw e; setOpen(!open); setGateConfirmed(false); }
    catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  async function save(row) {
    setBusy(true); setError(''); setNotice('');
    try {
      const {error:e}=await client.rpc('admin_update_founding_application',{p_id:row.id,p_status:row.status,p_notes:row.notes}); if(e)throw e;
      setRows(previous=>previous.map(item=>item.id===row.id?{...item,digest_consent:row.status==='withdrawn'?false:item.digest_consent}:item));
      setDirtyIds(previous=>{const next=new Set(previous);next.delete(row.id);return next;});
      setNotice('Review saved.');
    }
    catch(e){setError(e.message);} finally {setBusy(false);}
  }
  const edit = (id,key,value) => {setRows(previous=>previous.map(row=>row.id===id?{...row,[key]:value}:row));setDirtyIds(previous=>new Set([...previous,id]));setNotice('');};
  function exportRows() {
    const url=URL.createObjectURL(new Blob(['\ufeff',applicationCsv(rows)],{type:'text/csv;charset=utf-8;'}));
    const a=document.createElement('a'); a.href=url; a.download='favourit-founding-applications.csv'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className="admin-card" aria-labelledby="founding-admin-title">
    <h2 id="founding-admin-title">Founding creators</h2><p>Research and recruitment only. Status changes do not admit accounts, send emails, or affect wallets.</p>
    {error && <p role="alert" className="admin-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {ready && <><p>Application collection is <strong>{open?'open':'closed'}</strong>.</p>
    {!open && <label style={{display:'block',margin:'16px 0'}}><input type="checkbox" checked={gateConfirmed} onChange={e=>setGateConfirmed(e.target.checked)} /> I have reviewed the public contact and privacy notice, interview findings, and readiness to handle applications. This does not open service trading.</label>}
    <button type="button" className="secondary" onClick={setIntake} disabled={busy||(!open&&!gateConfirmed)}>{open?'Close application collection':'Open application collection'}</button>
    <div style={{display:'flex',flexWrap:'wrap',gap:16,margin:'24px 0'}}><label>Application status <select value={filter} disabled={busy||dirtyIds.size>0} onChange={e=>setFilter(e.target.value)}><option value="">All</option>{statuses.map(status=><option key={status}>{status}</option>)}</select></label><button type="button" className="secondary" onClick={exportRows} disabled={!rows.length||busy||dirtyIds.size>0}>Export displayed applications</button></div>
    {dirtyIds.size>0 && <p>Save edited reviews before changing the filter or exporting applications.</p>}
    <p>{rows.length} applications shown, up to 500. Keep exported files private. Exclude withdrawn people from all outreach and digest lists. Review research records older than 90 days for deletion.</p>
    {!rows.length && <p>No applications match this view.</p>}
    {rows.map(row=><article key={row.id} style={{borderTop:'1px solid #404052',padding:'24px 0'}}><h3>{row.name}</h3><p>{row.email} · {row.area} · {new Date(row.created_at).toLocaleDateString()}</p><p><strong>Offers:</strong> {row.offer}</p><p><strong>Needs:</strong> {row.need}</p><p><strong>Availability:</strong> {row.availability}</p><p><strong>Portfolio:</strong> {row.portfolio}</p><p>Source: {row.attribution?.source || 'direct'} · Digest: {row.digest_consent && row.status!=='withdrawn'?'opted in':'not opted in'}</p><label>Status <select value={row.status} disabled={busy} onChange={e=>edit(row.id,'status',e.target.value)}>{statuses.map(status=><option key={status}>{status}</option>)}</select></label><label style={{display:'block',marginTop:12}}>Private notes<textarea rows="3" disabled={busy} maxLength="3000" style={{display:'block',width:'100%',margin:'8px 0'}} value={row.notes} onChange={e=>edit(row.id,'notes',e.target.value)} /></label><button type="button" className="secondary" onClick={()=>save(row)} disabled={busy}>Save review</button></article>)}</>}
  </section>;
}

