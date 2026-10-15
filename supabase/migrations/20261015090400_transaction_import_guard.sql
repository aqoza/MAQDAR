set lock_timeout = '5s';
alter table public.import_files drop constraint import_files_entity_check;
alter table public.import_files add constraint import_files_entity_check check(entity in (
  'work_calendars','holiday_overrides','locations','network_links','brands','items','item_supersessions',
  'item_interchanges','suppliers','supplier_items','fx_rates','demand_history','stock_snapshots','open_orders','receipts'
));
reset lock_timeout;
