-- Step 12a: additive review records; original numerical results remain immutable.
set lock_timeout = '5s';
alter table public.inventory_policies add constraint inventory_policies_org_id_location_key unique(organization_id,id,location_id);
create table public.policy_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  policy_id uuid not null,
  location_id uuid not null,
  revision integer not null check(revision>0),
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  reorder_point numeric(18,3) not null check(reorder_point>=0),
  order_up_to numeric(18,3) not null check(order_up_to>=reorder_point),
  reason text not null check(length(btrim(reason)) between 1 and 2000),
  status text not null default 'pending' check(status in ('pending','approved','rejected','withdrawn')),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  decision_request_id uuid,
  unique(organization_id,id),
  unique(organization_id,request_id),
  unique(organization_id,decision_request_id),
  unique(policy_id,revision),
  foreign key(organization_id,policy_id,location_id) references public.inventory_policies(organization_id,id,location_id) on delete cascade,
  check ((status='pending' and decided_by is null and decided_at is null and decision_reason is null and decision_request_id is null)
    or (status<>'pending' and decided_by is not null and decided_at is not null and decision_request_id is not null
      and decision_reason is not null and length(btrim(decision_reason)) between 1 and 2000)),
  check(status not in ('approved','rejected') or decided_by<>submitted_by),
  check(status<>'withdrawn' or decided_by=submitted_by)
);
comment on table public.policy_overrides is 'One immutable proposal and at most one terminal decision. User UUIDs retain historical identity without disclosing member emails. No automatic activation or orders.';
create unique index policy_overrides_one_pending on public.policy_overrides(policy_id) where status='pending';
create index policy_overrides_org_policy on public.policy_overrides(organization_id,policy_id,revision desc);
create index policy_overrides_approved on public.policy_overrides(policy_id,revision desc) where status='approved';
create index inventory_policies_org_location on public.inventory_policies(organization_id,location_id,id);
alter table public.policy_overrides enable row level security;
revoke all on public.policy_overrides from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.policy_overrides to authenticated;
create policy "members read" on public.policy_overrides for select to authenticated using(organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.policy_overrides as restrictive for select to authenticated using(organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.policy_overrides for each row execute function app.audit_business_row();

create function public.policy_override_submit(p_organization_id uuid,p_policy_id uuid,p_request_id uuid,p_reorder_point text,p_order_up_to text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare source public.inventory_policies; previous public.policy_overrides; result uuid; sequence integer; low numeric; high numeric; why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='policy proposal requires an editor';
  end if;
  if p_request_id is null or p_reorder_point is null or p_reorder_point!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or p_order_up_to is null or p_order_up_to!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid policy proposal';
  end if;
  low:=p_reorder_point::numeric; high:=p_order_up_to::numeric;
  if low>high then raise exception using errcode='MQ422',message='reorder reference exceeds maximum'; end if;
  -- Serialize a source's proposals and decisions. Request-key reuse across sources is also serialized.
  perform pg_advisory_xact_lock(hashtextextended('maqdar.policy-review:'||p_organization_id::text,0));
  select * into previous from public.policy_overrides where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if previous.policy_id=p_policy_id and previous.submitted_by=auth.uid() and previous.reorder_point=low
      and previous.order_up_to=high and previous.reason=why then return previous.id; end if;
    raise exception using errcode='MQ409',message='proposal request conflicts';
  end if;
  select * into source from public.inventory_policies where organization_id=p_organization_id and id=p_policy_id for update;
  if not found or source.status<>'available' then raise exception using errcode='MQ422',message='choose an available policy'; end if;
  if exists(select 1 from public.policy_overrides where policy_id=source.id and status='pending') then
    raise exception using errcode='MQ409',message='policy has a pending proposal';
  end if;
  select coalesce(max(revision),0)+1 into sequence from public.policy_overrides where policy_id=source.id;
  insert into public.policy_overrides(organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason)
  values(p_organization_id,source.id,source.location_id,sequence,p_request_id,auth.uid(),low,high,why) returning id into result;
  return result;
end; $$;
revoke all on function public.policy_override_submit(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.policy_override_submit(uuid,uuid,uuid,text,text,text) to authenticated;

create function public.policy_override_decide(p_organization_id uuid,p_override_id uuid,p_request_id uuid,p_decision text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare proposal public.policy_overrides; why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='policy decision requires membership';
  end if;
  if p_request_id is null or p_decision is null or p_decision not in ('approved','rejected','withdrawn')
    or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid policy decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.policy-review:'||p_organization_id::text,0));
  -- Live branch access also applies to an author whose role has changed.
  select * into proposal from public.policy_overrides where organization_id=p_organization_id and id=p_override_id
    and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations()))) for update;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  if p_decision='withdrawn' then
    if proposal.submitted_by<>auth.uid() then raise exception using errcode='MQ403',message='only the author may withdraw'; end if;
  elsif proposal.submitted_by=auth.uid() or not(p_organization_id=any(array(select app.approving_organizations()))) then
    raise exception using errcode='MQ403',message='independent reviewer required';
  end if;
  if proposal.status<>'pending' then
    if proposal.decision_request_id=p_request_id and proposal.decided_by=auth.uid() and proposal.status=p_decision
      and proposal.decision_reason=why then return proposal.policy_id; end if;
    raise exception using errcode='MQ409',message='proposal already decided';
  end if;
  if exists(select 1 from public.policy_overrides where organization_id=p_organization_id and decision_request_id=p_request_id) then
    raise exception using errcode='MQ409',message='decision request conflicts';
  end if;
  update public.policy_overrides set status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp(),decision_reason=why,decision_request_id=p_request_id where id=proposal.id;
  return proposal.policy_id;
end; $$;
revoke all on function public.policy_override_decide(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.policy_override_decide(uuid,uuid,uuid,text,text) to authenticated;

-- Invoker views preserve RLS and serialize decimal values as strings throughout the UI.
create view public.policy_override_history with(security_invoker=true) as
select id,organization_id,policy_id,location_id,revision,submitted_by,created_at,reorder_point::text,order_up_to::text,reason,status,decided_by,decided_at,decision_reason
from public.policy_overrides;
create view public.policy_workbench with(security_invoker=true) as
select p.id,p.organization_id,p.run_id,p.location_id,p.item_code,p.unit,p.status,r.to_date,r.finished_at,l.code as location_code,
  p.summary->'lead_time'->>'target' as calculated_reorder,p.summary->'protection'->>'target' as calculated_maximum,
  coalesce(latest.status,'none') as review_status,
  approved.reorder_point::text as approved_reorder,approved.order_up_to::text as approved_maximum,
  app.normalize_search(p.item_code) as search_text
from public.inventory_policies p
join public.planning_runs r on r.organization_id=p.organization_id and r.id=p.run_id
join public.locations l on l.organization_id=p.organization_id and l.id=p.location_id
left join lateral(select o.status from public.policy_overrides o where o.policy_id=p.id order by o.revision desc limit 1) latest on true
left join lateral(select o.reorder_point,o.order_up_to from public.policy_overrides o where o.policy_id=p.id and o.status='approved' order by o.revision desc limit 1) approved on true;
revoke all on public.policy_override_history,public.policy_workbench from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.policy_override_history,public.policy_workbench to authenticated;
comment on function app.approving_organizations() is 'Live owner/admin/approver organizations, narrowed by the active claim. Used by policy review and future ordering approvals.';
reset lock_timeout;
