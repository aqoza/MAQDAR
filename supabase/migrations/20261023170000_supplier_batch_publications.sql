-- Step 26b: explicitly published, allowlisted ordinary purchase batches.
set lock_timeout = '5s';
create table public.supplier_batch_publications (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, batch_id uuid not null,
 supplier_id uuid not null, location_id uuid not null, handoff_ids uuid[] not null,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(), summary jsonb not null,
 withdrawn_at timestamptz, withdrawn_by uuid,
 unique(organization_id,id), unique(organization_id,batch_id),
 foreign key(organization_id,batch_id) references public.purchase_handoff_batches(organization_id,id) on delete cascade,
 foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
 check(cardinality(handoff_ids) between 1 and 50),
 check(coalesce(summary->>'schema_version'='supplier-batch-proposal-v1' and summary->>'purpose'='planning_only',false)),
 check((withdrawn_at is null)=(withdrawn_by is null))
);
create index supplier_batch_publications_portal on public.supplier_batch_publications(organization_id,supplier_id,created_at desc,id);
create index supplier_batch_publications_location on public.supplier_batch_publications(organization_id,location_id);
create index supplier_batch_publications_members on public.supplier_batch_publications using gin(handoff_ids);
alter table public.supplier_batch_publications enable row level security;
revoke all on public.supplier_batch_publications from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.supplier_batch_publications to authenticated;
create policy "members read" on public.supplier_batch_publications for select to authenticated using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.supplier_batch_publications as restrictive for select to authenticated using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.supplier_batch_publications for each row execute function app.audit_business_row();
comment on table public.supplier_batch_publications is 'Immutable allowlisted batch publication. Source handoff deletion preserves the copy; actual batch and location deletion cascade. No individual publication or operational effects.';

