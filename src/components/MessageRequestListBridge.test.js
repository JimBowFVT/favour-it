import { act, render, screen } from '@testing-library/react';
import MessageRequestListBridge from './MessageRequestListBridge';
jest.mock('../lib/supabase', () => ({ supabase: null }));
test('message request copy settles without a self-triggering observer loop', async () => {
  const NativeObserver = window.MutationObserver;
  let notifications = 0;
  window.MutationObserver = class extends NativeObserver {
    constructor(callback) { super((records, observer) => {
      notifications += 1;
      if (notifications > 20) { observer.disconnect(); return; }
      callback(records, observer);
    }); }
  };
  let view;
  try {
    await act(async () => {
      view = render(<><div className="dm-request-decision-copy"><small>Old copy</small></div><MessageRequestListBridge /></>);
    });
    expect(screen.getByText(/Accept to move it to Chats/)).toBeInTheDocument();
    expect(notifications).toBeLessThan(20);
  } finally { view?.unmount(); window.MutationObserver = NativeObserver; }
});
