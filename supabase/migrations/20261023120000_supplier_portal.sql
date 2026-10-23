-- Step 26: additive supplier-only access, independent of organization membership.
-- Roll back the web build and revoke grants/publications; retain audit/evidence.
set lock_timeout='5s';
create table public.supplier_portal_grants (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 supplier_id uuid not null, email text not null, user_id uuid references auth.users(id) on delete cascade,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 sent_at timestamptz not null default clock_timestamp(), send_count integer not null default 1,
 expires_at timestamptz not null default (clock_timestamp()+interval '7 days'), accepted_at timestamptz,
 revoked_at timestamptz, revoked_by uuid,
 unique(organization_id,id),
 foreign key(organization_id,supplier_id) references public.suppliers(organization_id,id) on delete cascade,
 check(email=lower(btrim(email)) and char_length(email) between 3 and 254 and email !~ '[[:cntrl:]]'),
 check((accepted_at is null)=(user_id is null)), check((revoked_at is null)=(revoked_by is null)),
 check(send_count between 1 and 10)
);
create unique index supplier_portal_grants_active_email on public.supplier_portal_grants(organization_id,supplier_id,email) where revoked_at is null;
create index supplier_portal_grants_user on public.supplier_portal_grants(user_id) where revoked_at is null;
create index supplier_portal_grants_email on public.supplier_portal_grants(email) where revoked_at is null and accepted_at is null;
alter table public.supplier_portal_grants enable row level security;
revoke all on public.supplier_portal_grants from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.supplier_portal_grants to authenticated;
create policy "administrators read" on public.supplier_portal_grants for select to authenticated
 using(organization_id=any(array(select app.admin_organizations())));
create trigger audit_business_row after insert or update or delete on public.supplier_portal_grants for each row execute function app.audit_business_row();

create table public.supplier_publications (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 handoff_id uuid not null,supplier_id uuid not null,location_id uuid not null,
 created_by uuid not null,created_at timestamptz not null default clock_timestamp(), summary jsonb not null,
 withdrawn_at timestamptz,withdrawn_by uuid,
 unique(organization_id,id),unique(organization_id,handoff_id),
 foreign key(organization_id,handoff_id) references public.purchase_handoffs(organization_id,id) on delete cascade,
 foreign key(organization_id,supplier_id) references public.suppliers(organization_id,id) on delete cascade,
 foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
 check((withdrawn_at is null)=(withdrawn_by is null)),
 check((summary->>'schema_version'='supplier-proposal-v1' and summary->>'purpose'='planning_only') is true)
);
create index supplier_publications_recent on public.supplier_publications(organization_id,supplier_id,created_at desc,id);
alter table public.supplier_publications enable row level security;
revoke all on public.supplier_publications from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.supplier_publications to authenticated;
create policy "members read" on public.supplier_publications for select to authenticated
 using(organization_id=any(array(select app.member_organizations())));
create policy "location scope" on public.supplier_publications as restrictive for select to authenticated
 using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.supplier_publications for each row execute function app.audit_business_row();

