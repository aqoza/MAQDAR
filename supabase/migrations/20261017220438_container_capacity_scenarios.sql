-- Step 18: additive measurements and immutable capacity scenarios. Rollback: restore the
-- previous web build and retain these nullable columns, RPCs and historical reports.
set lock_timeout='5s';
alter table public.supplier_items
  add column shipping_weight_kg numeric(15,6),
  add column shipping_volume_m3 numeric(15,6),
  add column shipping_valid_from date;
alter table public.supplier_items add constraint supplier_items_shipping_weight_check
  check(shipping_weight_kg > 0 and shipping_weight_kg < 1000000000) not valid;
alter table public.supplier_items add constraint supplier_items_shipping_volume_check
  check(shipping_volume_m3 > 0 and shipping_volume_m3 < 1000000000) not valid;
alter table public.supplier_items add constraint supplier_items_shipping_date_check
  check(isfinite(shipping_valid_from) and shipping_valid_from between date '0001-01-01' and date '9999-12-31') not valid;
comment on column public.supplier_items.shipping_weight_kg is 'Supplied shipping weight in kg per unit_of_measure, including apportioned packaging. NULL is unknown; no pack multiplication or unit conversion.';
comment on column public.supplier_items.shipping_volume_m3 is 'Supplied shipping volume in cubic metres per unit_of_measure, including apportioned packaging. NULL is unknown; not a geometric loading guarantee.';
comment on column public.supplier_items.shipping_valid_from is 'Separate effective-from date for supplied shipping measurements; applicability still requires planner confirmation.';

