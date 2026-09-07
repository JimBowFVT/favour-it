-- READ ONLY. Run as an authorised administrator. Keep the result private.
-- Replace the empty UUID list with reviewed pilot member IDs. Empty means no data.
-- Reconcile test/reversed flags and approved membership before using metrics.cjs.
-- Do not relabel this raw export as verified until that review is complete.
with cohort as (select unnest(array[]::uuid[]) as id)
select jsonb_build_object(
  'id', o.id, 'buyerId', o.buyer_id, 'sellerId', o.seller_id,
  'createdAt', to_char(o.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'completedAt', case when o.completed_at is not null then to_char(o.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
  'status',o.status,'serviceAmountMicroFav',o.amount_fav::text,
  'serverVerified',false,'isTest',null,'reversed',null
) as order_record
from public.orders o
where o.buyer_id in(select id from cohort) and o.seller_id in(select id from cohort)
order by o.created_at;