-- Read-only preview: all member checks use the enclosing statement snapshot.
alter function public.supplier_publication_preview(uuid,uuid) stable;
create function public.supplier_batch_publication_preview(p_organization_id uuid,p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.purchase_handoff_batches; h public.purchase_handoffs; line jsonb; preview jsonb;
 lines jsonb:='[]'; fingerprints jsonb:='[]'; total numeric:=0; data jsonb;
begin
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 select * into b from public.purchase_handoff_batches where organization_id=p_organization_id and id=p_batch_id
  and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
 if not found then raise exception using errcode='MQ404',message='batch unavailable'; end if;
 if coalesce(jsonb_array_length(b.payload->'lines'),0)<>cardinality(b.handoff_ids)
  or (select array_agg((value->>'handoff_id')::uuid order by (value->>'handoff_id')::uuid) from jsonb_array_elements(b.payload->'lines')) is distinct from b.handoff_ids then
  raise exception using errcode='MQ409',message='batch evidence unavailable'; end if;
 for line in select value from jsonb_array_elements(b.payload->'lines') loop
  select * into h from public.purchase_handoffs where organization_id=b.organization_id and id=(line->>'handoff_id')::uuid
   and id=any(b.handoff_ids) and location_id=b.location_id;
  if not found then raise exception using errcode='MQ404',message='member handoff unavailable'; end if;
  if h.payload is distinct from line then raise exception using errcode='MQ409',message='batch evidence changed'; end if;
  if line#>>'{estimate,source,supplier_id}' is distinct from b.payload#>>'{summary,supplier_id}'
   or line#>>'{estimate,source,supplier_code}' is distinct from b.payload#>>'{summary,supplier_code}'
   or line#>>'{estimate,source,location_code}' is distinct from b.payload#>>'{summary,location_code}'
   or line#>>'{estimate,source,order_date}' is distinct from b.payload#>>'{summary,order_date}'
   or line#>>'{estimate,price,currency}' is distinct from b.payload#>>'{summary,currency}' then
   raise exception using errcode='MQ409',message='batch header evidence changed'; end if;
  preview:=public.supplier_publication_preview(p_organization_id,h.id);
  lines:=lines||jsonb_build_array(preview->'summary');
  fingerprints:=fingerprints||jsonb_build_array(preview->>'fingerprint');
  total:=total+(preview#>>'{summary,subtotal}')::numeric;
 end loop;
 if total is distinct from (b.payload#>>'{summary,subtotal}')::numeric then
  raise exception using errcode='MQ409',message='batch subtotal changed'; end if;
 data:=jsonb_build_object('schema_version','supplier-batch-proposal-v1','purpose','planning_only',
  'supplier_code',b.payload#>'{summary,supplier_code}','location_code',b.payload#>'{summary,location_code}',
  'order_date',b.payload#>'{summary,order_date}','currency',b.payload#>'{summary,currency}',
  'subtotal',b.payload#>'{summary,subtotal}','lines',lines);
 return jsonb_build_object('summary',data,'fingerprint',encode(extensions.digest(convert_to(
  jsonb_build_object('batch',b.id,'summary',data,'members',fingerprints)::text,'UTF8'),'sha256'),'hex'));
end; $$;

create function public.supplier_batch_publication_publish(p_organization_id uuid,p_batch_id uuid,p_confirmed boolean,p_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.purchase_handoff_batches; result uuid; preview jsonb;
begin
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 if p_confirmed is distinct from true then raise exception using errcode='MQ422',message='sharing confirmation required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('maqdar.purchase-review:'||p_organization_id::text,0));
 perform app.lock_memberships(p_organization_id);
 select * into b from public.purchase_handoff_batches where organization_id=p_organization_id and id=p_batch_id
  and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations()))) for share;
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 if b.id is null then raise exception using errcode='MQ404',message='batch unavailable'; end if;
 select id into result from public.supplier_batch_publications where organization_id=p_organization_id and batch_id=p_batch_id;
 -- Access is rechecked, but a retry never refreshes or republishes the copied summary.
 if found then return result; end if;
 perform 1 from public.purchase_handoffs where organization_id=b.organization_id and id=any(b.handoff_ids) order by id for share;
 preview:=public.supplier_batch_publication_preview(p_organization_id,p_batch_id);
 if p_fingerprint is null or p_fingerprint is distinct from preview->>'fingerprint' then
  raise exception using errcode='MQ409',message='refresh publication preview'; end if;
 insert into public.supplier_batch_publications(organization_id,batch_id,supplier_id,location_id,handoff_ids,created_by,summary)
 values(b.organization_id,b.id,(b.payload#>>'{summary,supplier_id}')::uuid,b.location_id,b.handoff_ids,auth.uid(),preview->'summary') returning id into result;
 return result;
end; $$;

create function public.supplier_batch_publication_withdraw(p_organization_id uuid,p_publication_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare p public.supplier_batch_publications;
begin
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 perform app.lock_memberships(p_organization_id);
 select * into p from public.supplier_batch_publications where organization_id=p_organization_id and id=p_publication_id
  and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations()))) for update;
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 if p.id is null then raise exception using errcode='MQ404',message='publication unavailable'; end if;
 update public.supplier_batch_publications set withdrawn_at=clock_timestamp(),withdrawn_by=auth.uid() where id=p.id and withdrawn_at is null;
end; $$;

-- v1 single-handoff reader remains unchanged. The new feed includes both package kinds.
create function public.supplier_portal_publications(p_grant_id uuid,p_page integer default 1,p_size integer default 25,p_publication_id uuid default null)
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
 with visible as materialized (
  select p.id,p.created_at,'handoff'::text as kind,p.summary,array[p.handoff_id] as members
   from public.supplier_publications p where p.organization_id=g.organization_id and p.supplier_id=g.supplier_id and p.withdrawn_at is null
  union all
  select p.id,p.created_at,'batch',p.summary,p.handoff_ids from public.supplier_batch_publications p
   where p.organization_id=g.organization_id and p.supplier_id=g.supplier_id and p.withdrawn_at is null
 ), matching as materialized (select * from visible where p_publication_id is null or id=p_publication_id),
 paging as (select count(*) as total,least(p_page,greatest(1,ceil(count(*)::numeric/p_size)::integer)) as page from matching),
 rows as (select m.* from matching m order by m.created_at desc,m.id limit p_size offset (select (page-1)*p_size from paging))
 select jsonb_build_object('total',paging.total,'page',paging.page,'size',p_size,'rows',coalesce((select jsonb_agg(
  jsonb_build_object('id',r.id,'created_at',r.created_at,'kind',r.kind,'summary',r.summary,
   'overlap_count',(select count(*) from visible v where v.id<>r.id and v.members&&r.members),
   'overlaps',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'kind',v.kind) order by v.created_at desc,v.id)
    from (select id,kind,created_at from visible where id<>r.id and members&&r.members order by created_at desc,id limit 25) v),'[]'))
   order by r.created_at desc,r.id) from rows r),'[]')) into result from paging;
 return result;
end; $$;
revoke all on function public.supplier_batch_publication_preview(uuid,uuid),public.supplier_batch_publication_publish(uuid,uuid,boolean,text),
 public.supplier_batch_publication_withdraw(uuid,uuid),public.supplier_portal_publications(uuid,integer,integer,uuid)
 from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function public.supplier_batch_publication_preview(uuid,uuid),public.supplier_batch_publication_publish(uuid,uuid,boolean,text),
 public.supplier_batch_publication_withdraw(uuid,uuid),public.supplier_portal_publications(uuid,integer,integer,uuid) to authenticated;
