-- Step 20d: additive, forward-only. Web rollback retains saved planning evidence.
set lock_timeout='5s';
create table public.excess_disposition_handoff_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  handoff_ids uuid[] not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  payload jsonb not null,
  unique(organization_id,id),
  unique(organization_id,handoff_ids),
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
  check((array_ndims(handoff_ids)=1 and cardinality(handoff_ids) between 1 and 50) is true),
  check((payload->>'schema_version'='excess-disposition-handoff-batch-v1' and payload->>'purpose'='planning_only') is true)
);
create index excess_disposition_batches_recent on public.excess_disposition_handoff_batches(organization_id,created_at desc,id);
create index excess_disposition_batches_location on public.excess_disposition_handoff_batches(organization_id,location_id);
create index excess_disposition_batches_members on public.excess_disposition_handoff_batches using gin(handoff_ids);
alter table public.excess_disposition_handoff_batches enable row level security;
revoke all on public.excess_disposition_handoff_batches from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.excess_disposition_handoff_batches to authenticated;
create policy "members read" on public.excess_disposition_handoff_batches for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.excess_disposition_handoff_batches as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.excess_disposition_handoff_batches
  for each row execute function app.audit_business_row();
comment on table public.excess_disposition_handoff_batches is 'Immutable disposition planning packages. Sorted handoff set is retry identity. Copied evidence survives source handoff/assessment deletion; organization/location deletion cascades. Overlap does not reserve stock or prevent duplicate execution. Exact reference values are neither proceeds nor write-offs.';

