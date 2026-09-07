// Bind each request to the account that started it. RLS/RPC authorization remains server-side.
export function createAccountRequests(client, expectedUserId, timeoutMs = 15000) {
  const pending = new Set();
  const assertOwner = async () => {
    if (!client || !expectedUserId) throw new Error('Sign in to open your wallet.');
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data?.session?.user?.id !== expectedUserId) throw new Error('Your signed-in account changed. Reopen Wallet.');
    return data.session;
  };
  const run = async makeRequest => {
    const controller = new AbortController();
    pending.add(controller);
    let timer;
    let abortHandler;
    const cancelled = new Promise((_, reject) => {
      abortHandler = () => reject(new Error('The wallet request was interrupted. Refresh its status before retrying.'));
      controller.signal.addEventListener('abort', abortHandler, { once: true });
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Wallet request timed out. Refresh its status before retrying.'));
        controller.abort();
      }, timeoutMs);
    });
    const work = async () => {
      const session = await assertOwner();
      if (controller.signal.aborted) throw new Error('Wallet request cancelled.');
      let request = makeRequest(session);
      // Capture Authorization now, rather than letting a later account swap choose the JWT.
      if (session.access_token && request.setHeader) request = request.setHeader('Authorization', `Bearer ${session.access_token}`);
      if (request.abortSignal) request = request.abortSignal(controller.signal);
      const response = await request;
      if (controller.signal.aborted) throw new Error('Wallet request cancelled.');
      await assertOwner();
      if (response.error) throw response.error;
      return response.data;
    };
    try { return await Promise.race([work(), timeout, cancelled]); }
    finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abortHandler);
      pending.delete(controller);
    }
  };
  return { assertOwner, run, cancel: () => pending.forEach(controller => controller.abort()) };
}

export async function currentAccountId(client, expectedUserId) {
  if (expectedUserId) return expectedUserId;
  if (!client) throw new Error('Sign in to open your wallet.');
  let timer;
  try {
    const response = await Promise.race([
      client.auth.getSession(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Session check timed out. Sign in and retry.')), 15000);
      }),
    ]);
    if (response.error) throw response.error;
    const id = response.data?.session?.user?.id;
    if (!id) throw new Error('Sign in to open your wallet.');
    return id;
  } finally { clearTimeout(timer); }
}
