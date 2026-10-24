-- Step 27: declared internal return requests, with no inventory or financial effects.
-- Rollback: remove the entry point; retain this additive table and saved evidence.
set lock_timeout='5s';
create table public.dealer_return_requests (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 source_location_id uuid not null,
 location_id uuid not null,
 request_id uuid not null,
 submitted_by uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 withdrawn_at timestamptz,
 withdrawn_by uuid,
 withdrawal_reason text,
 report jsonb not null check(report->>'method'='dealer-return-request-v1'),
 search_text text not null,
 unique(organization_id,id), unique(organization_id,request_id),
 check(source_location_id<>location_id),
 check((withdrawn_at is null)=(withdrawn_by is null) and (withdrawn_at is null)=(withdrawal_reason is null)),
 foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete cascade,
 foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
create index dealer_returns_history on public.dealer_return_requests(organization_id,created_at desc,id);
create index dealer_returns_source on public.dealer_return_requests(organization_id,source_location_id);
create index dealer_returns_receiver on public.dealer_return_requests(organization_id,location_id);
alter table public.dealer_return_requests enable row level security;
revoke all on public.dealer_return_requests from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant select on public.dealer_return_requests to authenticated;
create policy "members read" on public.dealer_return_requests for select to authenticated
 using(organization_id=any(array(select app.member_organizations())));
create policy "source scope" on public.dealer_return_requests as restrictive for select to authenticated
 using(organization_id=any(array(select app.unscoped_organizations())) or source_location_id=any(array(select app.scoped_locations())));
create policy "destination scope" on public.dealer_return_requests as restrictive for select to authenticated
 using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.dealer_return_requests
 for each row execute function app.audit_business_row();
comment on table public.dealer_return_requests is 'Immutable internal declarations, not return eligibility, stock availability, credits or receipt. Only author withdrawal changes lifecycle. Catalog and author deletion do not erase copied evidence; organization/location deletion cascades.';

create function app.dealer_return_input(p_input jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare day date; quantity numeric;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>8192 then
  raise exception using errcode='MQ422',message='invalid return details'; end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in
  ('item_code','source_code','location_code','quantity','unit','requested_date','condition','reason','sale_reference','confirmed'))
  or exists(select 1 from unnest(array['item_code','source_code','location_code','quantity','unit','requested_date','condition','reason']) k
   where jsonb_typeof(p_input->k) is distinct from 'string')
  or btrim(p_input->>'item_code') !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'
  or btrim(p_input->>'source_code') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  or btrim(p_input->>'location_code') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  or btrim(p_input->>'source_code')=btrim(p_input->>'location_code')
  or btrim(p_input->>'quantity') !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$'
  or p_input->>'unit' not in ('EA','SET','L','KG')
  or p_input->>'requested_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or p_input->>'condition' not in ('unused','used','damaged','unknown')
  or length(btrim(p_input->>'reason')) not between 1 and 1000
  or (p_input->>'reason') ~ '[[:cntrl:]]'
  or (p_input ? 'sale_reference' and p_input->'sale_reference'<>'null'::jsonb and
   (jsonb_typeof(p_input->'sale_reference') is distinct from 'string' or length(btrim(p_input->>'sale_reference'))>200
    or (p_input->>'sale_reference') ~ '[[:cntrl:]]'))
  or p_input->'confirmed' is distinct from 'true'::jsonb then
  raise exception using errcode='MQ422',message='invalid or unconfirmed return details'; end if;
 quantity:=btrim(p_input->>'quantity')::numeric;
 if quantity<=0 then raise exception using errcode='MQ422',message='positive quantity required'; end if;
 begin
  day:=(p_input->>'requested_date')::date;
  if not isfinite(day) or day < date '0001-01-01' or day > date '9999-12-31' then raise exception 'date'; end if;
 exception when others then raise exception using errcode='MQ422',message='invalid return date'; end;
 return jsonb_build_object('item_code',btrim(p_input->>'item_code'),'source_code',btrim(p_input->>'source_code'),
  'location_code',btrim(p_input->>'location_code'),'quantity',trim_scale(quantity)::text,'unit',p_input->>'unit',
  'requested_date',day::text,'condition',p_input->>'condition','reason',btrim(p_input->>'reason'),
  'sale_reference',nullif(btrim(p_input->>'sale_reference'),''),'confirmed',true);
end; $$;
revoke all on function app.dealer_return_input(jsonb) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;

create function public.dealer_return_save(p_organization_id uuid,p_input jsonb,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare input jsonb; previous public.dealer_return_requests; item public.items; source public.locations;
 receiver public.locations; report jsonb; result uuid; actor text;
begin
 if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='return request requires an editor'; end if;
 input:=app.dealer_return_input(p_input);
 if p_request_id is null then raise exception using errcode='MQ422',message='request identifier required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('zeespare.dealer-return:'||p_organization_id::text||':'||p_request_id::text,0));
 if not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='return request requires an editor'; end if;
 select * into previous from public.dealer_return_requests where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if not(p_organization_id=any(array(select app.unscoped_organizations()))) and
   not(array[previous.source_location_id,previous.location_id] <@ array(select app.scoped_locations())) then
   raise exception using errcode='MQ404',message='return unavailable'; end if;
  if previous.submitted_by=auth.uid() and previous.report->'input'=input then return previous.id; end if;
  raise exception using errcode='MQ409',message='return request conflicts';
 end if;
 -- Serialize against catalog changes/deletion, then recheck current authority and values.
 perform 1 from public.locations where organization_id=p_organization_id and code in (input->>'source_code',input->>'location_code') order by id for share;
 select * into item from public.items where organization_id=p_organization_id and code=input->>'item_code' for share;
 select * into source from public.locations where organization_id=p_organization_id and code=input->>'source_code';
 select * into receiver from public.locations where organization_id=p_organization_id and code=input->>'location_code';
 if not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='return request requires an editor'; end if;
 if item.id is null or source.id is null or receiver.id is null or source.id=receiver.id
  or source.location_type<>'branch' or receiver.location_type not in ('central','hub')
  or not source.is_active or not receiver.is_active
  or (not(p_organization_id=any(array(select app.unscoped_organizations()))) and
   not(array[source.id,receiver.id] <@ array(select app.scoped_locations()))) then
  raise exception using errcode='MQ404',message='return inputs unavailable'; end if;
 if item.unit_of_measure is null or item.unit_of_measure is distinct from input->>'unit' then
  raise exception using errcode='MQ422',message='catalog unit must match'; end if;
 select email into actor from auth.users where id=auth.uid();
 report:=jsonb_build_object('method','dealer-return-request-v1','input',input,'author',actor,
  'item',jsonb_build_object('id',item.id,'code',item.code,'name_en',item.name_en,'name_ar',item.name_ar,'unit',item.unit_of_measure,'status',item.status),
  'source',jsonb_build_object('id',source.id,'code',source.code,'name_en',source.name_en,'name_ar',source.name_ar,'location_type',source.location_type),
  'receiver',jsonb_build_object('id',receiver.id,'code',receiver.code,'name_en',receiver.name_en,'name_ar',receiver.name_ar,'location_type',receiver.location_type));
 insert into public.dealer_return_requests(organization_id,source_location_id,location_id,request_id,submitted_by,report,search_text)
 values(p_organization_id,source.id,receiver.id,p_request_id,auth.uid(),report,
  app.normalize_search(concat_ws(' ',item.code,item.name_en,item.name_ar,source.code,receiver.code,input->>'reason',input->>'sale_reference')))
 returning id into result;
 return result;
end; $$;
revoke all on function public.dealer_return_save(uuid,jsonb,uuid) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.dealer_return_save(uuid,jsonb,uuid) to authenticated;

create function public.dealer_return_withdraw(p_organization_id uuid,p_return_id uuid,p_reason text) returns uuid
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
 update public.dealer_return_requests set withdrawn_at=clock_timestamp(),withdrawn_by=auth.uid(),withdrawal_reason=btrim(p_reason) where id=request.id;
 return request.id;
end; $$;
revoke all on function public.dealer_return_withdraw(uuid,uuid,text) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.dealer_return_withdraw(uuid,uuid,text) to authenticated;
