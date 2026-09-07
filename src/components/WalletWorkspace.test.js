import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WalletPage from './WalletPage';
import DailyRewardCard from './DailyRewardCard';
import AppSidebar from './AppSidebar';
import CryptoWalletPanel from './CryptoWalletPanel';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({ supabase: { auth: { getSession: jest.fn(), onAuthStateChange: jest.fn() }, rpc: jest.fn(), from: jest.fn() } }));

const owner = 'member-a';
const cutoff = '2026-09-07T12:00:00Z';
const event = { id: 'transaction-a', created_at: cutoff, label: 'Service earned', description: 'Original service scope', entry_type: 'sale', amount_fav: '97000000', held_change_fav: '0', order_id: 'order-a', order_status: 'completed', seller_fee_fav: '3000000' };
const overview = { server_time: cutoff, wallet: { available_fav: '103000001', held_fav: '5000000', updated_at: cutoff }, sources: { reward_fav: '6000001', earned_fav: '97000000', purchased_fav: '0', legacy_fav: '0' }, held_orders: [] };
let authChanged;
let reward;
let replies;

beforeEach(() => {
  jest.clearAllMocks();
  reward = { reason: 'visit_required', eligible: false, claimed: false, current_streak: 0, reward_date: '2026-09-07', amount_micro_fav: '50000' };
  replies = {
    get_my_wallet_overview: overview,
    list_my_wallet_activity: { items: [event], cutoff, next_cursor: null },
    get_my_wallet_transaction: event,
    submit_my_wallet_support_request: { id: 'support-a' },
    get_my_daily_reward_status: reward,
    get_crypto_chain_status: { chain_id: 84532, token_address: null, unlock_enabled: false, initial_cap_micro_fav: 10000000000000 },
    get_my_account_eligibility: { crypto_eligible: false, identity_status: 'unverified' },
    get_my_fav_balance_breakdown: { available_fav: 103000001, earned_fav: 97000000, crypto_eligible_fav: 1000000, crypto_maturing_fav: 96000000, pending_crypto_unlock_fav: 0, crypto_unlock_maturity_hours: 120, crypto_unlock_fee_bps: 250 },
  };
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: owner } } } });
  supabase.auth.onAuthStateChange.mockImplementation(callback => { authChanged = callback; return { data: { subscription: { unsubscribe: jest.fn() } } }; });
  supabase.rpc.mockImplementation(async name => ({ data: replies[name], error: null }));
  supabase.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }), order: () => ({ limit: async () => ({ data: [] }) }) }) }));
  window.matchMedia = jest.fn(() => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() }));
});

test('wallet renders server balances and transaction details without issuing rewards', async () => {
  const onBalance = jest.fn();
  render(<WalletPage userId={owner} onBalance={onBalance} onOpenOrder={jest.fn()} onExplore={jest.fn()} />);
  expect(await screen.findByText('103.000001 FAV')).toBeInTheDocument();
  await screen.findByRole('button', { name: 'Check today’s reward' });
  expect(onBalance).toHaveBeenCalledWith('103000001');
  expect(supabase.rpc.mock.calls.some(([name]) => name.includes('claim_') || name === 'record_my_reward_visit')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /Service earned/ }));
  const title = await screen.findByRole('heading', { name: 'Transaction details' });
  await waitFor(() => expect(title).toHaveFocus());
  expect(within(title.closest('section')).getByText('3 FAV')).toBeInTheDocument();
});

