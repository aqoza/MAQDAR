-- Step 26e: explicit supplier sharing of full event-adjusted selections.
-- Rollback the web entry points; retain publications/audit and revoke access if needed.
set lock_timeout='5s';
create table public.supplier_event_publications (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 handoff_id uuid not null,supplier_id uuid not null,location_id uuid not null,
 created_by uuid not null,created_at timestamptz not null default clock_timestamp(), summary jsonb not null,
 withdrawn_at timestamptz,withdrawn_by uuid,
 unique(organization_id,id),unique(organization_id,handoff_id),
 foreign key(organization_id,handoff_id) references public.event_purchase_handoffs(organization_id,id) on delete cascade,
 foreign key(organization_id,supplier_id) references public.suppliers(organization_id,id) on delete cascade,
 foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
 check((withdrawn_at is null)=(withdrawn_by is null)),
 check((summary->>'schema_version'='supplier-proposal-v1' and summary->>'purpose'='planning_only') is true)
);
create index supplier_event_publications_recent on public.supplier_event_publications(organization_id,supplier_id,created_at desc,id);
alter table public.supplier_event_publications enable row level security;
revoke all on public.supplier_event_publications from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant select on public.supplier_event_publications to authenticated;
create policy "members read" on public.supplier_event_publications for select to authenticated
 using(organization_id=any(array(select app.member_organizations())));
create policy "location scope" on public.supplier_event_publications as restrictive for select to authenticated
 using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.supplier_event_publications for each row execute function app.audit_business_row();

