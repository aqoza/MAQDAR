-- Plan shape of the item list at 50,000 items (Step 4). The list screens page with
-- "where organization_id = <active> [and filter] order by <column>, code limit 25"; the list
-- indexes end in the code tiebreaker, so page 1 must be an index range scan with no Sort and no
-- Seq Scan on items, also under RLS (the members-read policy shows up as an extra index condition).
-- Deep pages are read from the nearer end (nearestRange in list-params.ts), so the last page is
-- the same scan backwards. The supplier-items list sorts by lead time and unit price.
-- Fixtures run as postgres; the EXPLAINs run as an authenticated owner with the org_id claim.
-- Timings are not asserted here (they depend on the machine); docs/performance.md records them.
begin;

select plan(22);

-- Fixture: one organization with an owner, 20 brands and 50,000 items with codes P-000001...,
-- varied English names, brands round-robin and mixed statuses (half active).
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000001401', 'plans-owner@test.local', now());
insert into public.organizations (id, slug, name) values
  ('00000000-0000-4000-8000-0000000014a0', 'plans-org', 'Plans Org');
insert into public.memberships (organization_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000014a0', '00000000-0000-4000-8000-000000001401', 'owner');

insert into public.brands (id, organization_id, code, name_en)
select ('00000000-0000-4000-8000-00000014b0' || lpad(g::text, 2, '0'))::uuid,
       '00000000-0000-4000-8000-0000000014a0',
       'BR-' || lpad(g::text, 2, '0'),
       'Brand ' || g
from generate_series(1, 20) as g;

insert into public.items (organization_id, code, name_en, brand_id, product_group, unit_of_measure, unit_cost, currency, status)
select '00000000-0000-4000-8000-0000000014a0',
       'P-' || lpad(g::text, 6, '0'),
       (array['Brake pad', 'Oil filter', 'Air filter', 'Spark plug', 'Battery', 'Wiper blade', 'Clutch kit', 'Timing belt'])[1 + g % 8]
         || ' ' || lpad(((g * 7919) % 50000)::text, 5, '0'),
       ('00000000-0000-4000-8000-00000014b0' || lpad((1 + g % 20)::text, 2, '0'))::uuid,
       'misc', 'EA', (g % 1000)::numeric, 'SAR',
       (array['active', 'active', 'active', 'new', 'phase_out', 'discontinued'])[1 + g % 6]
from generate_series(1, 50000) as g;

-- A statistics target of 1000 samples up to 300,000 rows, i.e. every row here, so the statistics
-- (and therefore the plans) do not depend on ANALYZE's random sample. Items are analyzed before
-- the supplier items go in: with stale statistics (zero rows over the pages a rolled-back run left
-- behind) each of the 50,000 foreign-key checks below can become a scan of items.
set local default_statistics_target = 1000;
analyze public.items;

-- 50,000 supplier items: one per item, five suppliers round-robin, varied lead times and prices.
insert into public.suppliers (id, organization_id, code, name_en, country_code, currency, lead_time_days_p50, lead_time_days_p90)
select ('00000000-0000-4000-8000-00000014c0' || lpad(g::text, 2, '0'))::uuid,
       '00000000-0000-4000-8000-0000000014a0',
       'SUP-' || g, 'Supplier ' || g, 'SA', 'SAR', 10, 30
from generate_series(1, 5) as g;
analyze public.suppliers;
insert into public.supplier_items (organization_id, supplier_id, item_id, lead_time_days, unit_price, currency)
select i.organization_id,
       ('00000000-0000-4000-8000-00000014c0' || lpad((1 + row_number() over (order by i.code) % 5)::text, 2, '0'))::uuid,
       i.id,
       (row_number() over (order by i.code) * 37) % 120,
       ((row_number() over (order by i.code) * 7919) % 100000)::numeric / 100,
       'SAR'
from public.items i
where i.organization_id = '00000000-0000-4000-8000-0000000014a0';
analyze public.supplier_items;

-- The EXPLAIN (COSTS OFF) text of a query, one line per plan line. Security invoker: it runs as
-- the impersonated role, so RLS applies.
create function pg_temp.plan_of(q text)
returns text
language plpgsql
as $$
declare
  v_line text;
  v_plan text := '';
begin
  for v_line in execute 'explain (costs off) ' || q loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  return v_plan;
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000001401", "role": "authenticated", "email": "plans-owner@test.local", "org_id": "00000000-0000-4000-8000-0000000014a0"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000001401';

select is(
  (select count(*)::int from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0'),
  50000,
  'the owner sees all 50,000 generated items through RLS'
);

-- (1) Default list: order by code.
select matches(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by code limit 25$$),
  'Index (Only )?Scan using items_organization_id_code_key on items',
  'page 1 by code scans the (organization_id, code) unique index'
);
select matches(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by code limit 25$$),
  'organization_id = ANY',
  'the plan carries the members-read policy (the EXPLAIN runs under RLS)'
);
select doesnt_match(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by code limit 25$$),
  'Seq Scan on items',
  'page 1 by code has no Seq Scan on items'
);
select doesnt_match(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by code limit 25$$),
  'Sort',
  'page 1 by code has no Sort node'
);

