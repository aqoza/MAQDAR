set lock_timeout='5s';
alter table public.stock_snapshots add constraint stock_snapshots_finite check(quantity<>'NaN'::numeric and allocated_quantity<>'NaN'::numeric and unit_cost<>'NaN'::numeric);
alter table public.open_orders add constraint open_orders_finite check(quantity<>'NaN'::numeric and unit_cost<>'NaN'::numeric);
alter table public.receipts add constraint receipts_finite check(quantity<>'NaN'::numeric and unit_cost<>'NaN'::numeric);
create index open_orders_item_idx on public.open_orders(organization_id,item_id);
create index open_orders_supplier_idx on public.open_orders(organization_id,supplier_id);
create index receipts_item_idx on public.receipts(organization_id,item_id);
create index receipts_supplier_idx on public.receipts(organization_id,supplier_id);
reset lock_timeout;
