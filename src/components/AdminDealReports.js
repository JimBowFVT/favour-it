import { useEffect, useState } from 'react';
import { adminListDealReports, adminModerateDeal, resolveDealReport } from '../lib/dealReports';
import './AdminDealReports.css';

export default function AdminDealReports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try { setReports(await adminListDealReports()); }
    catch (err) { setError(err.message || 'Could not load marketplace reports.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const updateReport = async (report, status) => {
    setWorking(`report:${report.report_id}`);
    setError(''); setNotice('');
    try {
      await resolveDealReport(report.report_id, status, `Marketplace report marked ${status}.`);
      setNotice(`Report marked ${status}.`);
      await load();
    } catch (err) { setError(err.message || 'Could not update this report.'); }
    finally { setWorking(''); }
  };

  const moderate = async (report, action) => {
    const labels = { pause: 'pause this listing', restore: 'restore this listing', archive: 'permanently archive this listing' };
    if (action === 'archive' && !window.confirm('Archive this deal? The seller will not be able to republish it, while existing orders stay intact.')) return;
    setWorking(`deal:${report.deal_id}`);
    setError(''); setNotice('');
    try {
      await adminModerateDeal(report.deal_id, action);
      setNotice(`Listing moderation action completed: ${labels[action]}.`);
      await load();
    } catch (err) { setError(err.message || 'Could not moderate this listing.'); }
    finally { setWorking(''); }
  };

  return <section className="admin-deal-reports admin-card">
    <div className="admin-card-heading"><div><h2>Marketplace reports</h2><p>Review reported service listings and hide unsafe or prohibited offers without changing existing order snapshots.</p></div><button className="secondary" onClick={load}>Refresh</button></div>
    {notice && <div className="admin-notice">✓ {notice}</div>}
    {error && <div className="admin-error">{error}</div>}
    {loading ? <div className="admin-empty">Loading marketplace reports…</div> : !reports.length ? <div className="admin-empty">No marketplace listing reports yet.</div> : <div className="admin-deal-report-list">{reports.map(report => {
      const reportBusy = working === `report:${report.report_id}`;
      const dealBusy = working === `deal:${report.deal_id}`;
      const closed = ['resolved', 'dismissed'].includes(report.report_status);
      return <article className="admin-deal-report" key={report.report_id}>
        <div className="admin-deal-report-top">
          <div><strong>{report.deal_title}</strong><small>Seller @{report.seller_username || 'member'} · reported by @{report.reporter_username || 'member'} · {new Date(report.created_at).toLocaleString()}</small></div>
          <div className="admin-deal-statuses"><span className={`admin-marketplace-status ${report.deal_status}`}>{report.deal_status}</span><span className={`report-status ${report.report_status}`}>{report.report_status}</span></div>
        </div>
        <div className="admin-deal-report-reason"><b>{report.reason}</b><p>{report.details || 'No additional context supplied.'}</p></div>
        <div className="admin-deal-report-actions">
          <div className="admin-listing-actions">
            {report.deal_status === 'published' && <button className="secondary" disabled={dealBusy} onClick={() => moderate(report, 'pause')}>Pause listing</button>}
            {report.deal_status === 'paused' && <button className="secondary" disabled={dealBusy} onClick={() => moderate(report, 'restore')}>Restore listing</button>}
            {report.deal_status !== 'archived' && <button className="danger-button" disabled={dealBusy} onClick={() => moderate(report, 'archive')}>{dealBusy ? 'Saving…' : 'Archive listing'}</button>}
            {report.deal_status === 'archived' && <span className="admin-deal-archived">Archived · historical orders preserved</span>}
          </div>
          <div className="admin-report-resolution">
            {!closed && report.report_status === 'open' && <button className="secondary" disabled={reportBusy} onClick={() => updateReport(report, 'reviewing')}>Review</button>}
            {!closed && <button className="secondary" disabled={reportBusy} onClick={() => updateReport(report, 'dismissed')}>Dismiss</button>}
            {!closed && <button className="primary" disabled={reportBusy} onClick={() => updateReport(report, 'resolved')}>Resolve</button>}
          </div>
        </div>
      </article>;
    })}</div>}
  </section>;
}
