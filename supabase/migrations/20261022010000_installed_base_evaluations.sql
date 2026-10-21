-- Step 24c: retrospective recorded-sales evaluations; no operational mutations.
set lock_timeout = '5s';
create table public.installed_base_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  item_id uuid not null,
  scenario_id uuid not null,
  item_code text not null,
  location_code text not null,
  evaluation_name text not null,
  cutoff date not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null,
  unique(organization_id,id), unique(organization_id,request_id),
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
create index installed_base_evaluations_history on public.installed_base_evaluations(organization_id,created_at desc,id);
create index installed_base_evaluations_location on public.installed_base_evaluations(organization_id,location_id);
alter table public.installed_base_evaluations enable row level security;
revoke all on public.installed_base_evaluations from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.installed_base_evaluations to authenticated;
create policy "members read" on public.installed_base_evaluations for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.installed_base_evaluations as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.installed_base_evaluations
  for each row execute function app.audit_business_row();
comment on table public.installed_base_evaluations is 'Immutable retrospective comparison to recorded sales, not measured failures or verified out-of-sample accuracy. Copies survive scenario/item deletion; organization/location cascades remain.';

create function app.installed_base_evaluation_input(p_input jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>4096
    or jsonb_typeof(p_input->'scenario_id') is distinct from 'string'
    or coalesce(p_input->>'scenario_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_input->'evaluation_name') is distinct from 'string'
    or length(btrim(p_input->>'evaluation_name')) not between 1 and 200
    or p_input->'confirmed' is distinct from 'true'::jsonb then
    raise exception using errcode='MQ422',message='invalid evaluation input or unconfirmed complete history';
  end if;
  return jsonb_build_object('scenario_id',(p_input->>'scenario_id')::uuid,
    'evaluation_name',btrim(p_input->>'evaluation_name'),'confirmed',true);
end; $$;
revoke all on function app.installed_base_evaluation_input(jsonb) from public,anon,authenticated,service_role,maqdar_worker;

create function public.installed_base_evaluation_preview(p_organization_id uuid,p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare input jsonb; scenario public.installed_base_demand_scenarios; first_day date; last_day date;
  unit text; horizon integer; days jsonb; report jsonb; expected numeric; sold numeric; lost numeric;
  signed_total numeric; absolute_total numeric; squared_total numeric; observed integer;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='demand scenario unavailable';
  end if;
  input:=app.installed_base_evaluation_input(p_input);
  select * into scenario from public.installed_base_demand_scenarios s where s.organization_id=p_organization_id
    and s.id=(input->>'scenario_id')::uuid
    and (s.organization_id=any(array(select app.unscoped_organizations())) or s.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='demand scenario unavailable'; end if;
  horizon:=(scenario.report#>>'{input,horizon_days}')::integer;
  first_day:=scenario.cutoff+1; last_day:=scenario.cutoff+horizon;
  unit:=scenario.report#>>'{source,population,input,unit}';
  if scenario.report->>'method' is distinct from 'installed-base-demand-v1'
    or scenario.report#>'{input,confirmed}' is distinct from 'true'::jsonb
    or unit is null or unit not in ('EA','SET','L','KG') or horizon is null or horizon not between 1 and 90
    or scenario.item_id::text is distinct from scenario.report#>>'{source,population,source,item_id}'
    or scenario.location_id::text is distinct from scenario.report#>>'{source,population,source,location_id}'
    or scenario.cutoff::text is distinct from scenario.report#>>'{input,cutoff}'
    or scenario.report#>>'{source,population,source,time_zone}' is null
    or jsonb_typeof(scenario.report->'days') is distinct from 'array'
    or jsonb_array_length(scenario.report->'days')<>horizon then
    raise exception using errcode='MQ422',message='incompatible scenario evidence';
  end if;
  if last_day >= (current_timestamp at time zone (scenario.report#>>'{source,population,source,time_zone}'))::date then
    raise exception using errcode='MQ422',message='scenario horizon has not completed';
  end if;
  if exists(select 1 from jsonb_array_elements(scenario.report->'days') with ordinality d(value,n)
    where d.value->>'date' is distinct from (scenario.cutoff+d.n::integer)::text
      or jsonb_typeof(d.value->'expected_demand') is distinct from 'string'
      or coalesce(d.value->>'expected_demand','') !~ '^[0-9]{1,41}(\.[0-9]{1,12})?$') then
    raise exception using errcode='MQ422',message='incompatible scenario ledger';
  end if;
  -- One statement captures units and all daily quantities in a single MVCC snapshot.
  select jsonb_agg(jsonb_build_object('date',d.value->>'date','expected_demand',d.value->>'expected_demand',
      'recorded',h.demand_date is not null,'sold',trim_scale(coalesce(h.quantity,0))::text,
      'lost_sales',trim_scale(coalesce(h.lost_sales_quantity,0))::text,'supplied_unit',h.unit_of_measure,
      'difference',trim_scale((d.value->>'expected_demand')::numeric-coalesce(h.quantity,0))::text)
      order by d.value->>'date') into days
    from jsonb_array_elements(scenario.report->'days') d
    left join public.demand_history h on h.organization_id=p_organization_id and h.item_id=scenario.item_id
      and h.location_id=scenario.location_id and h.demand_date between first_day and last_day
      and h.demand_date=(d.value->>'date')::date;
  if exists(select 1 from jsonb_array_elements(days) d where d.value->'recorded'='true'::jsonb
      and d.value->>'supplied_unit' is distinct from unit) then
    raise exception using errcode='MQ422',message='sales units missing or incompatible';
  end if;
  select sum((d.value->>'expected_demand')::numeric),sum((d.value->>'sold')::numeric),
    sum((d.value->>'lost_sales')::numeric),sum((d.value->>'difference')::numeric),
    sum(abs((d.value->>'difference')::numeric)),sum((d.value->>'difference')::numeric*(d.value->>'difference')::numeric),
    count(*) filter(where d.value->'recorded'='true'::jsonb)
    into expected,sold,lost,signed_total,absolute_total,squared_total,observed from jsonb_array_elements(days) d;
  report:=jsonb_build_object('method','installed-base-evaluation-v1','input',input,'unit',unit,
    'start_date',first_day::text,'end_date',last_day::text,'day_count',horizon,'recorded_days',observed,
    'zero_filled_days',horizon-observed,'days',days,
    'totals',jsonb_build_object('expected',trim_scale(expected)::text,'sold',trim_scale(sold)::text,
      'lost_sales',trim_scale(lost)::text,'difference',trim_scale(signed_total)::text,
      'absolute_error',trim_scale(absolute_total)::text,'squared_error',trim_scale(squared_total)::text),
    -- Totals are exact. Division/root metrics are rounded once to 24 fractional digits.
    'metrics',jsonb_build_object('mae',trim_scale(round(absolute_total::numeric(150,60)/horizon,24))::text,
      'rmse',trim_scale(round(sqrt(squared_total::numeric(150,60)/horizon),24))::text,
      'bias',trim_scale(round(signed_total::numeric(150,60)/horizon,24))::text),
    'source',jsonb_build_object('scenario_id',scenario.id,'scenario_saved_at',scenario.created_at,'scenario',scenario.report));
  return report||jsonb_build_object('fingerprint',encode(extensions.digest(report::text,'sha256'),'hex'));
end; $$;
revoke all on function public.installed_base_evaluation_preview(uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.installed_base_evaluation_preview(uuid,jsonb) to authenticated;

create function public.installed_base_evaluation_save(p_organization_id uuid,p_input jsonb,p_request_id uuid,p_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare input jsonb; report jsonb; previous public.installed_base_evaluations; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='evaluation save forbidden';
  end if;
  input:=app.installed_base_evaluation_input(p_input);
  if p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid evaluation save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.installed-base-evaluation:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='evaluation save forbidden';
  end if;
  select * into previous from public.installed_base_evaluations e where e.organization_id=p_organization_id and e.request_id=p_request_id;
  if found then
    if not(previous.organization_id=any(array(select app.unscoped_organizations())) or previous.location_id=any(array(select app.scoped_locations()))) then
      raise exception using errcode='MQ404',message='evaluation unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='evaluation request conflicts';
  end if;
  perform 1 from public.installed_base_demand_scenarios s where s.organization_id=p_organization_id and s.id=(input->>'scenario_id')::uuid
    and (s.organization_id=any(array(select app.unscoped_organizations())) or s.location_id=any(array(select app.scoped_locations()))) for share;
  if not found then raise exception using errcode='MQ404',message='demand scenario unavailable'; end if;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='evaluation save forbidden';
  end if;
  report:=public.installed_base_evaluation_preview(p_organization_id,input);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='evaluation evidence changed; refresh preview'; end if;
  insert into public.installed_base_evaluations(organization_id,location_id,item_id,scenario_id,item_code,location_code,evaluation_name,cutoff,request_id,submitted_by,report)
    values(p_organization_id,(report#>>'{source,scenario,source,population,source,location_id}')::uuid,
      (report#>>'{source,scenario,source,population,source,item_id}')::uuid,(input->>'scenario_id')::uuid,
      report#>>'{source,scenario,source,population,input,item_code}',report#>>'{source,scenario,source,population,input,location_code}',
      input->>'evaluation_name',(report#>>'{source,scenario,input,cutoff}')::date,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $$;
revoke all on function public.installed_base_evaluation_save(uuid,jsonb,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.installed_base_evaluation_save(uuid,jsonb,uuid,text) to authenticated;
reset lock_timeout;
