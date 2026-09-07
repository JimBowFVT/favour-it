import { favDecimal } from './favAmounts';

export const WALLET_TYPES = ['all', 'daily_reward', 'premium_reward', 'purchase', 'escrow_hold', 'escrow_release', 'refund', 'fee', 'sale', 'adjustment'];
export const WALLET_STATUSES = ['all', 'posted', 'funded', 'in_progress', 'delivered', 'disputed', 'completed', 'cancelled'];
export function validateWalletFilters(input = {}) {
  const filters = { type: input.type || 'all', status: input.status || 'all', search: String(input.search || '').trim(), from: input.from || '', to: input.to || '' };
  if (!WALLET_TYPES.includes(filters.type) || !WALLET_STATUSES.includes(filters.status) || filters.search.length > 200) throw new Error('Check the activity filters.');
  for (const value of [filters.from, filters.to]) {
    if (!value) continue;
    const date = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Choose a valid date.');
  }
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('The end date must follow the start date.');
  return filters;
}

// Session comparisons prevent stale UI/downloads. Authorization remains in the RPCs.
export function createWalletApi(client, expectedUserId) {
  const assertOwner = async () => {
    if (!client || !expectedUserId) throw new Error('Sign in to open your wallet.');
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data?.session?.user?.id !== expectedUserId) throw new Error('Your signed-in account changed. Reopen Wallet.');
  };
  const rpc = async (name, args = {}) => {
    await assertOwner();
    const { data, error } = await client.rpc(name, args);
    await assertOwner();
    if (error) throw error;
    if (data === null || data === undefined) throw new Error('Wallet data is unavailable. Refresh and try again.');
    return data;
  };
  return {
    overview: () => rpc('get_my_wallet_overview'),
    rewardStatus: () => rpc('get_my_daily_reward_status'),
    prepareReward: () => rpc('record_my_reward_visit'),
    claimReward: offerId => {
      if (!offerId) return Promise.reject(new Error('Refresh today’s reward offer before claiming.'));
      return rpc('claim_my_daily_reward', { p_offer_id: offerId });
    },
    activity: (filters, cursor = null, cutoff = null) => rpc('list_my_wallet_activity', { p_filters: validateWalletFilters(filters), p_cursor: cursor, p_limit: 30, p_cutoff: cutoff }),
    transaction: id => rpc('get_my_wallet_transaction', { p_transaction_id: id }),
    support: (id, details) => {
      const text = String(details || '').trim();
      if (text.length < 10 || text.length > 3600) return Promise.reject(new Error('Describe the issue in 10 to 3600 characters.'));
      return rpc('submit_my_wallet_support_request', { p_transaction_id: id, p_details: text, p_expected_user_id: expectedUserId });
    },
    async statement(filters) {
      const statement = await rpc('begin_my_wallet_statement', { p_filters: validateWalletFilters(filters), p_expected_user_id: expectedUserId });
      if (!statement.id || !Number.isInteger(statement.row_count) || statement.row_count < 0 || statement.row_count > 100000) throw new Error('Invalid statement response.');
      const items = [];
      let cursor = null;
      const ids = new Set();
      do {
        const page = await rpc('get_my_wallet_statement_page', { p_statement_id: statement.id, p_cursor: cursor, p_limit: 200 });
        if (page.cutoff !== statement.cutoff || !Array.isArray(page.items)) throw new Error('The statement snapshot changed. Start the download again.');
        for (const item of page.items) {
          if (!item.id || ids.has(item.id)) throw new Error('Duplicate or invalid statement transaction.');
          ids.add(item.id); items.push(item);
        }
        if (items.length > statement.row_count) throw new Error('Statement row count mismatch.');
        if (page.next_cursor !== null && (!Number.isInteger(page.next_cursor) || page.next_cursor <= (cursor ?? 0) || page.next_cursor >= statement.row_count)) throw new Error('Invalid statement pagination.');
        cursor = page.next_cursor;
      } while (cursor !== null);
      if (items.length !== statement.row_count) throw new Error('The statement is incomplete. Start the download again.');
      await assertOwner();
      return { ...statement, items };
    },
  };
}
function csvCell(value) {
  let text = String(value ?? '');
  // Quoting alone does not prevent a spreadsheet from evaluating user content.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function walletStatementCsv(statement) {
  const fields = ['Statement ID', 'Snapshot (UTC)', 'Reference', 'Posted (UTC)', 'Type', 'Description', 'Available change (FAV)', 'Held change (FAV)', 'Order ID', 'Order status'];
  const rows = statement.items.map(item => [statement.id, statement.cutoff, item.id, item.created_at, item.entry_type, item.description, favDecimal(item.amount_fav), item.held_change_fav == null ? '' : favDecimal(item.held_change_fav), item.order_id, item.order_status]);
  return '\uFEFF' + [fields, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
