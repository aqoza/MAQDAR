-- Step 27d: copied authorization packages, with no operational effects.
-- Rollback: remove web entry points; retain the additive schema and saved files.
set lock_timeout='5s';
create table public.dealer_return_batches (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 source_location_id uuid not null,
 location_id uuid not null,
 handoff_ids uuid[] not null,
 created_by uuid not null,
 created_at timestamptz not null,
 payload jsonb not null,
 search_text text not null,
 unique(organization_id,id), unique(organization_id,handoff_ids),
 check(source_location_id<>location_id),
 check((array_ndims(handoff_ids)=1 and cardinality(handoff_ids) between 1 and 50) is true),
 check((payload->>'schema_version'='dealer-return-batch-v1' and payload->>'purpose'='internal_return_authorization') is true),
 foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete cascade,
 foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
create index dealer_return_batches_history on public.dealer_return_batches(organization_id,created_at desc,id);
create index dealer_return_batches_source on public.dealer_return_batches(organization_id,source_location_id);
create index dealer_return_batches_receiver on public.dealer_return_batches(organization_id,location_id);
create index dealer_return_batches_members on public.dealer_return_batches using gin(handoff_ids);
alter table public.dealer_return_batches enable row level security;
revoke all on public.dealer_return_batches from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant select on public.dealer_return_batches to authenticated;
create policy "members read" on public.dealer_return_batches for select to authenticated
 using(organization_id=any(array(select app.member_organizations())));
create policy "source scope" on public.dealer_return_batches as restrictive for select to authenticated
 using(organization_id=any(array(select app.unscoped_organizations())) or source_location_id=any(array(select app.scoped_locations())));
create policy "destination scope" on public.dealer_return_batches as restrictive for select to authenticated
 using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.dealer_return_batches
 for each row execute function app.audit_business_row();
comment on table public.dealer_return_batches is 'Immutable copied return authorizations. Canonical handoff set identifies retries; quantities remain separate. Source deletion preserves files; organization/endpoint deletion cascades. Overlap is allowed and creates no reservation or operational/financial effect. Requested date is not a receipt schedule.';

create function public.dealer_return_batch_preview(p_organization_id uuid,p_handoff_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ids uuid[]; evidence jsonb; first_line jsonb; row record; previous public.dealer_return_batches;
begin
 if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='return batch requires an editor'; end if;
 if p_handoff_ids is null or cardinality(p_handoff_ids) not between 1 and 50 or array_ndims(p_handoff_ids)<>1 then
  raise exception using errcode='MQ422',message='select 1 to 50 handoffs',hint='batch_selection_invalid'; end if;
 if array_position(p_handoff_ids,null) is not null then
  raise exception using errcode='MQ422',message='null handoff',hint='batch_selection_invalid'; end if;
 select array_agg(distinct id order by id) into ids from unnest(p_handoff_ids) id;
 if cardinality(ids)<>cardinality(p_handoff_ids) then
  raise exception using errcode='MQ422',message='duplicate handoff',hint='batch_selection_invalid'; end if;
 -- Explicit authority is required when invoked by the security-definer save RPC too.
 select jsonb_agg(h.payload order by h.id) into evidence from public.dealer_return_handoffs h
  join public.dealer_return_requests r on r.organization_id=h.organization_id and r.id=h.return_id
  where h.organization_id=p_organization_id and h.id=any(ids)
   and (h.organization_id=any(array(select app.unscoped_organizations())) or
    array[h.source_location_id,h.location_id] <@ array(select app.scoped_locations()));
 if coalesce(jsonb_array_length(evidence),0)<>cardinality(ids) then
  raise exception using errcode='MQ404',message='return handoff unavailable'; end if;
 select * into previous from public.dealer_return_batches b where b.organization_id=p_organization_id and b.handoff_ids=ids
  and (b.organization_id=any(array(select app.unscoped_organizations())) or
   array[b.source_location_id,b.location_id] <@ array(select app.scoped_locations()));
 if found then return previous.payload||jsonb_build_object('existing_batch_id',previous.id); end if;
 first_line:=evidence->0;
 if (select count(distinct value#>>'{request,report,item,id}') from jsonb_array_elements(evidence))<>cardinality(ids)
  or (select count(distinct value#>>'{request,report,item,code}') from jsonb_array_elements(evidence))<>cardinality(ids) then
  raise exception using errcode='MQ422',message='repeated item',hint='batch_duplicate_item'; end if;
 for row in
  select h.payload,r.report,r.decision,r.withdrawn_at,r.eligibility_confirmed,r.decided_at,r.decided_by,r.decision_reason,r.reviewer_email,
   i.id item_id,i.code item_code,i.unit_of_measure item_unit,
   s.id source_id,s.code source_code,s.location_type source_type,s.is_active source_active,
   d.id receiver_id,d.code receiver_code,d.location_type receiver_type,d.is_active receiver_active
  from public.dealer_return_handoffs h
  join public.dealer_return_requests r on r.organization_id=h.organization_id and r.id=h.return_id
  left join public.items i on i.organization_id=h.organization_id and i.id=(h.payload#>>'{request,report,item,id}')::uuid
  left join public.locations s on s.organization_id=h.organization_id and s.id=h.source_location_id
  left join public.locations d on d.organization_id=h.organization_id and d.id=h.location_id
  where h.organization_id=p_organization_id and h.id=any(ids)
 loop
  if row.payload#>'{request,report,source,id}' is distinct from first_line#>'{request,report,source,id}'
   or row.payload#>'{request,report,receiver,id}' is distinct from first_line#>'{request,report,receiver,id}'
   or row.payload#>'{request,report,input,requested_date}' is distinct from first_line#>'{request,report,input,requested_date}' then
   raise exception using errcode='MQ422',message='incompatible return batch',hint='batch_group_mismatch'; end if;
  if row.decision is distinct from 'approved' or row.withdrawn_at is not null or row.eligibility_confirmed is distinct from true
   or row.report is distinct from row.payload#>'{request,report}'
   or row.decided_at is distinct from (row.payload#>>'{approval,decided_at}')::timestamptz
   or row.decided_by is distinct from (row.payload#>>'{approval,decided_by}')::uuid
   or row.decision_reason is distinct from row.payload#>>'{approval,reason}'
   or row.reviewer_email is distinct from row.payload#>>'{approval,reviewer_email}'
   or row.item_id is null or row.item_code is distinct from row.report#>>'{item,code}'
   or row.item_unit is distinct from row.report#>>'{input,unit}'
   or row.source_id is null or row.receiver_id is null or row.source_active is distinct from true or row.receiver_active is distinct from true
   or row.source_type is distinct from 'branch' or row.receiver_type is distinct from row.report#>>'{receiver,location_type}'
   or row.receiver_type not in ('central','hub')
   or row.source_code is distinct from row.report#>>'{source,code}' or row.receiver_code is distinct from row.report#>>'{receiver,code}' then
   raise exception using errcode='MQ409',message='return evidence changed; create a new request and review',hint='return_evidence_changed'; end if;
 end loop;
 return jsonb_build_object('existing_batch_id',null,'summary',jsonb_build_object(
  'source_location_id',first_line#>'{request,report,source,id}','source_code',first_line#>'{request,report,source,code}',
  'location_id',first_line#>'{request,report,receiver,id}','location_code',first_line#>'{request,report,receiver,code}',
  'requested_date',first_line#>'{request,report,input,requested_date}','line_count',cardinality(ids)),'lines',evidence);
end; $$;
revoke all on function public.dealer_return_batch_preview(uuid,uuid[]) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.dealer_return_batch_preview(uuid,uuid[]) to authenticated;

create function public.dealer_return_batch_create(p_organization_id uuid,p_handoff_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare report jsonb; ids uuid[]; result uuid; captured timestamptz; snapshot jsonb; actor text;
begin
 if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='return batch requires an editor'; end if;
 perform pg_advisory_xact_lock(hashtextextended('zeespare.dealer-return-batches:'||p_organization_id::text,0));
 report:=public.dealer_return_batch_preview(p_organization_id,p_handoff_ids);
 if report->>'existing_batch_id' is not null then return (report->>'existing_batch_id')::uuid; end if;
 select array_agg(id order by id) into ids from unnest(p_handoff_ids) id;
 -- Lock all endpoints, then all original items, requests and handoffs in identity order.
 -- This matches single-handoff/review and parent-cascade order without reserving stock.
 perform 1 from public.locations where organization_id=p_organization_id and id in (
  select source_location_id from public.dealer_return_handoffs where organization_id=p_organization_id and id=any(ids)
  union select location_id from public.dealer_return_handoffs where organization_id=p_organization_id and id=any(ids)) order by id for share;
 perform 1 from public.items where organization_id=p_organization_id and id in (
  select (payload#>>'{request,report,item,id}')::uuid from public.dealer_return_handoffs where organization_id=p_organization_id and id=any(ids)) order by id for share;
 perform 1 from public.dealer_return_requests where organization_id=p_organization_id and id in (
  select return_id from public.dealer_return_handoffs where organization_id=p_organization_id and id=any(ids)) order by id for share;
 perform 1 from public.dealer_return_handoffs where organization_id=p_organization_id and id=any(ids) order by id for share;
 report:=public.dealer_return_batch_preview(p_organization_id,ids);
 if report->>'existing_batch_id' is not null then return (report->>'existing_batch_id')::uuid; end if;
 result:=gen_random_uuid(); captured:=clock_timestamp();
 select email into actor from auth.users where id=auth.uid();
 snapshot:=jsonb_build_object('schema_version','dealer-return-batch-v1','purpose','internal_return_authorization',
  'notice','Internal return authorization package only. Requested dates are not scheduled receipts. Quantities and conditions remain separate. Packages may overlap and create no stock, inbound, reservation, credit or financial change.',
  'batch_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),'created_by_email',actor,'created_at',captured,
  'summary',report->'summary','lines',report->'lines');
 insert into public.dealer_return_batches(id,organization_id,source_location_id,location_id,handoff_ids,created_by,created_at,payload,search_text)
 values(result,p_organization_id,(report#>>'{summary,source_location_id}')::uuid,(report#>>'{summary,location_id}')::uuid,ids,auth.uid(),captured,snapshot,
  app.normalize_search(concat_ws(' ',actor,(select string_agg(h.search_text,' ') from public.dealer_return_handoffs h where h.organization_id=p_organization_id and h.id=any(ids)))));
 return result;
end; $$;
revoke all on function public.dealer_return_batch_create(uuid,uuid[]) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.dealer_return_batch_create(uuid,uuid[]) to authenticated;

create view public.dealer_return_batch_list with(security_invoker=true) as
select b.*,
 b.payload#>>'{summary,source_code}' source_code,b.payload#>>'{summary,location_code}' location_code,
 b.payload#>>'{summary,requested_date}' requested_date,cardinality(b.handoff_ids) line_count,
 (select count(*) from public.dealer_return_handoffs h where h.organization_id=b.organization_id and h.id=any(b.handoff_ids))=cardinality(b.handoff_ids) sources_available,
 (select count(*) from public.dealer_return_batches other where other.organization_id=b.organization_id and other.id<>b.id and other.handoff_ids && b.handoff_ids) overlap_count
from public.dealer_return_batches b;
revoke all on public.dealer_return_batch_list from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant select on public.dealer_return_batch_list to authenticated;
create view public.dealer_return_batch_candidates with(security_invoker=true) as
select h.*,
 (select count(*) from public.dealer_return_batches b where b.organization_id=h.organization_id and b.handoff_ids @> array[h.id]) batch_count
from public.dealer_return_handoffs h;
revoke all on public.dealer_return_batch_candidates from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant select on public.dealer_return_batch_candidates to authenticated;
reset lock_timeout;
