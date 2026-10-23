-- Step 25h: additive/forward-only. Web rollback retains copied planning evidence.
set lock_timeout='5s';
create table public.regional_handoff_batches(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  destination_location_id uuid not null, required_location_ids uuid[] not null, handoff_ids uuid[] not null,
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(), payload jsonb not null,
  unique(organization_id,id), unique(organization_id,handoff_ids),
  foreign key(organization_id,destination_location_id) references public.locations(organization_id,id) on delete cascade,
  check(array_ndims(handoff_ids)=1 and cardinality(handoff_ids) between 1 and 50 and array_position(handoff_ids,null) is null),
  check(array_ndims(required_location_ids)=1 and cardinality(required_location_ids) between 2 and 20
    and array_position(required_location_ids,null) is null),
  check((payload->>'schema_version'='regional-handoff-batch-v1' and payload->>'purpose'='planning_only') is true)
);
create index regional_batches_recent on public.regional_handoff_batches(organization_id,created_at desc,id);
create index regional_batches_sources on public.regional_handoff_batches using gin(handoff_ids);
create index regional_batches_locations on public.regional_handoff_batches using gin(required_location_ids);
alter table public.regional_handoff_batches enable row level security;
revoke all on public.regional_handoff_batches from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.regional_handoff_batches to authenticated;
create policy "members read" on public.regional_handoff_batches for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "all locations" on public.regional_handoff_batches as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or required_location_ids <@ array(select app.scoped_locations()));
create trigger audit_business_row after insert or update or delete on public.regional_handoff_batches
  for each row execute function app.audit_business_row();
comment on table public.regional_handoff_batches is 'Immutable whole-regional planning packages; copied evidence survives source deletion. Every participating location is required. No consolidation, reservation or execution.';

create function app.delete_location_regional_batches() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.regional_handoff_batches
    where organization_id=old.organization_id and required_location_ids @> array[old.id];
  return old;
end; $$;
revoke all on function app.delete_location_regional_batches() from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
create trigger delete_regional_batches before delete on public.locations
  for each row execute function app.delete_location_regional_batches();