-- Explicit allowlist: baseline, event assumptions and internal planning evidence never leave the member boundary.
create function app.supplier_event_summary(p jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('schema_version','supplier-proposal-v1','purpose','planning_only',
 'item_code',p#>>'{estimate,source,source,draft,scenario,event,source,item_code}',
 'supplier_code',p#>>'{estimate,source,source,supplier,code}',
 'location_code',p#>>'{estimate,source,source,draft,scenario,event,source,location_code}',
 'quantity',p#>>'{estimate,adjusted,quantity}',
 'unit',p#>>'{estimate,source,source,draft,scenario,event,input,unit}',
 'order_date',p#>>'{estimate,source,order_date}','receipt_date',p#>>'{estimate,source,receipt_date}',
 'unit_price',p#>>'{estimate,price,unit_price}','currency',p#>>'{estimate,price,currency}',
 'subtotal',p#>>'{estimate,adjusted,subtotal}')
$$;
revoke all on function app.supplier_event_summary(jsonb) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;

create function public.supplier_event_publication_preview(p_organization_id uuid,p_handoff_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare h public.event_purchase_handoffs; p public.event_purchase_proposals; e public.event_purchase_cost_estimates; price jsonb; data jsonb;
begin
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 select * into h from public.event_purchase_handoffs where organization_id=p_organization_id and id=p_handoff_id
  and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
 if not found then raise exception using errcode='MQ404',message='handoff unavailable'; end if;
 select * into p from public.event_purchase_proposals where organization_id=h.organization_id and id=h.proposal_id;
 if p.status is distinct from 'approved' or exists(select 1 from public.event_purchase_proposals
  where organization_id=p.organization_id and draft_id=p.draft_id and status='approved' and revision>p.revision) then
  raise exception using errcode='MQ409',message='selected approval required'; end if;
 select * into e from public.event_purchase_cost_estimates where organization_id=h.organization_id and id=p.estimate_id;
 if e.report->>'status' is distinct from 'available' or coalesce((e.report#>>'{adjusted,quantity}')::numeric,0)<=0
  or e.report#>'{source,policy_recalculation_required}' is distinct from 'false'::jsonb
  or e.report#>'{source,event_before_receipt}' is distinct from '[]'::jsonb then
  raise exception using errcode='MQ409',message='positive clear estimate required'; end if;
 price:=public.event_purchase_cost_preview(p_organization_id,e.delivery_id,true);
 if price->>'status' is distinct from 'available' or price->>'fingerprint' is distinct from e.report->>'fingerprint'
  or h.payload->'estimate' is distinct from e.report then
  raise exception using errcode='MQ409',message='price evidence changed'; end if;
 data:=app.supplier_event_summary(h.payload);
 return jsonb_build_object('summary',data,'fingerprint',encode(extensions.digest(convert_to(
  jsonb_build_object('handoff',h.id,'summary',data,'price',price->>'fingerprint')::text,'UTF8'),'sha256'),'hex'));
end; $$;

create function public.supplier_event_publication_publish(p_organization_id uuid,p_handoff_id uuid,p_confirmed boolean,p_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare h public.event_purchase_handoffs; result uuid; preview jsonb;
begin
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 if p_confirmed is distinct from true then raise exception using errcode='MQ422',message='sharing confirmation required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('zeespare.event-purchase-review:'||p_organization_id::text,0));
 perform app.lock_memberships(p_organization_id);
 select * into h from public.event_purchase_handoffs where organization_id=p_organization_id and id=p_handoff_id
  and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations()))) for share;
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 if h.id is null then raise exception using errcode='MQ404',message='handoff unavailable'; end if;
 select id into result from public.supplier_event_publications where organization_id=p_organization_id and handoff_id=p_handoff_id;
 -- A retry never republishes a withdrawn snapshot or refreshes historical values.
 if found then return result; end if;
 -- Stabilize current pricing/active evidence before validating a new external publication.
 perform 1 from public.suppliers where organization_id=p_organization_id and id=(h.payload#>>'{estimate,price,supplier_id}')::uuid for share;
 perform 1 from public.locations where organization_id=p_organization_id and id=h.location_id for share;
 perform 1 from public.supplier_items where organization_id=p_organization_id and id=(h.payload#>>'{estimate,price,terms_id}')::uuid for share;
 preview:=public.supplier_event_publication_preview(p_organization_id,p_handoff_id);
 if p_fingerprint is null or p_fingerprint is distinct from preview->>'fingerprint' then
  raise exception using errcode='MQ409',message='refresh publication preview'; end if;
 insert into public.supplier_event_publications(organization_id,handoff_id,supplier_id,location_id,created_by,summary)
 values(p_organization_id,h.id,(h.payload#>>'{estimate,price,supplier_id}')::uuid,h.location_id,auth.uid(),preview->'summary') returning id into result;
 return result;
end; $$;

create function public.supplier_event_publication_withdraw(p_organization_id uuid,p_publication_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare p public.supplier_event_publications;
begin
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 perform app.lock_memberships(p_organization_id);
 select * into p from public.supplier_event_publications where organization_id=p_organization_id and id=p_publication_id
  and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations()))) for update;
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 if p.id is null then raise exception using errcode='MQ404',message='publication unavailable'; end if;
 update public.supplier_event_publications set withdrawn_at=clock_timestamp(),withdrawn_by=auth.uid() where id=p.id and withdrawn_at is null;
end; $$;

create function public.supplier_portal_event_publications(p_grant_id uuid,p_page integer default 1,p_size integer default 25,p_publication_id uuid default null)
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
  select p.id,p.created_at,p.summary from public.supplier_event_publications p
   where p.organization_id=g.organization_id and p.supplier_id=g.supplier_id and p.withdrawn_at is null
   and (p_publication_id is null or p.id=p_publication_id)
 ), paging as (select count(*) as total,least(p_page,greatest(1,ceil(count(*)::numeric/p_size)::integer)) as page from matching)
 select jsonb_build_object('total',paging.total,'page',paging.page,'size',p_size,
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id)
   from (select * from matching order by created_at desc,id limit p_size offset (paging.page-1)*p_size) r),'[]')) into result from paging;
 return result;
end; $$;


revoke all on function public.supplier_event_publication_preview(uuid,uuid),
 public.supplier_event_publication_publish(uuid,uuid,boolean,text),public.supplier_event_publication_withdraw(uuid,uuid),
 public.supplier_portal_event_publications(uuid,integer,integer,uuid)
 from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.supplier_event_publication_preview(uuid,uuid),
 public.supplier_event_publication_publish(uuid,uuid,boolean,text),public.supplier_event_publication_withdraw(uuid,uuid),
 public.supplier_portal_event_publications(uuid,integer,integer,uuid) to authenticated;
comment on table public.supplier_event_publications is 'Immutable full adjusted quantity/cost supplier summary. Explicit publication only; independent of ordinary publications. No event/baseline evidence, acceptance, orders or inbound.';
reset lock_timeout;
