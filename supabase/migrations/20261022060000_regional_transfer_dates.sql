-- Step 25d: dates for fixed regional sourcing quantities. No operational writes.
set lock_timeout='5s';

create function public.regional_date_preview(
  p_organization_id uuid,p_sourcing_id uuid,p_requested_date date,p_calendars_confirmed boolean
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  source public.regional_sourcing_scenarios; region public.stock_regions;
  sender public.locations; receiver public.locations; lane public.network_links;
  policy public.inventory_policies; cutoff date; reference_date date; destination_lead integer;
  line jsonb; lines jsonb:='[]'; report jsonb; policy_reference jsonb; quantity numeric;
  status text; line_status text; positive boolean; lead50 integer; lead90 integer;
  calendar jsonb; dispatch jsonb; dispatch_date date; receipts jsonb; receipt jsonb;
  percentile text; lead integer; nominal date;
begin
  -- Private calendar helpers are reached only after checking the complete saved location set.
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='regional sourcing unavailable';
  end if;
  select * into source from public.regional_sourcing_scenarios
    where organization_id=p_organization_id and id=p_sourcing_id
      and (organization_id=any(array(select app.unscoped_organizations()))
        or required_location_ids <@ array(select app.scoped_locations()));
  if not found then raise exception using errcode='MQ404',message='regional sourcing unavailable'; end if;
  select * into region from public.stock_regions where organization_id=p_organization_id
    and id=(source.report->'region'->>'id')::uuid and archived_at is null;
  if not found or region.required_location_ids is distinct from source.required_location_ids then
    raise exception using errcode='MQ404',message='region unavailable for new dates';
  end if;
  cutoff:=(source.report->'destination'->'policy'->>'cutoff')::date;
  if p_requested_date is null or not isfinite(p_requested_date)
    or p_requested_date not between date '1900-01-01' and date '2100-12-31'
    or p_requested_date<cutoff or p_calendars_confirmed is null then
    raise exception using errcode='MQ422',message='invalid requested date or confirmation';
  end if;
  select * into receiver from public.locations where organization_id=p_organization_id
    and id=(source.report->>'destination_location_id')::uuid;
  -- This parameter is absent from the captured stock comparison. Resolve the original
  -- immutable policy once, without rereading stock, inbound or recalculating allocations.
  select * into policy from public.inventory_policies where organization_id=p_organization_id
    and id=(source.report->'destination'->'policy'->>'policy_id')::uuid
    and location_id=receiver.id and unit=source.report->'destination'->'policy'->>'unit'
    and evidence->'forecast'->>'to_date'=cutoff::text;
  destination_lead:=(policy.evidence->'options'->>'lead_time')::integer;
  reference_date:=case when destination_lead between 0 and 3650 then cutoff+destination_lead end;
  policy_reference:=case when policy.id is null then null else jsonb_build_object(
    'id',policy.id,'cutoff',cutoff,'unit',policy.unit,'lead_time',destination_lead,
    'review_interval',(policy.evidence->'options'->>'review_interval')::integer) end;
  select bool_or((v->>'quantity')::numeric>0) into positive from jsonb_array_elements(source.report->'lines') v;
  status:=case
    when source.report->>'status' is distinct from 'available' or cutoff is null or not isfinite(cutoff) then 'source_unavailable'
    when receiver.id is null or not receiver.is_active then 'destination_location_unavailable'
    when positive and reference_date is null then 'destination_policy_unavailable'
    when positive and not p_calendars_confirmed then 'calendars_unconfirmed'
    when not positive then 'no_transfer_needed'
    else 'available' end;
  for line in select v from jsonb_array_elements(source.report->'lines') v order by (v->>'location_id')::uuid loop
    quantity:=(line->>'quantity')::numeric;
    lead50:=(line->'lane'->>'lead_time_days_p50')::integer;
    lead90:=(line->'lane'->>'lead_time_days_p90')::integer;
    select * into sender from public.locations where organization_id=p_organization_id and id=(line->>'location_id')::uuid;
    select * into lane from public.network_links where organization_id=p_organization_id
      and id=(line->'lane'->>'id')::uuid and from_location_id=sender.id and to_location_id=receiver.id;
    calendar:=null; dispatch:=null; dispatch_date:=null; receipts:='{}';
    line_status:=case
      when quantity is null or quantity<0 or lead50 is null or lead90 is null
        or lead50 not between 0 and 3650 or lead90 not between lead50 and 3650 then 'source_unavailable'
      when sender.id is null or not sender.is_active then 'source_location_unavailable'
      when receiver.id is null or not receiver.is_active then 'destination_location_unavailable'
      when lane.id is null or not lane.is_active then 'lane_unavailable'
      when lane.lead_time_days_p50<>lead50 or lane.lead_time_days_p90<>lead90 then 'lane_changed'
      when quantity=0 then 'no_transfer_needed'
      when status not in ('available','no_transfer_needed') then status
      else 'available' end;
    if line_status='available' then
      calendar:=app.delivery_calendar_context(p_organization_id,sender.country_code,sender.work_calendar_id,
        p_requested_date,p_requested_date+89);
      dispatch:=app.delivery_next_working_day(calendar,p_requested_date);
      dispatch_date:=(dispatch->>'date')::date;
      if dispatch_date is null then line_status:='dispatch_unavailable'; end if;
    end if;
    if line_status='available' then
      foreach percentile in array array['p50','p90'] loop
        lead:=case when percentile='p50' then lead50 else lead90 end;
        nominal:=dispatch_date+lead;
        receipt:=app.delivery_calendar_context(p_organization_id,receiver.country_code,receiver.work_calendar_id,
          nominal,nominal+89);
        receipts:=receipts||jsonb_build_object(percentile,jsonb_build_object('lead_time',lead,
          'nominal_date',nominal,'calendar',receipt,'search',app.delivery_next_working_day(receipt,nominal)));
        receipt:=receipts->percentile->'search';
        if receipt->>'date' is null then line_status:='receipt_unavailable'; end if;
        receipts:=jsonb_set(receipts,array[percentile,'timing_review_required'],
          coalesce(to_jsonb((receipt->>'date')::date>reference_date),'null'::jsonb));
      end loop;
    end if;
    lines:=lines||jsonb_build_array(jsonb_build_object(
      'location_id',line->>'location_id','location_code',line->>'location_code','quantity',line->>'quantity',
      'status',line_status,'source_calendar',calendar,'dispatch',dispatch,'receipts',receipts,
      'sender',case when sender.id is null then null else jsonb_build_object('id',sender.id,'code',sender.code,
        'name',sender.name_en,'active',sender.is_active,'updated_at',sender.updated_at) end,
      'lane',case when lane.id is null then null else jsonb_build_object('id',lane.id,'active',lane.is_active,
        'from_location_id',lane.from_location_id,'to_location_id',lane.to_location_id,
        'lead_time_days_p50',lane.lead_time_days_p50,'lead_time_days_p90',lane.lead_time_days_p90,
        'updated_at',lane.updated_at) end));
  end loop;
  if status in ('available','no_transfer_needed') and exists(
    select 1 from jsonb_array_elements(lines) v where v->>'status' not in ('available','no_transfer_needed')
  ) then status:='line_unavailable'; end if;
  report:=jsonb_build_object('method','regional-dates-v1','status',status,'sourcing_id',source.id,
    'source',source.report,'requested_date',p_requested_date,'calendars_confirmed',p_calendars_confirmed,
    'policy_reference',policy_reference,'timing_reference_date',reference_date,
    'receiver',case when receiver.id is null then null else jsonb_build_object('id',receiver.id,'code',receiver.code,
      'name',receiver.name_en,'active',receiver.is_active,'updated_at',receiver.updated_at) end,'lines',lines);
  return report||jsonb_build_object('fingerprint',encode(extensions.digest(report::text,'sha256'),'hex'));
end; $$;
revoke all on function public.regional_date_preview(uuid,uuid,date,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.regional_date_preview(uuid,uuid,date,boolean) to authenticated;

create table public.regional_date_scenarios(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,
  sourcing_id uuid not null,required_location_ids uuid[] not null,
  request_id uuid not null,submitted_by uuid not null,created_at timestamptz not null default clock_timestamp(),
  report jsonb not null check(report->>'method'='regional-dates-v1' and report->>'status' in ('available','no_transfer_needed')),
  unique(organization_id,id),unique(organization_id,request_id),
  check(cardinality(required_location_ids) between 2 and 20 and array_position(required_location_ids,null) is null),
  foreign key(organization_id) references public.organizations(id) on delete cascade,
  foreign key(organization_id,sourcing_id) references public.regional_sourcing_scenarios(organization_id,id) on delete cascade
);
comment on table public.regional_date_scenarios is 'Immutable per-source dates for fixed regional allocations; every region member is required. No operational writes.';
create index regional_dates_recent on public.regional_date_scenarios(organization_id,created_at desc,id);
create index regional_dates_parent on public.regional_date_scenarios(organization_id,sourcing_id);
alter table public.regional_date_scenarios enable row level security;
revoke all on public.regional_date_scenarios from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.regional_date_scenarios to authenticated;
create policy "members read" on public.regional_date_scenarios for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "all locations" on public.regional_date_scenarios as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or required_location_ids <@ array(select app.scoped_locations()));
create trigger audit_business_row after insert or update or delete on public.regional_date_scenarios
  for each row execute function app.audit_business_row();

create function public.regional_date_save(
  p_organization_id uuid,p_sourcing_id uuid,p_requested_date date,p_calendars_confirmed boolean,
  p_request_id uuid,p_fingerprint text
) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.regional_date_scenarios; source public.regional_sourcing_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional dates require an editor';
  end if;
  if p_sourcing_id is null or p_requested_date is null or not isfinite(p_requested_date)
    or p_requested_date not between date '1900-01-01' and date '2100-12-31'
    or p_calendars_confirmed is null or p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid regional date request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.regional-dates:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional dates require an editor';
  end if;
  select * into previous from public.regional_date_scenarios where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='regional dates unavailable';
    end if;
    if previous.sourcing_id=p_sourcing_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint
      and (previous.report->>'requested_date')::date=p_requested_date
      and (previous.report->>'calendars_confirmed')::boolean=p_calendars_confirmed then return previous.id; end if;
    raise exception using errcode='MQ409',message='regional date request conflicts';
  end if;
  select * into source from public.regional_sourcing_scenarios
    where organization_id=p_organization_id and id=p_sourcing_id
      and (organization_id=any(array(select app.unscoped_organizations()))
        or required_location_ids <@ array(select app.scoped_locations()));
  if not found then raise exception using errcode='MQ404',message='regional sourcing unavailable'; end if;
  -- Match regional sourcing/region archive lock order, then protect the saved parent.
  perform 1 from public.locations where organization_id=p_organization_id and id=any(source.required_location_ids) order by id for share;
  perform 1 from public.stock_regions where organization_id=p_organization_id and id=(source.report->'region'->>'id')::uuid for share;
  perform 1 from public.regional_sourcing_scenarios where organization_id=p_organization_id and id=p_sourcing_id for key share;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional dates require an editor';
  end if;
  report:=public.regional_date_preview(p_organization_id,p_sourcing_id,p_requested_date,p_calendars_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_transfer_needed') then
    raise exception using errcode='MQ422',message='resolve unavailable regional dates before saving';
  end if;
  insert into public.regional_date_scenarios(organization_id,sourcing_id,required_location_ids,request_id,submitted_by,report)
    values(p_organization_id,source.id,source.required_location_ids,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $$;
revoke all on function public.regional_date_save(uuid,uuid,date,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.regional_date_save(uuid,uuid,date,boolean,uuid,text) to authenticated;

create view public.regional_date_list with(security_invoker=true) as
select id,organization_id,sourcing_id,created_at,report->>'status' status,
  report->'source'->'region'->>'name_en' region_name,report->'source'->'region'->>'name_ar' region_name_ar,
  report->'source'->'destination'->'policy'->>'item_code' item_code,
  report->'source'->'destination'->'policy'->>'location_code' destination_code,
  report->'source'->'destination'->'policy'->>'cutoff' cutoff,
  report->'source'->'destination'->'policy'->>'unit' unit,
  report->'source'->>'allocated' allocated,report->>'requested_date' requested_date,
  app.normalize_search(concat_ws(' ',report->'source'->'region'->>'name_en',report->'source'->'region'->>'name_ar',
    report->'source'->'destination'->'policy'->>'item_code',report->'source'->'destination'->'policy'->>'location_code',
    (select string_agg(v->>'location_code',' ') from jsonb_array_elements(report->'lines') v))) search_text
from public.regional_date_scenarios;
revoke all on public.regional_date_list from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.regional_date_list to authenticated;
reset lock_timeout;
