-- Step 13c is additive and forward-only. Retain saved evidence on web rollback.
set lock_timeout = '5s';

-- Private snapshot helpers: only the guarded preview/save entry points can call them.
create function app.delivery_calendar_context(p_org uuid, p_country text, p_calendar uuid, p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'country', coalesce(c.code, p_country), 'calendar_id', w.id, 'calendar_code', w.code,
    'calendar_updated_at', w.updated_at, 'active', coalesce(w.is_active, true),
    'weekend_days', coalesce(w.weekend_days, c.weekend_days),
    'observe_public_holidays', coalesce(w.observe_public_holidays, true),
    'coverage_from', c.holiday_coverage_from, 'coverage_to', c.holiday_coverage_to,
    'holidays', coalesce((select jsonb_agg(jsonb_build_object(
      'date', h.holiday_date, 'sector', h.sector, 'name', h.name_en, 'source', h.source)
      order by h.holiday_date, h.sector) from public.public_holidays h
      where h.country_code = c.code and h.holiday_date between p_from and p_to), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'calendar_id', o.work_calendar_id, 'starts_on', o.starts_on,
      'ends_on', o.ends_on, 'kind', o.kind, 'name', o.name_en, 'updated_at', o.updated_at)
      order by o.id) from public.holiday_overrides o where o.organization_id = p_org
      and (o.work_calendar_id = w.id or o.country_code = c.code)
      and o.starts_on <= p_to and o.ends_on >= p_from), '[]'::jsonb))
  from (select 1) anchor
  left join public.work_calendars w on w.organization_id = p_org and w.id = p_calendar
  left join public.countries c on c.code = coalesce(w.country_code, p_country);
$$;

create function app.delivery_calendar_day(p_calendar jsonb, p_date date)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare
  verified boolean; holiday boolean; weekend boolean; working boolean;
  reason text := 'unknown_coverage'; chosen jsonb;
begin
  verified := coalesce(p_date between (p_calendar->>'coverage_from')::date
    and (p_calendar->>'coverage_to')::date, false);
  weekend := exists(select 1 from jsonb_array_elements_text(coalesce(nullif(p_calendar->'weekend_days','null'::jsonb),'[]'::jsonb)) d
    where d::integer = extract(isodow from p_date)::integer);
  if verified then
    holiday := exists(select 1 from jsonb_array_elements(p_calendar->'holidays') h
      where (h->>'date')::date = p_date and h->>'sector' = 'all');
  end if;
  select o into chosen from jsonb_array_elements(p_calendar->'overrides') o
    where p_date between (o->>'starts_on')::date and (o->>'ends_on')::date
    order by (o->>'calendar_id' is not null) desc, o->>'id' limit 1;
  if not coalesce((p_calendar->>'active')::boolean, false) then reason := 'inactive_calendar';
  elsif chosen is not null then
    working := chosen->>'kind' = 'working_day';
    reason := case when chosen->>'calendar_id' is null then 'country_override' else 'calendar_override' end;
  elsif (p_calendar->>'observe_public_holidays')::boolean and holiday then
    working := false; reason := 'public_holiday';
  elsif weekend then working := false; reason := 'weekend';
  elsif not (p_calendar->>'observe_public_holidays')::boolean or verified then
    working := true; reason := 'weekly_pattern';
  end if;
  return jsonb_build_object('date', p_date, 'working', working, 'reason', reason,
    'weekend', weekend, 'holiday', holiday, 'verified', verified, 'override_id', chosen->>'id');
end;
$$;

create function app.delivery_next_working_day(p_calendar jsonb, p_start date)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare day jsonb; days jsonb := '[]'; candidate date;
begin
  -- Stop at the first unknown: skipping it would invent an earliest working date.
  for offset_days in 0..89 loop
    candidate := p_start + offset_days;
    day := app.delivery_calendar_day(p_calendar, candidate);
    days := days || jsonb_build_array(day);
    if day->>'working' is null then
      return jsonb_build_object('status', case when day->>'reason' = 'inactive_calendar'
        then 'calendar_inactive' else 'calendar_unknown' end, 'date', null, 'days', days);
    elsif (day->>'working')::boolean then
      return jsonb_build_object('status', 'resolved', 'date', candidate, 'days', days);
    end if;
  end loop;
  return jsonb_build_object('status', 'search_exhausted', 'date', null, 'days', days);
end;
$$;
revoke all on function app.delivery_calendar_context(uuid,text,uuid,date,date),
  app.delivery_calendar_day(jsonb,date), app.delivery_next_working_day(jsonb,date)
  from public, anon, authenticated, service_role, maqdar_worker;

