-- Step 25: copied observed stock, never transferable surplus or a reservation.
set lock_timeout='5s';
create table public.regional_stock_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  required_location_ids uuid[] not null check(cardinality(required_location_ids) between 2 and 20 and array_position(required_location_ids,null) is null),
  location_codes text[] not null,
  item_id uuid not null,
  item_code text not null,
  assessment_name text not null,
  as_of date not null,
  unit text not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null check(report->>'method'='regional-stock-v1' and report->>'status'='available'),
  unique(organization_id,id), unique(organization_id,request_id)
);
create index regional_stock_history on public.regional_stock_assessments(organization_id,created_at desc,id);
create index regional_stock_locations on public.regional_stock_assessments using gin(required_location_ids);
alter table public.regional_stock_assessments enable row level security;
revoke all on public.regional_stock_assessments from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.regional_stock_assessments to authenticated;
create policy "members read" on public.regional_stock_assessments for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "all locations" on public.regional_stock_assessments as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or required_location_ids <@ array(select app.scoped_locations()));
create trigger audit_business_row after insert or update or delete on public.regional_stock_assessments
  for each row execute function app.audit_business_row();
comment on table public.regional_stock_assessments is 'Immutable exact-item observed-stock evidence. All locations required for every read; no pooling rights, availability guarantee, allocation or execution.';

create function app.delete_location_regional_stock() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.regional_stock_assessments where organization_id=old.organization_id and required_location_ids @> array[old.id];
  return old;
end; $$;
revoke all on function app.delete_location_regional_stock() from public,anon,authenticated,service_role,maqdar_worker;
create trigger delete_regional_stock before delete on public.locations
  for each row execute function app.delete_location_regional_stock();

