-- Step 19e is additive/forward-only. Roll back the web build, retaining evidence.
set lock_timeout='5s';
create table public.event_delivery_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  supplier_scenario_id uuid not null,
  location_id uuid not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null,
  unique(organization_id,id), unique(organization_id,request_id),
  foreign key(organization_id,supplier_scenario_id) references public.event_supplier_scenarios(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
create index event_delivery_history on public.event_delivery_scenarios(organization_id,supplier_scenario_id,created_at desc,id);
create index event_delivery_location on public.event_delivery_scenarios(organization_id,location_id);
alter table public.event_delivery_scenarios enable row level security;
revoke all on public.event_delivery_scenarios from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.event_delivery_scenarios to authenticated;
create policy "members read" on public.event_delivery_scenarios for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.event_delivery_scenarios as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.event_delivery_scenarios
  for each row execute function app.audit_business_row();
comment on table public.event_delivery_scenarios is 'Indicative dates for fixed event supplier comparisons; no refreshed commitments, policy recalculation or purchasing execution.';

create function public.event_delivery_preview(p_organization_id uuid,p_scenario_id uuid,p_requested_date date,p_calendars_confirmed boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  source public.event_supplier_scenarios; supplier public.suppliers; receiver public.locations;
  supplier_calendar jsonb; receiver_calendar jsonb; order_search jsonb; receipt_search jsonb;
  result jsonb; status text; blocked_stage text; cutoff date; lead integer;
  baseline numeric; adjusted numeric; order_date date; nominal_receipt date; receipt_date date;
  expected_receipt date; earlier_events jsonb;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='event supplier scenario unavailable';
  end if;
  select * into source from public.event_supplier_scenarios x where x.organization_id=p_organization_id and x.id=p_scenario_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='event supplier scenario unavailable'; end if;
  if p_requested_date is null or not isfinite(p_requested_date)
    or p_requested_date not between date '1900-01-01' and date '2100-12-31' or p_calendars_confirmed is null then
    raise exception using errcode='MQ422',message='invalid requested date or confirmation';
  end if;
  -- Only the saved comparison supplies quantities, lead time and event assumptions.
  if source.report->>'method' is distinct from 'event-supplier-v1' or source.report->>'status' is distinct from 'available'
    or source.report->>'location_id' is distinct from source.location_id::text
    or coalesce(source.report#>>'{baseline,quantity}','')!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or coalesce(source.report#>>'{adjusted,quantity}','')!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or coalesce(source.report#>>'{terms,lead_time}','')!~'^[0-9]{1,2}$' then
    status:='source_unavailable';
  else
    baseline:=(source.report#>>'{baseline,quantity}')::numeric;
    adjusted:=(source.report#>>'{adjusted,quantity}')::numeric;
    lead:=(source.report#>>'{terms,lead_time}')::integer;
    cutoff:=(source.report#>>'{draft,scenario,event,source,cutoff}')::date;
    if cutoff is null or not isfinite(cutoff) or adjusted<baseline then status:='source_unavailable';
    elsif p_requested_date<cutoff then raise exception using errcode='MQ422',message='requested date precedes cutoff';
    end if;
  end if;
  if status is null then
    select * into supplier from public.suppliers where organization_id=p_organization_id and id=(source.report#>>'{supplier,id}')::uuid;
    select * into receiver from public.locations where organization_id=p_organization_id and id=source.location_id;
    expected_receipt:=cutoff+lead;
    status:=case when adjusted=0 then 'no_order_needed'
      when supplier.id is null or not supplier.is_active then 'supplier_unavailable'
      when receiver.id is null or not receiver.is_active then 'location_unavailable'
      when not p_calendars_confirmed then 'calendars_unconfirmed'
      else 'available' end;
  end if;
  if status='available' then
    supplier_calendar:=app.delivery_calendar_context(p_organization_id,supplier.country_code,supplier.work_calendar_id,p_requested_date,p_requested_date+89);
    receiver_calendar:=app.delivery_calendar_context(p_organization_id,receiver.country_code,receiver.work_calendar_id,p_requested_date+lead,p_requested_date+lead+178);
    order_search:=app.delivery_next_working_day(supplier_calendar,p_requested_date);
    order_date:=(order_search->>'date')::date;
    if order_date is null then status:=order_search->>'status'; blocked_stage:='supplier';
    else
      nominal_receipt:=order_date+lead;
      receipt_search:=app.delivery_next_working_day(receiver_calendar,nominal_receipt);
      receipt_date:=(receipt_search->>'date')::date;
      if receipt_date is null then status:=receipt_search->>'status'; blocked_stage:='receiver'; end if;
    end if;
  end if;
  if receipt_date is not null then
    select coalesce(jsonb_agg(jsonb_build_object('date',e->>'date','quantity',e->>'quantity') order by e->>'date'),'[]'::jsonb)
      into earlier_events from jsonb_array_elements(source.report#>'{draft,scenario,event,input,additions}') e
      where (e->>'quantity')::numeric>0 and (e->>'date')::date<receipt_date;
  end if;
  result:=jsonb_build_object('method','event-delivery-v1','status',status,'location_id',source.location_id,
    'input',jsonb_build_object('scenario_id',source.id,'requested_date',p_requested_date,'calendars_confirmed',p_calendars_confirmed),
    'source',source.report,
    'supplier',case when supplier.id is null then null else jsonb_build_object('id',supplier.id,'code',supplier.code,'name',supplier.name_en,'active',supplier.is_active,'updated_at',supplier.updated_at) end,
    'receiver',case when receiver.id is null then null else jsonb_build_object('id',receiver.id,'code',receiver.code,'name',receiver.name_en,'active',receiver.is_active,'updated_at',receiver.updated_at) end,
    'supplier_calendar',supplier_calendar,'receiver_calendar',receiver_calendar,'order_search',order_search,'receipt_search',receipt_search,
    'blocked_stage',blocked_stage,'order_date',order_date,'nominal_receipt',nominal_receipt,'receipt_date',receipt_date,'expected_receipt',expected_receipt,
    'policy_recalculation_required',case when receipt_date is null then null else receipt_date>expected_receipt end,
    'event_before_receipt',earlier_events);
  return result||jsonb_build_object('fingerprint',encode(extensions.digest(result::text,'sha256'),'hex'));
end; $$;
revoke all on function public.event_delivery_preview(uuid,uuid,date,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_delivery_preview(uuid,uuid,date,boolean) to authenticated;

create function public.event_delivery_save(p_organization_id uuid,p_scenario_id uuid,p_requested_date date,p_calendars_confirmed boolean,p_request_id uuid,p_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.event_delivery_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event delivery save forbidden';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_requested_date is null or not isfinite(p_requested_date) or p_requested_date not between date '1900-01-01' and date '2100-12-31'
    or p_calendars_confirmed is null then raise exception using errcode='MQ422',message='invalid event delivery save'; end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.event-delivery:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then raise exception using errcode='MQ403',message='event delivery save forbidden'; end if;
  select * into previous from public.event_delivery_scenarios x where x.organization_id=p_organization_id and x.request_id=p_request_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.submitted_by=auth.uid() and previous.supplier_scenario_id=p_scenario_id
      and previous.report#>>'{input,requested_date}'=p_requested_date::text
      and previous.report#>'{input,calendars_confirmed}'=to_jsonb(p_calendars_confirmed)
      and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='event delivery request conflicts';
  end if;
  report:=public.event_delivery_preview(p_organization_id,p_scenario_id,p_requested_date,p_calendars_confirmed);
  if report->>'fingerprint' is distinct from p_fingerprint then raise exception using errcode='MQ409',message='event delivery evidence changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_order_needed') then raise exception using errcode='MQ422',message='event delivery unavailable'; end if;
  insert into public.event_delivery_scenarios(organization_id,supplier_scenario_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_scenario_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $$;
revoke all on function public.event_delivery_save(uuid,uuid,date,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_delivery_save(uuid,uuid,date,boolean,uuid,text) to authenticated;
reset lock_timeout;
