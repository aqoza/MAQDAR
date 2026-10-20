-- Step 22b is additive. Roll back the web release, retain immutable date evidence.
set lock_timeout='5s';

create function public.network_date_preview(
  p_organization_id uuid,p_allocation_id uuid,p_requested_date date,p_calendars_confirmed boolean
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  source public.network_allocation_scenarios; sender public.locations; receiver public.locations;
  lane public.network_links; policy public.inventory_policies; cutoff date; quantity numeric;
  line jsonb; lines jsonb:='[]'; receipts jsonb; result jsonb; policy_reference jsonb;
  status text; line_status text; positive boolean; lead50 integer; lead90 integer;
  reference_date date; destination_lead integer; source_calendar jsonb; dispatch jsonb;
  dispatch_date date; percentile text; lead integer; nominal date; calendar jsonb; receipt jsonb;
begin
  -- Definer access is needed only for private calendar helpers. Check every saved location first.
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='allocation unavailable';
  end if;
  select * into source from public.network_allocation_scenarios
    where organization_id=p_organization_id and id=p_allocation_id
      and (organization_id=any(array(select app.unscoped_organizations()))
        or required_location_ids <@ array(select app.scoped_locations()));
  if not found then raise exception using errcode='MQ404',message='allocation unavailable'; end if;
  cutoff:=(source.report->'source_policy'->>'cutoff')::date;
  if p_requested_date is null or not isfinite(p_requested_date)
    or p_requested_date not between date '1900-01-01' and date '2100-12-31'
    or p_requested_date<cutoff or p_calendars_confirmed is null then
    raise exception using errcode='MQ422',message='invalid requested date or confirmation';
  end if;
  select * into sender from public.locations where organization_id=p_organization_id and id=source.source_location_id;
  select bool_or((v->>'quantity')::numeric>0) into positive from jsonb_array_elements(source.report->'lines') v;
  status:=case
    when source.report->>'status' is distinct from 'available' or cutoff is null or not isfinite(cutoff) then 'source_unavailable'
    when sender.id is null or not sender.is_active then 'source_location_unavailable'
    when positive and not p_calendars_confirmed then 'calendars_unconfirmed'
    when not positive then 'no_transfer_needed'
    else 'available' end;
  if status='available' then
    source_calendar:=app.delivery_calendar_context(p_organization_id,sender.country_code,sender.work_calendar_id,
      p_requested_date,p_requested_date+89);
    dispatch:=app.delivery_next_working_day(source_calendar,p_requested_date);
    dispatch_date:=(dispatch->>'date')::date;
    if dispatch_date is null then status:='dispatch_unavailable'; end if;
  end if;
  for line in select v from jsonb_array_elements(source.report->'lines') v order by (v->>'location_id')::uuid loop
    quantity:=(line->>'quantity')::numeric;
    lead50:=(line->'evidence'->'lane'->>'lead_time_days_p50')::integer;
    lead90:=(line->'evidence'->'lane'->>'lead_time_days_p90')::integer;
    select * into receiver from public.locations where organization_id=p_organization_id and id=(line->>'location_id')::uuid;
    select * into lane from public.network_links where organization_id=p_organization_id
      and id=(line->'evidence'->'lane'->>'id')::uuid
      and from_location_id=source.source_location_id and to_location_id=receiver.id;
    -- Saved policies are immutable. Capture this missing date-reference parameter once;
    -- never infer it from a protection period or refresh branch stock/inbound.
    select * into policy from public.inventory_policies where organization_id=p_organization_id
      and id=(line->'evidence'->'destination'->'policy'->>'policy_id')::uuid
      and location_id=receiver.id and item_id=(source.report->>'item_id')::uuid
      and unit=source.report->'source_policy'->>'unit'
      and evidence->'forecast'->>'to_date'=cutoff::text;
    destination_lead:=(policy.evidence->'options'->>'lead_time')::integer;
    reference_date:=case when destination_lead between 0 and 3650 then cutoff+destination_lead end;
    policy_reference:=case when policy.id is null then null else jsonb_build_object(
      'id',policy.id,'cutoff',cutoff,'unit',policy.unit,'lead_time',destination_lead,
      'review_interval',(policy.evidence->'options'->>'review_interval')::integer) end;
    receipts:='{}';
    line_status:=case
      when quantity is null or quantity<0 or lead50 is null or lead90 is null
        or lead50 not between 0 and 3650 or lead90 not between lead50 and 3650 then 'source_unavailable'
      when receiver.id is null or not receiver.is_active then 'destination_location_unavailable'
      when lane.id is null or not lane.is_active then 'lane_unavailable'
      when lane.lead_time_days_p50<>lead50 or lane.lead_time_days_p90<>lead90 then 'lane_changed'
      when quantity=0 then 'no_transfer_needed'
      when reference_date is null then 'destination_policy_unavailable'
      when status in ('source_unavailable','source_location_unavailable','calendars_unconfirmed','dispatch_unavailable') then status
      else 'available' end;
    if line_status='available' then
      foreach percentile in array array['p50','p90'] loop
        lead:=case when percentile='p50' then lead50 else lead90 end;
        nominal:=dispatch_date+lead;
        calendar:=app.delivery_calendar_context(p_organization_id,receiver.country_code,receiver.work_calendar_id,
          nominal,nominal+89);
        receipt:=app.delivery_next_working_day(calendar,nominal);
        if receipt->>'date' is null then line_status:='receipt_unavailable'; end if;
        receipts:=receipts||jsonb_build_object(percentile,jsonb_build_object('lead_time',lead,
          'nominal_date',nominal,'calendar',calendar,'search',receipt,
          'timing_review_required',case when receipt->>'date' is null then null
            else (receipt->>'date')::date>reference_date end));
      end loop;
    end if;
    lines:=lines||jsonb_build_array(jsonb_build_object(
      'location_id',line->>'location_id','location_code',line->>'location_code','quantity',line->>'quantity',
      'status',line_status,'policy_reference',policy_reference,'timing_reference_date',reference_date,
      'receiver',case when receiver.id is null then null else jsonb_build_object('id',receiver.id,'code',receiver.code,
        'name',receiver.name_en,'active',receiver.is_active,'updated_at',receiver.updated_at) end,
      'lane',case when lane.id is null then null else jsonb_build_object('id',lane.id,'active',lane.is_active,
        'from_location_id',lane.from_location_id,'to_location_id',lane.to_location_id,
        'lead_time_days_p50',lane.lead_time_days_p50,'lead_time_days_p90',lane.lead_time_days_p90,
        'updated_at',lane.updated_at) end,'receipts',receipts));
  end loop;
  if status in ('available','no_transfer_needed') and exists(
    select 1 from jsonb_array_elements(lines) v where v->>'status' not in ('available','no_transfer_needed')
  ) then status:='line_unavailable'; end if;
  result:=jsonb_build_object('method','network-dates-v1','status',status,'allocation_id',source.id,
    'source_location_id',source.source_location_id,'source',source.report,
    'requested_date',p_requested_date,'calendars_confirmed',p_calendars_confirmed,
    'sender',case when sender.id is null then null else jsonb_build_object('id',sender.id,'code',sender.code,
      'name',sender.name_en,'active',sender.is_active,'updated_at',sender.updated_at) end,
    'source_calendar',source_calendar,'dispatch',dispatch,'lines',lines);
  return result||jsonb_build_object('fingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end; $$;
revoke all on function public.network_date_preview(uuid,uuid,date,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.network_date_preview(uuid,uuid,date,boolean) to authenticated;

create table public.network_date_scenarios(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,
  allocation_id uuid not null,source_location_id uuid not null,required_location_ids uuid[] not null,
  request_id uuid not null,submitted_by uuid not null,created_at timestamptz not null default clock_timestamp(),
  report jsonb not null check(report->>'method'='network-dates-v1' and report->>'status' in ('available','no_transfer_needed')),
  unique(organization_id,id),unique(organization_id,request_id),
  check(cardinality(required_location_ids) between 2 and 21 and array_position(required_location_ids,null) is null),
  foreign key(organization_id) references public.organizations(id) on delete cascade,
  foreign key(organization_id,allocation_id) references public.network_allocation_scenarios(organization_id,id) on delete cascade,
  foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete cascade
);
comment on table public.network_date_scenarios is 'Immutable dates for fixed network allocations; every participating location is required. No reservations or execution.';
create index network_dates_recent on public.network_date_scenarios(organization_id,created_at desc,id);
create index network_dates_parent on public.network_date_scenarios(organization_id,allocation_id);
alter table public.network_date_scenarios enable row level security;
revoke all on public.network_date_scenarios from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.network_date_scenarios to authenticated;
create policy "members read" on public.network_date_scenarios for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "all locations" on public.network_date_scenarios as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or required_location_ids <@ array(select app.scoped_locations()));
create trigger audit_business_row after insert or update or delete on public.network_date_scenarios for each row execute function app.audit_business_row();

create function public.network_date_save(
  p_organization_id uuid,p_allocation_id uuid,p_requested_date date,p_calendars_confirmed boolean,
  p_request_id uuid,p_fingerprint text
) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.network_date_scenarios; source public.network_allocation_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network dates require an editor';
  end if;
  if p_allocation_id is null or p_requested_date is null or not isfinite(p_requested_date)
    or p_requested_date not between date '1900-01-01' and date '2100-12-31'
    or p_calendars_confirmed is null or p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid network date request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.network-dates:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network dates require an editor';
  end if;
  select * into previous from public.network_date_scenarios where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='network dates unavailable';
    end if;
    if previous.allocation_id=p_allocation_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint
      and (previous.report->>'requested_date')::date=p_requested_date
      and (previous.report->>'calendars_confirmed')::boolean=p_calendars_confirmed then return previous.id; end if;
    raise exception using errcode='MQ409',message='network date request conflicts';
  end if;
  select * into source from public.network_allocation_scenarios
    where organization_id=p_organization_id and id=p_allocation_id
      and (organization_id=any(array(select app.unscoped_organizations()))
        or required_location_ids <@ array(select app.scoped_locations())) for key share;
  if not found then raise exception using errcode='MQ404',message='allocation unavailable'; end if;
  -- Parent deletion can also make this transaction wait after its advisory lock.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network dates require an editor';
  end if;
  report:=public.network_date_preview(p_organization_id,p_allocation_id,p_requested_date,p_calendars_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_transfer_needed') then
    raise exception using errcode='MQ422',message='resolve unavailable network dates before saving';
  end if;
  insert into public.network_date_scenarios(organization_id,allocation_id,source_location_id,required_location_ids,request_id,submitted_by,report)
    values(p_organization_id,source.id,source.source_location_id,source.required_location_ids,p_request_id,auth.uid(),report)
    returning id into result;
  return result;
end; $$;
revoke all on function public.network_date_save(uuid,uuid,date,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.network_date_save(uuid,uuid,date,boolean,uuid,text) to authenticated;

create view public.network_date_list with(security_invoker=true) as
select id,organization_id,allocation_id,source_location_id,created_at,report->>'status' status,
  report->'source'->>'source_location_code' source_code,report->'source'->'source_policy'->>'item_code' item_code,
  report->'source'->'source_policy'->>'cutoff' cutoff,report->'source'->'source_policy'->>'unit' unit,
  report->'source'->>'allocated' allocated,jsonb_array_length(report->'lines') branch_count,
  report->>'requested_date' requested_date,report->'dispatch'->>'date' dispatch_date,
  app.normalize_search(concat_ws(' ',report->'source'->>'source_location_code',
    report->'source'->'source_policy'->>'item_code',
    (select string_agg(v->>'location_code',' ') from jsonb_array_elements(report->'lines') v))) search_text
from public.network_date_scenarios;
revoke all on public.network_date_list from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.network_date_list to authenticated;
reset lock_timeout;
