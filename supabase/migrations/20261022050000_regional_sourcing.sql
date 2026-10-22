-- Step 25c: independent, immutable regional sourcing scenarios. No operational writes.
set lock_timeout='5s';

create function app.regional_sourcing_input(p_input jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare source jsonb; sources jsonb:='[]'; guid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>16384
    or jsonb_typeof(p_input->'region_id') is distinct from 'string' or p_input->>'region_id' !~* guid
    or jsonb_typeof(p_input->'draft_id') is distinct from 'string' or p_input->>'draft_id' !~* guid
    or jsonb_typeof(p_input->'sources') is distinct from 'array'
    or p_input->'commitments_confirmed' is distinct from 'true'::jsonb
    or p_input->'lanes_confirmed' is distinct from 'true'::jsonb then
    raise exception using errcode='MQ422',message='invalid or unconfirmed sourcing inputs';
  end if;
  if jsonb_array_length(p_input->'sources') not between 1 and 19 then
    raise exception using errcode='MQ422',message='choose every other region member';
  end if;
  for source in select value from jsonb_array_elements(p_input->'sources') loop
    if jsonb_typeof(source) is distinct from 'object'
      or jsonb_typeof(source->'location_id') is distinct from 'string' or source->>'location_id' !~* guid
      or jsonb_typeof(source->'policy_id') is distinct from 'string' or source->>'policy_id' !~* guid
      or jsonb_typeof(source->'maximum') is distinct from 'string'
      or (source->>'maximum'<>'calculated' and source->>'maximum' !~* guid)
      or jsonb_typeof(source->'backorders') is distinct from 'string'
      or source->>'backorders' !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$' then
      raise exception using errcode='MQ422',message='invalid source selection';
    end if;
    sources:=sources||jsonb_build_array(jsonb_build_object(
      'location_id',(source->>'location_id')::uuid,'policy_id',(source->>'policy_id')::uuid,
      'maximum',case when source->>'maximum'='calculated' then 'calculated' else ((source->>'maximum')::uuid)::text end,
      'backorders',((source->>'backorders')::numeric(18,3))::text));
  end loop;
  if (select count(distinct v->>'location_id') from jsonb_array_elements(sources) v)<>jsonb_array_length(sources) then
    raise exception using errcode='MQ422',message='duplicate source locations';
  end if;
  select jsonb_agg(v order by (v->>'location_id')::uuid) into sources from jsonb_array_elements(sources) v;
  return jsonb_build_object('region_id',(p_input->>'region_id')::uuid,'draft_id',(p_input->>'draft_id')::uuid,
    'sources',sources,'commitments_confirmed',true,'lanes_confirmed',true);
end; $$;
revoke all on function app.regional_sourcing_input(jsonb) from public,anon,authenticated,service_role,maqdar_worker;

create function public.regional_sourcing_preview(p_organization_id uuid,p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  input jsonb; region public.stock_regions; draft public.replenishment_drafts;
  source jsonb; evidence jsonb; lines jsonb:='[]'; locations jsonb; shares jsonb; report jsonb;
  required_ids uuid[]; selected_ids uuid[]; status text:='available'; gap numeric; surplus numeric; allocated numeric;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='sourcing inputs unavailable';
  end if;
  input:=app.regional_sourcing_input(p_input);
  select * into region from public.stock_regions where organization_id=p_organization_id and id=(input->>'region_id')::uuid;
  if not found or region.archived_at is not null
    or (not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(region.required_location_ids <@ array(select app.scoped_locations()))) then
    raise exception using errcode='MQ404',message='sourcing inputs unavailable';
  end if;
  required_ids:=region.required_location_ids;
  select jsonb_agg(jsonb_build_object('id',id,'code',code,'name_en',name_en,'name_ar',name_ar,
    'location_type',location_type,'updated_at',updated_at) order by id) into locations
    from public.locations where organization_id=p_organization_id and id=any(required_ids) and is_active;
  if jsonb_array_length(locations) is distinct from cardinality(required_ids) then
    raise exception using errcode='MQ404',message='sourcing inputs unavailable';
  end if;
  select * into draft from public.replenishment_drafts where organization_id=p_organization_id
    and id=(input->>'draft_id')::uuid and location_id=any(required_ids);
  if not found then raise exception using errcode='MQ404',message='sourcing inputs unavailable'; end if;
  select array_agg((v->>'location_id')::uuid order by (v->>'location_id')::uuid) into selected_ids
    from jsonb_array_elements(input->'sources') v;
  if selected_ids is distinct from (select array_agg(id order by id) from unnest(required_ids) id where id<>draft.location_id) then
    raise exception using errcode='MQ422',message='choose every other region member';
  end if;
  for source in select value from jsonb_array_elements(input->'sources') loop
    -- Explicit checks in redistribution_preview remain effective inside this definer.
    evidence:=public.redistribution_preview(p_organization_id,draft.id,(source->>'policy_id')::uuid,
      case when source->>'maximum'='calculated' then 'calculated' else 'approved' end,
      case when source->>'maximum'<>'calculated' then (source->>'maximum')::uuid end,
      source->>'backorders',true,true);
    if evidence->>'source_location_id' is distinct from source->>'location_id' then
      raise exception using errcode='MQ404',message='sourcing inputs unavailable';
    end if;
    if evidence->>'status' is distinct from 'available' then status:='unavailable'; end if;
    -- Retain the source check and destination evidence, but not its independent
    -- single-source transfer quantity: this scenario computes coordinated shares.
    lines:=lines||jsonb_build_array(jsonb_build_object('location_id',source->>'location_id',
      'location_code',evidence->>'source_location_code','status',evidence->>'status',
      'source_policy',evidence->'source_policy','lane',evidence->'lane','backorders',evidence->>'backorders',
      'surplus',evidence->>'source_surplus','quantity',null,'remaining_surplus',null,'retained_available',null));
  end loop;
  gap:=(draft.report->>'gap')::numeric;
  if status='available' then
    select sum((v->>'surplus')::numeric),jsonb_agg(jsonb_build_object('location_id',v->>'location_id','gap',v->>'surplus'))
      into surplus,shares from jsonb_array_elements(lines) v;
    -- The existing exact allocator treats source surpluses as weights/caps and
    -- the destination gap as the budget. It floors before proportional allocation.
    shares:=app.network_allocate(gap,shares);
    select jsonb_agg(l||jsonb_build_object('quantity',s->>'quantity',
      'remaining_surplus',((l->>'surplus')::numeric-(s->>'quantity')::numeric)::text,
      'retained_available',((l->'source_policy'->'snapshot'->>'available')::numeric-(l->>'backorders')::numeric-(s->>'quantity')::numeric)::text)
      order by (l->>'location_id')::uuid),sum((s->>'quantity')::numeric)
      into lines,allocated from jsonb_array_elements(lines) l
        join jsonb_array_elements(shares) s on s->>'location_id'=l->>'location_id';
  end if;
  report:=jsonb_build_object('method','regional-sourcing-v1','input',input,'status',status,
    'region',jsonb_build_object('id',region.id,'name_en',region.name_en,'name_ar',region.name_ar,
      'created_at',region.created_at,'definition',region.report),
    'locations',locations,'destination_location_id',draft.location_id,'destination',draft.report,
    'lines',lines,'total_surplus',surplus::text,'allocated',allocated::text,
    'remaining_gap',case when status='available' then (gap-allocated)::text end);
  return report||jsonb_build_object('fingerprint',encode(extensions.digest(report::text,'sha256'),'hex'));
end; $$;
revoke all on function public.regional_sourcing_preview(uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.regional_sourcing_preview(uuid,jsonb) to authenticated;

create table public.regional_sourcing_scenarios(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  required_location_ids uuid[] not null check(cardinality(required_location_ids) between 2 and 20 and array_position(required_location_ids,null) is null),
  request_id uuid not null,submitted_by uuid not null,created_at timestamptz not null default clock_timestamp(),
  report jsonb not null check(report->>'method'='regional-sourcing-v1' and report->>'status'='available'),
  unique(organization_id,id),unique(organization_id,request_id)
);
create index regional_sourcing_history on public.regional_sourcing_scenarios(organization_id,created_at desc,id);
create index regional_sourcing_locations on public.regional_sourcing_scenarios using gin(required_location_ids);
alter table public.regional_sourcing_scenarios enable row level security;
revoke all on public.regional_sourcing_scenarios from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.regional_sourcing_scenarios to authenticated;
create policy "members read" on public.regional_sourcing_scenarios for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "all locations" on public.regional_sourcing_scenarios as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or required_location_ids <@ array(select app.scoped_locations()));
create trigger audit_business_row after insert or update or delete on public.regional_sourcing_scenarios
  for each row execute function app.audit_business_row();
comment on table public.regional_sourcing_scenarios is 'Copied all-member regional sourcing evidence. No reservations, refreshed destination commitments or transfer execution.';
create function app.delete_location_regional_sourcing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.regional_sourcing_scenarios where organization_id=old.organization_id and required_location_ids @> array[old.id];
  return old;
end; $$;
revoke all on function app.delete_location_regional_sourcing() from public,anon,authenticated,service_role,maqdar_worker;
create trigger delete_regional_sourcing before delete on public.locations
  for each row execute function app.delete_location_regional_sourcing();

create function public.regional_sourcing_save(p_organization_id uuid,p_input jsonb,p_request_id uuid,p_fingerprint text) returns uuid
language plpgsql security definer set search_path='' as $$
declare input jsonb; report jsonb; previous public.regional_sourcing_scenarios; required_ids uuid[]; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='sourcing requires an editor';
  end if;
  input:=app.regional_sourcing_input(p_input);
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid sourcing save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.regional-sourcing:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='sourcing requires an editor';
  end if;
  select * into previous from public.regional_sourcing_scenarios where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='sourcing unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='sourcing request conflicts';
  end if;
  report:=public.regional_sourcing_preview(p_organization_id,input);
  select array_agg((v->>'id')::uuid order by (v->>'id')::uuid) into required_ids from jsonb_array_elements(report->'locations') v;
  -- Match the existing assessment lock order: item, locations, region. Region
  -- SHARE serializes new saves with archive; location SHARE prevents stale identities.
  perform 1 from public.items where organization_id=p_organization_id and id in
    (select p.item_id from public.inventory_policies p where p.organization_id=p_organization_id
      and p.id in (select (v->>'policy_id')::uuid from jsonb_array_elements(input->'sources') v)) order by id for share;
  perform 1 from public.locations where organization_id=p_organization_id and id=any(required_ids) order by id for share;
  perform 1 from public.stock_regions where organization_id=p_organization_id and id=(input->>'region_id')::uuid for share;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='sourcing requires an editor';
  end if;
  report:=public.regional_sourcing_preview(p_organization_id,input);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='sourcing evidence changed'; end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='sourcing unavailable'; end if;
  insert into public.regional_sourcing_scenarios(organization_id,required_location_ids,request_id,submitted_by,report)
    values(p_organization_id,required_ids,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $$;
revoke all on function public.regional_sourcing_save(uuid,jsonb,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.regional_sourcing_save(uuid,jsonb,uuid,text) to authenticated;

create view public.regional_sourcing_list with(security_invoker=true) as
select id,organization_id,created_at,report->'region'->>'name_en' region_name,
  report->'region'->>'name_ar' region_name_ar,report->'destination'->'policy'->>'item_code' item_code,
  report->'destination'->'policy'->>'location_code' destination_code,
  report->'destination'->'policy'->>'cutoff' cutoff,report->'destination'->'policy'->>'unit' unit,
  report->>'allocated' allocated,report->>'remaining_gap' remaining_gap,
  app.normalize_search(concat_ws(' ',report->'region'->>'name_en',report->'region'->>'name_ar',
    report->'destination'->'policy'->>'item_code',report->'destination'->'policy'->>'location_code',
    (select string_agg(v->>'location_code',' ') from jsonb_array_elements(report->'lines') v))) search_text
from public.regional_sourcing_scenarios;
revoke all on public.regional_sourcing_list from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.regional_sourcing_list to authenticated;
reset lock_timeout;
