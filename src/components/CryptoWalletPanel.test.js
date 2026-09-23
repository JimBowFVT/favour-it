import { fireEvent, render, screen } from '@testing-library/react';
import CryptoWalletPanel from './CryptoWalletPanel';
import * as crypto from '../lib/crypto';
import { getMyFavBalanceBreakdown } from '../lib/wallet';
jest.mock('../lib/crypto', () => ({
  ...jest.requireActual('../lib/crypto'),
  getMyAgeEligibility: jest.fn(), getCryptoChainStatus: jest.fn(),
  getMyCryptoWallet: jest.fn(), getMyCryptoUnlocks: jest.fn(),
  connectAndVerifyCryptoWallet: jest.fn(), requestCryptoUnlock: jest.fn(),
}));
jest.mock('../lib/wallet', () => ({ formatFav: value => String(value), getMyFavBalanceBreakdown: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  crypto.getCryptoChainStatus.mockResolvedValue({ token_address: 'token', deployment_verified_at: '2026-01-01', unlock_enabled: true });
  crypto.getMyCryptoWallet.mockResolvedValue(null);
  crypto.getMyCryptoUnlocks.mockResolvedValue([]);
  getMyFavBalanceBreakdown.mockResolvedValue({ crypto_eligible_fav: 2000000, crypto_unlock_maturity_hours: 120 });
});
test.each([false, null])('crypto controls fail closed for minors or unknown eligibility: %s', async eligible => {
  crypto.getMyAgeEligibility.mockResolvedValue(eligible === null ? null : { crypto_age_eligible: eligible, birth_date_recorded: true });
  render(<CryptoWalletPanel />);
  expect(await screen.findByText('Crypto is available from age 18')).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Connect & verify testnet wallet' });
  expect(button).toBeDisabled(); fireEvent.click(button);
  expect(crypto.connectAndVerifyCryptoWallet).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText('0.000000'), { target: { value: '1' } });
  expect(screen.getByRole('button', { name: 'Queue crypto unlock' })).toBeDisabled();
});
test('age-eligible adults can connect a wallet', async () => {
  crypto.getMyAgeEligibility.mockResolvedValue({ crypto_age_eligible: true, birth_date_recorded: true });
  render(<CryptoWalletPanel />);
  expect(await screen.findByRole('button', { name: 'Connect & verify testnet wallet' })).toBeEnabled();
});
test('failed eligibility lookup never enables crypto', async () => {
  crypto.getMyAgeEligibility.mockRejectedValue(new Error('Connection failed'));
  render(<CryptoWalletPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection failed');
  expect(screen.getByRole('button', { name: 'Connect & verify testnet wallet' })).toBeDisabled();
});