create table public.container_capacity_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  batch_id uuid not null,
  location_id uuid not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null,
  unique(organization_id,id),
  unique(organization_id,request_id),
  foreign key(organization_id,batch_id) references public.purchase_handoff_batches(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
create index container_capacity_source on public.container_capacity_scenarios(organization_id,batch_id,created_at desc,id);
create index container_capacity_location on public.container_capacity_scenarios(organization_id,location_id);
alter table public.container_capacity_scenarios enable row level security;
revoke all on public.container_capacity_scenarios from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.container_capacity_scenarios to authenticated;
create policy "members read" on public.container_capacity_scenarios for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.container_capacity_scenarios as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.container_capacity_scenarios
  for each row execute function app.audit_business_row();
comment on table public.container_capacity_scenarios is 'Immutable aggregate weight/volume comparisons for fixed purchase batches. No filling, booking, reservations or guarantee of physical fit.';

create function public.container_capacity_preview(p_organization_id uuid,p_batch_id uuid,
  p_volume text,p_payload text,p_confirmed boolean)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  batch public.purchase_handoff_batches; terms public.supplier_items;
  volume numeric; payload numeric; total_volume numeric:=0; total_weight numeric:=0;
  line jsonb; lines jsonb:='[]'; measurement jsonb; report jsonb; reason text;
  quantity numeric; line_weight numeric; line_volume numeric; all_ready boolean:=true;
  selected boolean; all_selected boolean:=true;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='capacity source unavailable';
  end if;
  -- Explicit scope checks are also required when invoked by the definer save RPC.
  select * into batch from public.purchase_handoff_batches b
    where b.organization_id=p_organization_id and b.id=p_batch_id
      and (b.organization_id=any(array(select app.unscoped_organizations())) or b.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='capacity source unavailable'; end if;
  if p_volume is null or p_payload is null or p_confirmed is null
    or p_volume !~ '^[0-9]{1,9}(\.[0-9]{1,6})?$' or p_payload !~ '^[0-9]{1,9}(\.[0-9]{1,6})?$' then
    raise exception using errcode='MQ422',message='invalid capacity limits';
  end if;
  volume:=p_volume::numeric; payload:=p_payload::numeric;
  if volume<=0 or payload<=0 then raise exception using errcode='MQ422',message='capacity limits must be positive'; end if;
  if batch.payload->>'schema_version' is distinct from 'purchase-handoff-batch-v1'
    or jsonb_typeof(batch.payload->'lines') is distinct from 'array'
    or jsonb_array_length(batch.payload->'lines') not between 1 and 50 then
    raise exception using errcode='MQ422',message='invalid saved batch';
  end if;
  for line in select value from jsonb_array_elements(batch.payload->'lines') loop
    select exists(select 1 from public.purchase_review_list p where p.organization_id=p_organization_id
      and p.id=(line#>>'{proposal,id}')::uuid and p.selected) into selected;
    all_selected:=all_selected and selected;
    select * into terms from public.supplier_items s where s.organization_id=p_organization_id
      and s.supplier_id=(line#>>'{estimate,source,supplier_id}')::uuid
      and s.item_id=(line#>>'{estimate,source,item_id}')::uuid;
    measurement:=case when terms.id is not null then jsonb_build_object('id',terms.id,
      'unit',terms.unit_of_measure,'weight_kg',terms.shipping_weight_kg::text,
      'volume_m3',terms.shipping_volume_m3::text,'valid_from',terms.shipping_valid_from,
      'updated_at',terms.updated_at) end;
    quantity:=(line#>>'{estimate,source,quantity}')::numeric;
    reason:=case
      when not selected then 'selection_changed'
      when quantity is null or quantity<=0 or quantity='NaN'::numeric then 'source_invalid'
      when terms.id is null then 'measurements_missing'
      when terms.unit_of_measure is null or line#>>'{estimate,source,unit}' is null then 'unit_unknown'
      when terms.unit_of_measure<>line#>>'{estimate,source,unit}' then 'unit_mismatch'
      when terms.shipping_weight_kg is null or terms.shipping_volume_m3 is null then 'measurements_missing'
      when terms.shipping_valid_from is null then 'date_unknown'
      when line#>>'{estimate,source,order_date}' is null then 'source_invalid'
      when terms.shipping_valid_from>(line#>>'{estimate,source,order_date}')::date then 'not_effective'
      when not p_confirmed then 'unconfirmed'
      else 'available' end;
    line_weight:=null; line_volume:=null;
    if reason='available' then
      line_weight:=quantity*terms.shipping_weight_kg; line_volume:=quantity*terms.shipping_volume_m3;
      total_weight:=total_weight+line_weight; total_volume:=total_volume+line_volume;
    else all_ready:=false; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('handoff_id',line->>'handoff_id',
      'proposal_id',line#>>'{proposal,id}','item_id',line#>>'{estimate,source,item_id}',
      'item_code',line#>>'{estimate,source,item_code}','unit',line#>>'{estimate,source,unit}',
      'quantity',quantity::text,'order_date',line#>>'{estimate,source,order_date}',
      'receipt_date',line#>>'{estimate,source,receipt_date}','selected',selected,
      'status',reason,'measurement',measurement,'weight_kg',line_weight::text,'volume_m3',line_volume::text));
  end loop;
  report:=jsonb_build_object('method','container-capacity-v1','batch_id',batch.id,
    'location_id',batch.location_id,'summary',batch.payload->'summary','confirmed',p_confirmed,
    'selected',all_selected,'volume_limit_m3',volume::text,'payload_limit_kg',payload::text,
    'status',case when all_ready then 'available' else 'unavailable' end,'lines',lines,
    'totals',case when all_ready then jsonb_build_object('weight_kg',total_weight::text,'volume_m3',total_volume::text,
      'weight_utilization_pct',round(total_weight/payload*100,2)::text,
      'volume_utilization_pct',round(total_volume/volume*100,2)::text,
      'weight_over_kg',greatest(total_weight-payload,0)::text,'volume_over_m3',greatest(total_volume-volume,0)::text,
      'within_limits',total_weight<=payload and total_volume<=volume) end);
  return report||jsonb_build_object('fingerprint',encode(sha256(convert_to(report::text,'UTF8')),'hex'));
end; $$;
revoke all on function public.container_capacity_preview(uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.container_capacity_preview(uuid,uuid,text,text,boolean) to authenticated;

create function public.container_capacity_save(p_organization_id uuid,p_batch_id uuid,p_volume text,p_payload text,
  p_confirmed boolean,p_request_id uuid,p_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.container_capacity_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='capacity saving requires an editor';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    or p_confirmed is distinct from true or p_volume is null or p_payload is null
    or p_volume !~ '^[0-9]{1,9}(\.[0-9]{1,6})?$' or p_payload !~ '^[0-9]{1,9}(\.[0-9]{1,6})?$'
    or p_volume::numeric<=0 or p_payload::numeric<=0 then
    raise exception using errcode='MQ422',message='invalid capacity save';
  end if;
  -- Shares proposal-selection serialization. Preview uses a new statement snapshot after waiting.
  perform pg_advisory_xact_lock(hashtextextended('maqdar.purchase-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='capacity saving requires an editor';
  end if;
  select * into previous from public.container_capacity_scenarios s
    where s.organization_id=p_organization_id and s.request_id=p_request_id
      and (s.organization_id=any(array(select app.unscoped_organizations())) or s.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.batch_id=p_batch_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint
      and (previous.report->>'volume_limit_m3')::numeric=p_volume::numeric
      and (previous.report->>'payload_limit_kg')::numeric=p_payload::numeric then return previous.id; end if;
    raise exception using errcode='MQ409',message='capacity request conflicts';
  end if;
  report:=public.container_capacity_preview(p_organization_id,p_batch_id,p_volume,p_payload,p_confirmed);
  if report->>'fingerprint'<>p_fingerprint then
    raise exception using errcode='MQ409',message='capacity evidence changed; refresh preview';
  end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='capacity evidence unavailable'; end if;
  insert into public.container_capacity_scenarios(organization_id,batch_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_batch_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report)
    returning id into result;
  return result;
end; $$;
revoke all on function public.container_capacity_save(uuid,uuid,text,text,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.container_capacity_save(uuid,uuid,text,text,boolean,uuid,text) to authenticated;
reset lock_timeout;

delete from ingest.contract_columns;
delete from ingest.contract_entities;
-- BEGIN GENERATED import contract
-- Generated by `uv run maqdar-synth format --sql` from engine/src/maqdar_engine/importformat.py
-- (import format v1); do not edit by hand.
insert into ingest.contract_entities (entity, load_order, table_name, natural_key, unordered_pair, monthly_parts, required_in_bundle, stage_rows, merge_rows, row_rules, set_rules, column_groups) values
  ('work_calendars', 1, 'public.work_calendars', array['work_calendar_code']::text[], false, false, false, 5000, 5000, array['country_required']::text[], array[]::text[], '[]'::jsonb),
  ('holiday_overrides', 2, 'public.holiday_overrides', array['country_code', 'work_calendar_code', 'starts_on']::text[], false, false, false, 5000, 5000, array['scope_exactly_one', 'end_before_start', 'holiday_too_long']::text[], array['holiday_overlap']::text[], '[["starts_on", "ends_on"]]'::jsonb),
  ('locations', 3, 'public.locations', array['location_code']::text[], false, false, true, 5000, 5000, array['must_differ']::text[], array['location_cycle']::text[], '[]'::jsonb),
  ('network_links', 4, 'public.network_links', array['from_location_code', 'to_location_code']::text[], false, false, false, 5000, 5000, array['must_differ', 'p90_below_p50', 'freight_mismatch']::text[], array[]::text[], '[["lead_time_days_p50", "lead_time_days_p90"], ["freight_basis", "freight_cost", "currency"]]'::jsonb),
  ('brands', 5, 'public.brands', array['brand_code']::text[], false, false, true, 5000, 5000, array[]::text[], array[]::text[], '[]'::jsonb),
  ('items', 6, 'public.items', array['item_code']::text[], false, false, true, 5000, 5000, array['end_before_start']::text[], array[]::text[], '[["unit_cost", "currency"]]'::jsonb),
  ('item_supersessions', 7, 'public.item_supersessions', array['predecessor_item_code']::text[], false, false, true, 5000, 5000, array['must_differ']::text[], array['supersession_cycle']::text[], '[]'::jsonb),
  ('item_interchanges', 8, 'public.item_interchanges', array['item_code', 'alternate_item_code']::text[], true, false, false, 5000, 5000, array['must_differ']::text[], array[]::text[], '[]'::jsonb),
  ('suppliers', 9, 'public.suppliers', array['supplier_code']::text[], false, false, true, 5000, 5000, array['p90_below_p50']::text[], array[]::text[], '[["lead_time_days_p50", "lead_time_days_p90"]]'::jsonb),
  ('supplier_items', 10, 'public.supplier_items', array['supplier_code', 'item_code']::text[], false, false, true, 5000, 5000, array['p90_below_p50']::text[], array['preferred_conflict']::text[], '[["unit_price", "currency"]]'::jsonb),
  ('fx_rates', 11, 'public.fx_rates', array['from_currency', 'to_currency', 'valid_from']::text[], true, false, false, 5000, 5000, array['must_differ']::text[], array[]::text[], '[]'::jsonb),
  ('demand_history', 12, 'public.demand_history', array['item_code', 'location_code', 'demand_date']::text[], false, true, true, 10000, 10000, array['date_outside_history_window']::text[], array[]::text[], '[]'::jsonb),
  ('stock_snapshots', 13, 'public.stock_snapshots', array['item_code', 'location_code', 'snapshot_date']::text[], false, false, false, 5000, 5000, array[]::text[], array[]::text[], '[["unit_cost", "currency"]]'::jsonb),
  ('open_orders', 14, 'public.open_orders', array['order_code', 'line_code']::text[], false, false, false, 5000, 5000, array[]::text[], array[]::text[], '[["unit_cost", "currency"]]'::jsonb),
  ('receipts', 15, 'public.receipts', array['receipt_code', 'line_code']::text[], false, false, false, 5000, 5000, array[]::text[], array[]::text[], '[["unit_cost", "currency"]]'::jsonb);

insert into ingest.contract_columns (entity, position, name, kind, required, natural_key, required_for_new, default_value, pattern, max_length, scale, integer_digits, min_value, max_value, greater_than, enum_values, reference, lookup_entity, db_column) values
  ('work_calendars', 1, 'work_calendar_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, null, null, 'code'),
  ('work_calendars', 2, 'name_en', 'text', true, false, true, null, null, 200, null, null, null, null, null, null, null, null, 'name_en'),
  ('work_calendars', 3, 'name_ar', 'text', false, false, false, null, null, 200, null, null, null, null, null, null, null, null, 'name_ar'),
  ('work_calendars', 4, 'country_code', 'country', false, false, false, null, '^[A-Z]{2}$', null, null, null, null, null, null, null, 'countries.code', null, 'country_code'),
  ('work_calendars', 5, 'weekend_days', 'weekdays', false, false, false, '', '^([1-7](;[1-7]){0,5})?$', null, null, null, null, null, null, null, null, null, 'weekend_days'),
  ('work_calendars', 6, 'observe_public_holidays', 'boolean', true, false, false, 'true', '^(true|false)$', null, null, null, null, null, null, null, null, null, 'observe_public_holidays'),
  ('work_calendars', 7, 'is_active', 'boolean', true, false, false, 'true', '^(true|false)$', null, null, null, null, null, null, null, null, null, 'is_active'),
  ('holiday_overrides', 1, 'country_code', 'country', false, true, false, null, '^[A-Z]{2}$', null, null, null, null, null, null, null, 'countries.code', null, 'country_code'),
  ('holiday_overrides', 2, 'work_calendar_code', 'code', false, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'work_calendars.work_calendar_code', 'work_calendars', 'work_calendar_id'),
  ('holiday_overrides', 3, 'starts_on', 'date', true, true, false, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'starts_on'),
  ('holiday_overrides', 4, 'ends_on', 'date', true, false, true, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'ends_on'),
  ('holiday_overrides', 5, 'kind', 'enum', true, false, true, null, null, null, null, null, null, null, null, array['closure', 'working_day']::text[], null, null, 'kind'),
  ('holiday_overrides', 6, 'name_en', 'text', true, false, true, null, null, 200, null, null, null, null, null, null, null, null, 'name_en'),
  ('holiday_overrides', 7, 'name_ar', 'text', false, false, false, null, null, 200, null, null, null, null, null, null, null, null, 'name_ar'),
  ('holiday_overrides', 8, 'note', 'text', false, false, false, null, null, 1000, null, null, null, null, null, null, null, null, 'note'),
  ('locations', 1, 'location_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, null, null, 'code'),
  ('locations', 2, 'name_en', 'text', true, false, true, null, null, 200, null, null, null, null, null, null, null, null, 'name_en'),
  ('locations', 3, 'name_ar', 'text', false, false, false, null, null, 200, null, null, null, null, null, null, null, null, 'name_ar'),
  ('locations', 4, 'location_type', 'enum', true, false, true, null, null, null, null, null, null, null, null, array['central', 'hub', 'branch']::text[], null, null, 'location_type'),
  ('locations', 5, 'country_code', 'country', true, false, true, null, '^[A-Z]{2}$', null, null, null, null, null, null, null, 'countries.code', null, 'country_code'),
  ('locations', 6, 'city', 'text', false, false, false, null, null, 100, null, null, null, null, null, null, null, null, 'city'),
  ('locations', 7, 'latitude', 'decimal', false, false, false, null, '^-?[0-9]+(\.[0-9]+)?$', null, 6, 3, -90, 90, null, null, null, null, 'latitude'),
  ('locations', 8, 'longitude', 'decimal', false, false, false, null, '^-?[0-9]+(\.[0-9]+)?$', null, 6, 3, -180, 180, null, null, null, null, 'longitude'),
  ('locations', 9, 'timezone', 'timezone', true, false, true, null, '^[A-Za-z][A-Za-z0-9_+/-]*$', 64, null, null, null, null, null, null, null, null, 'timezone'),
  ('locations', 10, 'parent_location_code', 'code', false, false, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'locations.location_code', 'locations', 'parent_location_id'),
  ('locations', 11, 'is_active', 'boolean', true, false, false, 'true', '^(true|false)$', null, null, null, null, null, null, null, null, null, 'is_active'),
  ('locations', 12, 'work_calendar_code', 'code', false, false, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'work_calendars.work_calendar_code', 'work_calendars', 'work_calendar_id'),
  ('network_links', 1, 'from_location_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'locations.location_code', 'locations', 'from_location_id'),
  ('network_links', 2, 'to_location_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'locations.location_code', 'locations', 'to_location_id'),
  ('network_links', 3, 'lead_time_days_p50', 'integer', true, false, true, null, '^-?[0-9]+$', null, null, 9, 0, 3650, null, null, null, null, 'lead_time_days_p50'),
  ('network_links', 4, 'lead_time_days_p90', 'integer', true, false, true, null, '^-?[0-9]+$', null, null, 9, 0, 3650, null, null, null, null, 'lead_time_days_p90'),
  ('network_links', 5, 'freight_basis', 'enum', true, false, false, 'none', null, null, null, null, null, null, null, array['none', 'per_unit', 'per_shipment']::text[], null, null, 'freight_basis'),
  ('network_links', 6, 'freight_cost', 'money', false, false, false, null, '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, 0, null, null, null, null, null, 'freight_cost'),
  ('network_links', 7, 'currency', 'currency', false, false, false, null, '^[A-Z]{3}$', null, null, null, null, null, null, null, 'currencies.code', null, 'currency'),
  ('network_links', 8, 'is_active', 'boolean', true, false, false, 'true', '^(true|false)$', null, null, null, null, null, null, null, null, null, 'is_active'),
  ('network_links', 9, 'freight_unit', 'enum', false, false, false, null, null, null, null, null, null, null, null, array['EA', 'SET', 'L', 'KG']::text[], null, null, 'freight_unit'),
  ('network_links', 10, 'freight_valid_from', 'date', false, false, false, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'freight_valid_from'),
  ('brands', 1, 'brand_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, null, null, 'code'),
  ('brands', 2, 'name_en', 'text', true, false, true, null, null, 200, null, null, null, null, null, null, null, null, 'name_en'),
  ('brands', 3, 'name_ar', 'text', false, false, false, null, null, 200, null, null, null, null, null, null, null, null, 'name_ar'),
  ('brands', 4, 'brand_type', 'enum', false, false, false, null, null, null, null, null, null, null, null, array['oem', 'aftermarket']::text[], null, null, 'brand_type'),
  ('brands', 5, 'country_of_origin', 'country', false, false, false, null, '^[A-Z]{2}$', null, null, null, null, null, null, null, null, null, 'country_of_origin'),
  ('brands', 6, 'is_active', 'boolean', true, false, false, 'true', '^(true|false)$', null, null, null, null, null, null, null, null, null, 'is_active'),
  ('items', 1, 'item_code', 'item_code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$', 64, null, null, null, null, null, null, null, null, 'code'),
  ('items', 2, 'name_en', 'text', true, false, true, null, null, 200, null, null, null, null, null, null, null, null, 'name_en'),
  ('items', 3, 'name_ar', 'text', false, false, false, null, null, 200, null, null, null, null, null, null, null, null, 'name_ar'),
  ('items', 4, 'brand_code', 'code', false, false, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'brands.brand_code', 'brands', 'brand_id'),
  ('items', 5, 'product_group', 'text', true, false, true, null, null, 64, null, null, null, null, null, null, null, null, 'product_group'),
  ('items', 6, 'unit_of_measure', 'enum', true, false, true, null, null, null, null, null, null, null, null, array['EA', 'SET', 'L', 'KG']::text[], null, null, 'unit_of_measure'),
  ('items', 7, 'unit_cost', 'money', true, false, true, null, '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, 0, null, null, null, null, null, 'unit_cost'),
  ('items', 8, 'currency', 'currency', true, false, true, null, '^[A-Z]{3}$', null, null, null, null, null, null, null, 'currencies.code', null, 'currency'),
  ('items', 9, 'status', 'enum', true, false, false, 'active', null, null, null, null, null, null, null, array['new', 'active', 'phase_out', 'discontinued']::text[], null, null, 'status'),
  ('items', 10, 'introduced_on', 'date', false, false, false, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'introduced_on'),
  ('items', 11, 'discontinued_on', 'date', false, false, false, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'discontinued_on'),
  ('item_supersessions', 1, 'predecessor_item_code', 'item_code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$', 64, null, null, null, null, null, null, 'items.item_code', 'items', 'predecessor_item_id'),
  ('item_supersessions', 2, 'successor_item_code', 'item_code', true, false, true, null, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$', 64, null, null, null, null, null, null, 'items.item_code', 'items', 'successor_item_id'),
  ('item_supersessions', 3, 'effective_on', 'date', true, false, true, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'effective_on'),
  ('item_supersessions', 4, 'quantity_factor', 'decimal', true, false, false, '1', '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, null, null, 0, null, null, null, 'quantity_factor'),
  ('item_supersessions', 5, 'note', 'text', false, false, false, null, null, 1000, null, null, null, null, null, null, null, null, 'note'),
  ('item_interchanges', 1, 'item_code', 'item_code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$', 64, null, null, null, null, null, null, 'items.item_code', 'items', 'item_id'),
  ('item_interchanges', 2, 'alternate_item_code', 'item_code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$', 64, null, null, null, null, null, null, 'items.item_code', 'items', 'alternate_item_id'),
  ('item_interchanges', 3, 'direction', 'enum', true, false, false, 'two_way', null, null, null, null, null, null, null, array['one_way', 'two_way']::text[], null, null, 'direction'),
  ('item_interchanges', 4, 'priority', 'integer', true, false, false, '1', '^-?[0-9]+$', null, null, 9, 1, 99, null, null, null, null, 'priority'),
  ('item_interchanges', 5, 'note', 'text', false, false, false, null, null, 1000, null, null, null, null, null, null, null, null, 'note'),
  ('suppliers', 1, 'supplier_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, null, null, 'code'),
  ('suppliers', 2, 'name_en', 'text', true, false, true, null, null, 200, null, null, null, null, null, null, null, null, 'name_en'),
  ('suppliers', 3, 'name_ar', 'text', false, false, false, null, null, 200, null, null, null, null, null, null, null, null, 'name_ar'),
  ('suppliers', 4, 'country_code', 'country', true, false, true, null, '^[A-Z]{2}$', null, null, null, null, null, null, null, null, null, 'country_code'),
  ('suppliers', 5, 'currency', 'currency', true, false, true, null, '^[A-Z]{3}$', null, null, null, null, null, null, null, 'currencies.code', null, 'currency'),
  ('suppliers', 6, 'lead_time_days_p50', 'integer', true, false, true, null, '^-?[0-9]+$', null, null, 9, 0, null, null, null, null, null, 'lead_time_days_p50'),
  ('suppliers', 7, 'lead_time_days_p90', 'integer', true, false, true, null, '^-?[0-9]+$', null, null, 9, 0, null, null, null, null, null, 'lead_time_days_p90'),
  ('suppliers', 8, 'is_active', 'boolean', true, false, false, 'true', '^(true|false)$', null, null, null, null, null, null, null, null, null, 'is_active'),
  ('suppliers', 9, 'work_calendar_code', 'code', false, false, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'work_calendars.work_calendar_code', 'work_calendars', 'work_calendar_id'),
  ('supplier_items', 1, 'supplier_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'suppliers.supplier_code', 'suppliers', 'supplier_id'),
  ('supplier_items', 2, 'item_code', 'item_code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$', 64, null, null, null, null, null, null, 'items.item_code', 'items', 'item_id'),
  ('supplier_items', 3, 'supplier_part_number', 'text', false, false, false, null, null, 100, null, null, null, null, null, null, null, null, 'supplier_part_number'),
  ('supplier_items', 4, 'lead_time_days', 'integer', true, false, true, null, '^-?[0-9]+$', null, null, 9, 0, null, null, null, null, null, 'lead_time_days'),
  ('supplier_items', 5, 'lead_time_days_p90', 'integer', false, false, false, null, '^-?[0-9]+$', null, null, 9, 0, null, null, null, null, null, 'lead_time_days_p90'),
  ('supplier_items', 6, 'min_order_quantity', 'decimal', true, false, false, '0', '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, 0, null, null, null, null, null, 'min_order_quantity'),
  ('supplier_items', 7, 'pack_size', 'decimal', true, false, false, '1', '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, null, null, 0, null, null, null, 'pack_size'),
  ('supplier_items', 8, 'unit_price', 'money', true, false, true, null, '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, 0, null, null, null, null, null, 'unit_price'),
  ('supplier_items', 9, 'currency', 'currency', true, false, true, null, '^[A-Z]{3}$', null, null, null, null, null, null, null, 'currencies.code', null, 'currency'),
  ('supplier_items', 10, 'is_preferred', 'boolean', true, false, false, 'false', '^(true|false)$', null, null, null, null, null, null, null, null, null, 'is_preferred'),
  ('supplier_items', 11, 'valid_from', 'date', false, false, false, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'valid_from'),
  ('supplier_items', 12, 'unit_of_measure', 'enum', false, false, false, null, null, null, null, null, null, null, null, array['EA', 'SET', 'L', 'KG']::text[], null, null, 'unit_of_measure'),
  ('supplier_items', 13, 'shipping_weight_kg', 'decimal', false, false, false, null, '^-?[0-9]+(\.[0-9]+)?$', null, 6, 9, null, null, 0, null, null, null, 'shipping_weight_kg'),
  ('supplier_items', 14, 'shipping_volume_m3', 'decimal', false, false, false, null, '^-?[0-9]+(\.[0-9]+)?$', null, 6, 9, null, null, 0, null, null, null, 'shipping_volume_m3'),
  ('supplier_items', 15, 'shipping_valid_from', 'date', false, false, false, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'shipping_valid_from'),
  ('fx_rates', 1, 'from_currency', 'currency', true, true, false, null, '^[A-Z]{3}$', null, null, null, null, null, null, null, 'currencies.code', null, 'from_currency'),
  ('fx_rates', 2, 'to_currency', 'currency', true, true, false, null, '^[A-Z]{3}$', null, null, null, null, null, null, null, 'currencies.code', null, 'to_currency'),
  ('fx_rates', 3, 'valid_from', 'date', true, true, false, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'valid_from'),
  ('fx_rates', 4, 'rate', 'decimal', true, false, true, null, '^-?[0-9]+(\.[0-9]+)?$', null, 10, 10, null, null, 0, null, null, null, 'rate'),
  ('fx_rates', 5, 'note', 'text', false, false, false, null, null, 1000, null, null, null, null, null, null, null, null, 'note'),
  ('demand_history', 1, 'item_code', 'item_code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$', 64, null, null, null, null, null, null, 'items.item_code', 'items', 'item_id'),
  ('demand_history', 2, 'location_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'locations.location_code', 'locations', 'location_id'),
  ('demand_history', 3, 'demand_date', 'date', true, true, false, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'demand_date'),
  ('demand_history', 4, 'quantity', 'decimal', true, false, false, '0', '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, 0, null, null, null, null, null, 'quantity'),
  ('demand_history', 5, 'lost_sales_quantity', 'decimal', true, false, false, '0', '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, 0, null, null, null, null, null, 'lost_sales_quantity'),
  ('demand_history', 6, 'unit_of_measure', 'enum', false, false, false, null, null, null, null, null, null, null, null, array['EA', 'SET', 'L', 'KG']::text[], null, null, 'unit_of_measure'),
  ('stock_snapshots', 1, 'item_code', 'item_code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$', 64, null, null, null, null, null, null, 'items.item_code', 'items', 'item_id'),
  ('stock_snapshots', 2, 'location_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'locations.location_code', 'locations', 'location_id'),
  ('stock_snapshots', 3, 'snapshot_date', 'date', true, true, false, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'snapshot_date'),
  ('stock_snapshots', 4, 'quantity', 'decimal', true, false, true, null, '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, 0, null, null, null, null, null, 'quantity'),
  ('stock_snapshots', 5, 'allocated_quantity', 'decimal', true, false, false, '0', '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, 0, null, null, null, null, null, 'allocated_quantity'),
  ('stock_snapshots', 6, 'unit_cost', 'money', true, false, true, null, '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, 0, null, null, null, null, null, 'unit_cost'),
  ('stock_snapshots', 7, 'currency', 'currency', true, false, true, null, '^[A-Z]{3}$', null, null, null, null, null, null, null, 'currencies.code', null, 'currency'),
  ('stock_snapshots', 8, 'unit_of_measure', 'enum', false, false, false, null, null, null, null, null, null, null, null, array['EA', 'SET', 'L', 'KG']::text[], null, null, 'unit_of_measure'),
  ('open_orders', 1, 'order_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, null, null, 'order_code'),
  ('open_orders', 2, 'line_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, null, null, 'line_code'),
  ('open_orders', 3, 'item_code', 'item_code', true, false, true, null, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$', 64, null, null, null, null, null, null, 'items.item_code', 'items', 'item_id'),
  ('open_orders', 4, 'location_code', 'code', true, false, true, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'locations.location_code', 'locations', 'location_id'),
  ('open_orders', 5, 'supplier_code', 'code', true, false, true, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'suppliers.supplier_code', 'suppliers', 'supplier_id'),
  ('open_orders', 6, 'expected_date', 'date', true, false, true, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'expected_date'),
  ('open_orders', 7, 'quantity', 'decimal', true, false, true, null, '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, 0, null, null, null, null, null, 'quantity'),
  ('open_orders', 8, 'unit_cost', 'money', true, false, true, null, '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, 0, null, null, null, null, null, 'unit_cost'),
  ('open_orders', 9, 'currency', 'currency', true, false, true, null, '^[A-Z]{3}$', null, null, null, null, null, null, null, 'currencies.code', null, 'currency'),
  ('open_orders', 10, 'status', 'enum', true, false, false, 'open', null, null, null, null, null, null, null, array['open', 'closed', 'canceled']::text[], null, null, 'status'),
  ('open_orders', 11, 'unit_of_measure', 'enum', false, false, false, null, null, null, null, null, null, null, null, array['EA', 'SET', 'L', 'KG']::text[], null, null, 'unit_of_measure'),
  ('receipts', 1, 'receipt_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, null, null, 'receipt_code'),
  ('receipts', 2, 'line_code', 'code', true, true, false, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, null, null, 'line_code'),
  ('receipts', 3, 'item_code', 'item_code', true, false, true, null, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$', 64, null, null, null, null, null, null, 'items.item_code', 'items', 'item_id'),
  ('receipts', 4, 'location_code', 'code', true, false, true, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'locations.location_code', 'locations', 'location_id'),
  ('receipts', 5, 'supplier_code', 'code', true, false, true, null, '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 64, null, null, null, null, null, null, 'suppliers.supplier_code', 'suppliers', 'supplier_id'),
  ('receipts', 6, 'receipt_date', 'date', true, false, true, null, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', null, null, null, null, null, null, null, null, null, 'receipt_date'),
  ('receipts', 7, 'quantity', 'decimal', true, false, true, null, '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, null, null, 0, null, null, null, 'quantity'),
  ('receipts', 8, 'unit_cost', 'money', true, false, true, null, '^-?[0-9]+(\.[0-9]+)?$', null, 3, 12, 0, null, null, null, null, null, 'unit_cost'),
  ('receipts', 9, 'currency', 'currency', true, false, true, null, '^[A-Z]{3}$', null, null, null, null, null, null, null, 'currencies.code', null, 'currency');
-- END GENERATED import contract

create or replace function app.import_rows_supplier_items_shipping(p_organization_id uuid, p_batch_id uuid, p_file_no smallint, p_from_row integer, p_to_row integer)
returns table (row_no integer, supplier_id uuid, item_id uuid, supplier_part_number text, lead_time_days integer,
               lead_time_days_p90 integer, min_order_quantity numeric, pack_size numeric, unit_price numeric, currency char(3),
               is_preferred boolean, valid_from date, unresolved boolean, unit_of_measure text, shipping_weight_kg numeric, shipping_volume_m3 numeric, shipping_valid_from date)
language sql
stable
security definer
set search_path = ''
rows 5000
as $$
  select s.row_no, a.id, b.id, nullif(s.cells[3], ''), s.cells[4]::integer, nullif(s.cells[5], '')::integer,
         s.cells[6]::numeric, s.cells[7]::numeric, s.cells[8]::numeric, s.cells[9]::char(3), s.cells[10]::boolean,
         nullif(s.cells[11], '')::date, a.id is null or b.id is null, nullif(s.cells[12],''),
         nullif(s.cells[13],'')::numeric, nullif(s.cells[14],'')::numeric, nullif(s.cells[15],'')::date
  from ingest.staged_rows s
  left join public.suppliers a on a.organization_id = p_organization_id and a.code = s.cells[1]
  left join public.items b on b.organization_id = p_organization_id and b.code = s.cells[2]
  where s.organization_id = p_organization_id and s.batch_id = p_batch_id and s.file_no = p_file_no
    and s.row_no between p_from_row and p_to_row;
$$;
create or replace function app.import_merge_supplier_items(p_batch_id uuid, p_file_no smallint, p_from_row integer, p_to_row integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
set enable_hashjoin = off
set enable_mergejoin = off
as $$
declare
  v_org uuid;
  v_p boolean[];
  v_staged integer;
  v_unresolved integer;
  v_cleared integer := 0;
  v_updated integer;
  v_inserted integer;
  v_raced integer;
begin
  select c.organization_id, c.provided into v_org, v_p from app.import_file_context(p_batch_id, p_file_no, 'supplier_items') c;
  select count(*)::integer, count(*) filter (where x.unresolved)::integer into v_staged, v_unresolved
  from app.import_rows_supplier_items_shipping(v_org, p_batch_id, p_file_no, p_from_row, p_to_row) x;
  perform app.import_require_resolved(v_unresolved);

  if v_p[10] then
    update public.supplier_items t
    set is_preferred = false
    from app.import_rows_supplier_items_shipping(v_org, p_batch_id, p_file_no, p_from_row, p_to_row) x
    where x.is_preferred
      and t.organization_id = v_org and t.item_id = x.item_id and t.supplier_id <> x.supplier_id and t.is_preferred;
    get diagnostics v_cleared = row_count;
  end if;

  update public.supplier_items t
  set shipping_weight_kg = case when v_p[13] then x.shipping_weight_kg when t.unit_of_measure is distinct from (case when v_p[12] then x.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) then null else t.shipping_weight_kg end,
      shipping_volume_m3 = case when v_p[14] then x.shipping_volume_m3 when t.unit_of_measure is distinct from (case when v_p[12] then x.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) then null else t.shipping_volume_m3 end,
      shipping_valid_from = case when v_p[15] then x.shipping_valid_from when t.unit_of_measure is distinct from (case when v_p[12] then x.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) or v_p[13] or v_p[14] then null else t.shipping_valid_from end,
      unit_of_measure = case when v_p[12] then x.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end,
      supplier_part_number = case when v_p[3] then x.supplier_part_number else t.supplier_part_number end,
      lead_time_days = case when v_p[4] then x.lead_time_days else t.lead_time_days end,
      lead_time_days_p90 = case when v_p[5] then x.lead_time_days_p90 else t.lead_time_days_p90 end,
      min_order_quantity = case when v_p[6] then x.min_order_quantity else t.min_order_quantity end,
      pack_size = case when v_p[7] then x.pack_size else t.pack_size end,
      unit_price = case when v_p[8] then x.unit_price else t.unit_price end,
      currency = case when v_p[9] then x.currency else t.currency end,
      is_preferred = case when v_p[10] then x.is_preferred else t.is_preferred end,
      valid_from = case when v_p[11] then x.valid_from else t.valid_from end
  from app.import_rows_supplier_items_shipping(v_org, p_batch_id, p_file_no, p_from_row, p_to_row) x
  where t.organization_id = v_org and t.supplier_id = x.supplier_id and t.item_id = x.item_id
    and (t.shipping_weight_kg is distinct from (case when v_p[13] then x.shipping_weight_kg when t.unit_of_measure is distinct from (case when v_p[12] then x.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) then null else t.shipping_weight_kg end) or t.shipping_volume_m3 is distinct from (case when v_p[14] then x.shipping_volume_m3 when t.unit_of_measure is distinct from (case when v_p[12] then x.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) then null else t.shipping_volume_m3 end) or t.shipping_valid_from is distinct from (case when v_p[15] then x.shipping_valid_from when t.unit_of_measure is distinct from (case when v_p[12] then x.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) or v_p[13] or v_p[14] then null else t.shipping_valid_from end) or t.unit_of_measure is distinct from (case when v_p[12] then x.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) or (v_p[3] and t.supplier_part_number is distinct from x.supplier_part_number)
      or (v_p[4] and t.lead_time_days is distinct from x.lead_time_days)
      or (v_p[5] and t.lead_time_days_p90 is distinct from x.lead_time_days_p90)
      or (v_p[6] and t.min_order_quantity is distinct from x.min_order_quantity)
      or (v_p[7] and t.pack_size is distinct from x.pack_size)
      or (v_p[8] and t.unit_price is distinct from x.unit_price)
      or (v_p[9] and t.currency is distinct from x.currency)
      or (v_p[10] and t.is_preferred is distinct from x.is_preferred)
      or (v_p[11] and t.valid_from is distinct from x.valid_from));
  get diagnostics v_updated = row_count;

  with ins as (
    insert into public.supplier_items as t (organization_id, supplier_id, item_id, supplier_part_number, lead_time_days,
                                            lead_time_days_p90, min_order_quantity, pack_size, unit_price, currency,
                                            is_preferred, valid_from, unit_of_measure, shipping_weight_kg, shipping_volume_m3, shipping_valid_from)
    select v_org, x.supplier_id, x.item_id, x.supplier_part_number, x.lead_time_days, x.lead_time_days_p90,
           coalesce(x.min_order_quantity, 0), coalesce(x.pack_size, 1), x.unit_price, x.currency,
           coalesce(x.is_preferred, false), x.valid_from, x.unit_of_measure, x.shipping_weight_kg, x.shipping_volume_m3, x.shipping_valid_from
    from app.import_rows_supplier_items_shipping(v_org, p_batch_id, p_file_no, p_from_row, p_to_row) x
    where not exists (select 1 from public.supplier_items e
                      where e.organization_id = v_org and e.supplier_id = x.supplier_id and e.item_id = x.item_id)
    on conflict (organization_id, supplier_id, item_id) do update
    set shipping_weight_kg = case when v_p[13] then excluded.shipping_weight_kg when t.unit_of_measure is distinct from (case when v_p[12] then excluded.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) then null else t.shipping_weight_kg end,
      shipping_volume_m3 = case when v_p[14] then excluded.shipping_volume_m3 when t.unit_of_measure is distinct from (case when v_p[12] then excluded.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) then null else t.shipping_volume_m3 end,
      shipping_valid_from = case when v_p[15] then excluded.shipping_valid_from when t.unit_of_measure is distinct from (case when v_p[12] then excluded.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) or v_p[13] or v_p[14] then null else t.shipping_valid_from end,
      unit_of_measure = case when v_p[12] then excluded.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end,
        supplier_part_number = case when v_p[3] then excluded.supplier_part_number else t.supplier_part_number end,
        lead_time_days = case when v_p[4] then excluded.lead_time_days else t.lead_time_days end,
        lead_time_days_p90 = case when v_p[5] then excluded.lead_time_days_p90 else t.lead_time_days_p90 end,
        min_order_quantity = case when v_p[6] then excluded.min_order_quantity else t.min_order_quantity end,
        pack_size = case when v_p[7] then excluded.pack_size else t.pack_size end,
        unit_price = case when v_p[8] then excluded.unit_price else t.unit_price end,
        currency = case when v_p[9] then excluded.currency else t.currency end,
        is_preferred = case when v_p[10] then excluded.is_preferred else t.is_preferred end,
        valid_from = case when v_p[11] then excluded.valid_from else t.valid_from end
    where t.shipping_weight_kg is distinct from (case when v_p[13] then excluded.shipping_weight_kg when t.unit_of_measure is distinct from (case when v_p[12] then excluded.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) then null else t.shipping_weight_kg end) or t.shipping_volume_m3 is distinct from (case when v_p[14] then excluded.shipping_volume_m3 when t.unit_of_measure is distinct from (case when v_p[12] then excluded.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) then null else t.shipping_volume_m3 end) or t.shipping_valid_from is distinct from (case when v_p[15] then excluded.shipping_valid_from when t.unit_of_measure is distinct from (case when v_p[12] then excluded.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) or v_p[13] or v_p[14] then null else t.shipping_valid_from end) or t.unit_of_measure is distinct from (case when v_p[12] then excluded.unit_of_measure when v_p[6] or v_p[7] or v_p[8] or v_p[9] then null else t.unit_of_measure end) or (v_p[3] and t.supplier_part_number is distinct from excluded.supplier_part_number)
       or (v_p[4] and t.lead_time_days is distinct from excluded.lead_time_days)
       or (v_p[5] and t.lead_time_days_p90 is distinct from excluded.lead_time_days_p90)
       or (v_p[6] and t.min_order_quantity is distinct from excluded.min_order_quantity)
       or (v_p[7] and t.pack_size is distinct from excluded.pack_size)
       or (v_p[8] and t.unit_price is distinct from excluded.unit_price)
       or (v_p[9] and t.currency is distinct from excluded.currency)
       or (v_p[10] and t.is_preferred is distinct from excluded.is_preferred)
       or (v_p[11] and t.valid_from is distinct from excluded.valid_from)
    returning (t.xmax = 0) as fresh
  )
  select count(*) filter (where ins.fresh)::integer, count(*) filter (where not ins.fresh)::integer
    into v_inserted, v_raced
  from ins;

  return app.import_counts(v_staged, v_inserted, v_updated + v_raced, 0, 0)
    || jsonb_build_object('preferred_cleared', v_cleared);
end;
$$;

revoke all on function app.import_rows_supplier_items_shipping(uuid,uuid,smallint,integer,integer) from public,anon,authenticated,service_role,maqdar_worker;
alter type ingest.api_record_supplier_items drop attribute updated_at;
alter type ingest.api_record_supplier_items add attribute shipping_weight_kg text;
alter type ingest.api_record_supplier_items add attribute shipping_volume_m3 text;
alter type ingest.api_record_supplier_items add attribute shipping_valid_from date;
alter type ingest.api_record_supplier_items add attribute updated_at text;
create or replace function public.api_list(
  p_key_hash bytea,
  p_entity text,
  p_after text default null,
  p_limit integer default null,
  p_updated_since timestamptz default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_key uuid;
  v_limit integer := coalesce(p_limit, 100);
  v_after uuid := '00000000-0000-0000-0000-000000000000';
  v_since timestamptz := p_updated_since;
  v_since_text text := to_char(p_updated_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  v_as_of text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  v_cursor jsonb;
  v_data json;
  v_count integer;
  v_last uuid;
  v_next text;
begin
  select a.organization_id, a.api_key_id into v_org, v_key from app.api_authorize(p_key_hash, case when p_entity in ('stock_snapshots','open_orders','receipts') then 'transactions:read' else 'master_data:read' end) as a;
  if p_entity is null or p_entity = 'demand_history'
     or not exists (select 1 from ingest.contract_entities e where e.entity = p_entity) then
    raise exception using errcode = 'MQ404', message = 'no such resource', hint = 'resource';
  end if;
  if v_limit not between 1 and 1000 then
    raise exception using errcode = 'MQ422', message = 'limit is 1 to 1000', hint = 'limit';
  end if;
  if p_updated_since is not null and not isfinite(p_updated_since) then
    raise exception using errcode = 'MQ422', message = 'updated_since is a finite timestamp', hint = 'updated_since';
  end if;
  if p_after is not null then
    v_cursor := app.api_cursor_decode(p_after, p_entity);
    if not coalesce(
         jsonb_typeof(v_cursor -> 'a') = 'string' and pg_catalog.pg_input_is_valid(v_cursor ->> 'a', 'uuid')
         and jsonb_typeof(v_cursor -> 't') = 'string'
         and (v_cursor ->> 't') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
         and pg_catalog.pg_input_is_valid(v_cursor ->> 't', 'timestamptz')
         and v_cursor ? 'u'
         and (jsonb_typeof(v_cursor -> 'u') = 'null'
              or (jsonb_typeof(v_cursor -> 'u') = 'string'
                  and (v_cursor ->> 'u') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
                  and pg_catalog.pg_input_is_valid(v_cursor ->> 'u', 'timestamptz'))),
         false) then
      raise exception using errcode = 'MQ422', message = 'invalid cursor', hint = 'cursor';
    end if;
    if (v_cursor ->> 'u')::timestamptz is distinct from p_updated_since then
      raise exception using errcode = 'MQ422', message = 'this cursor belongs to another updated_since', hint = 'cursor';
    end if;
    v_after := (v_cursor ->> 'a')::uuid;
    v_as_of := v_cursor ->> 't';
  end if;

  if p_entity = 'work_calendars' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.code, t.name_en, t.name_ar, t.country_code::text,
                 array(select d.v from unnest(t.weekend_days) as d(v) order by d.v),
                 t.observe_public_holidays, t.is_active,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_work_calendars as rec
      from (
        select w.id, w.code, w.name_en, w.name_ar, w.country_code, w.weekend_days, w.observe_public_holidays, w.is_active, w.updated_at
        from public.work_calendars w
        where w.organization_id = v_org and w.id > v_after and (v_since is null or w.updated_at >= v_since)
        order by w.id
        limit v_limit + 1
      ) as t
    ) as x;
  elsif p_entity = 'holiday_overrides' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.country_code::text, wc.code, t.starts_on, t.ends_on, t.kind, t.name_en, t.name_ar, t.note,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_holiday_overrides as rec
      from (
        select h.id, h.country_code, h.work_calendar_id, h.starts_on, h.ends_on, h.kind, h.name_en, h.name_ar, h.note, h.updated_at
        from public.holiday_overrides h
        where h.organization_id = v_org and h.id > v_after and (v_since is null or h.updated_at >= v_since)
        order by h.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select w.code from public.work_calendars w where w.organization_id = v_org and w.id = t.work_calendar_id
      ) as wc on true
    ) as x;
  elsif p_entity = 'locations' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.code, t.name_en, t.name_ar, t.location_type, t.country_code::text, t.city,
                 trim_scale(t.latitude)::text, trim_scale(t.longitude)::text, t.timezone, p.code, t.is_active, wc.code,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_locations as rec
      from (
        select l.id, l.code, l.name_en, l.name_ar, l.location_type, l.country_code, l.city, l.latitude, l.longitude, l.timezone,
               l.parent_location_id, l.is_active, l.work_calendar_id, l.updated_at
        from public.locations l
        where l.organization_id = v_org and l.id > v_after and (v_since is null or l.updated_at >= v_since)
        order by l.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select pl.code from public.locations pl where pl.organization_id = v_org and pl.id = t.parent_location_id
      ) as p on true
      left join lateral (
        select w.code from public.work_calendars w where w.organization_id = v_org and w.id = t.work_calendar_id
      ) as wc on true
    ) as x;
  elsif p_entity = 'network_links' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(fl.code, tl.code, t.lead_time_days_p50, t.lead_time_days_p90, t.freight_basis, trim_scale(t.freight_cost)::text,
                 t.currency::text, t.is_active, t.freight_unit, t.freight_valid_from,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_network_links as rec
      from (
        select n.id, n.from_location_id, n.to_location_id, n.lead_time_days_p50, n.lead_time_days_p90, n.freight_basis,
               n.freight_cost, n.currency, n.is_active, n.freight_unit, n.freight_valid_from, n.updated_at
        from public.network_links n
        where n.organization_id = v_org and n.id > v_after and (v_since is null or n.updated_at >= v_since)
        order by n.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select l.code from public.locations l where l.organization_id = v_org and l.id = t.from_location_id
      ) as fl on true
      left join lateral (
        select l.code from public.locations l where l.organization_id = v_org and l.id = t.to_location_id
      ) as tl on true
    ) as x;
  elsif p_entity = 'brands' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.code, t.name_en, t.name_ar, t.brand_type, t.country_of_origin::text, t.is_active,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_brands as rec
      from (
        select b.id, b.code, b.name_en, b.name_ar, b.brand_type, b.country_of_origin, b.is_active, b.updated_at
        from public.brands b
        where b.organization_id = v_org and b.id > v_after and (v_since is null or b.updated_at >= v_since)
        order by b.id
        limit v_limit + 1
      ) as t
    ) as x;
  elsif p_entity = 'items' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.code, t.name_en, t.name_ar, br.code, t.product_group, t.unit_of_measure, trim_scale(t.unit_cost)::text,
                 t.currency::text, t.status, t.introduced_on, t.discontinued_on,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_items as rec
      from (
        select i.id, i.code, i.name_en, i.name_ar, i.brand_id, i.product_group, i.unit_of_measure, i.unit_cost, i.currency,
               i.status, i.introduced_on, i.discontinued_on, i.updated_at
        from public.items i
        where i.organization_id = v_org and i.id > v_after and (v_since is null or i.updated_at >= v_since)
        order by i.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select b.code from public.brands b where b.organization_id = v_org and b.id = t.brand_id
      ) as br on true
    ) as x;
  elsif p_entity = 'item_supersessions' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(pi.code, si.code, t.effective_on, trim_scale(t.quantity_factor)::text, t.note,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_item_supersessions as rec
      from (
        select s.id, s.predecessor_item_id, s.successor_item_id, s.effective_on, s.quantity_factor, s.note, s.updated_at
        from public.item_supersessions s
        where s.organization_id = v_org and s.id > v_after and (v_since is null or s.updated_at >= v_since)
        order by s.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select i.code from public.items i where i.organization_id = v_org and i.id = t.predecessor_item_id
      ) as pi on true
      left join lateral (
        select i.code from public.items i where i.organization_id = v_org and i.id = t.successor_item_id
      ) as si on true
    ) as x;
  elsif p_entity = 'item_interchanges' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(ii.code, ai.code, t.direction, t.priority::integer, t.note,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_item_interchanges as rec
      from (
        select c.id, c.item_id, c.alternate_item_id, c.direction, c.priority, c.note, c.updated_at
        from public.item_interchanges c
        where c.organization_id = v_org and c.id > v_after and (v_since is null or c.updated_at >= v_since)
        order by c.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select i.code from public.items i where i.organization_id = v_org and i.id = t.item_id
      ) as ii on true
      left join lateral (
        select i.code from public.items i where i.organization_id = v_org and i.id = t.alternate_item_id
      ) as ai on true
    ) as x;
  elsif p_entity = 'suppliers' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.code, t.name_en, t.name_ar, t.country_code::text, t.currency::text, t.lead_time_days_p50, t.lead_time_days_p90,
                 t.is_active, wc.code,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_suppliers as rec
      from (
        select s.id, s.code, s.name_en, s.name_ar, s.country_code, s.currency, s.lead_time_days_p50, s.lead_time_days_p90,
               s.is_active, s.work_calendar_id, s.updated_at
        from public.suppliers s
        where s.organization_id = v_org and s.id > v_after and (v_since is null or s.updated_at >= v_since)
        order by s.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select w.code from public.work_calendars w where w.organization_id = v_org and w.id = t.work_calendar_id
      ) as wc on true
    ) as x;
  elsif p_entity = 'supplier_items' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(sp.code, it.code, t.supplier_part_number, t.lead_time_days, t.lead_time_days_p90,
                 trim_scale(t.min_order_quantity)::text, trim_scale(t.pack_size)::text, trim_scale(t.unit_price)::text,
                 t.currency::text, t.is_preferred, t.valid_from, t.unit_of_measure,
                 trim_scale(t.shipping_weight_kg)::text, trim_scale(t.shipping_volume_m3)::text, t.shipping_valid_from,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_supplier_items as rec
      from (
        select si.id, si.supplier_id, si.item_id, si.supplier_part_number, si.lead_time_days, si.lead_time_days_p90,
               si.min_order_quantity, si.pack_size, si.unit_price, si.currency, si.is_preferred, si.valid_from, si.unit_of_measure, si.shipping_weight_kg, si.shipping_volume_m3, si.shipping_valid_from, si.updated_at
        from public.supplier_items si
        where si.organization_id = v_org and si.id > v_after and (v_since is null or si.updated_at >= v_since)
        order by si.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select s.code from public.suppliers s where s.organization_id = v_org and s.id = t.supplier_id
      ) as sp on true
      left join lateral (
        select i.code from public.items i where i.organization_id = v_org and i.id = t.item_id
      ) as it on true
    ) as x;
  elsif p_entity = 'stock_snapshots' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n<=v_limit),'[]'::json),count(*)::integer,(array_agg(x.id) filter(where x.n=v_limit))[1]
    into v_data,v_count,v_last from (
      select t.id,row_number() over(order by t.id) as n,row(j1.code,j2.code,t.snapshot_date::text,t.quantity::text,t.allocated_quantity::text,t.unit_cost::text,t.currency::text,t.unit_of_measure,to_char(t.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_stock_snapshots as rec
      from (select * from public.stock_snapshots where organization_id=v_org and id>v_after and (v_since is null or updated_at>=v_since) order by id limit v_limit+1) t
      join public.items j1 on j1.organization_id=t.organization_id and j1.id=t.item_id join public.locations j2 on j2.organization_id=t.organization_id and j2.id=t.location_id
    ) x;
  elsif p_entity = 'open_orders' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n<=v_limit),'[]'::json),count(*)::integer,(array_agg(x.id) filter(where x.n=v_limit))[1]
    into v_data,v_count,v_last from (
      select t.id,row_number() over(order by t.id) as n,row(t.order_code::text,t.line_code::text,j3.code,j4.code,j5.code,t.expected_date::text,t.quantity::text,t.unit_cost::text,t.currency::text,t.status::text,t.unit_of_measure,to_char(t.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_open_orders as rec
      from (select * from public.open_orders where organization_id=v_org and id>v_after and (v_since is null or updated_at>=v_since) order by id limit v_limit+1) t
      join public.items j3 on j3.organization_id=t.organization_id and j3.id=t.item_id join public.locations j4 on j4.organization_id=t.organization_id and j4.id=t.location_id join public.suppliers j5 on j5.organization_id=t.organization_id and j5.id=t.supplier_id
    ) x;
  elsif p_entity = 'receipts' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n<=v_limit),'[]'::json),count(*)::integer,(array_agg(x.id) filter(where x.n=v_limit))[1]
    into v_data,v_count,v_last from (
      select t.id,row_number() over(order by t.id) as n,row(t.receipt_code::text,t.line_code::text,j3.code,j4.code,j5.code,t.receipt_date::text,t.quantity::text,t.unit_cost::text,t.currency::text,to_char(t.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_receipts as rec
      from (select * from public.receipts where organization_id=v_org and id>v_after and (v_since is null or updated_at>=v_since) order by id limit v_limit+1) t
      join public.items j3 on j3.organization_id=t.organization_id and j3.id=t.item_id join public.locations j4 on j4.organization_id=t.organization_id and j4.id=t.location_id join public.suppliers j5 on j5.organization_id=t.organization_id and j5.id=t.supplier_id
    ) x;
  elsif p_entity = 'fx_rates' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.from_currency::text, t.to_currency::text, t.valid_from, trim_scale(t.rate)::text, t.note,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_fx_rates as rec
      from (
        select f.id, f.from_currency, f.to_currency, f.valid_from, f.rate, f.note, f.updated_at
        from public.fx_rates f
        where f.organization_id = v_org and f.id > v_after and (v_since is null or f.updated_at >= v_since)
        order by f.id
        limit v_limit + 1
      ) as t
    ) as x;
  end if;

  if v_count > v_limit then
    v_next := app.api_cursor_encode(jsonb_build_object('v', 1, 'k', p_entity, 'a', v_last, 'u', v_since_text, 't', v_as_of));
  end if;
  return json_build_object('data', v_data, 'next_cursor', v_next, 'as_of', v_as_of);
end;
$$;
