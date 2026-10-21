-- Step 24b: conditional replacement demand from captured population and explicit rates.
set lock_timeout = '5s';

create table public.installed_base_demand_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  item_id uuid not null,
  dataset_id uuid not null,
  item_code text not null,
  location_code text not null,
  scenario_name text not null,
  cutoff date not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null,
  unique (organization_id, id),
  unique (organization_id, request_id),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade
);
create index installed_base_demand_history on public.installed_base_demand_scenarios(organization_id, created_at desc, id);
create index installed_base_demand_location on public.installed_base_demand_scenarios(organization_id, location_id);
alter table public.installed_base_demand_scenarios enable row level security;
revoke all on public.installed_base_demand_scenarios from public, anon, authenticated, service_role, maqdar_worker;
grant select on public.installed_base_demand_scenarios to authenticated;
create policy "members read" on public.installed_base_demand_scenarios for select to authenticated
  using (organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.installed_base_demand_scenarios as restrictive for select to authenticated
  using (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.installed_base_demand_scenarios
  for each row execute function app.audit_business_row();
comment on table public.installed_base_demand_scenarios is 'Immutable conditional expected demand, not learned forecasts or orders. Copied population evidence survives dataset/item deletion; organization/location cascades remain.';

create function app.installed_base_demand_input(p_input jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare entry jsonb; rates jsonb; cutoff_day date; available date; dataset uuid; horizon integer;
begin
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text) > 524288
    or jsonb_typeof(p_input->'dataset_id') is distinct from 'string'
    or coalesce(p_input->>'dataset_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_input->'scenario_name') is distinct from 'string'
    or length(btrim(p_input->>'scenario_name')) not between 1 and 200
    or jsonb_typeof(p_input->'confirmed') is distinct from 'boolean'
    or jsonb_typeof(p_input->'cutoff') is distinct from 'string'
    or coalesce(p_input->>'cutoff','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_input->'horizon_days') is distinct from 'number'
    or coalesce(p_input->>'horizon_days','') !~ '^[0-9]{1,2}$'
    or jsonb_typeof(p_input->'rates') is distinct from 'array' then
    raise exception using errcode='MQ422', message='invalid demand scenario input';
  end if;
  begin
    dataset := (p_input->>'dataset_id')::uuid;
    cutoff_day := (p_input->>'cutoff')::date;
    horizon := (p_input->>'horizon_days')::integer;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode='MQ422', message='invalid demand scenario dates';
  end;
  if horizon not between 1 and 90 or cutoff_day + horizon > date '9999-12-31'
    or jsonb_array_length(p_input->'rates') not between 1 and 1000 then
    raise exception using errcode='MQ422', message='invalid demand scenario bounds';
  end if;
  for entry in select x.value from jsonb_array_elements(p_input->'rates') x loop
    if jsonb_typeof(entry) is distinct from 'object'
      or jsonb_typeof(entry->'group_code') is distinct from 'string'
      or length(btrim(entry->>'group_code')) not between 1 and 100
      or jsonb_typeof(entry->'daily_rate') is distinct from 'string'
      or coalesce(entry->>'daily_rate','') !~ '^[0-9]{1,6}(\.[0-9]{1,9})?$'
      or jsonb_typeof(entry->'source') is distinct from 'string'
      or length(btrim(entry->>'source')) not between 1 and 1000
      or jsonb_typeof(entry->'available_on') is distinct from 'string'
      or coalesce(entry->>'available_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='MQ422', message='invalid replacement rate';
    end if;
    begin available := (entry->>'available_on')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception using errcode='MQ422', message='invalid replacement rate date';
    end;
    if available > cutoff_day then raise exception using errcode='MQ422', message='rate unavailable by cutoff'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_input->'rates') x
      group by btrim(x.value->>'group_code') collate "C" having count(*) > 1) then
    raise exception using errcode='MQ422', message='duplicate rate group';
  end if;
  select jsonb_agg(jsonb_build_object('group_code',btrim(x.value->>'group_code'),
    'daily_rate',trim_scale((x.value->>'daily_rate')::numeric)::text,
    'source',btrim(x.value->>'source'),'available_on',x.value->>'available_on')
    order by btrim(x.value->>'group_code') collate "C") into rates from jsonb_array_elements(p_input->'rates') x;
  return jsonb_build_object('dataset_id',dataset,'scenario_name',btrim(p_input->>'scenario_name'),
    'cutoff',cutoff_day::text,'horizon_days',horizon,'confirmed',p_input->'confirmed','rates',rates);
end; $$;
revoke all on function app.installed_base_demand_input(jsonb) from public, anon, authenticated, service_role, maqdar_worker;

create function public.installed_base_demand_preview(p_organization_id uuid,p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare input jsonb; population public.installed_base_datasets; groups jsonb; days jsonb;
  daily numeric; report jsonb; cutoff_day date; horizon integer;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404', message='population source unavailable';
  end if;
  input := app.installed_base_demand_input(p_input);
  select * into population from public.installed_base_datasets x where x.organization_id=p_organization_id
    and x.id=(input->>'dataset_id')::uuid
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404', message='population source unavailable'; end if;
  cutoff_day := (input->>'cutoff')::date;
  horizon := (input->>'horizon_days')::integer;
  if population.report->>'method' is distinct from 'installed-base-v1'
    or population.report#>'{input,confirmed}' is distinct from 'true'::jsonb
    or population.report#>'{input,non_overlapping}' is distinct from 'true'::jsonb
    or nullif(btrim(population.report#>>'{input,unit}'),'') is null
    or (population.report#>>'{input,as_of}')::date > cutoff_day
    or (population.report#>>'{input,available_on}')::date > cutoff_day
    or cutoff_day > (current_timestamp at time zone (population.report#>>'{source,time_zone}'))::date then
    raise exception using errcode='MQ422', message='population unavailable by cutoff';
  end if;
  if jsonb_array_length(input->'rates') <> jsonb_array_length(population.report->'groups') or exists(
    select 1 from jsonb_array_elements(input->'rates') r where not exists(
      select 1 from jsonb_array_elements(population.report->'groups') g where g.value->>'group_code'=r.value->>'group_code')) then
    raise exception using errcode='MQ422', message='every population group requires an explicit rate';
  end if;
  select jsonb_agg(g.value || jsonb_build_object('rate',r.value,
    'daily_demand',trim_scale((g.value->>'installed_quantity')::numeric*(r.value->>'daily_rate')::numeric)::text,
    'total_demand',trim_scale((g.value->>'installed_quantity')::numeric*(r.value->>'daily_rate')::numeric*horizon)::text)
    order by g.value->>'group_code' collate "C") into groups
    from jsonb_array_elements(population.report->'groups') g join jsonb_array_elements(input->'rates') r
      on g.value->>'group_code'=r.value->>'group_code';
  select sum((g.value->>'daily_demand')::numeric) into daily from jsonb_array_elements(groups) g;
  select jsonb_agg(jsonb_build_object('date',(cutoff_day+d)::text,'expected_demand',trim_scale(daily)::text) order by d)
    into days from generate_series(1,horizon) d;
  report := jsonb_build_object('method','installed-base-demand-v1','input',input,'groups',groups,'days',days,
    'daily_demand',trim_scale(daily)::text,'total_demand',trim_scale(daily*horizon)::text,
    'source',jsonb_build_object('dataset_id',population.id,'population_imported_at',population.created_at,'population',population.report));
  return report || jsonb_build_object('fingerprint',encode(extensions.digest(report::text,'sha256'),'hex'));
end; $$;
revoke all on function public.installed_base_demand_preview(uuid,jsonb) from public, anon, authenticated, service_role, maqdar_worker;
grant execute on function public.installed_base_demand_preview(uuid,jsonb) to authenticated;

create function public.installed_base_demand_save(p_organization_id uuid,p_input jsonb,p_request_id uuid,p_fingerprint text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare input jsonb; report jsonb; previous public.installed_base_demand_scenarios; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='demand scenario save forbidden';
  end if;
  input := app.installed_base_demand_input(p_input);
  if input->'confirmed' <> 'true'::jsonb or p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422', message='invalid demand scenario save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.installed-base-demand:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='demand scenario save forbidden';
  end if;
  select * into previous from public.installed_base_demand_scenarios x where x.organization_id=p_organization_id and x.request_id=p_request_id;
  if found then
    if not(previous.organization_id=any(array(select app.unscoped_organizations())) or previous.location_id=any(array(select app.scoped_locations()))) then
      raise exception using errcode='MQ404', message='demand scenario unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409', message='demand scenario request conflicts';
  end if;
  -- Protect the source only for the initial capture. Existing retries use their saved copy.
  perform 1 from public.installed_base_datasets x where x.organization_id=p_organization_id and x.id=(input->>'dataset_id')::uuid
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations()))) for share;
  if not found then raise exception using errcode='MQ404', message='population source unavailable'; end if;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='demand scenario save forbidden';
  end if;
  report := public.installed_base_demand_preview(p_organization_id,input);
  if report->>'fingerprint' <> p_fingerprint then raise exception using errcode='MQ409', message='demand scenario evidence changed; refresh preview'; end if;
  insert into public.installed_base_demand_scenarios(organization_id,location_id,item_id,dataset_id,item_code,location_code,scenario_name,cutoff,request_id,submitted_by,report)
    values(p_organization_id,(report#>>'{source,population,source,location_id}')::uuid,(report#>>'{source,population,source,item_id}')::uuid,
      (input->>'dataset_id')::uuid,report#>>'{source,population,input,item_code}',report#>>'{source,population,input,location_code}',
      input->>'scenario_name',(input->>'cutoff')::date,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $$;
revoke all on function public.installed_base_demand_save(uuid,jsonb,uuid,text) from public, anon, authenticated, service_role, maqdar_worker;
grant execute on function public.installed_base_demand_save(uuid,jsonb,uuid,text) to authenticated;
reset lock_timeout;