create function public.delivery_scenario_preview(
  p_organization_id uuid, p_supplier_scenario_id uuid, p_requested_date date, p_calendars_confirmed boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  source public.supplier_scenarios; supplier public.suppliers; receiver public.locations;
  supplier_calendar jsonb; receiver_calendar jsonb; order_search jsonb; receipt_search jsonb;
  result jsonb; status text; blocked_stage text; cutoff date; lead integer; quantity numeric;
  order_date date; nominal_receipt date; receipt_date date; expected_receipt date;
begin
  -- Explicit claim/member and location checks also protect calls from the definer save RPC.
  if p_organization_id is null or not(p_organization_id = any(array(select app.member_organizations()))) then
    raise exception using errcode = 'MQ404', message = 'no such supplier scenario';
  end if;
  select * into source from public.supplier_scenarios
    where organization_id = p_organization_id and id = p_supplier_scenario_id
    and (organization_id = any(array(select app.unscoped_organizations()))
      or location_id = any(array(select app.scoped_locations())));
  if not found then raise exception using errcode = 'MQ404', message = 'no such supplier scenario'; end if;
  cutoff := (source.report->'source'->>'cutoff')::date;
  lead := (source.report->'source'->>'lead_time')::integer;
  quantity := (source.report->>'quantity')::numeric;
  if p_requested_date is null or not isfinite(p_requested_date)
    or p_requested_date < cutoff or p_requested_date not between date '1900-01-01' and date '2100-12-31'
    or p_calendars_confirmed is null then
    raise exception using errcode = 'MQ422', message = 'invalid requested date or confirmation';
  end if;
  select * into supplier from public.suppliers where organization_id = p_organization_id
    and id = (source.report->'supplier'->>'id')::uuid;
  select * into receiver from public.locations where organization_id = p_organization_id and id = source.location_id;
  status := case
    when source.report->>'status' is distinct from 'available' or quantity is null or quantity < 0
      or lead is null or lead not between 0 and 3650 then 'source_unavailable'
    when quantity = 0 then 'no_order_needed'
    when supplier.id is null or not supplier.is_active then 'supplier_unavailable'
    when receiver.id is null or not receiver.is_active then 'location_unavailable'
    when not p_calendars_confirmed then 'calendars_unconfirmed'
    else 'available' end;
  if lead between 0 and 3650 then
    expected_receipt := cutoff + lead;
    if supplier.id is not null then
      supplier_calendar := app.delivery_calendar_context(p_organization_id, supplier.country_code,
        supplier.work_calendar_id, p_requested_date, p_requested_date + 89);
    end if;
    if receiver.id is not null then
      receiver_calendar := app.delivery_calendar_context(p_organization_id, receiver.country_code,
        receiver.work_calendar_id, p_requested_date + lead, p_requested_date + lead + 178);
    end if;
  end if;
  if status = 'available' then
    order_search := app.delivery_next_working_day(supplier_calendar, p_requested_date);
    order_date := (order_search->>'date')::date;
    if order_date is null then status := order_search->>'status'; blocked_stage := 'supplier';
    else
      nominal_receipt := order_date + lead;
      receipt_search := app.delivery_next_working_day(receiver_calendar, nominal_receipt);
      receipt_date := (receipt_search->>'date')::date;
      if receipt_date is null then status := receipt_search->>'status'; blocked_stage := 'receiver'; end if;
    end if;
  end if;
  result := jsonb_build_object('method', 'delivery-dates-v1', 'status', status, 'location_id', source.location_id,
    'requested_date', p_requested_date, 'calendars_confirmed', p_calendars_confirmed, 'blocked_stage', blocked_stage,
    'source', jsonb_build_object('scenario_id', source.id, 'fingerprint', source.report->>'fingerprint',
      'draft_id', source.draft_id, 'item_code', source.report->'source'->>'item_code',
      'location_code', source.report->'source'->>'location_code', 'supplier_code', source.report->>'requested_supplier_code',
      'unit', source.report->'source'->>'unit', 'quantity', quantity::text, 'lead_time', lead, 'cutoff', cutoff),
    'supplier', case when supplier.id is null then null else jsonb_build_object('id', supplier.id,
      'code', supplier.code, 'name', supplier.name_en, 'active', supplier.is_active, 'updated_at', supplier.updated_at) end,
    'receiver', case when receiver.id is null then null else jsonb_build_object('id', receiver.id,
      'code', receiver.code, 'name', receiver.name_en, 'active', receiver.is_active, 'updated_at', receiver.updated_at) end,
    'supplier_calendar', supplier_calendar, 'receiver_calendar', receiver_calendar,
    'order_search', order_search, 'receipt_search', receipt_search,
    'order_date', order_date, 'nominal_receipt', nominal_receipt, 'receipt_date', receipt_date,
    'expected_receipt', expected_receipt, 'elapsed_days', receipt_date - cutoff,
    'policy_recalculation_required', case when receipt_date is null then null else receipt_date > expected_receipt end);
  return result || jsonb_build_object('fingerprint', encode(sha256(convert_to(result::text, 'UTF8')), 'hex'));
end;
$$;
revoke all on function public.delivery_scenario_preview(uuid,uuid,date,boolean)
  from public, anon, authenticated, service_role, maqdar_worker;
grant execute on function public.delivery_scenario_preview(uuid,uuid,date,boolean) to authenticated;

create table public.delivery_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  supplier_scenario_id uuid not null,
  location_id uuid not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null,
  unique (organization_id, id),
  unique (organization_id, request_id),
  foreign key (organization_id, supplier_scenario_id) references public.supplier_scenarios(organization_id,id) on delete cascade,
  foreign key (organization_id, location_id) references public.locations(organization_id,id) on delete cascade
);
comment on table public.delivery_scenarios is 'Immutable indicative dates; source quantities and policy targets remain unchanged. No order execution.';
create index delivery_scenarios_source on public.delivery_scenarios(organization_id,supplier_scenario_id,created_at desc,id);
create index delivery_scenarios_location on public.delivery_scenarios(organization_id,location_id);
alter table public.delivery_scenarios enable row level security;
revoke all on public.delivery_scenarios from public, anon, authenticated, service_role, maqdar_worker;
grant select on public.delivery_scenarios to authenticated;
create policy "members read" on public.delivery_scenarios for select to authenticated
  using (organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.delivery_scenarios as restrictive for select to authenticated
  using (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.delivery_scenarios
  for each row execute function app.audit_business_row();

create function public.delivery_scenario_save(p_organization_id uuid, p_supplier_scenario_id uuid,
  p_requested_date date, p_calendars_confirmed boolean, p_request_id uuid, p_fingerprint text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare previous public.delivery_scenarios; report jsonb; result uuid;
begin
  if p_organization_id is null or auth.uid() is null
    or not(p_organization_id = any(array(select app.editable_organizations()))) then
    raise exception using errcode = 'MQ403', message = 'delivery scenario requires an editor';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'MQ422', message = 'invalid delivery scenario request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.delivery-scenario:' || p_organization_id::text, 0));
  if not(p_organization_id = any(array(select app.editable_organizations()))) then
    raise exception using errcode = 'MQ403', message = 'delivery scenario requires an editor';
  end if;
  select * into previous from public.delivery_scenarios where organization_id = p_organization_id and request_id = p_request_id
    and (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));
  if found then
    if previous.supplier_scenario_id = p_supplier_scenario_id and previous.submitted_by = auth.uid()
      and previous.report->>'fingerprint' = p_fingerprint and (previous.report->>'requested_date')::date = p_requested_date
      and (previous.report->>'calendars_confirmed')::boolean = p_calendars_confirmed then return previous.id; end if;
    raise exception using errcode = 'MQ409', message = 'delivery scenario request conflicts';
  end if;
  report := public.delivery_scenario_preview(p_organization_id, p_supplier_scenario_id, p_requested_date, p_calendars_confirmed);
  if report->>'fingerprint' <> p_fingerprint then
    raise exception using errcode = 'MQ409', message = 'calendar inputs changed; refresh preview';
  end if;
  insert into public.delivery_scenarios(organization_id,supplier_scenario_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_supplier_scenario_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report)
    returning id into result;
  return result;
end;
$$;
revoke all on function public.delivery_scenario_save(uuid,uuid,date,boolean,uuid,text)
  from public, anon, authenticated, service_role, maqdar_worker;
grant execute on function public.delivery_scenario_save(uuid,uuid,date,boolean,uuid,text) to authenticated;

create view public.delivery_scenario_list with (security_invoker = true) as
select id, organization_id, supplier_scenario_id, location_id, created_at,
  report->>'status' status, report->>'requested_date' requested_date, report->>'order_date' order_date,
  report->>'receipt_date' receipt_date, (report->>'policy_recalculation_required')::boolean policy_recalculation_required
from public.delivery_scenarios;
revoke all on public.delivery_scenario_list from public, anon, authenticated, service_role, maqdar_worker;
grant select on public.delivery_scenario_list to authenticated;
reset lock_timeout;
