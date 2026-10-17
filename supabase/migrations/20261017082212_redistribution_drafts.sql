-- Step 16: additive quantity scenarios. Roll back the web build; retain saved evidence.
set lock_timeout='5s';

create function public.redistribution_preview(
  p_organization_id uuid,p_draft_id uuid,p_source_policy_id uuid,p_basis text,p_override_id uuid default null,
  p_backorders text default null,p_commitments_confirmed boolean default null,p_lane_confirmed boolean default null
)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  d public.replenishment_drafts; destination public.inventory_policies; source public.inventory_policies;
  lane public.network_links; comparison jsonb; result jsonb; status text; cutoff date;
  backorders numeric; surplus numeric; quantity numeric; gap numeric; source_code text;
begin
  if auth.uid() is null then raise exception using errcode='MQ401',message='sign in required'; end if;
  if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='draft or source unavailable';
  end if;
  -- These predicates also apply when called by the definer save RPC: never rely on invoker RLS alone.
  select * into d from public.replenishment_drafts where organization_id=p_organization_id and id=p_draft_id
    and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='draft or source unavailable'; end if;
  select p.* into source from public.inventory_policies p join public.planning_runs r
    on r.organization_id=p.organization_id and r.id=p.run_id and r.location_id=p.location_id
    where p.organization_id=p_organization_id and p.id=p_source_policy_id and r.kind='policy' and r.status='succeeded'
      and (p.organization_id=any(array(select app.unscoped_organizations())) or p.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='draft or source unavailable'; end if;
  if p_backorders is null or p_backorders!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or p_commitments_confirmed is null or p_lane_confirmed is null
    or p_basis is null or p_basis not in ('calculated','approved')
    or (p_basis='calculated' and p_override_id is not null) or (p_basis='approved' and p_override_id is null) then
    raise exception using errcode='MQ422',message='choose maximum, additional backorders and confirmations';
  end if;
  select * into destination from public.inventory_policies where organization_id=p_organization_id and id=d.policy_id;
  select code into source_code from public.locations where organization_id=p_organization_id and id=source.location_id;
  select * into lane from public.network_links where organization_id=p_organization_id
    and from_location_id=source.location_id and to_location_id=d.location_id;
  cutoff:=(source.evidence->'forecast'->>'to_date')::date;
  backorders:=p_backorders::numeric(18,3);
  gap:=(d.report->>'gap')::numeric;
  if cutoff is not null and isfinite(cutoff) then
    comparison:=public.policy_stock_comparison(p_organization_id,source.id,cutoff,p_basis,p_override_id);
  end if;
  status:=case
    when d.report->>'status' is distinct from 'available' or gap is null or gap<0
      or d.report->'policy'->>'unit' is null
      or d.report->'policy'->'snapshot'->>'date' is distinct from d.report->'policy'->>'cutoff'
      then 'destination_unavailable'
    when source.evidence->'forecast'->>'method'='regional-v1' or source.evidence->'forecast'->'source' ? 'preparation'
      or destination.evidence->'forecast'->>'method'='regional-v1' or destination.evidence->'forecast'->'source' ? 'preparation'
      then 'prepared_group'
    when source.location_id=d.location_id then 'same_location'
    when source.item_id is distinct from destination.item_id then 'item_mismatch'
    when cutoff::text is distinct from d.report->'policy'->>'cutoff' then 'cutoff_mismatch'
    when comparison->>'status' is distinct from 'available' then 'source_unavailable'
    when source.unit is distinct from d.report->'policy'->>'unit' then 'unit_mismatch'
    when comparison->'snapshot'->>'date' is distinct from cutoff::text then 'stock_date_mismatch'
    when lane.id is null then 'lane_missing'
    when not lane.is_active then 'lane_inactive'
    when not p_commitments_confirmed then 'commitments_unconfirmed'
    when not p_lane_confirmed then 'lane_unconfirmed'
    else 'available' end;
  if status='available' then
    -- Inbound cannot be shipped now. Keep allocations and additional unallocated commitments separate.
    surplus:=greatest((comparison->'snapshot'->>'available')::numeric-backorders-(comparison->>'maximum')::numeric,0);
    quantity:=least(surplus,gap);
  end if;
  result:=jsonb_build_object('method','redistribution-quantity-v1','status',status,
    'draft_id',d.id,'location_id',d.location_id,'source_location_id',source.location_id,
    'source_policy_id',source.id,'source_item_id',source.item_id,'source_location_code',source_code,
    'source_policy',comparison,'destination',d.report,
    'backorders',backorders::text,'commitments_confirmed',p_commitments_confirmed,'lane_confirmed',p_lane_confirmed,
    'basis',p_basis,'override_id',p_override_id,
    'lane',case when lane.id is null then null else jsonb_build_object('id',lane.id,'active',lane.is_active,
      'from_location_id',lane.from_location_id,'to_location_id',lane.to_location_id,
      'lead_time_days_p50',lane.lead_time_days_p50,'lead_time_days_p90',lane.lead_time_days_p90,
      'freight_basis',lane.freight_basis,'freight_cost',lane.freight_cost::text,'currency',lane.currency,'updated_at',lane.updated_at) end,
    'source_surplus',surplus::text,'quantity',quantity::text);
  return result||jsonb_build_object('fingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end; $$;
revoke all on function public.redistribution_preview(uuid,uuid,uuid,text,uuid,text,boolean,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.redistribution_preview(uuid,uuid,uuid,text,uuid,text,boolean,boolean) to authenticated;

create table public.redistribution_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  draft_id uuid not null,
  location_id uuid not null,
  source_policy_id uuid not null,
  source_location_id uuid not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null check(report->>'status'='available' and report->>'method'='redistribution-quantity-v1'),
  unique(organization_id,id),
  unique(organization_id,request_id),
  check(source_location_id<>location_id),
  foreign key(organization_id,draft_id) references public.replenishment_drafts(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
  foreign key(organization_id,source_policy_id,source_location_id) references public.inventory_policies(organization_id,id,location_id) on delete cascade
);
comment on table public.redistribution_drafts is 'Immutable quantity scenarios requiring access to both locations. Does not reserve stock, schedule transfers, change inbound or execute orders.';
create index redistribution_drafts_recent on public.redistribution_drafts(organization_id,created_at desc,id);
create index redistribution_drafts_destination on public.redistribution_drafts(organization_id,location_id,draft_id);
create index redistribution_drafts_source on public.redistribution_drafts(organization_id,source_location_id,source_policy_id);
alter table public.redistribution_drafts enable row level security;
revoke all on public.redistribution_drafts from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.redistribution_drafts to authenticated;
create policy "members read" on public.redistribution_drafts for select to authenticated using(organization_id=any(array(select app.member_organizations())));
-- Separate restrictive predicates AND together: either endpoint alone must never expose a draft.
create policy "destination scope" on public.redistribution_drafts as restrictive for select to authenticated using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create policy "source scope" on public.redistribution_drafts as restrictive for select to authenticated using(organization_id=any(array(select app.unscoped_organizations())) or source_location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.redistribution_drafts for each row execute function app.audit_business_row();

create function public.redistribution_save(
  p_organization_id uuid,p_draft_id uuid,p_source_policy_id uuid,p_basis text,p_override_id uuid default null,
  p_backorders text default null,p_commitments_confirmed boolean default null,p_lane_confirmed boolean default null,p_request_id uuid default null,p_fingerprint text default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.redistribution_drafts; report jsonb; result uuid;
begin
  if p_organization_id is null or auth.uid() is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='draft requires an editor';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_backorders is null or p_backorders!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or p_commitments_confirmed is distinct from true or p_lane_confirmed is distinct from true
    or p_draft_id is null or p_source_policy_id is null
    or p_basis is null or p_basis not in ('calculated','approved')
    or (p_basis='calculated' and p_override_id is not null) or (p_basis='approved' and p_override_id is null) then
    raise exception using errcode='MQ422',message='invalid redistribution request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.redistribution:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='draft requires an editor';
  end if;
  select * into previous from public.redistribution_drafts where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and (not(previous.location_id=any(array(select app.scoped_locations())))
        or not(previous.source_location_id=any(array(select app.scoped_locations())))) then
      raise exception using errcode='MQ404',message='draft unavailable';
    end if;
    if previous.draft_id=p_draft_id and previous.source_policy_id=p_source_policy_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint and previous.report->>'basis'=p_basis
      and (previous.report->>'override_id')::uuid is not distinct from p_override_id
      and (previous.report->>'backorders')::numeric=p_backorders::numeric then return previous.id; end if;
    raise exception using errcode='MQ409',message='redistribution request conflicts';
  end if;
  report:=public.redistribution_preview(p_organization_id,p_draft_id,p_source_policy_id,p_basis,p_override_id,p_backorders,p_commitments_confirmed,p_lane_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='choose an available redistribution preview'; end if;
  insert into public.redistribution_drafts(organization_id,draft_id,location_id,source_policy_id,source_location_id,request_id,submitted_by,report)
    values(p_organization_id,p_draft_id,(report->>'location_id')::uuid,p_source_policy_id,(report->>'source_location_id')::uuid,p_request_id,auth.uid(),report)
    returning id into result;
  return result;
end; $$;
revoke all on function public.redistribution_save(uuid,uuid,uuid,text,uuid,text,boolean,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.redistribution_save(uuid,uuid,uuid,text,uuid,text,boolean,boolean,uuid,text) to authenticated;

create view public.redistribution_draft_list with(security_invoker=true) as
select id,organization_id,draft_id,location_id,source_location_id,source_policy_id,created_at,
  report->'destination'->'policy'->>'item_code' item_code,
  report->'destination'->'policy'->>'location_code' destination_code,
  report->>'source_location_code' source_code,
  report->'destination'->'policy'->>'cutoff' cutoff,
  report->'destination'->'policy'->>'unit' unit,report->>'quantity' quantity,
  app.normalize_search(concat_ws(' ',report->'destination'->'policy'->>'item_code',
    report->'destination'->'policy'->>'location_code',report->>'source_location_code')) search_text
from public.redistribution_drafts;

-- A bounded, paginated picker; both endpoint joins preserve location RLS. No stock claim until preview.
create view public.redistribution_source_options with(security_invoker=true) as
select p.id,p.organization_id,p.item_id,p.location_id,n.to_location_id,p.unit,p.item_code,
  p.evidence->'forecast'->>'to_date' cutoff,l.code source_code,r.finished_at,
  p.summary->'protection'->>'target' maximum,n.id lane_id,n.lead_time_days_p50,n.lead_time_days_p90,
  app.normalize_search(l.code) search_text
from public.inventory_policies p
join public.planning_runs r on r.organization_id=p.organization_id and r.id=p.run_id and r.location_id=p.location_id
join public.locations l on l.organization_id=p.organization_id and l.id=p.location_id
join public.network_links n on n.organization_id=p.organization_id and n.from_location_id=p.location_id
join public.locations target on target.organization_id=n.organization_id and target.id=n.to_location_id
where r.kind='policy' and r.status='succeeded' and p.status='available' and n.is_active
  and p.evidence->'forecast'->>'method' is distinct from 'regional-v1'
  and not(coalesce(p.evidence->'forecast'->'source' ? 'preparation',false));
revoke all on public.redistribution_draft_list,public.redistribution_source_options from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.redistribution_draft_list,public.redistribution_source_options to authenticated;
reset lock_timeout;
