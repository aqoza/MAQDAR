create or replace function app.import_prepare_stats(p_batch_id uuid, p_entities text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text;
  v_reltuples real;
  v_relpages integer;
  v_pages bigint;
  v_modified bigint;
  v_inserted bigint;
  v_counts jsonb;
  v_done text[] := '{}';
  v_skip boolean := coalesce(current_setting('maqdar.import_analyze', true), '') = 'skip_locked';
begin
  select b.counts into v_counts from public.import_batches b where b.id = p_batch_id;
  for v_entity in
    select distinct x from unnest(p_entities) as x
    where x in ('work_calendars', 'holiday_overrides', 'locations', 'network_links', 'brands', 'items', 'item_supersessions',
                'item_interchanges', 'suppliers', 'supplier_items', 'fx_rates', 'stock_snapshots', 'open_orders', 'receipts')
    order by 1
  loop
    select c.reltuples, c.relpages, coalesce(s.n_mod_since_analyze, 0),
           pg_catalog.pg_relation_size(c.oid) / current_setting('block_size')::integer
      into v_reltuples, v_relpages, v_modified, v_pages
    from pg_catalog.pg_class c
    left join pg_catalog.pg_stat_user_tables s on s.relid = c.oid
    where c.oid = pg_catalog.to_regclass('public.' || v_entity);
    v_inserted := coalesce((v_counts -> v_entity ->> 'inserted')::bigint, 0);
    if (v_reltuples <= 0 and v_pages > 0)
       or v_pages > v_relpages * 1.2 + 8
       or v_modified > 0.1 * greatest(v_reltuples, 0)
       or v_inserted > 0.1 * greatest(v_reltuples, 0) then
      if v_skip then
        case v_entity
          when 'work_calendars' then analyze (skip_locked) public.work_calendars;
          when 'holiday_overrides' then analyze (skip_locked) public.holiday_overrides;
          when 'locations' then analyze (skip_locked) public.locations;
          when 'network_links' then analyze (skip_locked) public.network_links;
          when 'brands' then analyze (skip_locked) public.brands;
          when 'items' then analyze (skip_locked) public.items;
          when 'item_supersessions' then analyze (skip_locked) public.item_supersessions;
          when 'item_interchanges' then analyze (skip_locked) public.item_interchanges;
          when 'suppliers' then analyze (skip_locked) public.suppliers;
          when 'supplier_items' then analyze (skip_locked) public.supplier_items;
          when 'stock_snapshots' then analyze (skip_locked) public.stock_snapshots;
when 'open_orders' then analyze (skip_locked) public.open_orders;
when 'receipts' then analyze (skip_locked) public.receipts;
        when 'fx_rates' then analyze (skip_locked) public.fx_rates;
        end case;
      else
        case v_entity
          when 'work_calendars' then analyze public.work_calendars;
          when 'holiday_overrides' then analyze public.holiday_overrides;
          when 'locations' then analyze public.locations;
          when 'network_links' then analyze public.network_links;
          when 'brands' then analyze public.brands;
          when 'items' then analyze public.items;
          when 'item_supersessions' then analyze public.item_supersessions;
          when 'item_interchanges' then analyze public.item_interchanges;
          when 'suppliers' then analyze public.suppliers;
          when 'supplier_items' then analyze public.supplier_items;
          when 'stock_snapshots' then analyze public.stock_snapshots;
when 'open_orders' then analyze public.open_orders;
when 'receipts' then analyze public.receipts;
        when 'fx_rates' then analyze public.fx_rates;
        end case;
      end if;
      v_done := v_done || ('public.' || v_entity);
    end if;
  end loop;
  return v_done;
end;
$$;