-- (2) Sorted by English name with the code tiebreaker.
select matches(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by name_en, code limit 25$$),
  'Index (Only )?Scan using items_name_idx on items',
  'page 1 by name scans items_name_idx'
);
select doesnt_match(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by name_en, code limit 25$$),
  'Seq Scan on items',
  'page 1 by name has no Seq Scan on items'
);
select doesnt_match(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by name_en, code limit 25$$),
  'Sort',
  'page 1 by name has no Sort node'
);

-- (3) Filtered by brand, ordered by code.
select matches(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0'
                      and brand_id = '00000000-0000-4000-8000-00000014b007' order by code limit 25$$),
  'Index (Only )?Scan using items_brand_idx on items',
  'page 1 of one brand scans items_brand_idx'
);
select doesnt_match(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0'
                      and brand_id = '00000000-0000-4000-8000-00000014b007' order by code limit 25$$),
  'Seq Scan on items',
  'page 1 of one brand has no Seq Scan on items'
);
select doesnt_match(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0'
                      and brand_id = '00000000-0000-4000-8000-00000014b007' order by code limit 25$$),
  'Sort',
  'page 1 of one brand has no Sort node'
);

-- (4) Filtered by status, ordered by code: the status index, or the code index with a filter
-- when the status is common enough; either way no Seq Scan.
select matches(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0'
                      and status = 'active' order by code limit 25$$),
  'Index (Only )?Scan using (items_status_idx|items_organization_id_code_key) on items',
  'page 1 of active items scans items_status_idx or the code index'
);
select doesnt_match(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0'
                      and status = 'active' order by code limit 25$$),
  'Seq Scan on items',
  'page 1 of active items has no Seq Scan on items'
);
select doesnt_match(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0'
                      and status = 'active' order by code limit 25$$),
  'Sort',
  'page 1 of active items has no Sort node'
);

-- (5) The last page, read backwards: by code, and by name with the code tiebreaker.
select matches(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by code desc limit 25$$),
  'Index (Only )?Scan Backward using items_organization_id_code_key on items',
  'the last page by code scans the code index backwards'
);
select doesnt_match(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by code desc limit 25$$),
  'Sort|Seq Scan on items',
  'the last page by code has no Sort and no Seq Scan'
);
select matches(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by name_en desc, code desc limit 25$$),
  'Index (Only )?Scan Backward using items_name_idx on items',
  'the last page by name scans items_name_idx backwards'
);
select doesnt_match(
  pg_temp.plan_of($$select id from public.items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by name_en desc, code desc limit 25$$),
  'Sort|Seq Scan on items',
  'the last page by name has no Sort and no Seq Scan'
);

-- (6) Supplier items sorted by lead time or unit price, with the id tiebreaker.
select matches(
  pg_temp.plan_of($$select id from public.supplier_items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by lead_time_days, id limit 25$$),
  'Index (Only )?Scan using supplier_items_lead_time_idx on supplier_items',
  'supplier items by lead time scan supplier_items_lead_time_idx'
);
select doesnt_match(
  pg_temp.plan_of($$select id from public.supplier_items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by lead_time_days, id limit 25$$),
  'Sort|Seq Scan on supplier_items',
  'supplier items by lead time have no Sort and no Seq Scan'
);
select matches(
  pg_temp.plan_of($$select id from public.supplier_items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by unit_price desc, id desc limit 25$$),
  'Index (Only )?Scan Backward using supplier_items_unit_price_idx on supplier_items',
  'supplier items by unit price (descending) scan supplier_items_unit_price_idx backwards'
);
select doesnt_match(
  pg_temp.plan_of($$select id from public.supplier_items where organization_id = '00000000-0000-4000-8000-0000000014a0' order by unit_price desc, id desc limit 25$$),
  'Sort|Seq Scan on supplier_items',
  'supplier items by unit price have no Sort and no Seq Scan'
);
reset role;

select * from finish();

rollback;