create function public.excess_disposition_handoff_batch_preview(p_organization_id uuid,p_handoff_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ids uuid[]; evidence jsonb; line jsonb; first_line jsonb; source jsonb; summary jsonb;
  existing public.excess_disposition_handoff_batches; total numeric:=0;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='batch requires an editor';
  end if;
  if p_handoff_ids is null or cardinality(p_handoff_ids) not between 1 and 50 or array_ndims(p_handoff_ids)<>1 then
    raise exception using errcode='MQ422',message='select 1 to 50 distinct handoffs',hint='batch_selection_invalid';
  end if;
  if array_position(p_handoff_ids,null) is not null then
    raise exception using errcode='MQ422',message='null handoff',hint='batch_selection_invalid';
  end if;
  select array_agg(distinct id order by id) into ids from unnest(p_handoff_ids) id;
  if cardinality(ids)<>cardinality(p_handoff_ids) then
    raise exception using errcode='MQ422',message='duplicate handoff',hint='batch_selection_invalid';
  end if;
  -- Explicit scope also protects calls from the security-definer create function.
  select jsonb_agg(h.payload order by h.id) into evidence from public.excess_disposition_handoffs h
    where h.organization_id=p_organization_id and h.id=any(ids)
      and (h.organization_id=any(array(select app.unscoped_organizations())) or h.location_id=any(array(select app.scoped_locations())));
  if coalesce(jsonb_array_length(evidence),0)<>cardinality(ids) then
    raise exception using errcode='MQ404',message='handoff unavailable';
  end if;
  select * into existing from public.excess_disposition_handoff_batches b
    where b.organization_id=p_organization_id and b.handoff_ids=ids
      and (b.organization_id=any(array(select app.unscoped_organizations())) or b.location_id=any(array(select app.scoped_locations())));
  if found then return existing.payload||jsonb_build_object('existing_batch_id',existing.id); end if;
  first_line:=evidence->0;
  for line in select value from jsonb_array_elements(evidence) loop
    if line->>'schema_version' is distinct from 'excess-disposition-handoff-v1'
      or line->>'purpose' is distinct from 'planning_only'
      or line#>>'{disposition,item_id}' is null or line#>>'{disposition,item_code}' is null
      or line#>>'{disposition,location_id}' is null or line#>>'{disposition,cutoff}' is null
      or line#>>'{disposition,currency}' is null or line#>>'{disposition,unit}' is null
      or line#>>'{disposition,reference_value}' is null
      or coalesce((line#>>'{disposition,quantity}')::numeric,0)<=0
      or coalesce(line#>>'{disposition,kind}','') not in ('supplier_return','scrap') then
      raise exception using errcode='MQ422',message='incomplete saved evidence',hint='batch_source_invalid';
    end if;
    if (line#>'{disposition,location_id}') is distinct from (first_line#>'{disposition,location_id}')
      or (line#>'{disposition,kind}') is distinct from (first_line#>'{disposition,kind}')
      or (line#>'{disposition,currency}') is distinct from (first_line#>'{disposition,currency}')
      or (line#>'{disposition,cutoff}') is distinct from (first_line#>'{disposition,cutoff}') then
      raise exception using errcode='MQ422',message='incompatible batch headers',hint='batch_group_mismatch';
    end if;
    if not exists(select 1 from public.excess_disposition_list p where p.organization_id=p_organization_id
      and p.id=(line#>>'{proposal,id}')::uuid and p.selected) then
      raise exception using errcode='MQ409',message='selected approval required',hint='handoff_selection_changed';
    end if;
    source:=public.excess_disposition_preview(p_organization_id,(line#>>'{assessment,id}')::uuid,(line#>>'{disposition,item_id}')::uuid);
    if source->'matches' is distinct from 'true'::jsonb or source->'line' is distinct from line->'line' then
      raise exception using errcode='MQ409',message='assessment evidence changed',hint='excess_disposition_changed';
    end if;
    total:=total+(line#>>'{disposition,reference_value}')::numeric;
  end loop;
  if (select count(distinct value#>>'{disposition,item_id}') from jsonb_array_elements(evidence))<>cardinality(ids)
    or (select count(distinct value#>>'{disposition,item_code}') from jsonb_array_elements(evidence))<>cardinality(ids) then
    raise exception using errcode='MQ422',message='repeated item in batch',hint='batch_duplicate_item';
  end if;
  summary:=jsonb_build_object('location_id',first_line#>'{disposition,location_id}',
    'location_code',first_line#>'{disposition,location_code}','kind',first_line#>'{disposition,kind}',
    'currency',first_line#>'{disposition,currency}','cutoff',first_line#>'{disposition,cutoff}',
    'line_count',cardinality(ids),'reference_value',total::text);
  return jsonb_build_object('existing_batch_id',null,'summary',summary,'lines',evidence);
end; $$;
revoke all on function public.excess_disposition_handoff_batch_preview(uuid,uuid[]) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.excess_disposition_handoff_batch_preview(uuid,uuid[]) to authenticated;

create function public.excess_disposition_handoff_batch_create(p_organization_id uuid,p_handoff_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare report jsonb; ids uuid[]; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='batch requires an editor';
  end if;
  -- Shared with disposition decisions and single handoffs; preview rechecks live authority.
  perform pg_advisory_xact_lock(hashtextextended('maqdar.excess-disposition:'||p_organization_id::text,0));
  report:=public.excess_disposition_handoff_batch_preview(p_organization_id,p_handoff_ids);
  if report->>'existing_batch_id' is not null then return (report->>'existing_batch_id')::uuid; end if;
  select array_agg(id order by id) into ids from unnest(p_handoff_ids) id;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','excess-disposition-handoff-batch-v1','purpose','planning_only',
    'notice','As-of disposition planning package only. Reference inventory value is neither recovery proceeds nor an accounting write-off. Overlap is allowed; no reservation, supplier return, scrap execution or stock movement is created.',
    'batch_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'summary',report->'summary','lines',report->'lines');
  insert into public.excess_disposition_handoff_batches(id,organization_id,location_id,handoff_ids,created_by,created_at,payload)
    values(result,p_organization_id,(report#>>'{summary,location_id}')::uuid,ids,auth.uid(),captured,snapshot);
  return result;
end; $$;
revoke all on function public.excess_disposition_handoff_batch_create(uuid,uuid[]) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.excess_disposition_handoff_batch_create(uuid,uuid[]) to authenticated;

create view public.excess_disposition_handoff_batch_list with(security_invoker=true) as
select b.id,b.organization_id,b.location_id,b.handoff_ids,b.created_at,
  b.payload#>>'{summary,location_code}' location_code,b.payload#>>'{summary,kind}' kind,
  b.payload#>>'{summary,currency}' currency,b.payload#>>'{summary,reference_value}' reference_value,
  b.payload#>>'{summary,cutoff}' cutoff,cardinality(b.handoff_ids) line_count,
  case when (select count(*) from public.excess_disposition_handoff_list h where h.organization_id=b.organization_id and h.id=any(b.handoff_ids))<>cardinality(b.handoff_ids)
    then 'unavailable'
    when (select count(*) from public.excess_disposition_handoff_list h where h.organization_id=b.organization_id and h.id=any(b.handoff_ids) and h.selected)=cardinality(b.handoff_ids)
    then 'current' else 'historical' end selection,
  (select count(*) from public.excess_disposition_handoff_batches other where other.organization_id=b.organization_id
    and other.id<>b.id and other.handoff_ids && b.handoff_ids) overlap_count,
  app.normalize_search((select string_agg(concat_ws(' ',value#>>'{disposition,item_code}',value#>>'{proposal,reason}',value#>>'{proposal,approval_reason}',value#>>'{assessment,reason}'),' ') from jsonb_array_elements(b.payload->'lines'))) search_text
from public.excess_disposition_handoff_batches b;
revoke all on public.excess_disposition_handoff_batch_list from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.excess_disposition_handoff_batch_list to authenticated;
create view public.excess_disposition_handoff_batch_candidates with(security_invoker=true) as
select h.*,(select count(*) from public.excess_disposition_handoff_batches b where b.organization_id=h.organization_id and b.handoff_ids @> array[h.id]) batch_count
from public.excess_disposition_handoff_list h;
revoke all on public.excess_disposition_handoff_batch_candidates from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.excess_disposition_handoff_batch_candidates to authenticated;
reset lock_timeout;
