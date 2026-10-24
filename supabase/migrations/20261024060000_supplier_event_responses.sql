-- Step 26g: whole-publication event supplier reports, never acceptance or order execution.
set lock_timeout = '5s';
create table public.supplier_event_responses (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 publication_id uuid, batch_publication_id uuid, location_id uuid not null,
 supplier_id uuid not null, request_id uuid not null, actor_id uuid not null,
 actor_email text not null, created_at timestamptz not null default clock_timestamp(),
 revision integer not null check(revision>0), status text not null check(status in ('received','declined')),
 reference text not null default '', reason text not null default '',
 unique(organization_id,id), unique(organization_id,actor_id,request_id),
 foreign key(organization_id,publication_id) references public.supplier_event_publications(organization_id,id) on delete cascade,
 foreign key(organization_id,batch_publication_id) references public.supplier_event_batch_publications(organization_id,id) on delete cascade,
 foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
 check(num_nonnulls(publication_id,batch_publication_id)=1),
 check(char_length(reference)<=120 and reference=btrim(reference) and reference !~ '[[:cntrl:]]'),
 check(char_length(reason)<=2000 and reason=btrim(reason) and (status<>'declined' or reason ~ '[^[:space:]]'))
);
create unique index supplier_event_responses_single_revision on public.supplier_event_responses(organization_id,publication_id,revision desc) where publication_id is not null;
create unique index supplier_event_responses_batch_revision on public.supplier_event_responses(organization_id,batch_publication_id,revision desc) where batch_publication_id is not null;
create index supplier_event_responses_location on public.supplier_event_responses(organization_id,location_id);
alter table public.supplier_event_responses enable row level security;
revoke all on public.supplier_event_responses from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant select on public.supplier_event_responses to authenticated;
create policy "members read" on public.supplier_event_responses for select to authenticated using(organization_id=any(array(select app.member_organizations())));
create policy "location scope" on public.supplier_event_responses as restrictive for select to authenticated using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.supplier_event_responses for each row execute function app.audit_business_row();
comment on table public.supplier_event_responses is 'Append-only whole-publication received/declined reports. Actor evidence survives grant/account deletion; actual publication deletion cascades. No acceptance or operational effects.';

create function public.supplier_event_response_submit(p_grant_id uuid,p_kind text,p_publication_id uuid,p_request_id uuid,p_status text,p_reference text default '',p_reason text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare g public.supplier_portal_grants; existing public.supplier_event_responses; receiver uuid; author text; result uuid; next_revision integer;
 ref text:=btrim(coalesce(p_reference,'')); why text:=btrim(coalesce(p_reason,''));
begin
 perform app.require_user();
 if p_request_id is null or p_publication_id is null or p_kind is null or p_kind not in ('handoff','batch')
  or p_status is null or p_status not in ('received','declined') or char_length(ref)>120 or ref ~ '[[:cntrl:]]'
  or char_length(why)>2000 or (p_status='declined' and why !~ '[^[:space:]]') then
  raise exception using errcode='MQ422',message='invalid supplier response'; end if;
 select * into g from public.supplier_portal_grants where id=p_grant_id and user_id=auth.uid() and accepted_at is not null and revoked_at is null;
 if not found then raise exception using errcode='MQ404',message='portal unavailable'; end if;
 -- Serialize identical client requests across all publications and grants for this actor.
 perform pg_advisory_xact_lock(hashtextextended('zeespare.event-supplier-response:'||g.organization_id::text||':'||auth.uid()::text||':'||p_request_id::text,0));
 -- Lock live authority, then the publication. Revocation, inactivity and withdrawal cannot race a successful response.
 select * into g from public.supplier_portal_grants where id=p_grant_id and user_id=auth.uid() and accepted_at is not null and revoked_at is null for share;
 if not found then raise exception using errcode='MQ404',message='portal unavailable'; end if;
 select lower(email) into author from auth.users where id=auth.uid() and email_confirmed_at is not null for share;
 if not found or author is null then raise exception using errcode='MQ404',message='portal unavailable'; end if;
 perform 1 from public.suppliers where organization_id=g.organization_id and id=g.supplier_id and is_active for share;
 if not found then raise exception using errcode='MQ404',message='portal unavailable'; end if;
 if p_kind='handoff' then
  select location_id into receiver from public.supplier_event_publications where organization_id=g.organization_id and supplier_id=g.supplier_id and id=p_publication_id and withdrawn_at is null for update;
 else
  select location_id into receiver from public.supplier_event_batch_publications where organization_id=g.organization_id and supplier_id=g.supplier_id and id=p_publication_id and withdrawn_at is null for update;
 end if;
 if not found then raise exception using errcode='MQ404',message='publication unavailable'; end if;
 select * into existing from public.supplier_event_responses where organization_id=g.organization_id and actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if existing.publication_id is distinct from (case when p_kind='handoff' then p_publication_id end)
   or existing.batch_publication_id is distinct from (case when p_kind='batch' then p_publication_id end)
   or existing.status is distinct from p_status or existing.reference is distinct from ref or existing.reason is distinct from why then
   raise exception using errcode='MQ409',message='response request already used'; end if;
  return existing.id;
 end if;
 select coalesce(max(revision),0)+1 into next_revision from public.supplier_event_responses where organization_id=g.organization_id
  and (case when p_kind='handoff' then publication_id=p_publication_id else batch_publication_id=p_publication_id end);
 insert into public.supplier_event_responses(organization_id,publication_id,batch_publication_id,location_id,supplier_id,request_id,actor_id,actor_email,revision,status,reference,reason)
 values(g.organization_id,case when p_kind='handoff' then p_publication_id end,case when p_kind='batch' then p_publication_id end,receiver,g.supplier_id,p_request_id,auth.uid(),author,next_revision,p_status,ref,why) returning id into result;
 return result;
end; $$;

-- Private explicit projection; every public caller first authorizes the actual parent.
create function app.supplier_event_response_page(p_org uuid,p_kind text,p_id uuid,p_page integer)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
 if p_page is null or p_page not between 1 and 100000 then raise exception using errcode='MQ422',message='invalid page'; end if;
 with matching as materialized (
  select id,revision,status,reference,reason,actor_email as author,created_at from public.supplier_event_responses where organization_id=p_org
   and (case when p_kind='handoff' then publication_id=p_id else batch_publication_id=p_id end)
 ), paging as (select count(*) total,least(p_page,greatest(1,ceil(count(*)::numeric/25)::integer)) page from matching)
 select jsonb_build_object('total',total,'page',page,'size',25,
  'latest',(select to_jsonb(m) from matching m order by revision desc limit 1),
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by revision desc) from (select * from matching order by revision desc limit 25 offset (paging.page-1)*25) r),'[]')) into result from paging;
 return result;
