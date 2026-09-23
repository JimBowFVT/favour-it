const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
let db;
const legacy = randomUUID();
const chosen = randomUUID();
before(async () => {
  db = new PGlite();
  // Minimal Supabase contract fixture; execute the real migration and real PG triggers.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create table public.profiles(id uuid primary key,username text,username_chosen boolean,
      display_name text,username_last_changed_at timestamptz);
    create table public.crypto_wallets(user_id uuid,is_active boolean);
    create table public.crypto_unlock_requests(user_id uuid,status text);
    create table public.crypto_wallet_link_challenges(user_id uuid);
    create table public.wallets(user_id uuid primary key,available_fav bigint);
    create function public.test_unlock(u uuid) returns void language plpgsql as $$
    begin
      update public.wallets set available_fav=available_fav-10 where user_id=u;
      insert into public.crypto_unlock_requests values(u,'pending');
    end $$;
  `);
  for (const id of [legacy, chosen]) await db.query('insert into auth.users values($1,$2,$3)', [id,'fixture@example.com',{}]);
  await db.query("insert into public.profiles values($1,$2,true,'Legacy',null),($3,'chosen_name',true,'Chosen',now())", [legacy,`user_${legacy.slice(0,8)}`,chosen]);
  await db.exec(readFileSync(resolve(__dirname,'../supabase/migrations/20260923150303_signup_age_and_crypto_guards.sql'),'utf8'));
});
after(async () => { await db?.close(); });
async function birthday(years, days = 0) {
  return (await db.query("select to_char((now() at time zone 'UTC')::date - make_interval(years => $1::int, days => -$2::int),'YYYY-MM-DD') as value",[years,days])).rows[0].value;
}
async function signup(date) {
  const id = randomUUID();
  await db.query('insert into auth.users values($1,$2,$3)',[id,'fixture@example.com',{birth_date:date}]);
  return id;
}
async function eligibility(id) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  return (await db.query('select public.get_my_age_eligibility() as value')).rows[0].value;
}
test('signup rejects missing, impossible, future and under-13 dates atomically', async () => {
  for (const date of [null,'','2000-02-30','1899-12-31','2099-01-01',await birthday(13,1)]) {
    const count = (await db.query('select count(*) as n from auth.users')).rows[0].n;
    await assert.rejects(signup(date));
    assert.equal((await db.query('select count(*) as n from auth.users')).rows[0].n,count);
  }
  assert.ok(await signup(await birthday(13)));
});
test('13–17-year-olds retain credits, but all crypto entry points reject them and roll back deductions', async () => {
  const id = await signup(await birthday(18,1));
  assert.equal((await eligibility(id)).crypto_age_eligible,false);
  await db.query('insert into public.wallets values($1,100)',[id]);
  await db.query('update public.wallets set available_fav=available_fav-5 where user_id=$1',[id]);
  await assert.rejects(db.query('select public.test_unlock($1)',[id]),/18 or older/);
  assert.equal((await db.query('select available_fav from public.wallets where user_id=$1',[id])).rows[0].available_fav,95);
  await assert.rejects(db.query('insert into public.crypto_wallets values($1,true)',[id]),/18 or older/);
  await assert.rejects(db.query('insert into public.crypto_wallet_link_challenges values($1)',[id]),/18 or older/);
  await db.query('update auth.users set raw_user_meta_data=$2 where id=$1',[id,{birth_date:'1980-01-01',crypto_eligible:true}]);
  assert.equal((await eligibility(id)).crypto_age_eligible,false);
});
test('exactly 18 is eligible and existing users with no recorded date fail closed', async () => {
  const id = await signup(await birthday(18));
  assert.equal((await eligibility(id)).crypto_age_eligible,true);
  await db.query('insert into public.crypto_wallet_link_challenges values($1)',[id]);
  await db.query('insert into public.crypto_wallets values($1,true)',[id]);
  await db.query("insert into public.crypto_unlock_requests values($1,'pending')",[id]);
  assert.deepEqual(await eligibility(legacy),{birth_date_recorded:false,crypto_age_eligible:false});
  await assert.rejects(db.query("insert into public.crypto_unlock_requests values($1,'pending')",[legacy]),/18 or older/);
});
test('processing rechecks age but cancellation and disconnect remain possible', async () => {
  const id = await signup(await birthday(20));
  await db.query("insert into public.crypto_unlock_requests values($1,'pending')",[id]);
  await db.query('insert into public.crypto_wallets values($1,true)',[id]);
  await db.query('update private.account_birth_dates set birth_date=$2 where user_id=$1',[id,await birthday(17)]);
  await assert.rejects(db.query("update public.crypto_unlock_requests set status='processing' where user_id=$1",[id]),/18 or older/);
  await db.query("update public.crypto_unlock_requests set status='cancelled' where user_id=$1",[id]);
  await db.query('update public.crypto_wallets set is_active=false where user_id=$1',[id]);
});
test('ordinary users cannot read or modify birth dates directly', async () => {
  await db.exec('set role authenticated');
  try {
    await assert.rejects(db.query('select * from private.account_birth_dates'),/permission denied/);
    await assert.rejects(db.query("update private.account_birth_dates set birth_date='1980-01-01'"),/permission denied/);
  } finally { await db.exec('reset role'); }
});
test('only untouched generated usernames are returned to onboarding', async () => {
  await eligibility(legacy);
  assert.equal((await db.query('select * from public.get_my_username_status()')).rows[0].username_chosen,false);
  await eligibility(chosen);
  assert.equal((await db.query('select * from public.get_my_username_status()')).rows[0].username_chosen,true);
});