create function app.regional_stock_input(p_input jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare codes jsonb; day date;
begin
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>8192
    or jsonb_typeof(p_input->'assessment_name') is distinct from 'string'
    or length(btrim(p_input->>'assessment_name')) not between 1 and 200
    or jsonb_typeof(p_input->'item_code') is distinct from 'string'
    or btrim(p_input->>'item_code') !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'
    or jsonb_typeof(p_input->'unit') is distinct from 'string'
    or p_input->>'unit' not in ('EA','SET','L','KG')
    or jsonb_typeof(p_input->'as_of') is distinct from 'string'
    or p_input->>'as_of' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(p_input->'location_codes') is distinct from 'array'
    or p_input->'confirmed' is distinct from 'true'::jsonb then
    raise exception using errcode='MQ422',message='invalid or unconfirmed regional assessment';
  end if;
  if jsonb_array_length(p_input->'location_codes') not between 2 and 20
    or exists(select 1 from jsonb_array_elements(p_input->'location_codes') v
      where jsonb_typeof(v) is distinct from 'string' or btrim(v#>>'{}') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') then
    raise exception using errcode='MQ422',message='choose two to twenty distinct locations';
  end if;
  select jsonb_agg(code order by code collate "C") into codes
    from (select distinct btrim(v) code from jsonb_array_elements_text(p_input->'location_codes') v) s;
  if jsonb_array_length(codes)<>jsonb_array_length(p_input->'location_codes') then
    raise exception using errcode='MQ422',message='choose two to twenty distinct locations';
  end if;
  begin
    day:=(p_input->>'as_of')::date;
    if not isfinite(day) or day < date '0001-01-01' or day > date '9999-12-31' then raise exception 'invalid day'; end if;
  exception when others then
    raise exception using errcode='MQ422',message='invalid assessment date';
  end;
  return jsonb_build_object('assessment_name',btrim(p_input->>'assessment_name'),'item_code',btrim(p_input->>'item_code'),
    'unit',p_input->>'unit','as_of',day::text,'location_codes',codes,'confirmed',true);
end; $$;
revoke all on function app.regional_stock_input(jsonb) from public,anon,authenticated,service_role,maqdar_worker;

create function public.regional_stock_preview(p_organization_id uuid,p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare input jsonb; item public.items; lines jsonb; totals jsonb; report jsonb; day date; codes text[];
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='assessment inputs unavailable';
  end if;
  input:=app.regional_stock_input(p_input); day:=(input->>'as_of')::date;
  select array_agg(v) into codes from jsonb_array_elements_text(input->'location_codes') v;
  select * into item from public.items where organization_id=p_organization_id and code=input->>'item_code';
  if not found then raise exception using errcode='MQ404',message='assessment inputs unavailable'; end if;
  -- Latest snapshot wins before freshness/unit checks. One statement captures every line.
  select coalesce(jsonb_agg(jsonb_build_object(
    'location_id',l.id,'code',l.code,'name_en',l.name_en,'name_ar',l.name_ar,'location_type',l.location_type,
    'is_active',l.is_active,'updated_at',l.updated_at,
    'status',case when s.id is null then 'missing' when day-s.snapshot_date>7 then 'stale'
      when s.unit_of_measure is null then 'unit_unknown'
      when s.unit_of_measure<>input->>'unit' then 'unit_mismatch' else 'available' end,
    'snapshot',case when s.id is null then null else jsonb_build_object(
      'id',s.id,'date',s.snapshot_date::text,'age_days',day-s.snapshot_date,'unit',s.unit_of_measure,
      'on_hand',s.quantity::text,'allocated',s.allocated_quantity::text,'net',(s.quantity-s.allocated_quantity)::text,
      'updated_at',s.updated_at) end) order by l.code collate "C"),'[]'::jsonb) into lines
    from public.locations l left join lateral (
      select s.* from public.stock_snapshots s where s.organization_id=p_organization_id and s.item_id=item.id
        and s.location_id=l.id and s.snapshot_date<=day order by s.snapshot_date desc limit 1
    ) s on true where l.organization_id=p_organization_id and l.code=any(codes) and l.is_active
      and (l.organization_id=any(array(select app.unscoped_organizations())) or l.id=any(array(select app.scoped_locations())));
  -- Do not return partial evidence, counts or totals for a hidden/inactive requested location.
  if jsonb_array_length(lines)<>cardinality(codes) then
    raise exception using errcode='MQ404',message='assessment inputs unavailable';
  end if;
  if not exists(select 1 from jsonb_array_elements(lines) v where v->>'status'<>'available') then
    select jsonb_build_object('on_hand',trim_scale(sum((v#>>'{snapshot,on_hand}')::numeric))::text,
      'allocated',trim_scale(sum((v#>>'{snapshot,allocated}')::numeric))::text,
      'net',trim_scale(sum((v#>>'{snapshot,net}')::numeric))::text)
      into totals from jsonb_array_elements(lines) v;
  end if;
  report:=jsonb_build_object('method','regional-stock-v1','input',input,
    'status',case when totals is null then 'unavailable' else 'available' end,
    'item',jsonb_build_object('id',item.id,'code',item.code,'name_en',item.name_en,'name_ar',item.name_ar,
      'status',item.status,'catalog_unit',item.unit_of_measure,'updated_at',item.updated_at),
    'lines',lines,'totals',totals);
  return report||jsonb_build_object('fingerprint',encode(extensions.digest(report::text,'sha256'),'hex'));
end; $$;
revoke all on function public.regional_stock_preview(uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.regional_stock_preview(uuid,jsonb) to authenticated;

create function public.regional_stock_save(p_organization_id uuid,p_input jsonb,p_request_id uuid,p_fingerprint text) returns uuid
language plpgsql security definer set search_path='' as $$
declare input jsonb; report jsonb; previous public.regional_stock_assessments; required_ids uuid[]; locked_item uuid; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='assessment requires an editor';
  end if;
  input:=app.regional_stock_input(p_input);
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid assessment save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.regional-stock:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='assessment requires an editor';
  end if;
  select * into previous from public.regional_stock_assessments where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='assessment unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='assessment request conflicts';
  end if;
  report:=public.regional_stock_preview(p_organization_id,input);
  locked_item:=(report#>>'{item,id}')::uuid;
  select array_agg((v->>'location_id')::uuid order by (v->>'location_id')::uuid) into required_ids from jsonb_array_elements(report->'lines') v;
  -- Hold catalog rows through insertion: location deletion must cascade the new assessment too.
  perform 1 from public.items where organization_id=p_organization_id and id=(report#>>'{item,id}')::uuid for share;
  if not found then raise exception using errcode='MQ409',message='assessment evidence changed'; end if;
  perform 1 from public.locations where organization_id=p_organization_id and id=any(required_ids) order by id for share;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='assessment requires an editor';
  end if;
  report:=public.regional_stock_preview(p_organization_id,input);
  if (report#>>'{item,id}')::uuid<>locked_item or required_ids is distinct from
    (select array_agg((v->>'location_id')::uuid order by (v->>'location_id')::uuid) from jsonb_array_elements(report->'lines') v) then
    raise exception using errcode='MQ409',message='assessment identities changed';
  end if;
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='assessment evidence changed'; end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='complete stock evidence required'; end if;
  insert into public.regional_stock_assessments(organization_id,required_location_ids,location_codes,item_id,item_code,
    assessment_name,as_of,unit,request_id,submitted_by,report)
    values(p_organization_id,required_ids,array(select jsonb_array_elements_text(input->'location_codes')),
      (report#>>'{item,id}')::uuid,input->>'item_code',input->>'assessment_name',(input->>'as_of')::date,
      input->>'unit',p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $$;
revoke all on function public.regional_stock_save(uuid,jsonb,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.regional_stock_save(uuid,jsonb,uuid,text) to authenticated;
reset lock_timeout;
