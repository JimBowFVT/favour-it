import { supabase } from './supabase';

export const DEAL_REPORT_REASONS = [
  'Misleading or deceptive listing',
  'Prohibited or unsafe service',
  'Spam or low-quality listing',
  'Fraud or payment scam',
  'Copyright or impersonation concern',
  'Harassment or abusive content',
  'Other marketplace policy issue',
];

export async function reportDeal(dealId, reason, details = '') {
  const cleanReason = String(reason || '').trim();
  const cleanDetails = String(details || '').trim();
  if (!dealId) throw new Error('A valid deal is required.');
  if (!DEAL_REPORT_REASONS.includes(cleanReason)) throw new Error('Choose a report reason.');
  if (cleanDetails.length > 2000) throw new Error('Report details must be 2,000 characters or less.');

  const { data, error } = await supabase.rpc('report_deal', {
    p_deal_id: dealId,
    p_reason: cleanReason,
    p_details: cleanDetails,
  });
  if (error) throw error;
  return data;
}

export async function adminListDealReports() {
  const { data, error } = await supabase.rpc('admin_list_deal_reports');
  if (error) throw error;
  return data || [];
}

export async function adminModerateDeal(dealId, action) {
  const normalizedAction = String(action || '').toLowerCase();
  if (!['pause', 'restore', 'archive'].includes(normalizedAction)) throw new Error('Unsupported moderation action.');
  const { data, error } = await supabase.rpc('admin_moderate_deal', {
    p_deal_id: dealId,
    p_action: normalizedAction,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function resolveDealReport(reportId, status, note = '') {
  const { data, error } = await supabase.rpc('resolve_report', {
    p_report_id: reportId,
    p_status: status,
    p_note: String(note || '').trim(),
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
