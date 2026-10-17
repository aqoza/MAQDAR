-- Step 16b is additive. Roll back the web build and retain immutable date evidence.
set lock_timeout = '5s';

create function public.transfer_date_preview(
  p_organization_id uuid, p_redistribution_id uuid, p_requested_date date, p_calendars_confirmed boolean
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  source public.redistribution_drafts; sender public.locations; receiver public.locations;
  lane public.network_links; cutoff date; quantity numeric; lead50 integer; lead90 integer;
  destination_lead integer; reference_date date; status text; result jsonb;
  source_calendar jsonb; dispatch jsonb; dispatch_date date; receipts jsonb := '{}';
  percentile text; lead integer; calendar jsonb; receipt jsonb; nominal date; arrival date;
begin
  -- The calendar helpers are private. Definer rights must not bypass either endpoint's scope.
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id = any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404', message='redistribution draft unavailable';
  end if;
  select * into source from public.redistribution_drafts
    where organization_id=p_organization_id and id=p_redistribution_id
      and (organization_id=any(array(select app.unscoped_organizations()))
        or (location_id=any(array(select app.scoped_locations()))
          and source_location_id=any(array(select app.scoped_locations()))));
  if not found then raise exception using errcode='MQ404', message='redistribution draft unavailable'; end if;
  cutoff := (source.report->'destination'->'policy'->>'cutoff')::date;
  if p_requested_date is null or not isfinite(p_requested_date)
    or p_requested_date not between date '1900-01-01' and date '2100-12-31'
    or p_requested_date < cutoff or p_calendars_confirmed is null then
    raise exception using errcode='MQ422', message='invalid requested date or confirmation';
  end if;
  quantity := (source.report->>'quantity')::numeric;
  lead50 := (source.report->'lane'->>'lead_time_days_p50')::integer;
  lead90 := (source.report->'lane'->>'lead_time_days_p90')::integer;
  select * into sender from public.locations where organization_id=p_organization_id and id=source.source_location_id;
  select * into receiver from public.locations where organization_id=p_organization_id and id=source.location_id;
  select * into lane from public.network_links where organization_id=p_organization_id
    and id=(source.report->'lane'->>'id')::uuid
    and from_location_id=source.source_location_id and to_location_id=source.location_id;
  select (p.evidence->'options'->>'lead_time')::integer into destination_lead
    from public.replenishment_drafts d join public.inventory_policies p
      on p.organization_id=d.organization_id and p.id=d.policy_id and p.location_id=d.location_id
    where d.organization_id=p_organization_id and d.id=source.draft_id and d.location_id=source.location_id;
  if destination_lead between 0 and 3650 and isfinite(cutoff) then reference_date := cutoff + destination_lead; end if;
  status := case
    when source.report->>'status' is distinct from 'available' or cutoff is null or not isfinite(cutoff)
      or quantity is null or quantity<0 or lead50 is null or lead90 is null
      or lead50 not between 0 and 3650 or lead90 not between lead50 and 3650 then 'source_unavailable'
    when quantity=0 then 'no_transfer_needed'
    when sender.id is null or not sender.is_active then 'source_location_unavailable'
    when receiver.id is null or not receiver.is_active then 'destination_location_unavailable'
    when lane.id is null or not lane.is_active then 'lane_unavailable'
    when lane.lead_time_days_p50<>lead50 or lane.lead_time_days_p90<>lead90 then 'lane_changed'
    when reference_date is null then 'destination_policy_unavailable'
    when not p_calendars_confirmed then 'calendars_unconfirmed'
    else 'available' end;
  if status='available' then
    source_calendar := app.delivery_calendar_context(p_organization_id,sender.country_code,
      sender.work_calendar_id,p_requested_date,p_requested_date+89);
    dispatch := app.delivery_next_working_day(source_calendar,p_requested_date);
    dispatch_date := (dispatch->>'date')::date;
    if dispatch_date is null then status := 'dispatch_unavailable';
    else
      foreach percentile in array array['p50','p90'] loop
        lead := case when percentile='p50' then lead50 else lead90 end;
        nominal := dispatch_date+lead;
        -- Capture only the evaluated receipt window, not the years between widely separated leads.
        calendar := app.delivery_calendar_context(p_organization_id,receiver.country_code,
          receiver.work_calendar_id,nominal,nominal+89);
        receipt := app.delivery_next_working_day(calendar,nominal);
        arrival := (receipt->>'date')::date;
        if arrival is null then status := 'receipt_unavailable'; end if;
        receipts := receipts || jsonb_build_object(percentile,jsonb_build_object(
          'lead_time',lead,'nominal_date',nominal,'calendar',calendar,'search',receipt,
          'timing_review_required',case when arrival is null then null else arrival>reference_date end));
      end loop;
    end if;
  end if;
  result := jsonb_build_object('method','transfer-dates-v1','status',status,
    'redistribution_id',source.id,'location_id',source.location_id,'source_location_id',source.source_location_id,
    'source',source.report,'requested_date',p_requested_date,'calendars_confirmed',p_calendars_confirmed,
    'destination_lead_time',destination_lead,'timing_reference_date',reference_date,
    'sender',case when sender.id is null then null else jsonb_build_object('id',sender.id,'code',sender.code,
      'name',sender.name_en,'active',sender.is_active,'updated_at',sender.updated_at) end,
    'receiver',case when receiver.id is null then null else jsonb_build_object('id',receiver.id,'code',receiver.code,
      'name',receiver.name_en,'active',receiver.is_active,'updated_at',receiver.updated_at) end,
    'lane',case when lane.id is null then null else jsonb_build_object('id',lane.id,'active',lane.is_active,
      'from_location_id',lane.from_location_id,'to_location_id',lane.to_location_id,
      'lead_time_days_p50',lane.lead_time_days_p50,'lead_time_days_p90',lane.lead_time_days_p90,'updated_at',lane.updated_at) end,
    'source_calendar',source_calendar,'dispatch',dispatch,'receipts',receipts);
  return result || jsonb_build_object('fingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end; $$;
revoke all on function public.transfer_date_preview(uuid,uuid,date,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.transfer_date_preview(uuid,uuid,date,boolean) to authenticated;

create table public.transfer_date_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  redistribution_id uuid not null,
  location_id uuid not null,
  source_location_id uuid not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null check(report->>'method'='transfer-dates-v1' and report->>'status' in ('available','no_transfer_needed')),
  unique(organization_id,id),
  unique(organization_id,request_id),
  check(location_id<>source_location_id),
  foreign key(organization_id,redistribution_id) references public.redistribution_drafts(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
  foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete cascade
);
comment on table public.transfer_date_scenarios is 'Immutable indicative dispatch and p50/p90 receipt dates. No reservation, freight cost, transfer execution or arrival guarantee.';
create index transfer_date_scenarios_recent on public.transfer_date_scenarios(organization_id,created_at desc,id);
create index transfer_date_scenarios_parent on public.transfer_date_scenarios(organization_id,redistribution_id);
create index transfer_date_scenarios_destination on public.transfer_date_scenarios(organization_id,location_id);
create index transfer_date_scenarios_source on public.transfer_date_scenarios(organization_id,source_location_id);
alter table public.transfer_date_scenarios enable row level security;
revoke all on public.transfer_date_scenarios from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.transfer_date_scenarios to authenticated;
create policy "members read" on public.transfer_date_scenarios for select to authenticated using(organization_id=any(array(select app.member_organizations())));
create policy "destination scope" on public.transfer_date_scenarios as restrictive for select to authenticated using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create policy "source scope" on public.transfer_date_scenarios as restrictive for select to authenticated using(organization_id=any(array(select app.unscoped_organizations())) or source_location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.transfer_date_scenarios for each row execute function app.audit_business_row();

create function public.transfer_date_save(
  p_organization_id uuid,p_redistribution_id uuid,p_requested_date date,p_calendars_confirmed boolean,
  p_request_id uuid,p_fingerprint text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.transfer_date_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='transfer dates require an editor';
  end if;
  if p_redistribution_id is null or p_requested_date is null or not isfinite(p_requested_date)
    or p_requested_date not between date '1900-01-01' and date '2100-12-31'
    or p_calendars_confirmed is null or p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid transfer date request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.transfer-dates:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='transfer dates require an editor';
  end if;
  select * into previous from public.transfer_date_scenarios where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and (not(previous.location_id=any(array(select app.scoped_locations())))
        or not(previous.source_location_id=any(array(select app.scoped_locations())))) then
      raise exception using errcode='MQ404',message='transfer dates unavailable';
    end if;
    if previous.redistribution_id=p_redistribution_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint
      and (previous.report->>'requested_date')::date=p_requested_date
      and (previous.report->>'calendars_confirmed')::boolean=p_calendars_confirmed then return previous.id; end if;
    raise exception using errcode='MQ409',message='transfer date request conflicts';
  end if;
  report := public.transfer_date_preview(p_organization_id,p_redistribution_id,p_requested_date,p_calendars_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_transfer_needed') then
    raise exception using errcode='MQ422',message='resolve unavailable transfer dates before saving';
  end if;
  insert into public.transfer_date_scenarios(organization_id,redistribution_id,location_id,source_location_id,request_id,submitted_by,report)
    values(p_organization_id,p_redistribution_id,(report->>'location_id')::uuid,(report->>'source_location_id')::uuid,p_request_id,auth.uid(),report)
    returning id into result;
  return result;
end; $$;
revoke all on function public.transfer_date_save(uuid,uuid,date,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.transfer_date_save(uuid,uuid,date,boolean,uuid,text) to authenticated;

create view public.transfer_date_scenario_list with(security_invoker=true) as
select id,organization_id,redistribution_id,location_id,source_location_id,created_at,
  report->>'status' status,report->>'requested_date' requested_date,
  report->'source'->'destination'->'policy'->>'item_code' item_code,
  report->'source'->'destination'->'policy'->>'location_code' destination_code,
  report->'source'->>'source_location_code' source_code,
  report->'source'->>'quantity' quantity,report->'source'->'destination'->'policy'->>'unit' unit,
  report->'dispatch'->>'date' dispatch_date,
  report->'receipts'->'p50'->'search'->>'date' typical_receipt,
  report->'receipts'->'p90'->'search'->>'date' slow_receipt,
  app.normalize_search(concat_ws(' ',report->'source'->'destination'->'policy'->>'item_code',
    report->'source'->'destination'->'policy'->>'location_code',report->'source'->>'source_location_code')) search_text
from public.transfer_date_scenarios;
revoke all on public.transfer_date_scenario_list from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.transfer_date_scenario_list to authenticated;
reset lock_timeout;
