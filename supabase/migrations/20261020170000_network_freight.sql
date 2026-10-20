-- Step 22c is additive. Roll back the web release while retaining saved evidence.
set lock_timeout='5s';

create function public.network_freight_preview(p_organization_id uuid,p_scenario_id uuid,p_terms_confirmed boolean)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  source public.network_date_scenarios; sender public.locations; receiver public.locations; lane public.network_links;
  line jsonb; lines jsonb:='[]'; totals jsonb:='[]'; result jsonb; terms jsonb;
  quantity numeric; unit text; dispatch date; digits integer; product numeric; subtotal numeric;
  status text; line_status text; positive boolean;
begin
  -- Explicit checks also protect calls from the definer save RPC.
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='network dates unavailable';
  end if;
  select * into source from public.network_date_scenarios
    where organization_id=p_organization_id and id=p_scenario_id
      and (organization_id=any(array(select app.unscoped_organizations()))
        or required_location_ids <@ array(select app.scoped_locations()));
  if not found then raise exception using errcode='MQ404',message='network dates unavailable'; end if;
  if p_terms_confirmed is null then raise exception using errcode='MQ422',message='freight confirmation is required'; end if;
  unit:=source.report->'source'->'source_policy'->>'unit';
  dispatch:=(source.report->'dispatch'->>'date')::date;
  select bool_or((v->>'quantity')::numeric>0) into positive from jsonb_array_elements(source.report->'lines') v;
  select * into sender from public.locations where organization_id=p_organization_id and id=source.source_location_id;
  status:=case
    when source.report->>'status' not in ('available','no_transfer_needed') or positive is null
      or (positive and (dispatch is null or not isfinite(dispatch))) then 'source_unavailable'
    when sender.id is null or not sender.is_active then 'source_location_unavailable'
    when not positive then 'no_transfer_needed'
    else 'available' end;
  for line in select v from jsonb_array_elements(source.report->'lines') v order by (v->>'location_id')::uuid loop
    quantity:=(line->>'quantity')::numeric;
    select * into receiver from public.locations where organization_id=p_organization_id and id=(line->>'location_id')::uuid;
    select * into lane from public.network_links where organization_id=p_organization_id
      and id=(line->'lane'->>'id')::uuid
      and from_location_id=source.source_location_id and to_location_id=receiver.id;
    select minor_units into digits from public.currencies where code=lane.currency;
    product:=null; subtotal:=null;
    line_status:=case
      when status in ('source_unavailable','source_location_unavailable') then status
      when quantity is null or quantity::text !~ '^\d+(\.\d+)?$'
        or line->>'status' not in ('available','no_transfer_needed') then 'source_unavailable'
      when receiver.id is null or not receiver.is_active then 'destination_location_unavailable'
      when lane.id is null or not lane.is_active then 'lane_unavailable'
      when lane.lead_time_days_p50 is distinct from (line->'lane'->>'lead_time_days_p50')::integer
        or lane.lead_time_days_p90 is distinct from (line->'lane'->>'lead_time_days_p90')::integer then 'lane_changed'
      when quantity=0 then 'no_transfer_needed'
      when lane.freight_basis='none' then 'freight_unconfigured'
      when lane.freight_basis='per_unit' and (lane.freight_unit is null or unit is null) then 'unit_unknown'
      when lane.freight_basis='per_unit' and lane.freight_unit is distinct from unit then 'unit_mismatch'
      when lane.freight_cost is null or lane.freight_cost::text !~ '^\d+(\.\d+)?$' or digits is null then 'rate_invalid'
      when lane.freight_valid_from is null or not isfinite(lane.freight_valid_from) then 'rate_date_unknown'
      when lane.freight_valid_from>dispatch then 'rate_not_effective'
      when not p_terms_confirmed then 'terms_unconfirmed'
      else 'available' end;
    if line_status='available' then
      product:=case when lane.freight_basis='per_unit' then quantity*lane.freight_cost else lane.freight_cost end;
      subtotal:=round(product,digits);
      if subtotal>999999999999999.999 then line_status:='amount_out_of_range'; subtotal:=null; end if;
    end if;
    terms:=case when lane.id is null then null else jsonb_build_object(
      'id',lane.id,'active',lane.is_active,'from_location_id',lane.from_location_id,'to_location_id',lane.to_location_id,
      'lead_time_days_p50',lane.lead_time_days_p50,'lead_time_days_p90',lane.lead_time_days_p90,
      'basis',lane.freight_basis,'rate',case when lane.freight_cost::text ~ '^\d+(\.\d+)?$' then lane.freight_cost::text end,
      'raw_rate',lane.freight_cost::text,'currency',lane.currency,'minor_units',digits,
      'unit',lane.freight_unit,'valid_from',lane.freight_valid_from::text,'updated_at',lane.updated_at) end;
    lines:=lines||jsonb_build_array(jsonb_build_object(
      'location_id',line->>'location_id','location_code',line->>'location_code','quantity',line->>'quantity',
      'status',line_status,'terms',terms,
      'receiver',case when receiver.id is null then null else jsonb_build_object('id',receiver.id,'code',receiver.code,
        'name',receiver.name_en,'active',receiver.is_active,'updated_at',receiver.updated_at) end,
      'shipment_count',case when line_status='available' and lane.freight_basis='per_shipment' then 1 end,
      'exact_product',product::text,'subtotal',subtotal::text));
  end loop;
  if status in ('available','no_transfer_needed') and exists(
    select 1 from jsonb_array_elements(lines) v where v->>'status' not in ('available','no_transfer_needed')
  ) then status:='line_unavailable'; end if;
  -- Never present partial totals as a complete estimate. Quantities are not pooled.
  if status='available' then
    select coalesce(jsonb_agg(jsonb_build_object('currency',v.currency,'minor_units',v.minor_units,
      'subtotal',v.subtotal::text) order by v.currency),'[]') into totals from (
      select v->'terms'->>'currency' currency,(v->'terms'->>'minor_units')::integer minor_units,
        sum((v->>'subtotal')::numeric) subtotal
      from jsonb_array_elements(lines) v where v->>'status'='available' group by 1,2
    ) v;
  end if;
  result:=jsonb_build_object('method','network-freight-v1','status',status,'scenario_id',source.id,
    'source_location_id',source.source_location_id,'source',source.report,'terms_confirmed',p_terms_confirmed,
    'sender',case when sender.id is null then null else jsonb_build_object('id',sender.id,'code',sender.code,
      'name',sender.name_en,'active',sender.is_active,'updated_at',sender.updated_at) end,
    'lines',lines,'totals',totals,'rounding','half-up-currency-minor-units');
  return result||jsonb_build_object('fingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end; $$;
revoke all on function public.network_freight_preview(uuid,uuid,boolean) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function public.network_freight_preview(uuid,uuid,boolean) to authenticated;

create table public.network_freight_estimates(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,
  scenario_id uuid not null,source_location_id uuid not null,required_location_ids uuid[] not null,
  request_id uuid not null,submitted_by uuid not null,created_at timestamptz not null default clock_timestamp(),
  report jsonb not null check(report->>'method'='network-freight-v1' and report->>'status' in ('available','no_transfer_needed')),
  unique(organization_id,id),unique(organization_id,request_id),
  check(cardinality(required_location_ids) between 2 and 21 and array_position(required_location_ids,null) is null),
  foreign key(organization_id) references public.organizations(id) on delete cascade,
  foreign key(organization_id,scenario_id) references public.network_date_scenarios(organization_id,id) on delete cascade,
  foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete cascade
);
comment on table public.network_freight_estimates is 'Immutable freight estimates for fixed network schedules. Separate branch fees and currency totals; no consolidation or execution.';
create index network_freight_recent on public.network_freight_estimates(organization_id,created_at desc,id);
create index network_freight_parent on public.network_freight_estimates(organization_id,scenario_id);
alter table public.network_freight_estimates enable row level security;
revoke all on public.network_freight_estimates from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.network_freight_estimates to authenticated;
create policy "members read" on public.network_freight_estimates for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "all locations" on public.network_freight_estimates as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or required_location_ids <@ array(select app.scoped_locations()));
create trigger audit_business_row after insert or update or delete on public.network_freight_estimates for each row execute function app.audit_business_row();

