-- Step 27c: immutable internal return-authorization exports.
-- Rollback: remove entry points; retain saved evidence and restrictive grants.
set lock_timeout='5s';
create table public.dealer_return_handoffs (
 id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 return_id uuid not null,
 source_location_id uuid not null,
 location_id uuid not null,
 created_by uuid not null,
 created_at timestamptz not null,
 payload jsonb not null check(payload->>'schema_version'='dealer-return-handoff-v1'),
 search_text text not null,
 unique(organization_id,id), unique(organization_id,return_id),
 check(source_location_id<>location_id),
 foreign key(organization_id,return_id) references public.dealer_return_requests(organization_id,id) on delete cascade,
 foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete cascade,
 foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
create index dealer_return_handoffs_history on public.dealer_return_handoffs(organization_id,created_at desc,id);
create index dealer_return_handoffs_source on public.dealer_return_handoffs(organization_id,source_location_id);
create index dealer_return_handoffs_receiver on public.dealer_return_handoffs(organization_id,location_id);
alter table public.dealer_return_handoffs enable row level security;
revoke all on public.dealer_return_handoffs from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant select on public.dealer_return_handoffs to authenticated;
create policy "members read" on public.dealer_return_handoffs for select to authenticated
 using(organization_id=any(array(select app.member_organizations())));
create policy "source scope" on public.dealer_return_handoffs as restrictive for select to authenticated
 using(organization_id=any(array(select app.unscoped_organizations())) or source_location_id=any(array(select app.scoped_locations())));
create policy "destination scope" on public.dealer_return_handoffs as restrictive for select to authenticated
 using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.dealer_return_handoffs
 for each row execute function app.audit_business_row();
comment on table public.dealer_return_handoffs is 'Immutable internal return authorization evidence, one export per approved request. Requested date is not a receipt schedule. No stock, inbound, reservation or financial effects. Item/account deletion preserves copied evidence; request/organization/location deletion cascades.';

create function public.dealer_return_handoff_create(p_organization_id uuid,p_return_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare request public.dealer_return_requests; item public.items; source public.locations; receiver public.locations;
 previous uuid; result uuid; saved_at timestamptz; actor text; payload jsonb;
begin
 if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='return handoff requires an editor'; end if;
 select * into request from public.dealer_return_requests where organization_id=p_organization_id and id=p_return_id;
 if request.id is null or (not(p_organization_id=any(array(select app.unscoped_organizations()))) and
  not(array[request.source_location_id,request.location_id] <@ array(select app.scoped_locations()))) then
  raise exception using errcode='MQ404',message='return unavailable'; end if;
 select id into previous from public.dealer_return_handoffs where organization_id=p_organization_id and return_id=p_return_id;
 -- Already saved exports retain their original evidence after later catalog changes.
 if previous is not null then return previous; end if;
 if request.decision is distinct from 'approved' or request.withdrawn_at is not null
  or request.eligibility_confirmed is distinct from true then
  raise exception using errcode='MQ409',message='approved return required'; end if;
 -- Match endpoint cascade / review lock order before serializing creation on the request.
 perform 1 from public.locations where organization_id=p_organization_id and id in (request.source_location_id,request.location_id) order by id for share;
 select * into item from public.items where organization_id=p_organization_id and id=(request.report#>>'{item,id}')::uuid for share;
 select * into request from public.dealer_return_requests where organization_id=p_organization_id and id=p_return_id for update;
 if not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='return handoff requires an editor'; end if;
 if request.id is null or (not(p_organization_id=any(array(select app.unscoped_organizations()))) and
  not(array[request.source_location_id,request.location_id] <@ array(select app.scoped_locations()))) then
  raise exception using errcode='MQ404',message='return unavailable'; end if;
 select id into previous from public.dealer_return_handoffs where organization_id=p_organization_id and return_id=p_return_id;
 if previous is not null then return previous; end if;
 if request.decision is distinct from 'approved' or request.withdrawn_at is not null
  or request.eligibility_confirmed is distinct from true then
  raise exception using errcode='MQ409',message='approved return required'; end if;
 select * into source from public.locations where organization_id=p_organization_id and id=request.source_location_id;
 select * into receiver from public.locations where organization_id=p_organization_id and id=request.location_id;
 if item.id is null or item.code is distinct from request.report#>>'{item,code}'
  or item.unit_of_measure is distinct from request.report#>>'{input,unit}'
  or source.id is null or receiver.id is null or not source.is_active or not receiver.is_active
  or source.location_type<>'branch' or receiver.location_type not in ('hub','central')
  or source.code is distinct from request.report#>>'{source,code}'
  or receiver.code is distinct from request.report#>>'{receiver,code}'
  or receiver.location_type is distinct from request.report#>>'{receiver,location_type}' then
  raise exception using errcode='MQ409',message='return catalog evidence changed; create a new request'; end if;
 result:=gen_random_uuid(); saved_at:=clock_timestamp();
 select email into actor from auth.users where id=auth.uid();
 payload:=jsonb_build_object(
  'schema_version','dealer-return-handoff-v1','purpose','internal_return_authorization',
  'notice','Internal authorization for the declared return only. The requested return date is not a scheduled receipt. This export does not verify live stock or create inbound, reservations, stock movements, credits or financial records. Separate requests may overlap.',
  'handoff_id',result,'organization_id',p_organization_id,'created_at',saved_at,'created_by',auth.uid(),'created_by_email',actor,
  'request',jsonb_build_object('id',request.id,'created_at',request.created_at,'submitted_by',request.submitted_by,'report',request.report),
  'approval',jsonb_build_object('decision','approved','decided_at',request.decided_at,'decided_by',request.decided_by,
   'reviewer_email',request.reviewer_email,'reason',request.decision_reason,'eligibility_confirmed',true));
 insert into public.dealer_return_handoffs(id,organization_id,return_id,source_location_id,location_id,created_by,created_at,payload,search_text)
 values(result,p_organization_id,request.id,request.source_location_id,request.location_id,auth.uid(),saved_at,payload,
  app.normalize_search(concat_ws(' ',request.search_text,actor)));
 return result;
end; $$;
revoke all on function public.dealer_return_handoff_create(uuid,uuid) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.dealer_return_handoff_create(uuid,uuid) to authenticated;
