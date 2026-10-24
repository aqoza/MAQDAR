-- Step 27b: independent internal return authorization; no operational effects.
-- Rollback: remove review UI, retaining the immutable decisions and withdrawal gate.
set lock_timeout='5s';
alter table public.dealer_return_requests
 add column decision text check(decision in ('approved','rejected')),
 add column decision_reason text,
 add column decided_at timestamptz,
 add column decided_by uuid,
 add column reviewer_email text,
 add column eligibility_confirmed boolean,
 add constraint dealer_return_terminal_decision check (
  (decision is null and decision_reason is null and decided_at is null and decided_by is null
   and reviewer_email is null and eligibility_confirmed is null)
  or (decision is not null and decision_reason is not null and length(btrim(decision_reason)) between 1 and 1000
   and decided_at is not null and decided_by is not null and decided_by<>submitted_by
   and eligibility_confirmed is not null and eligibility_confirmed=(decision='approved') and withdrawn_at is null)
 );
comment on table public.dealer_return_requests is 'Immutable internal return declarations with one independent terminal review or author withdrawal. Approval authorizes the full declared return internally, without stock, receipt, credit or financial effects. Catalog/author deletion preserves evidence; organization/location deletion cascades.';

create function public.dealer_return_review(p_organization_id uuid,p_return_id uuid,p_decision text,p_reason text,p_eligibility_confirmed boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare request public.dealer_return_requests; item public.items; source public.locations; receiver public.locations; actor text;
begin
 if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.approving_organizations()))) then
  raise exception using errcode='MQ403',message='return review requires an approver'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') or p_reason is null
  or length(btrim(p_reason)) not between 1 and 1000 or p_reason ~ '[[:cntrl:]]'
  or p_eligibility_confirmed is distinct from (p_decision='approved') then
  raise exception using errcode='MQ422',message='valid decision, rationale and eligibility confirmation required'; end if;
 select * into request from public.dealer_return_requests where organization_id=p_organization_id and id=p_return_id;
 if request.id is null or (not(p_organization_id=any(array(select app.unscoped_organizations()))) and
  not(array[request.source_location_id,request.location_id] <@ array(select app.scoped_locations()))) then
  raise exception using errcode='MQ404',message='return unavailable'; end if;
 if request.submitted_by=auth.uid() then raise exception using errcode='MQ403',message='independent reviewer required'; end if;
 -- Match location-deletion lock order: catalog endpoints before their dependent request.
 -- Retries retain their original decision even when the catalog later changes.
 if request.decision is null and request.withdrawn_at is null and p_decision='approved' then
  perform 1 from public.locations where organization_id=p_organization_id and id in (request.source_location_id,request.location_id) order by id for share;
  select * into item from public.items where organization_id=p_organization_id and id=(request.report#>>'{item,id}')::uuid for share;
 end if;
 select * into request from public.dealer_return_requests where organization_id=p_organization_id and id=p_return_id for update;
 if not(p_organization_id=any(array(select app.approving_organizations()))) then
  raise exception using errcode='MQ403',message='return review requires an approver'; end if;
 if request.id is null or (not(p_organization_id=any(array(select app.unscoped_organizations()))) and
  not(array[request.source_location_id,request.location_id] <@ array(select app.scoped_locations()))) then
  raise exception using errcode='MQ404',message='return unavailable'; end if;
 if request.submitted_by=auth.uid() then raise exception using errcode='MQ403',message='independent reviewer required'; end if;
 if request.decision is not null then
  if request.decided_by=auth.uid() and request.decision=p_decision and request.decision_reason=btrim(p_reason)
   and request.eligibility_confirmed=p_eligibility_confirmed then return request.id; end if;
  raise exception using errcode='MQ409',message='return decision already recorded'; end if;
 if request.withdrawn_at is not null then raise exception using errcode='MQ409',message='return withdrawn'; end if;
 if p_decision='approved' then
  select * into source from public.locations where organization_id=p_organization_id and id=request.source_location_id;
  select * into receiver from public.locations where organization_id=p_organization_id and id=request.location_id;
  if item.id is null or item.unit_of_measure is distinct from request.report#>>'{input,unit}'
   or item.code is distinct from request.report#>>'{item,code}'
   or source.id is null or receiver.id is null or not source.is_active or not receiver.is_active
   or source.location_type<>'branch' or receiver.location_type not in ('hub','central')
   or source.code is distinct from request.report#>>'{source,code}'
   or receiver.code is distinct from request.report#>>'{receiver,code}'
   or receiver.location_type is distinct from request.report#>>'{receiver,location_type}' then
   raise exception using errcode='MQ409',message='return catalog evidence changed; create a new request'; end if;
 end if;
 select email into actor from auth.users where id=auth.uid();
 update public.dealer_return_requests set decision=p_decision,decision_reason=btrim(p_reason),
  decided_at=clock_timestamp(),decided_by=auth.uid(),reviewer_email=actor,eligibility_confirmed=p_eligibility_confirmed,
  search_text=app.normalize_search(concat_ws(' ',search_text,btrim(p_reason),actor)) where id=request.id;
 return request.id;
end; $$;
revoke all on function public.dealer_return_review(uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.dealer_return_review(uuid,uuid,text,text,boolean) to authenticated;

create or replace function public.dealer_return_withdraw(p_organization_id uuid,p_return_id uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare request public.dealer_return_requests;
begin
 if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
  raise exception using errcode='MQ404',message='return unavailable'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 or p_reason ~ '[[:cntrl:]]' then
  raise exception using errcode='MQ422',message='withdrawal reason required'; end if;
 select * into request from public.dealer_return_requests where organization_id=p_organization_id and id=p_return_id;
 if request.id is null or (not(p_organization_id=any(array(select app.unscoped_organizations()))) and
  not(array[request.source_location_id,request.location_id] <@ array(select app.scoped_locations()))) then
  raise exception using errcode='MQ404',message='return unavailable'; end if;
 if request.submitted_by<>auth.uid() then raise exception using errcode='MQ403',message='only the author may withdraw'; end if;
 select * into request from public.dealer_return_requests where organization_id=p_organization_id and id=p_return_id for update;
 if request.id is null or not(p_organization_id=any(array(select app.member_organizations()))) or
  (not(p_organization_id=any(array(select app.unscoped_organizations()))) and
  not(array[request.source_location_id,request.location_id] <@ array(select app.scoped_locations()))) then
  raise exception using errcode='MQ404',message='return unavailable'; end if;
 if request.submitted_by<>auth.uid() then raise exception using errcode='MQ403',message='only the author may withdraw'; end if;
 if request.withdrawn_at is not null then
  if request.withdrawal_reason=btrim(p_reason) then return request.id; end if;
  raise exception using errcode='MQ409',message='withdrawal already recorded'; end if;
 if request.decision is not null then raise exception using errcode='MQ409',message='return decision already recorded'; end if;
 update public.dealer_return_requests set withdrawn_at=clock_timestamp(),withdrawn_by=auth.uid(),withdrawal_reason=btrim(p_reason) where id=request.id;
 return request.id;
end; $$;
revoke all on function public.dealer_return_withdraw(uuid,uuid,text) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.dealer_return_withdraw(uuid,uuid,text) to authenticated;
