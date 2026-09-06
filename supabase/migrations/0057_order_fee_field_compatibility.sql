-- Keep new split-fee fields compatible with legacy order inserts while the application migrates.
create or replace function public.normalize_order_fee_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.seller_fee_fav, 0) = 0 and coalesce(new.fee_fav, 0) > 0 then
    new.seller_fee_fav := new.fee_fav;
  elsif coalesce(new.fee_fav, 0) = 0 and coalesce(new.seller_fee_fav, 0) > 0 then
    new.fee_fav := new.seller_fee_fav;
  end if;

  new.buyer_total_fav := new.amount_fav + coalesce(new.buyer_fee_fav, 0);
  return new;
end;
$$;

drop trigger if exists orders_normalize_fee_fields on public.orders;
create trigger orders_normalize_fee_fields
before insert or update of amount_fav, fee_fav, buyer_fee_fav, seller_fee_fav, buyer_total_fav
on public.orders
for each row execute function public.normalize_order_fee_fields();