end; $$;

create function public.supplier_event_response_history(p_grant_id uuid,p_kind text,p_publication_id uuid,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g public.supplier_portal_grants;
begin
 perform app.require_user();
 if p_kind is null or p_kind not in ('handoff','batch') then raise exception using errcode='MQ422',message='invalid package kind'; end if;
 select a.* into g from public.supplier_portal_grants a
  join public.suppliers s on s.organization_id=a.organization_id and s.id=a.supplier_id and s.is_active
  join auth.users u on u.id=a.user_id and u.email_confirmed_at is not null
  where a.id=p_grant_id and a.user_id=auth.uid() and a.accepted_at is not null and a.revoked_at is null;
 if not found then raise exception using errcode='MQ404',message='portal unavailable'; end if;
 if p_kind='handoff' then
  perform 1 from public.supplier_event_publications where organization_id=g.organization_id and supplier_id=g.supplier_id and id=p_publication_id and withdrawn_at is null;
 else
  perform 1 from public.supplier_event_batch_publications where organization_id=g.organization_id and supplier_id=g.supplier_id and id=p_publication_id and withdrawn_at is null;
 end if;
 if not found then raise exception using errcode='MQ404',message='publication unavailable'; end if;
 return app.supplier_event_response_page(g.organization_id,p_kind,p_publication_id,p_page);
end; $$;

create function public.supplier_event_response_history_internal(p_organization_id uuid,p_kind text,p_publication_id uuid,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform app.require_role(p_organization_id,array['owner','admin','planner','approver','viewer','branch_user']);
 if p_kind is null or p_kind not in ('handoff','batch') then raise exception using errcode='MQ422',message='invalid package kind'; end if;
 if p_kind='handoff' then
  perform 1 from public.supplier_event_publications where organization_id=p_organization_id and id=p_publication_id
   and organization_id=any(array(select app.member_organizations()))
   and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
 else
  perform 1 from public.supplier_event_batch_publications where organization_id=p_organization_id and id=p_publication_id
   and organization_id=any(array(select app.member_organizations()))
   and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
 end if;
 if not found then raise exception using errcode='MQ404',message='publication unavailable'; end if;
 return app.supplier_event_response_page(p_organization_id,p_kind,p_publication_id,p_page);
end; $$;
revoke all on function app.supplier_event_response_page(uuid,text,uuid,integer) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
revoke all on function public.supplier_event_response_submit(uuid,text,uuid,uuid,text,text,text),public.supplier_event_response_history(uuid,text,uuid,integer),public.supplier_event_response_history_internal(uuid,text,uuid,integer)
 from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.supplier_event_response_submit(uuid,text,uuid,uuid,text,text,text),public.supplier_event_response_history(uuid,text,uuid,integer),public.supplier_event_response_history_internal(uuid,text,uuid,integer) to authenticated;

reset lock_timeout;
