const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sourceUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const moneyUrl = sourceUrl(fs.readFileSync(path.join(root, 'src/lib/favAmounts.js'), 'utf8'));
const money = import(moneyUrl);
const activity = import(sourceUrl(fs.readFileSync(path.join(root, 'src/lib/walletActivity.js'), 'utf8').replace("'./favAmounts'", JSON.stringify(moneyUrl))));
function client(responses, owner = 'member-a') {
  const calls = [];
  const state = { owner };
  return { state, calls, auth: { async getSession() { return { data: { session: state.owner ? { user: { id: state.owner } } : null } }; } }, async rpc(name, args) { calls.push({ name, args }); return { data: await responses(name, args) }; } };
}

test('formats full signed 64-bit ledger values without floating-point rounding', async () => {
  const m = await money;
  assert.equal(m.favDecimal('9223372036854775807'), '9223372036854.775807');
  assert.equal(m.favDecimal('-9223372036854775808'), '-9223372036854.775808');
  assert.equal(m.favDecimal('1'), '0.000001');
  assert.equal(m.formatMicroFav('-1', 'en-US'), '-0.000001');
  assert.equal(m.formatMicroFav('0', 'en-US'), '0');
});
test('missing and imprecise amounts are never displayed as a genuine zero', async () => {
  const m = await money;
  for (const x of [null, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1.4', 'bad']) assert.equal(m.formatMicroFav(x), '—');
  assert.throws(() => m.microFavInteger(Number.MAX_SAFE_INTEGER + 1));
});
test('FAV parsing rejects negatives, exponent notation and excess decimals', async () => {
  const m = await money;
  assert.equal(m.parseFavInput('1.000001'), 1000001);
  assert.equal(m.parseFavInput('0'), 0);
  assert.equal(m.parseFavInput('9007199254.740991'), Number.MAX_SAFE_INTEGER);
  for (const x of ['1e3','-2','1.0000001','9007199254.740992','NaN']) assert.equal(m.parseFavInput(x), null);
});
test('fee rounding matches exact integer ceilings, including the safe-integer boundary', async () => {
  const m = await money;
  for (const gross of [1, 39, 40, 41, 1000000, 10000000000000, Number.MAX_SAFE_INTEGER]) {
    for (const bps of [0, 1, 250, 300, 10000]) {
      const quote = m.calculateCryptoUnlockQuote(gross, bps);
      const fee = Number((BigInt(gross) * BigInt(bps) + 9999n) / 10000n);
      assert.deepEqual(quote, { gross_fav: gross, fee_fav: fee, net_fav: gross - fee });
    }
  }
  assert.equal(m.calculateCryptoUnlockQuote(100, 10001).gross_fav, 0);
  assert.equal(m.calculateCryptoUnlockQuote(100, 1.5).gross_fav, 0);
});
test('filters preserve UTC calendar boundaries and reject invalid dates and ranges', async () => {
  const { validateWalletFilters: validate } = await activity;
  assert.equal(validate({ from: '2024-02-29', search: '  reference  ' }).search, 'reference');
  for (const input of [{ from:'2026-02-29' }, { from:'2026-09-08', to:'2026-09-07' }, { type:'mint' }, { search:'x'.repeat(201) }]) assert.throws(() => validate(input));
});
test('no wallet read or write is sent when the expected account is no longer signed in', async () => {
  const { createWalletApi } = await activity;
  const c = client(() => ({}), 'member-b');
  const api = createWalletApi(c, 'member-a');
  await assert.rejects(api.overview(), /account changed/);
  await assert.rejects(api.support('tx', 'Something is incorrect.'), /account changed/);
  assert.equal(c.calls.length, 0);
});
test('results resolving after an account switch are discarded', async () => {
  const { createWalletApi } = await activity;
  let c;
  c = client(() => { c.state.owner = 'member-b'; return { wallet: { available_fav:'2000000' } }; });
  await assert.rejects(createWalletApi(c, 'member-a').overview(), /account changed/);
});
test('support sends expected-account guard and rejects incomplete descriptions', async () => {
  const { createWalletApi } = await activity;
  const c = client(() => ({ received: true }));
  const api = createWalletApi(c, 'member-a');
  await assert.rejects(api.support('tx', 'no'), /10 to 3600/);
  await api.support('tx', '  Incorrect transaction amount.  ');
  assert.deepEqual(c.calls[0], { name:'submit_my_wallet_support_request', args:{p_transaction_id:'tx',p_details:'Incorrect transaction amount.',p_expected_user_id:'member-a'} });
});
test('activity sends server-side filters, cursor and an unchanged snapshot cutoff', async () => {
  const { createWalletApi } = await activity;
  const c = client(() => ({ items:[], cutoff:'cutoff', next_cursor:null }));
  const cursor={ id:'tx', created_at:'date' };
  await createWalletApi(c, 'member-a').activity({type:'sale'}, cursor, 'cutoff');
  assert.equal(c.calls[0].args.p_filters.type, 'sale');
  assert.deepEqual(c.calls[0].args.p_cursor, cursor);
  assert.equal(c.calls[0].args.p_cutoff, 'cutoff');
});
test('statement downloads every page of one frozen snapshot and keeps unknown balances null', async () => {
  const { createWalletApi } = await activity;
  const items = Array.from({length:401}, (_, n) => ({ id:`tx-${n}`, amount_fav:'1' }));
  const c = client((name,args) => name==='begin_my_wallet_statement' ? { id:'snapshot', cutoff:'fixed', row_count:401, balances:{opening_held_fav:null} } : { items:items.slice(args.p_cursor || 0,(args.p_cursor || 0)+200), cutoff:'fixed', next_cursor:(args.p_cursor || 0)+200<401 ? (args.p_cursor || 0)+200 : null });
  const result=await createWalletApi(c, 'member-a').statement({});
  assert.equal(result.items.length,401); assert.equal(result.balances.opening_held_fav,null);
  assert.equal(c.calls[0].args.p_expected_user_id,'member-a');
});
test('statement rejects snapshot drift, repeated pages, duplicates and missing rows', async () => {
  const { createWalletApi } = await activity;
  const badPages = [
    {items:[{id:'one'}],cutoff:'different',next_cursor:null},
    {items:[],cutoff:'fixed',next_cursor:0},
    {items:[{id:'one'},{id:'one'}],cutoff:'fixed',next_cursor:null},
    {items:[{id:'one'}],cutoff:'fixed',next_cursor:null},
  ];
  for (const page of badPages) {
    const c=client(name=>name==='begin_my_wallet_statement'?{id:'snapshot',cutoff:'fixed',row_count:2}:page);
    await assert.rejects(createWalletApi(c,'member-a').statement({}));
  }
});
test('CSV neutralizes formulas in user descriptions and preserves tiny FAV values', async () => {
  const { walletStatementCsv } = await activity;
  const csv = walletStatementCsv({id:'s',cutoff:'fixed',items:[{id:'tx',description:' \t=HYPERLINK("unsafe")',amount_fav:'1',held_change_fav:null}]});
  assert.ok(csv.includes("' \t=HYPERLINK")); assert.ok(csv.includes('"0.000001"')); assert.ok(!csv.includes('NaN'));
});
test('manual reward claims require an offer and never invoke the obsolete automatic reward function', async () => {
  const { createWalletApi } = await activity;
  const c=client(()=>({eligible:true,offer_id:'offer'}));const api=createWalletApi(c,'member-a');
  await api.rewardStatus();await api.prepareReward();await assert.rejects(api.claimReward(null));await api.claimReward('offer');
  assert.deepEqual(c.calls.map(x=>x.name),['get_my_daily_reward_status','record_my_reward_visit','claim_my_daily_reward']);
  assert.deepEqual(c.calls[2].args,{p_offer_id:'offer'});
});