-- Supplier readers receive only these explicit fields, never the internal handoff payload.
create function app.supplier_summary(p jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('schema_version','supplier-proposal-v1','purpose','planning_only',
 'item_code',p#>>'{estimate,source,item_code}','supplier_code',p#>>'{estimate,source,supplier_code}',
 'location_code',p#>>'{estimate,source,location_code}','quantity',p#>>'{estimate,source,quantity}',
 'unit',p#>>'{estimate,source,unit}','order_date',p#>>'{estimate,source,order_date}',
 'receipt_date',p#>>'{estimate,source,receipt_date}','unit_price',p#>>'{estimate,price,unit_price}',
 'currency',p#>>'{estimate,price,currency}','subtotal',p#>>'{estimate,subtotal}')
$$;
revoke all on function app.supplier_summary(jsonb) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;

create function public.supplier_portal_invite(p_organization_id uuid,p_supplier_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.supplier_portal_grants; address text:=lower(btrim(p_email));
begin
 perform app.require_role(p_organization_id,array['owner','admin']);
 if address is null or char_length(address)>254 or address !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or address ~ '[[:cntrl:]]' then
  raise exception using errcode='MQ422',message='valid email required'; end if;
 perform app.lock_memberships(p_organization_id);
 perform pg_advisory_xact_lock(hashtextextended('maqdar.supplier-portal:'||p_organization_id::text,0));
 perform app.require_role(p_organization_id,array['owner','admin']);
 perform 1 from public.suppliers where organization_id=p_organization_id and id=p_supplier_id and is_active for share;
 if not found then raise exception using errcode='MQ404',message='supplier unavailable'; end if;
 select * into g from public.supplier_portal_grants where organization_id=p_organization_id and supplier_id=p_supplier_id and email=address and revoked_at is null for update;
 if found then
  if g.accepted_at is not null then return jsonb_build_object('id',g.id,'email',g.email,'send',false); end if;
  if g.sent_at>clock_timestamp()-interval '2 minutes' or g.send_count>=10 then
   raise exception using errcode='MQ429',message='invitation rate limit'; end if;
  update public.supplier_portal_grants set sent_at=clock_timestamp(),expires_at=clock_timestamp()+interval '7 days',send_count=send_count+1 where id=g.id;
 else
  if (select count(*) from public.supplier_portal_grants where organization_id=p_organization_id and created_at>clock_timestamp()-interval '24 hours')>=100 then
   raise exception using errcode='MQ429',message='invitation daily limit'; end if;
  insert into public.supplier_portal_grants(organization_id,supplier_id,email,created_by)
   values(p_organization_id,p_supplier_id,address,auth.uid()) returning * into g;
 end if;
 return jsonb_build_object('id',g.id,'email',g.email,'send',true);
end; $$;

create function public.supplier_portal_revoke(p_organization_id uuid,p_grant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform app.require_role(p_organization_id,array['owner','admin']);
 perform app.lock_memberships(p_organization_id);
 perform pg_advisory_xact_lock(hashtextextended('maqdar.supplier-portal:'||p_organization_id::text,0));
 perform 1 from public.supplier_portal_grants where organization_id=p_organization_id and id=p_grant_id for update;
 if not found then raise exception using errcode='MQ404',message='grant unavailable'; end if;
 perform app.require_role(p_organization_id,array['owner','admin']);
 update public.supplier_portal_grants set revoked_at=clock_timestamp(),revoked_by=auth.uid() where id=p_grant_id and revoked_at is null;
end; $$;

create function public.supplier_portal_accept(p_grant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare g public.supplier_portal_grants; verified_email text;
begin
 perform app.require_user();
 select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 select * into g from public.supplier_portal_grants where id=p_grant_id and revoked_at is null
  and (user_id=auth.uid() or (accepted_at is null and email=verified_email and expires_at>clock_timestamp()));
 if not found then raise exception using errcode='MQ404',message='invitation unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('maqdar.supplier-portal:'||g.organization_id::text,0));
 select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 select * into g from public.supplier_portal_grants where id=p_grant_id and revoked_at is null for update;
 if not found or verified_email is null or (g.user_id is distinct from auth.uid() and
   (g.accepted_at is not null or g.email is distinct from verified_email or g.expires_at<=clock_timestamp())) then
  raise exception using errcode='MQ404',message='invitation unavailable'; end if;
 perform 1 from public.suppliers where organization_id=g.organization_id and id=g.supplier_id and is_active for share;
 if not found then raise exception using errcode='MQ404',message='supplier unavailable'; end if;
 if g.accepted_at is null then
  update public.supplier_portal_grants set user_id=auth.uid(),accepted_at=clock_timestamp() where id=g.id;
 end if;
end; $$;

-- No membership is created and no token org_id is trusted. Email comes from the live verified Auth row.
create function public.my_supplier_portals() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'organization_id',g.organization_id,'organization_name',o.name,
  'supplier_code',s.code,'accepted',g.accepted_at is not null,'expires_at',g.expires_at,
  'arabic_enabled',o.arabic_enabled,'default_locale',o.default_locale,'numbering_system',o.numbering_system)
  order by g.created_at,g.id),'[]')
 from public.supplier_portal_grants g join public.suppliers s on s.organization_id=g.organization_id and s.id=g.supplier_id and s.is_active
 join public.organizations o on o.id=g.organization_id
 join auth.users u on u.id=auth.uid() and u.email_confirmed_at is not null
 where g.revoked_at is null and (g.user_id=u.id or (g.accepted_at is null and g.email=lower(u.email) and g.expires_at>statement_timestamp()))
$$;

create function public.supplier_publication_preview(p_organization_id uuid,p_handoff_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.purchase_handoffs; p public.purchase_proposals; e public.purchase_cost_estimates; price jsonb; data jsonb;
begin
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 select * into h from public.purchase_handoffs where organization_id=p_organization_id and id=p_handoff_id
  and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
 if not found then raise exception using errcode='MQ404',message='handoff unavailable'; end if;
 select * into p from public.purchase_proposals where organization_id=h.organization_id and id=h.proposal_id;
 if p.status is distinct from 'approved' or exists(select 1 from public.purchase_proposals
  where organization_id=p.organization_id and draft_id=p.draft_id and status='approved' and revision>p.revision) then
  raise exception using errcode='MQ409',message='selected approval required'; end if;
 select * into e from public.purchase_cost_estimates where organization_id=h.organization_id and id=p.estimate_id;
 if e.report->>'status' is distinct from 'available' or coalesce((e.report#>>'{source,quantity}')::numeric,0)<=0
  or e.report#>'{source,policy_recalculation_required}' is distinct from 'false'::jsonb then
  raise exception using errcode='MQ409',message='positive clear estimate required'; end if;
 price:=public.purchase_cost_preview(p_organization_id,e.delivery_id,true);
 if price->>'status' is distinct from 'available' or price->>'fingerprint' is distinct from e.report->>'fingerprint'
  or h.payload->'estimate' is distinct from e.report then
  raise exception using errcode='MQ409',message='price evidence changed'; end if;
 data:=app.supplier_summary(h.payload);
 return jsonb_build_object('summary',data,'fingerprint',encode(extensions.digest(convert_to(
  jsonb_build_object('handoff',h.id,'summary',data,'price',price->>'fingerprint')::text,'UTF8'),'sha256'),'hex'));
end; $$;

create function public.supplier_publication_publish(p_organization_id uuid,p_handoff_id uuid,p_confirmed boolean,p_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare h public.purchase_handoffs; result uuid; preview jsonb;
begin
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 if p_confirmed is distinct from true then raise exception using errcode='MQ422',message='sharing confirmation required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('maqdar.purchase-review:'||p_organization_id::text,0));
 perform app.lock_memberships(p_organization_id);
 select * into h from public.purchase_handoffs where organization_id=p_organization_id and id=p_handoff_id
  and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations()))) for share;
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 if h.id is null then raise exception using errcode='MQ404',message='handoff unavailable'; end if;
 select id into result from public.supplier_publications where organization_id=p_organization_id and handoff_id=p_handoff_id;
 -- A retry never republishes a withdrawn snapshot or refreshes historical values.
 if found then return result; end if;
 preview:=public.supplier_publication_preview(p_organization_id,p_handoff_id);
 if p_fingerprint is null or p_fingerprint is distinct from preview->>'fingerprint' then
  raise exception using errcode='MQ409',message='refresh publication preview'; end if;
 insert into public.supplier_publications(organization_id,handoff_id,supplier_id,location_id,created_by,summary)
 values(p_organization_id,h.id,(h.payload#>>'{estimate,source,supplier_id}')::uuid,h.location_id,auth.uid(),preview->'summary') returning id into result;
 return result;
end; $$;

create function public.supplier_publication_withdraw(p_organization_id uuid,p_publication_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare p public.supplier_publications;
begin
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 perform app.lock_memberships(p_organization_id);
 select * into p from public.supplier_publications where organization_id=p_organization_id and id=p_publication_id
  and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations()))) for update;
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 if p.id is null then raise exception using errcode='MQ404',message='publication unavailable'; end if;
 update public.supplier_publications set withdrawn_at=clock_timestamp(),withdrawn_by=auth.uid() where id=p.id and withdrawn_at is null;
end; $$;

-- The only supplier package reader. Internal tables stay protected by member-only RLS.
-- Explicit projection prevents future internal columns/evidence from widening this contract.
create function public.supplier_portal_packages(p_grant_id uuid,p_page integer default 1,p_size integer default 25,p_publication_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare g public.supplier_portal_grants; result jsonb;
begin
 perform app.require_user();
 select a.* into g from public.supplier_portal_grants a
  join public.suppliers s on s.organization_id=a.organization_id and s.id=a.supplier_id and s.is_active
  join auth.users u on u.id=a.user_id and u.email_confirmed_at is not null
  where a.id=p_grant_id and a.user_id=auth.uid() and a.accepted_at is not null and a.revoked_at is null;
 if not found then raise exception using errcode='MQ404',message='portal unavailable'; end if;
 if p_page is null or p_page not between 1 and 100000 or p_size is null or p_size not in(25,50,100) then
  raise exception using errcode='MQ422',message='invalid page'; end if;
 with matching as materialized (
  select p.id,p.created_at,p.summary from public.supplier_publications p
   where p.organization_id=g.organization_id and p.supplier_id=g.supplier_id and p.withdrawn_at is null
   and (p_publication_id is null or p.id=p_publication_id)
 ), paging as (select count(*) as total,least(p_page,greatest(1,ceil(count(*)::numeric/p_size)::integer)) as page from matching)
 select jsonb_build_object('total',paging.total,'page',paging.page,'size',p_size,
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id)
   from (select * from matching order by created_at desc,id limit p_size offset (paging.page-1)*p_size) r),'[]')) into result from paging;
 return result;
end; $$;

revoke all on function public.supplier_portal_invite(uuid,uuid,text),public.supplier_portal_revoke(uuid,uuid),public.supplier_portal_accept(uuid),
 public.my_supplier_portals(),public.supplier_publication_preview(uuid,uuid),public.supplier_publication_publish(uuid,uuid,boolean,text),
 public.supplier_publication_withdraw(uuid,uuid),public.supplier_portal_packages(uuid,integer,integer,uuid)
 from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function public.supplier_portal_invite(uuid,uuid,text),public.supplier_portal_revoke(uuid,uuid),public.supplier_portal_accept(uuid),
 public.my_supplier_portals(),public.supplier_publication_preview(uuid,uuid),public.supplier_publication_publish(uuid,uuid,boolean,text),
 public.supplier_publication_withdraw(uuid,uuid),public.supplier_portal_packages(uuid,integer,integer,uuid) to authenticated;
comment on table public.supplier_portal_grants is 'Separate supplier authority. Never an organization membership. Verified-email acceptance, live revocation and bounded invitations.';
comment on table public.supplier_publications is 'Immutable allowlisted planning summary; withdrawal removes supplier access, never modifies approved quantities or executes an order. Source/supplier/location deletion cascades.';