test('wallet failures do not fabricate an empty or zero balance; retry loads real data', async () => {
  supabase.rpc.mockResolvedValue({ error: new Error('Wallet unavailable') });
  render(<WalletPage userId={owner} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Wallet unavailable');
  expect(screen.queryByText('Available to spend')).not.toBeInTheDocument();
  expect(screen.queryByText(/No recorded transactions/)).not.toBeInTheDocument();
  supabase.rpc.mockImplementation(async name => ({ data: replies[name] }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh wallet' }));
  expect(await screen.findByText('103.000001 FAV')).toBeInTheDocument();
  await screen.findByRole('button', { name: 'Check today’s reward' });
});

test('activity pagination keeps the cutoff and filters execute on the server', async () => {
  const cursor = { id: event.id, created_at: event.created_at };
  replies.list_my_wallet_activity = { items: [event], cutoff, next_cursor: cursor };
  render(<WalletPage userId={owner} />);
  const more = await screen.findByRole('button', { name: 'Load more transactions' });
  replies.list_my_wallet_activity = { items: [{ ...event, id: 'transaction-b', label: 'Other sale' }], cutoff, next_cursor: null };
  fireEvent.click(more);
  expect(await screen.findByText('Other sale')).toBeInTheDocument();
  expect(supabase.rpc).toHaveBeenCalledWith('list_my_wallet_activity', expect.objectContaining({ p_cursor: cursor, p_cutoff: cutoff }));
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'sale' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('list_my_wallet_activity', expect.objectContaining({ p_filters: expect.objectContaining({ type: 'sale' }), p_cursor: null })));
  await screen.findByRole('button', { name: 'Check today’s reward' });
});

test('transaction support uses the exact transaction and expected account', async () => {
  render(<WalletPage userId={owner} />);
  fireEvent.click(await screen.findByRole('button', { name: /Service earned/ }));
  fireEvent.change(await screen.findByLabelText('Report a problem with this transaction'), { target: { value: 'The recorded amount needs review.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send to support' }));
  expect(await screen.findByText('Your support request was received. No balance or order was changed.')).toBeInTheDocument();
  expect(supabase.rpc).toHaveBeenCalledWith('submit_my_wallet_support_request', { p_transaction_id: event.id, p_details: 'The recorded amount needs review.', p_expected_user_id: owner });
});

test('changing accounts closes the wallet and removes the previous account data', async () => {
  render(<WalletPage userId={owner} />);
  await screen.findByText('103.000001 FAV');
  await screen.findByRole('button', { name: 'Check today’s reward' });
  act(() => authChanged('SIGNED_IN', { user: { id: 'member-b' } }));
  expect(screen.getByRole('heading', { name: 'Wallet closed' })).toBeInTheDocument();
  expect(screen.queryByText('103.000001 FAV')).not.toBeInTheDocument();
});

test('reward visit and claim are separate explicit actions, never mount side effects', async () => {
  const onClaimed = jest.fn();
  replies.record_my_reward_visit = { ...reward, reason: 'eligible', eligible: true, offer_id: 'offer-a' };
  replies.claim_my_daily_reward = { ...reward, reason: 'already_claimed', claimed: true, receipt: { transaction_id: 'reward-tx', amount_micro_fav: '50000' } };
  render(<DailyRewardCard userId={owner} onClaimed={onClaimed} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Check today’s reward' }));
  const claim = await screen.findByRole('button', { name: 'Claim 0.05 FAV' });
  expect(onClaimed).not.toHaveBeenCalled();
  expect(supabase.rpc.mock.calls.some(([name]) => name === 'claim_my_daily_reward')).toBe(false);
  fireEvent.click(claim);
  await waitFor(() => expect(onClaimed).toHaveBeenCalledTimes(1));
  expect(supabase.rpc).toHaveBeenCalledWith('claim_my_daily_reward', { p_offer_id: 'offer-a' });
  expect(screen.queryByRole('button', { name: 'Claim 0.05 FAV' })).not.toBeInTheDocument();
});

test('sidebar selects Wallet and closes mobile navigation with Escape', () => {
  window.matchMedia.mockReturnValue({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() });
  const onNavigate = jest.fn();
  function Harness() { const [open, setOpen] = useState(true); return <AppSidebar active="Wallet" open={open} onToggle={setOpen} onNavigate={onNavigate} fav="1" />; }
  render(<Harness />);
  expect(screen.getByRole('button', { name: 'Wallet' })).toHaveAttribute('aria-current', 'page');
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus();
  expect(document.body.style.overflow).not.toBe('hidden');
});

test('mature earnings do not enable crypto for an ineligible account or undeployed token', async () => {
  render(<CryptoWalletPanel />);
  expect(await screen.findByText('Crypto access is not enabled for this account')).toBeInTheDocument();
  expect(screen.getByText('5 days safety window')).toBeInTheDocument();
  expect(screen.getByText('Testnet token deployment pending')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Connect & verify testnet wallet' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Queue crypto unlock' })).not.toBeInTheDocument();
});