create function public.regional_handoff_batch_preview(p_organization_id uuid,p_handoff_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ids uuid[]; locations uuid[]; evidence jsonb; line jsonb; first_line jsonb; totals jsonb;
  item_identity uuid; item_ids uuid[]:='{}'; identities jsonb:='[]';
  existing public.regional_handoff_batches; current_freight jsonb;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional batch requires an editor';
  end if;
  if p_handoff_ids is null or cardinality(p_handoff_ids) not between 1 and 50
    or array_ndims(p_handoff_ids)<>1 or array_position(p_handoff_ids,null) is not null then
    raise exception using errcode='MQ422',message='select 1 to 50 distinct handoffs',hint='batch_selection_invalid';
  end if;
  select array_agg(distinct id order by id) into ids from unnest(p_handoff_ids) id;
  if cardinality(ids)<>cardinality(p_handoff_ids) then
    raise exception using errcode='MQ422',message='duplicate handoff',hint='batch_selection_invalid';
  end if;
  -- Explicit predicates also protect the definer create RPC; never disclose a partial package.
  select jsonb_agg(h.payload order by h.id) into evidence from public.regional_transfer_handoffs h
    where h.organization_id=p_organization_id and h.id=any(ids)
      and (h.organization_id=any(array(select app.unscoped_organizations()))
        or h.required_location_ids <@ array(select app.scoped_locations()));
  if coalesce(jsonb_array_length(evidence),0)<>cardinality(ids) then
    raise exception using errcode='MQ404',message='handoff unavailable';
  end if;
  select array_agg(distinct location_id order by location_id) into locations
    from public.regional_transfer_handoffs h cross join lateral unnest(h.required_location_ids) location_id
    where h.organization_id=p_organization_id and h.id=any(ids);
  select * into existing from public.regional_handoff_batches b
    where b.organization_id=p_organization_id and b.handoff_ids=ids
      and (b.organization_id=any(array(select app.unscoped_organizations()))
        or b.required_location_ids <@ array(select app.scoped_locations()));
  if found then
    return jsonb_build_object('existing_batch_id',existing.id,'summary',existing.payload->'summary',
      'lines',existing.payload->'lines','item_identities',existing.payload->'item_identities','required_location_ids',existing.required_location_ids);
  end if;
  first_line:=evidence->0;
  for line in select value from jsonb_array_elements(evidence) loop
    if line->>'schema_version' is distinct from 'regional-transfer-handoff-v1'
      or line#>>'{estimate,source,source,destination,policy,item_code}' is null
      or line#>>'{estimate,source,source,destination,policy,unit}' is null
      or line#>>'{estimate,source,source,destination_location_id}' is null
      or line#>>'{estimate,source,requested_date}' is null
      or line#>>'{estimate,source,source,region,id}' is null then
      raise exception using errcode='MQ422',message='incomplete saved evidence',hint='batch_source_invalid';
    end if;
    if app.regional_review_timing_clear(line->'estimate') is distinct from true then
      raise exception using errcode='MQ422',message='regional timing review required',hint='regional_timing_required';
    end if;
    if line#>'{estimate,source,source,region}' is distinct from first_line#>'{estimate,source,source,region}'
      or line#>'{estimate,source,source,destination_location_id}' is distinct from first_line#>'{estimate,source,source,destination_location_id}'
      or line#>'{estimate,source,requested_date}' is distinct from first_line#>'{estimate,source,requested_date}' then
      raise exception using errcode='MQ422',message='incompatible region, receiver or requested dispatch',hint='batch_group_mismatch';
    end if;
    if not exists(select 1 from public.regional_review_list p where p.organization_id=p_organization_id
      and p.id=(line#>>'{proposal,id}')::uuid and p.selected) then
      raise exception using errcode='MQ409',message='selected approval required',hint='regional_selection_changed';
    end if;
    -- v1 regional handoffs lack an item UUID. Resolve only the original saved
    -- draft/policy lineage, never a lookup by a possibly renamed/reused item code.
    select i.id into item_identity from public.replenishment_drafts d
      join public.inventory_policies p on p.organization_id=d.organization_id and p.id=d.policy_id and p.location_id=d.location_id
      join public.items i on i.organization_id=p.organization_id and i.id=p.item_id
      where d.organization_id=p_organization_id and d.id=(line#>>'{estimate,source,source,input,draft_id}')::uuid
        and d.policy_id=(line#>>'{estimate,source,source,destination,policy,policy_id}')::uuid
        and d.location_id=(line#>>'{estimate,source,source,destination_location_id}')::uuid
        and d.report=line#>'{estimate,source,source,destination}'
        and p.item_code=line#>>'{estimate,source,source,destination,policy,item_code}'
        and p.unit=line#>>'{estimate,source,source,destination,policy,unit}';
    if item_identity is null then
      raise exception using errcode='MQ422',message='original item identity unavailable',hint='batch_identity_unavailable';
    end if;
    item_ids:=array_append(item_ids,item_identity);
    identities:=identities||jsonb_build_array(jsonb_build_object('handoff_id',line->'handoff_id','item_id',item_identity,
      'draft_id',line#>'{estimate,source,source,input,draft_id}',
      'policy_id',line#>'{estimate,source,source,destination,policy,policy_id}'));
    current_freight:=public.regional_freight_preview(p_organization_id,(line#>>'{estimate,scenario_id}')::uuid,true);
    if current_freight->>'status' is distinct from 'available'
      or current_freight->>'fingerprint' is distinct from line#>>'{estimate,fingerprint}' then
      raise exception using errcode='MQ409',message='freight evidence changed',hint='regional_freight_changed';
    end if;
  end loop;
  if (select count(distinct id) from unnest(item_ids) id)<>cardinality(ids)
    or (select count(distinct value#>>'{estimate,source,source,destination,policy,item_code}') from jsonb_array_elements(evidence))<>cardinality(ids) then
    raise exception using errcode='MQ422',message='repeated item in batch',hint='batch_duplicate_item';
  end if;
  if exists(select 1 from jsonb_array_elements(evidence) h
    cross join lateral jsonb_array_elements(h#>'{estimate,lines}') b
    where b->>'status'='available'
    group by b#>>'{terms,currency}' having count(distinct b#>>'{terms,minor_units}')<>1) then
    raise exception using errcode='MQ422',message='incompatible currency precision',hint='batch_source_invalid';
  end if;
  -- Sum each saved rounded source cost once; zero sources have no priced subtotal.
  select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'minor_units',minor_units,
    'subtotal',subtotal::text) order by currency),'[]'::jsonb) into totals from (
    select b#>>'{terms,currency}' currency,(b#>>'{terms,minor_units}')::integer minor_units,
      sum((b->>'subtotal')::numeric) subtotal
    from jsonb_array_elements(evidence) h cross join lateral jsonb_array_elements(h#>'{estimate,lines}') b
    where b->>'status'='available' group by 1,2
  ) amounts;
  return jsonb_build_object('existing_batch_id',null,'required_location_ids',locations,'lines',evidence,'item_identities',identities,
    'summary',jsonb_build_object(
      'destination_location_id',first_line#>'{estimate,source,source,destination_location_id}',
      'destination_code',first_line#>'{estimate,source,source,destination,policy,location_code}',
      'region_id',first_line#>'{estimate,source,source,region,id}',
      'region_name',first_line#>'{estimate,source,source,region,name_en}',
      'region_name_ar',first_line#>'{estimate,source,source,region,name_ar}',
      'requested_date',first_line#>'{estimate,source,requested_date}',
      'handoff_count',cardinality(ids),
      'source_row_count',(select sum(jsonb_array_length(h#>'{estimate,lines}')) from jsonb_array_elements(evidence) h),
      'totals',totals));
end; $$;
revoke all on function public.regional_handoff_batch_preview(uuid,uuid[]) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function public.regional_handoff_batch_preview(uuid,uuid[]) to authenticated;

create function public.regional_handoff_batch_create(p_organization_id uuid,p_handoff_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare report jsonb; ids uuid[]; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional batch requires an editor';
  end if;
  if p_handoff_ids is null or cardinality(p_handoff_ids) not between 1 and 50
    or array_ndims(p_handoff_ids)<>1 or array_position(p_handoff_ids,null) is not null then
    raise exception using errcode='MQ422',message='select 1 to 50 distinct handoffs',hint='batch_selection_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.regional-review:'||p_organization_id::text,0));
  -- Skip live evidence locks on retries, while still locking visible original parents.
  -- First saves use the review/handoff lock order; concurrent archive/rate changes
  -- must commit before the final fresh-statement preview can validate evidence.
  select array_agg(distinct id order by id) into ids from unnest(p_handoff_ids) id;
  if not exists(select 1 from public.regional_handoff_batches where organization_id=p_organization_id and handoff_ids=ids) then
    perform l.id from public.locations l where l.organization_id=p_organization_id and l.id in(
      select unnest(h.required_location_ids) from public.regional_transfer_handoffs h
        where h.organization_id=p_organization_id and h.id=any(ids)
    ) order by l.id for share;
    perform r.id from public.stock_regions r where r.organization_id=p_organization_id and r.id in(
      select (h.payload#>>'{estimate,source,source,region,id}')::uuid from public.regional_transfer_handoffs h
        where h.organization_id=p_organization_id and h.id=any(ids)
    ) order by r.id for share;
    perform n.id from public.network_links n where n.organization_id=p_organization_id and n.id in(
      select (v#>>'{lane,id}')::uuid from public.regional_transfer_handoffs h
      cross join lateral jsonb_array_elements(h.payload#>'{estimate,source,lines}') v
        where h.organization_id=p_organization_id and h.id=any(ids)
    ) order by n.id for share;
    perform i.id from public.items i join public.inventory_policies p on p.organization_id=i.organization_id and p.item_id=i.id
      where i.organization_id=p_organization_id and p.id in(
        select (h.payload#>>'{estimate,source,source,destination,policy,policy_id}')::uuid from public.regional_transfer_handoffs h
          where h.organization_id=p_organization_id and h.id=any(ids)
      ) order by i.id for key share of i;
    perform p.id from public.inventory_policies p where p.organization_id=p_organization_id and p.id in(
      select (h.payload#>>'{estimate,source,source,destination,policy,policy_id}')::uuid from public.regional_transfer_handoffs h
        where h.organization_id=p_organization_id and h.id=any(ids)
    ) order by p.id for share;
    perform d.id from public.replenishment_drafts d where d.organization_id=p_organization_id and d.id in(
      select (h.payload#>>'{estimate,source,source,input,draft_id}')::uuid from public.regional_transfer_handoffs h
        where h.organization_id=p_organization_id and h.id=any(ids)
    ) order by d.id for share;
  end if;
  perform h.id from public.regional_transfer_handoffs h
    where h.organization_id=p_organization_id and h.id=any(ids) order by h.id for key share;
  -- A new statement after every wait checks current authority, visibility and evidence.
  report:=public.regional_handoff_batch_preview(p_organization_id,p_handoff_ids);
  if report->>'existing_batch_id' is not null then return (report->>'existing_batch_id')::uuid; end if;
  select array_agg(id order by id) into ids from unnest(p_handoff_ids) id;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','regional-handoff-batch-v1','purpose','planning_only',
    'notice','As-of whole-regional planning package. Overlap is allowed. Each source retains its original freight charge. No consolidation, reservation, transfer order or inbound update.',
    'batch_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'summary',report->'summary','lines',report->'lines','item_identities',report->'item_identities');
  insert into public.regional_handoff_batches(id,organization_id,destination_location_id,required_location_ids,handoff_ids,created_by,created_at,payload)
    values(result,p_organization_id,(report#>>'{summary,destination_location_id}')::uuid,
      array(select value::uuid from jsonb_array_elements_text(report->'required_location_ids')),ids,auth.uid(),captured,snapshot);
  return result;
end; $$;
revoke all on function public.regional_handoff_batch_create(uuid,uuid[]) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function public.regional_handoff_batch_create(uuid,uuid[]) to authenticated;

create view public.regional_handoff_batch_list with(security_invoker=true) as
select b.id,b.organization_id,b.destination_location_id,b.required_location_ids,b.handoff_ids,b.created_at,
  b.payload#>>'{summary,region_name}' region_name,b.payload#>>'{summary,region_name_ar}' region_name_ar,
  b.payload#>>'{summary,destination_code}' destination_code,b.payload#>>'{summary,requested_date}' requested_date,
  cardinality(b.handoff_ids) handoff_count,(b.payload#>>'{summary,source_row_count}')::integer source_row_count,
  b.payload#>'{summary,totals}' totals,
  case when (select count(*) from public.regional_handoff_list h where h.organization_id=b.organization_id and h.id=any(b.handoff_ids))<>cardinality(b.handoff_ids)
    then 'unavailable'
    when (select count(*) from public.regional_handoff_list h where h.organization_id=b.organization_id and h.id=any(b.handoff_ids) and h.selected)=cardinality(b.handoff_ids)
    then 'current' else 'historical' end selection,
  (select count(*) from public.regional_handoff_batches other where other.organization_id=b.organization_id
    and other.id<>b.id and other.handoff_ids && b.handoff_ids) overlap_count,
  app.normalize_search(concat_ws(' ',b.payload#>>'{summary,destination_code}',b.payload#>>'{summary,region_name}',b.payload#>>'{summary,region_name_ar}',
    (select string_agg(concat_ws(' ',h#>>'{estimate,source,source,destination,policy,item_code}',
      (select string_agg(v->>'location_code',' ') from jsonb_array_elements(h#>'{estimate,lines}') v)),' ')
      from jsonb_array_elements(b.payload->'lines') h))) search_text
from public.regional_handoff_batches b;
revoke all on public.regional_handoff_batch_list from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.regional_handoff_batch_list to authenticated;
create view public.regional_handoff_batch_candidates with(security_invoker=true) as
select h.*,(select count(*) from public.regional_handoff_batches b
  where b.organization_id=h.organization_id and b.handoff_ids @> array[h.id]) batch_count
from public.regional_handoff_list h;
revoke all on public.regional_handoff_batch_candidates from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.regional_handoff_batch_candidates to authenticated;
reset lock_timeout;
