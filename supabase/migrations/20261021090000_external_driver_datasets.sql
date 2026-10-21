-- Step 23: immutable external-driver evidence, without forecast fitting or operational writes.
set lock_timeout = '5s';

create table public.external_driver_datasets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  item_id uuid not null,
  item_code text not null,
  location_code text not null,
  driver_name text not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null,
  unique (organization_id, id),
  unique (organization_id, request_id),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade
);
create index external_driver_history on public.external_driver_datasets(organization_id, created_at desc, id);
create index external_driver_location on public.external_driver_datasets(organization_id, location_id);
alter table public.external_driver_datasets enable row level security;
revoke all on public.external_driver_datasets from public, anon, authenticated, service_role, maqdar_worker;
grant select on public.external_driver_datasets to authenticated;
create policy "members read" on public.external_driver_datasets for select to authenticated
  using (organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.external_driver_datasets as restrictive for select to authenticated
  using (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.external_driver_datasets
  for each row execute function app.audit_business_row();
comment on table public.external_driver_datasets is 'Immutable source-declared daily driver evidence. No inferred values, learned effects, forecasts, policies or orders. Item metadata survives catalog deletion; organization/location cascades remain.';

create function app.external_driver_input(p_input jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  entry jsonb; rows jsonb; start_day date; cutoff date; end_day date; d date; available date;
begin
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text) > 524288 then
    raise exception using errcode='MQ422', message='invalid driver input';
  end if;
  foreach entry in array array[p_input->'item_code', p_input->'location_code', p_input->'driver_name', p_input->'unit', p_input->'source'] loop
    if jsonb_typeof(entry) is distinct from 'string' or length(btrim(entry#>>'{}')) not between 1 and 2000 then
      raise exception using errcode='MQ422', message='invalid driver metadata';
    end if;
  end loop;
  if length(btrim(p_input->>'item_code')) > 100 or length(btrim(p_input->>'location_code')) > 100
    or length(btrim(p_input->>'driver_name')) > 200 or length(btrim(p_input->>'unit')) > 80
    or jsonb_typeof(p_input->'confirmed') is distinct from 'boolean'
    or coalesce(p_input->>'history_from','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(p_input->>'cutoff','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(p_input->>'forecast_to','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_input->'rows') is distinct from 'array' then
    raise exception using errcode='MQ422', message='invalid driver input';
  end if;
  begin
    start_day := (p_input->>'history_from')::date; cutoff := (p_input->>'cutoff')::date; end_day := (p_input->>'forecast_to')::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode='MQ422', message='invalid driver dates';
  end;
  if cutoff-start_day not between 0 and 1095 or end_day-cutoff not between 1 and 90
    or jsonb_array_length(p_input->'rows') not between 1 and 1186 then
    raise exception using errcode='MQ422', message='invalid driver window';
  end if;
  for entry in select value from jsonb_array_elements(p_input->'rows') loop
    if jsonb_typeof(entry) is distinct from 'object'
      or coalesce(entry->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(entry->>'available_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(entry->'value') is distinct from 'string'
      or coalesce(entry->>'value','') !~ '^-?[0-9]{1,12}(\.[0-9]{1,6})?$'
      or coalesce(entry->>'kind','') not in ('observed', 'planned') then
      raise exception using errcode='MQ422', message='invalid driver row';
    end if;
    begin d := (entry->>'date')::date; available := (entry->>'available_on')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception using errcode='MQ422', message='invalid driver dates';
    end;
    if d < start_day or d > end_day or (entry->>'kind' = 'observed' and available < d) then
      raise exception using errcode='MQ422', message='incompatible driver dates';
    end if;
  end loop;
  if (select count(distinct value->>'date') from jsonb_array_elements(p_input->'rows')) <> jsonb_array_length(p_input->'rows') then
    raise exception using errcode='MQ422', message='duplicate driver dates';
  end if;
  select jsonb_agg(jsonb_build_object('date', value->>'date', 'value', trim_scale((value->>'value')::numeric)::text,
    'kind', value->>'kind', 'available_on', value->>'available_on') order by value->>'date') into rows
    from jsonb_array_elements(p_input->'rows');
  return jsonb_build_object('item_code', btrim(p_input->>'item_code'), 'location_code', btrim(p_input->>'location_code'),
    'driver_name', btrim(p_input->>'driver_name'), 'unit', btrim(p_input->>'unit'), 'source', btrim(p_input->>'source'),
    'history_from', start_day::text, 'cutoff', cutoff::text, 'forecast_to', end_day::text,
    'confirmed', p_input->'confirmed', 'rows', rows);
end; $$;
revoke all on function app.external_driver_input(jsonb) from public, anon, authenticated, service_role, maqdar_worker;

create function public.external_driver_preview(p_organization_id uuid, p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare input jsonb; item public.items; location public.locations; today date; daily jsonb; report jsonb;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404', message='driver source unavailable';
  end if;
  input := app.external_driver_input(p_input);
  select * into location from public.locations x where x.organization_id=p_organization_id and x.code=input->>'location_code'
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.id=any(array(select app.scoped_locations())));
  if not found or not location.is_active then raise exception using errcode='MQ404', message='driver source unavailable'; end if;
  select * into item from public.items x where x.organization_id=p_organization_id and x.code=input->>'item_code';
  if not found then raise exception using errcode='MQ404', message='driver source unavailable'; end if;
  today := (current_timestamp at time zone location.timezone)::date;
  if (input->>'cutoff')::date > today or exists(select 1 from jsonb_array_elements(input->'rows') r where (r->>'available_on')::date > today) then
    raise exception using errcode='MQ422', message='driver availability cannot be in the future';
  end if;
  select jsonb_agg(jsonb_build_object('date', day::text, 'period', case when day <= (input->>'cutoff')::date then 'history' else 'forecast' end,
    'value', row->'value', 'kind', row->'kind', 'available_on', row->'available_on',
    'availability', case when row is null then 'missing' when row->>'available_on' <= input->>'cutoff' then 'declared_available' else 'after_cutoff' end) order by day)
    into daily from (
      select (input->>'history_from')::date + n as day from generate_series(0, (input->>'forecast_to')::date-(input->>'history_from')::date) n
    ) dates left join jsonb_array_elements(input->'rows') row on row->>'date'=day::text;
  report := jsonb_build_object('method', 'external-driver-v1', 'input', input, 'daily', daily,
    'source', jsonb_build_object('item_id',item.id,'item_code',item.code,'item_name',item.name_en,'item_status',item.status,
      'location_id',location.id,'location_code',location.code,'location_name',location.name_en,'time_zone',location.timezone));
  return report || jsonb_build_object('fingerprint',encode(extensions.digest(report::text,'sha256'),'hex'));
end; $$;
revoke all on function public.external_driver_preview(uuid,jsonb) from public, anon, authenticated, service_role, maqdar_worker;
grant execute on function public.external_driver_preview(uuid,jsonb) to authenticated;

create function public.external_driver_save(p_organization_id uuid, p_input jsonb, p_request_id uuid, p_fingerprint text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare input jsonb; report jsonb; previous public.external_driver_datasets; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='driver save forbidden';
  end if;
  input := app.external_driver_input(p_input);
  if input->'confirmed' <> 'true'::jsonb or p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422', message='invalid driver save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.external-driver:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='driver save forbidden';
  end if;
  select * into previous from public.external_driver_datasets x where x.organization_id=p_organization_id and x.request_id=p_request_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409', message='driver request conflicts';
  end if;
  report := public.external_driver_preview(p_organization_id, input);
  if report->>'fingerprint' <> p_fingerprint then raise exception using errcode='MQ409', message='driver evidence changed; refresh preview'; end if;
  insert into public.external_driver_datasets(organization_id,location_id,item_id,item_code,location_code,driver_name,request_id,submitted_by,report)
    values(p_organization_id,(report#>>'{source,location_id}')::uuid,(report#>>'{source,item_id}')::uuid,
      input->>'item_code',input->>'location_code',input->>'driver_name',p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $$;
revoke all on function public.external_driver_save(uuid,jsonb,uuid,text) from public, anon, authenticated, service_role, maqdar_worker;
grant execute on function public.external_driver_save(uuid,jsonb,uuid,text) to authenticated;
reset lock_timeout;