create function public.network_freight_save(p_organization_id uuid,p_scenario_id uuid,p_terms_confirmed boolean,p_request_id uuid,p_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.network_freight_estimates; source public.network_date_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network freight requires an editor';
  end if;
  if p_scenario_id is null or p_terms_confirmed is null or p_request_id is null or p_fingerprint is null
    or p_fingerprint!~'^[a-f0-9]{64}$' then raise exception using errcode='MQ422',message='invalid network freight request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.network-freight:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network freight requires an editor';
  end if;
  select * into previous from public.network_freight_estimates where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='network freight unavailable';
    end if;
    if previous.scenario_id=p_scenario_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint
      and (previous.report->>'terms_confirmed')::boolean=p_terms_confirmed then return previous.id; end if;
    raise exception using errcode='MQ409',message='network freight request conflicts';
  end if;
  select * into source from public.network_date_scenarios where organization_id=p_organization_id and id=p_scenario_id
    and (organization_id=any(array(select app.unscoped_organizations()))
      or required_location_ids <@ array(select app.scoped_locations())) for key share;
  if not found then raise exception using errcode='MQ404',message='network dates unavailable'; end if;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network freight requires an editor';
  end if;
  report:=public.network_freight_preview(p_organization_id,p_scenario_id,p_terms_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_transfer_needed') then
    raise exception using errcode='MQ422',message='resolve unavailable network freight before saving';
  end if;
  insert into public.network_freight_estimates(organization_id,scenario_id,source_location_id,required_location_ids,request_id,submitted_by,report)
    values(p_organization_id,source.id,source.source_location_id,source.required_location_ids,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $$;
revoke all on function public.network_freight_save(uuid,uuid,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function public.network_freight_save(uuid,uuid,boolean,uuid,text) to authenticated;

create view public.network_freight_list with(security_invoker=true) as
select id,organization_id,scenario_id,source_location_id,created_at,report->>'status' status,
  report->'source'->'source'->>'source_location_code' source_code,
  report->'source'->'source'->'source_policy'->>'item_code' item_code,
  jsonb_array_length(report->'lines') branch_count,report->'source'->'dispatch'->>'date' dispatch_date,
  app.normalize_search(concat_ws(' ',report->'source'->'source'->>'source_location_code',
    report->'source'->'source'->'source_policy'->>'item_code',
    (select string_agg(v->>'location_code',' ') from jsonb_array_elements(report->'lines') v))) search_text
from public.network_freight_estimates;
revoke all on public.network_freight_list from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.network_freight_list to authenticated;
reset lock_timeout;
