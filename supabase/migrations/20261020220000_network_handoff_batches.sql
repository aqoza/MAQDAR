-- Step 22f: additive/forward-only. Web rollback retains copied planning evidence.
set lock_timeout='5s';
create table public.network_handoff_batches(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_location_id uuid not null, required_location_ids uuid[] not null, handoff_ids uuid[] not null,
  created_by uuid not null, created_at timestamptz not null default clock_timestamp(), payload jsonb not null,
  unique(organization_id,id), unique(organization_id,handoff_ids),
  foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete cascade,
  check(array_ndims(handoff_ids)=1 and cardinality(handoff_ids) between 1 and 50 and array_position(handoff_ids,null) is null),
  check(array_ndims(required_location_ids)=1 and cardinality(required_location_ids) between 2 and 1001
    and array_position(required_location_ids,null) is null),
  check((payload->>'schema_version'='network-handoff-batch-v1' and payload->>'purpose'='planning_only') is true)
);
create index network_batches_recent on public.network_handoff_batches(organization_id,created_at desc,id);
create index network_batches_sources on public.network_handoff_batches using gin(handoff_ids);
create index network_batches_locations on public.network_handoff_batches using gin(required_location_ids);
alter table public.network_handoff_batches enable row level security;
revoke all on public.network_handoff_batches from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.network_handoff_batches to authenticated;
create policy "members read" on public.network_handoff_batches for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "all locations" on public.network_handoff_batches as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or required_location_ids <@ array(select app.scoped_locations()));
create trigger audit_business_row after insert or update or delete on public.network_handoff_batches
  for each row execute function app.audit_business_row();
comment on table public.network_handoff_batches is 'Immutable whole-network planning packages; copied evidence survives source deletion. Every participating location is required. No consolidation, reservation or execution.';

create function app.delete_location_network_batches() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.network_handoff_batches
    where organization_id=old.organization_id and required_location_ids @> array[old.id];
  return old;
end; $$;
revoke all on function app.delete_location_network_batches() from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
create trigger delete_network_batches before delete on public.locations
  for each row execute function app.delete_location_network_batches();

