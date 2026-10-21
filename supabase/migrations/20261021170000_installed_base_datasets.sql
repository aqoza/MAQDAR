-- Step 24: immutable equipment populations; no demand or operational changes.
set lock_timeout = '5s';

create table public.installed_base_datasets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  item_id uuid not null,
  item_code text not null,
  location_code text not null,
  dataset_name text not null,
  as_of date not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null,
  unique (organization_id, id),
  unique (organization_id, request_id),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade
);
create index installed_base_history on public.installed_base_datasets(organization_id, created_at desc, id);
create index installed_base_location on public.installed_base_datasets(organization_id, location_id);
alter table public.installed_base_datasets enable row level security;
revoke all on public.installed_base_datasets from public, anon, authenticated, service_role, maqdar_worker;
grant select on public.installed_base_datasets to authenticated;
create policy "members read" on public.installed_base_datasets for select to authenticated
  using (organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.installed_base_datasets as restrictive for select to authenticated
  using (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.installed_base_datasets
  for each row execute function app.audit_business_row();
comment on table public.installed_base_datasets is 'Immutable source-declared equipment populations. Installed quantities are fitted parts, not stock or demand. Item evidence survives catalog deletion; organization/location cascades remain.';

create function app.installed_base_input(p_input jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare entry jsonb; value jsonb; rows jsonb; as_of_day date; available date; installed date;
begin
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text) > 524288 then
    raise exception using errcode='MQ422', message='invalid population input';
  end if;
  foreach value in array array[p_input->'item_code',p_input->'location_code',p_input->'dataset_name',p_input->'unit',p_input->'source'] loop
    if jsonb_typeof(value) is distinct from 'string' or length(btrim(value#>>'{}')) not between 1 and 2000 then
      raise exception using errcode='MQ422', message='invalid population metadata';
    end if;
  end loop;
  if length(btrim(p_input->>'item_code')) > 100 or length(btrim(p_input->>'location_code')) > 100
    or length(btrim(p_input->>'dataset_name')) > 200 or length(btrim(p_input->>'unit')) > 80
    or jsonb_typeof(p_input->'confirmed') is distinct from 'boolean'
    or jsonb_typeof(p_input->'non_overlapping') is distinct from 'boolean'
    or jsonb_typeof(p_input->'as_of') is distinct from 'string'
    or coalesce(p_input->>'as_of','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_input->'available_on') is distinct from 'string'
    or coalesce(p_input->>'available_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_input->'rows') is distinct from 'array' then
    raise exception using errcode='MQ422', message='invalid population input';
  end if;
  begin as_of_day := (p_input->>'as_of')::date; available := (p_input->>'available_on')::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode='MQ422', message='invalid population dates';
  end;
  if available < as_of_day or jsonb_array_length(p_input->'rows') not between 1 and 1000 then
    raise exception using errcode='MQ422', message='invalid population dates or group count';
  end if;
  for entry in select x.value from jsonb_array_elements(p_input->'rows') x loop
    if jsonb_typeof(entry) is distinct from 'object'
      or jsonb_typeof(entry->'group_code') is distinct from 'string'
      or length(btrim(entry->>'group_code')) not between 1 and 100
      or jsonb_typeof(entry->'group_name') is distinct from 'string'
      or length(btrim(entry->>'group_name')) not between 1 and 200
      or jsonb_typeof(entry->'active_assets') is distinct from 'string'
      or coalesce(entry->>'active_assets','') !~ '^[0-9]{1,15}$'
      or jsonb_typeof(entry->'parts_per_asset') is distinct from 'string'
      or coalesce(entry->>'parts_per_asset','') !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$'
      or not(entry ? 'installed_on') then
      raise exception using errcode='MQ422', message='invalid population group';
    end if;
    if (entry->>'parts_per_asset')::numeric <= 0 then
      raise exception using errcode='MQ422', message='invalid population group';
    end if;
    if entry->'installed_on' <> 'null'::jsonb then
      if jsonb_typeof(entry->'installed_on') is distinct from 'string'
        or coalesce(entry->>'installed_on','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode='MQ422', message='invalid population dates';
      end if;
      begin installed := (entry->>'installed_on')::date;
      exception when datetime_field_overflow or invalid_datetime_format then
        raise exception using errcode='MQ422', message='invalid population dates';
      end;
      if installed > as_of_day then raise exception using errcode='MQ422', message='installation after population date'; end if;
    end if;
  end loop;
  if (select count(distinct btrim(x.value->>'group_code') collate "C") from jsonb_array_elements(p_input->'rows') x) <> jsonb_array_length(p_input->'rows') then
    raise exception using errcode='MQ422', message='duplicate population groups';
  end if;
  select jsonb_agg(jsonb_build_object('group_code',btrim(x.value->>'group_code'),'group_name',btrim(x.value->>'group_name'),
    'installed_on',x.value->'installed_on','active_assets',trim_scale((x.value->>'active_assets')::numeric)::text,
    'parts_per_asset',trim_scale((x.value->>'parts_per_asset')::numeric)::text) order by btrim(x.value->>'group_code') collate "C")
    into rows from jsonb_array_elements(p_input->'rows') x;
  return jsonb_build_object('item_code',btrim(p_input->>'item_code'),'location_code',btrim(p_input->>'location_code'),
    'dataset_name',btrim(p_input->>'dataset_name'),'unit',btrim(p_input->>'unit'),'source',btrim(p_input->>'source'),
    'as_of',as_of_day::text,'available_on',available::text,'confirmed',p_input->'confirmed',
    'non_overlapping',p_input->'non_overlapping','rows',rows);
end; $$;
revoke all on function app.installed_base_input(jsonb) from public, anon, authenticated, service_role, maqdar_worker;

create function public.installed_base_preview(p_organization_id uuid, p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare input jsonb; item public.items; location public.locations; today date; groups jsonb; totals jsonb; report jsonb;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404', message='population source unavailable';
  end if;
  input := app.installed_base_input(p_input);
  select * into location from public.locations x where x.organization_id=p_organization_id and x.code=input->>'location_code'
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.id=any(array(select app.scoped_locations())));
  if not found or not location.is_active then raise exception using errcode='MQ404', message='population source unavailable'; end if;
  select * into item from public.items x where x.organization_id=p_organization_id and x.code=input->>'item_code';
  if not found then raise exception using errcode='MQ404', message='population source unavailable'; end if;
  if nullif(btrim(item.unit_of_measure),'') is null or btrim(item.unit_of_measure) <> input->>'unit' then
    raise exception using errcode='MQ422', message='population unit must match catalog part';
  end if;
  today := (current_timestamp at time zone location.timezone)::date;
  if (input->>'as_of')::date > today or (input->>'available_on')::date > today then
    raise exception using errcode='MQ422', message='population evidence cannot be in the future';
  end if;
  select jsonb_agg(x.value || jsonb_build_object(
    'installed_quantity',trim_scale((x.value->>'active_assets')::numeric*(x.value->>'parts_per_asset')::numeric)::text,
    'age_days',(input->>'as_of')::date-(x.value->>'installed_on')::date) order by x.ordinality)
    into groups from jsonb_array_elements(input->'rows') with ordinality x;
  select jsonb_build_object('groups',count(*),
    'active_assets',trim_scale(sum((x.value->>'active_assets')::numeric))::text,
    'installed_quantity',trim_scale(sum((x.value->>'installed_quantity')::numeric))::text,
    'known_age_assets',trim_scale(coalesce(sum((x.value->>'active_assets')::numeric) filter(where x.value->>'installed_on' is not null),0))::text,
    'unknown_age_assets',trim_scale(coalesce(sum((x.value->>'active_assets')::numeric) filter(where x.value->>'installed_on' is null),0))::text)
    into totals from jsonb_array_elements(groups) x;
  report := jsonb_build_object('method','installed-base-v1','input',input,'groups',groups,'totals',totals,
    'source',jsonb_build_object('item_id',item.id,'item_code',item.code,'item_name',item.name_en,'item_status',item.status,
      'unit_of_measure',item.unit_of_measure,'location_id',location.id,'location_code',location.code,
      'location_name',location.name_en,'time_zone',location.timezone));
  return report || jsonb_build_object('fingerprint',encode(extensions.digest(report::text,'sha256'),'hex'));
end; $$;
revoke all on function public.installed_base_preview(uuid,jsonb) from public, anon, authenticated, service_role, maqdar_worker;
grant execute on function public.installed_base_preview(uuid,jsonb) to authenticated;

create function public.installed_base_save(p_organization_id uuid, p_input jsonb, p_request_id uuid, p_fingerprint text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare input jsonb; report jsonb; previous public.installed_base_datasets; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='population save forbidden';
  end if;
  input := app.installed_base_input(p_input);
  if input->'confirmed' <> 'true'::jsonb or input->'non_overlapping' <> 'true'::jsonb
    or p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422', message='invalid population save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.installed-base:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='population save forbidden';
  end if;
  select * into previous from public.installed_base_datasets x where x.organization_id=p_organization_id and x.request_id=p_request_id;
  if found then
    if not(previous.organization_id=any(array(select app.unscoped_organizations())) or previous.location_id=any(array(select app.scoped_locations()))) then
      raise exception using errcode='MQ404', message='population source unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409', message='population request conflicts';
  end if;
  report := public.installed_base_preview(p_organization_id,input);
  if report->>'fingerprint' <> p_fingerprint then raise exception using errcode='MQ409', message='population evidence changed; refresh preview'; end if;
  insert into public.installed_base_datasets(organization_id,location_id,item_id,item_code,location_code,dataset_name,as_of,request_id,submitted_by,report)
    values(p_organization_id,(report#>>'{source,location_id}')::uuid,(report#>>'{source,item_id}')::uuid,
      input->>'item_code',input->>'location_code',input->>'dataset_name',(input->>'as_of')::date,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $$;
revoke all on function public.installed_base_save(uuid,jsonb,uuid,text) from public, anon, authenticated, service_role, maqdar_worker;
grant execute on function public.installed_base_save(uuid,jsonb,uuid,text) to authenticated;
reset lock_timeout;
