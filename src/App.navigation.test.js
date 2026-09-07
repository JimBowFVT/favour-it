import { fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { getMyWallet } from './lib/wallet';
import { getMyOrders } from './lib/orders';
import { getPublishedDeals, getMyDeals } from './lib/deals';
import { getMyFavoriteDealIds } from './lib/favorites';
import { getEconomyConfig } from './lib/economy';

jest.mock('./lib/wallet', () => ({ ...jest.requireActual('./lib/wallet'), getMyWallet: jest.fn() }));
jest.mock('./lib/orders', () => ({ getMyOrders: jest.fn() }));
jest.mock('./lib/deals', () => ({ getPublishedDeals: jest.fn(), getMyDeals: jest.fn() }));
jest.mock('./lib/favorites', () => ({ getMyFavoriteDealIds: jest.fn() }));
jest.mock('./lib/economy', () => ({ getEconomyConfig: jest.fn() }));
jest.mock('./components/ExploreDealsPage', () => () => <section>Original Explore destination</section>);
jest.mock('./components/Community', () => () => <section>Original Community destination</section>);

const session = { user: { id: 'fixture-account', email: 'fixture@example.invalid', user_metadata: { display_name: 'Fixture' } } };
beforeEach(() => {
  jest.clearAllMocks(); window.scrollTo = jest.fn();
  getMyWallet.mockResolvedValue({ available_fav: '123450001' });
  getMyOrders.mockResolvedValue([]); getPublishedDeals.mockResolvedValue([]); getMyDeals.mockResolvedValue([]);
  getMyFavoriteDealIds.mockResolvedValue([]); getEconomyConfig.mockResolvedValue({});
  window.history.replaceState(null, '', '/');
});
test('restores the original six top navbar destinations, not a site-wide sidebar', async () => {
  const { container } = render(<App session={session} initialWallet={{ available_fav: '123450001' }} />);
  await screen.findByRole('heading', { name: /Your skills are your currency/ });
  const nav = screen.getByRole('navigation');
  expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['Home', 'Explore', 'Orders', 'My Deals', 'Community', 'Upgrade']);
  expect(nav.closest('header')).toHaveClass('topbar');
  expect(container.querySelector('.app-sidebar')).toBeNull();
  expect(container.querySelector('.sidebar-expanded')).toBeNull();
  expect(screen.queryByRole('button', { name: /Open navigation|Open FAV wallet|Wallet/ })).not.toBeInTheDocument();
  expect(container.querySelector('.top-actions .balance').tagName).toBe('DIV');
});
test('Explore and Community remain ordinary navbar destinations without a global sidebar', async () => {
  render(<App session={session} />);
  await screen.findByRole('heading', { name: /Your skills are your currency/ });
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Explore' }));
  expect(screen.getByText('Original Explore destination')).toBeInTheDocument();
  expect(document.querySelector('.app-sidebar')).toBeNull();
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Community' }));
  expect(screen.getByText('Original Community destination')).toBeInTheDocument();
});
test('withdraws the unapproved #wallet route rather than hiding the navbar behind it', async () => {
  window.history.replaceState(null, '', '/#wallet');
  render(<App session={session} />);
  await screen.findByRole('heading', { name: /Your skills are your currency/ });
  expect(screen.queryByText(/Know where your FAV goes/)).not.toBeInTheDocument();
});