create function public.network_handoff_batch_preview(p_organization_id uuid,p_handoff_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ids uuid[]; locations uuid[]; evidence jsonb; line jsonb; first_line jsonb; totals jsonb;
  existing public.network_handoff_batches; current_freight jsonb;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network batch requires an editor';
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
  select jsonb_agg(h.payload order by h.id) into evidence from public.network_transfer_handoffs h
    where h.organization_id=p_organization_id and h.id=any(ids)
      and (h.organization_id=any(array(select app.unscoped_organizations()))
        or h.required_location_ids <@ array(select app.scoped_locations()));
  if coalesce(jsonb_array_length(evidence),0)<>cardinality(ids) then
    raise exception using errcode='MQ404',message='handoff unavailable';
  end if;
  select array_agg(distinct location_id order by location_id) into locations
    from public.network_transfer_handoffs h cross join lateral unnest(h.required_location_ids) location_id
    where h.organization_id=p_organization_id and h.id=any(ids);
  select * into existing from public.network_handoff_batches b
    where b.organization_id=p_organization_id and b.handoff_ids=ids
      and (b.organization_id=any(array(select app.unscoped_organizations()))
        or b.required_location_ids <@ array(select app.scoped_locations()));
  if found then
    return jsonb_build_object('existing_batch_id',existing.id,'summary',existing.payload->'summary',
      'lines',existing.payload->'lines','required_location_ids',existing.required_location_ids);
  end if;
  first_line:=evidence->0;
  for line in select value from jsonb_array_elements(evidence) loop
    if line->>'schema_version' is distinct from 'network-transfer-handoff-v1'
      or line#>>'{estimate,source,source,item_id}' is null
      or line#>>'{estimate,source,source,source_policy,item_code}' is null
      or line#>>'{estimate,source,source,source_policy,unit}' is null
      or line#>>'{estimate,source_location_id}' is null
      or line#>>'{estimate,source,dispatch,date}' is null then
      raise exception using errcode='MQ422',message='incomplete saved evidence',hint='batch_source_invalid';
    end if;
    if app.network_review_timing_clear(line->'estimate') is distinct from true then
      raise exception using errcode='MQ422',message='network timing review required',hint='network_timing_required';
    end if;
    if line#>'{estimate,source_location_id}' is distinct from first_line#>'{estimate,source_location_id}'
      or line#>'{estimate,source,dispatch,date}' is distinct from first_line#>'{estimate,source,dispatch,date}' then
      raise exception using errcode='MQ422',message='incompatible warehouse or dispatch',hint='batch_group_mismatch';
    end if;
    if not exists(select 1 from public.network_review_list p where p.organization_id=p_organization_id
      and p.id=(line#>>'{proposal,id}')::uuid and p.selected) then
      raise exception using errcode='MQ409',message='selected approval required',hint='network_selection_changed';
    end if;
    current_freight:=public.network_freight_preview(p_organization_id,(line#>>'{estimate,scenario_id}')::uuid,true);
    if current_freight->>'status' is distinct from 'available'
      or current_freight->>'fingerprint' is distinct from line#>>'{estimate,fingerprint}' then
      raise exception using errcode='MQ409',message='freight evidence changed',hint='network_freight_changed';
    end if;
  end loop;
  if (select count(distinct value#>>'{estimate,source,source,item_id}') from jsonb_array_elements(evidence))<>cardinality(ids)
    or (select count(distinct value#>>'{estimate,source,source,source_policy,item_code}') from jsonb_array_elements(evidence))<>cardinality(ids) then
    raise exception using errcode='MQ422',message='repeated item in batch',hint='batch_duplicate_item';
  end if;
  if exists(select 1 from jsonb_array_elements(evidence) h
    cross join lateral jsonb_array_elements(h#>'{estimate,lines}') b
    where b->>'status'='available'
    group by b#>>'{terms,currency}' having count(distinct b#>>'{terms,minor_units}')<>1) then
    raise exception using errcode='MQ422',message='incompatible currency precision',hint='batch_source_invalid';
  end if;
  -- Sum each saved rounded branch cost once; zero branches have no priced subtotal.
  select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'minor_units',minor_units,
    'subtotal',subtotal::text) order by currency),'[]'::jsonb) into totals from (
    select b#>>'{terms,currency}' currency,(b#>>'{terms,minor_units}')::integer minor_units,
      sum((b->>'subtotal')::numeric) subtotal
    from jsonb_array_elements(evidence) h cross join lateral jsonb_array_elements(h#>'{estimate,lines}') b
    where b->>'status'='available' group by 1,2
  ) amounts;
  return jsonb_build_object('existing_batch_id',null,'required_location_ids',locations,'lines',evidence,
    'summary',jsonb_build_object(
      'source_location_id',first_line#>'{estimate,source_location_id}',
      'source_code',first_line#>'{estimate,source,source,source_location_code}',
      'dispatch_date',first_line#>'{estimate,source,dispatch,date}',
      'handoff_count',cardinality(ids),
      'branch_row_count',(select sum(jsonb_array_length(h#>'{estimate,lines}')) from jsonb_array_elements(evidence) h),
      'totals',totals));
end; $$;
revoke all on function public.network_handoff_batch_preview(uuid,uuid[]) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function public.network_handoff_batch_preview(uuid,uuid[]) to authenticated;

create function public.network_handoff_batch_create(p_organization_id uuid,p_handoff_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare report jsonb; ids uuid[]; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network batch requires an editor';
  end if;
  if p_handoff_ids is null or cardinality(p_handoff_ids) not between 1 and 50
    or array_ndims(p_handoff_ids)<>1 or array_position(p_handoff_ids,null) is not null then
    raise exception using errcode='MQ422',message='select 1 to 50 distinct handoffs',hint='batch_selection_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.network-review:'||p_organization_id::text,0));
  -- Protect original parents and participating locations against deletion during first save.
  perform l.id from public.locations l where l.organization_id=p_organization_id and l.id in(
    select unnest(h.required_location_ids) from public.network_transfer_handoffs h
      where h.organization_id=p_organization_id and h.id=any(p_handoff_ids)
  ) order by l.id for key share;
  perform h.id from public.network_transfer_handoffs h
    where h.organization_id=p_organization_id and h.id=any(p_handoff_ids) order by h.id for key share;
  -- A new statement after every wait checks current authority, visibility and evidence.
  report:=public.network_handoff_batch_preview(p_organization_id,p_handoff_ids);
  if report->>'existing_batch_id' is not null then return (report->>'existing_batch_id')::uuid; end if;
  select array_agg(id order by id) into ids from unnest(p_handoff_ids) id;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','network-handoff-batch-v1','purpose','planning_only',
    'notice','As-of whole-network planning package. Overlap is allowed. Each branch retains its original freight charge. No consolidation, reservation, transfer order or inbound update.',
    'batch_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'summary',report->'summary','lines',report->'lines');
  insert into public.network_handoff_batches(id,organization_id,source_location_id,required_location_ids,handoff_ids,created_by,created_at,payload)
    values(result,p_organization_id,(report#>>'{summary,source_location_id}')::uuid,
      array(select value::uuid from jsonb_array_elements_text(report->'required_location_ids')),ids,auth.uid(),captured,snapshot);
  return result;
end; $$;
revoke all on function public.network_handoff_batch_create(uuid,uuid[]) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function public.network_handoff_batch_create(uuid,uuid[]) to authenticated;

create view public.network_handoff_batch_list with(security_invoker=true) as
select b.id,b.organization_id,b.source_location_id,b.required_location_ids,b.handoff_ids,b.created_at,
  b.payload#>>'{summary,source_code}' source_code,b.payload#>>'{summary,dispatch_date}' dispatch_date,
  cardinality(b.handoff_ids) handoff_count,(b.payload#>>'{summary,branch_row_count}')::integer branch_row_count,
  b.payload#>'{summary,totals}' totals,
  case when (select count(*) from public.network_handoff_list h where h.organization_id=b.organization_id and h.id=any(b.handoff_ids))<>cardinality(b.handoff_ids)
    then 'unavailable'
    when (select count(*) from public.network_handoff_list h where h.organization_id=b.organization_id and h.id=any(b.handoff_ids) and h.selected)=cardinality(b.handoff_ids)
    then 'current' else 'historical' end selection,
  (select count(*) from public.network_handoff_batches other where other.organization_id=b.organization_id
    and other.id<>b.id and other.handoff_ids && b.handoff_ids) overlap_count,
  app.normalize_search(concat_ws(' ',b.payload#>>'{summary,source_code}',
    (select string_agg(concat_ws(' ',h#>>'{estimate,source,source,source_policy,item_code}',
      (select string_agg(v->>'location_code',' ') from jsonb_array_elements(h#>'{estimate,lines}') v)),' ')
      from jsonb_array_elements(b.payload->'lines') h))) search_text
from public.network_handoff_batches b;
revoke all on public.network_handoff_batch_list from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.network_handoff_batch_list to authenticated;
create view public.network_handoff_batch_candidates with(security_invoker=true) as
select h.*,(select count(*) from public.network_handoff_batches b
  where b.organization_id=h.organization_id and b.handoff_ids @> array[h.id]) batch_count
from public.network_handoff_list h;
revoke all on public.network_handoff_batch_candidates from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.network_handoff_batch_candidates to authenticated;
reset lock_timeout;
