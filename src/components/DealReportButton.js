import { useState } from 'react';
import { DEAL_REPORT_REASONS, reportDeal } from '../lib/dealReports';
import './DealReportButton.css';

export default function DealReportButton({ dealId, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(DEAL_REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError('');
  };

  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await reportDeal(dealId, reason, details);
      setSubmitted(true);
      setDetails('');
    } catch (err) {
      setError(err.message || 'Could not submit this report.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <button type="button" className="deal-report-trigger" disabled={disabled} onClick={() => { setSubmitted(false); setOpen(true); }}>Report this listing</button>
    {open && <div className="deal-report-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <section className="deal-report-dialog" role="dialog" aria-modal="true" aria-labelledby="deal-report-title">
        <button className="deal-report-close" type="button" aria-label="Close report dialog" onClick={close}>×</button>
        {submitted ? <div className="deal-report-success">
          <span>✓</span>
          <h2 id="deal-report-title">Report received</h2>
          <p>Favourit moderation can review the listing and hide or archive it if it violates marketplace rules.</p>
          <button className="primary full" type="button" onClick={close}>Done</button>
        </div> : <form onSubmit={submit}>
          <div className="eyebrow">MARKETPLACE SAFETY</div>
          <h2 id="deal-report-title">Report this listing</h2>
          <p>Use this for misleading, prohibited, unsafe or abusive services. Order disputes should be opened from the order itself.</p>
          <label>Reason<select value={reason} onChange={event => setReason(event.target.value)}>{DEAL_REPORT_REASONS.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>What should moderators know? <small>Optional</small><textarea value={details} maxLength="2000" rows="5" onChange={event => setDetails(event.target.value)} placeholder="Add specific context that will help the moderator review the listing…" /><span>{details.length}/2000</span></label>
          {error && <div className="deal-report-error">{error}</div>}
          <div className="deal-report-actions"><button className="secondary" type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit report'}</button></div>
        </form>}
      </section>
    </div>}
  </>;
}
