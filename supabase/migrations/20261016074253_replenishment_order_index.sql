-- Separate, nontransactional statement: avoid blocking inbound feed writes.
create index concurrently open_orders_replenishment_idx on public.open_orders(organization_id,item_id,location_id,expected_date,id) where status='open' and quantity>0;
