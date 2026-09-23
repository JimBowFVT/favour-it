import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import PrivateGroupBridge from './PrivateGroupBridge';
jest.mock('../lib/supabase', () => ({ supabase: null }));
jest.mock('../lib/privateGroups', () => ({ getMyPrivateGroups: jest.fn().mockResolvedValue([]) }));
jest.mock('../lib/social', () => ({ getMySocialGraph: jest.fn().mockResolvedValue({ friends: [] }) }));
const session = { user: { id: 'member-a' } };
function Inbox() {
  const [section, setSection] = useState('people');
  return <><div className="dm-panel is-inbox"><div className="dm-sections-v2">
    <button className={section === 'groups' ? 'active' : ''} onClick={() => setSection('groups')}>Groups</button>
    <button onClick={() => setSection('people')}>People</button>
  </div>{section === 'groups' && <div className="dm-empty">No private groups</div>}</div><PrivateGroupBridge session={session} /></>;
}
test('opening and reopening Groups settles instead of observing its own changes forever', async () => {
  const NativeObserver = window.MutationObserver;
  let notifications = 0;
  // Bound the regression so the old infinite microtask loop produces a failure.
  window.MutationObserver = class extends NativeObserver {
    constructor(callback) { super((records, observer) => {
      notifications += 1;
      if (notifications > 40) { observer.disconnect(); return; }
      callback(records, observer);
    }); }
  };
  let view;
  try {
    view = render(<Inbox />);
    await act(async () => { fireEvent.click(screen.getByText('Groups')); });
    expect(screen.getByText('No private groups yet.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('People')); });
    await act(async () => { fireEvent.click(screen.getByText(/Groups/)); });
    expect(screen.getByText('No private groups yet.')).toBeInTheDocument();
    expect(notifications).toBeLessThan(40);
  } finally { view?.unmount(); window.MutationObserver = NativeObserver; }
});
