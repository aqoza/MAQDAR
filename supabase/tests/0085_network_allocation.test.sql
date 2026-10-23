begin;
select no_plan();
select is(app.network_allocate(0,'[{"location_id":"00000000-0000-4000-8000-000000000001","gap":"8"}]')->0->>'quantity','0.000','no surplus is a known zero');
select is(app.network_allocate(10,'[{"location_id":"00000000-0000-4000-8000-000000000001","gap":"0"}]')->0->>'quantity','0.000','zero gap never receives stock');
select is(app.network_allocate(10,'[{"location_id":"00000000-0000-4000-8000-000000000001","gap":"2.123"}]')->0->>'quantity','2.123','abundant surplus is capped by the gap');
select is(app.network_allocate(0.001,'[{"location_id":"00000000-0000-4000-8000-000000000002","gap":"1"},{"location_id":"00000000-0000-4000-8000-000000000001","gap":"1"}]')->0->>'quantity','0.001','equal remainder goes to smaller location UUID, not input order');
select is(app.network_allocate(0.0009,'[{"location_id":"00000000-0000-4000-8000-000000000001","gap":"1"}]')->0->>'quantity','0.000','sub-quantum source surplus is retained, never rounded up');
select is(app.network_allocate(999999999999999.999,'[{"location_id":"00000000-0000-4000-8000-000000000001","gap":"999999999999999.999"}]')->0->>'quantity','999999999999999.999','maximum quantity stays exact');
-- A deterministic grid exercises budget conservation and per-branch caps independently.
with cases as (
  select s::numeric/1000 surplus, jsonb_agg(jsonb_build_object(
    'location_id',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
    'gap',((s*n+7)%37)::numeric/1000) order by n desc) lines
  from generate_series(0,150) s cross join generate_series(1,20) n group by s
), checked as (
  select surplus,lines,app.network_allocate(surplus,lines) result from cases
)
select ok(
  (select sum((v->>'quantity')::numeric) from jsonb_array_elements(result) v)
    =least(surplus,(select sum((v->>'gap')::numeric) from jsonb_array_elements(lines) v))
  and not exists(select 1 from jsonb_array_elements(result) r join jsonb_array_elements(lines) l
    on r->>'location_id'=l->>'location_id' where (r->>'quantity')::numeric<0 or (r->>'quantity')::numeric>(l->>'gap')::numeric),
  'conserves budget and respects every gap for surplus '||surplus) from checked;
select ok(not has_table_privilege('authenticated','public.network_allocation_scenarios','INSERT'),'no direct insert');
select ok(not has_table_privilege('authenticated','public.network_allocation_scenarios','UPDATE'),'no direct update');
select ok(not has_table_privilege('authenticated','public.network_allocation_scenarios','DELETE'),'no direct delete');
select ok(not has_table_privilege('service_role','public.network_allocation_scenarios','SELECT'),'no API service read grant');
select ok(not has_function_privilege('anon','public.network_allocation_preview(uuid,uuid[],uuid,text,uuid,text,boolean,boolean)','EXECUTE'),'anonymous cannot preview');
select ok(not has_function_privilege('zeespare_worker','public.network_allocation_save(uuid,uuid[],uuid,text,uuid,text,boolean,boolean,uuid,text)','EXECUTE'),'worker cannot save');
select * from finish();
rollback;
