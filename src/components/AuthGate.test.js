import { fireEvent, render, screen } from '@testing-library/react';
import AuthGate from './AuthGate';
import { signUp } from '../lib/auth';
jest.mock('../lib/auth', () => ({ signUp: jest.fn(), signIn: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); localStorage.clear(); });
function fillSignup(birthday) {
  render(<AuthGate />);
  fireEvent.click(screen.getByText('Create one'));
  fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Test member' } });
  fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: 'member@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test-password' } });
  fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: birthday } });
  fireEvent.submit(screen.getByRole('button', { name: 'Create account →' }).closest('form'));
}
test('under-13 registration never reaches the auth service', () => {
  fillSignup(new Date().toISOString().slice(0, 10));
  expect(screen.getByText(/must be at least 13/)).toBeInTheDocument();
  expect(signUp).not.toHaveBeenCalled();
});
test('registration sends the birthday and handles email confirmation', async () => {
  signUp.mockResolvedValue({ data: { user: { id: 'new-member' }, session: null } });
  fillSignup('2000-02-29');
  expect(await screen.findByText(/Check your email to confirm/)).toBeInTheDocument();
  expect(signUp).toHaveBeenCalledWith('member@example.com', 'test-password', 'Test member', expect.any(String), '2000-02-29');
});
test('unavailable browser storage does not turn successful signup into an error', async () => {
  const storage = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  try {
    signUp.mockResolvedValue({ data: { user: { id: 'new-member' }, session: {} } });
    fillSignup('2000-01-01');
    expect(await screen.findByText(/Account created successfully/)).toBeInTheDocument();
  } finally { storage.mockRestore(); }
});
