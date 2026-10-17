-- Step 16d: independent planning selections, never executable transfers.
-- Rollback restores the prior web build while retaining additive schema and review evidence.
set lock_timeout = '5s';
create table public.transfer_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  estimate_id uuid not null,
  draft_id uuid not null,
  location_id uuid not null,
  source_location_id uuid not null,
  revision integer not null check(revision > 0),
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  reason text not null check(length(btrim(reason)) between 1 and 2000),
  status text not null default 'pending' check(status in ('pending','approved','rejected','withdrawn')),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  decision_request_id uuid,
  unique(organization_id,id),
  unique(organization_id,request_id),
  unique(organization_id,decision_request_id),
  unique(draft_id,revision),
  foreign key(organization_id,estimate_id) references public.transfer_freight_estimates(organization_id,id) on delete cascade,
  foreign key(organization_id,draft_id) references public.redistribution_drafts(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
  foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete cascade,
  check(location_id<>source_location_id),
  check ((status='pending' and decided_by is null and decided_at is null and decision_reason is null and decision_request_id is null)
    or (status<>'pending' and decided_by is not null and decided_at is not null and decision_request_id is not null
      and decision_reason is not null and length(btrim(decision_reason)) between 1 and 2000)),
  check(status not in ('approved','rejected') or decided_by<>submitted_by),
  check(status<>'withdrawn' or decided_by=submitted_by)
);
create unique index transfer_proposals_one_pending on public.transfer_proposals(draft_id) where status='pending';
create index transfer_proposals_org_created on public.transfer_proposals(organization_id,created_at desc,id);
create index transfer_proposals_org_estimate on public.transfer_proposals(organization_id,estimate_id);
create index transfer_proposals_org_location on public.transfer_proposals(organization_id,location_id);
create index transfer_proposals_approved on public.transfer_proposals(draft_id,revision desc) where status='approved';
create index transfer_proposals_org_source on public.transfer_proposals(organization_id,source_location_id);
alter table public.transfer_proposals enable row level security;
revoke all on public.transfer_proposals from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.transfer_proposals to authenticated;
create policy "members read" on public.transfer_proposals for select to authenticated using(organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.transfer_proposals as restrictive for select to authenticated using(organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));
create policy "source scope" on public.transfer_proposals as restrictive for select to authenticated using(organization_id = any(array(select app.unscoped_organizations())) or source_location_id = any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.transfer_proposals for each row execute function app.audit_business_row();
comment on table public.transfer_proposals is 'Immutable submitted estimate identity and one terminal decision. Latest approved revision per original draft is a planning selection only; no orders or inbound are created.';

create function public.transfer_proposal_submit(p_organization_id uuid,p_estimate_id uuid,p_request_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare source public.transfer_freight_estimates; previous public.transfer_proposals; result uuid; sequence integer; original_draft uuid; current_freight jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='transfer proposal requires an editor';
  end if;
  if p_request_id is null or p_estimate_id is null or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid transfer proposal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.transfer-review:'||p_organization_id::text,0));
  -- A waiter must use current membership and location access, including on replay.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='transfer proposal requires an editor';
  end if;
  select * into source from public.transfer_freight_estimates where organization_id=p_organization_id and id=p_estimate_id
    and (organization_id=any(array(select app.unscoped_organizations())) or (location_id=any(array(select app.scoped_locations())) and source_location_id=any(array(select app.scoped_locations()))));
  if not found then raise exception using errcode='MQ404',message='estimate unavailable'; end if;
  select * into previous from public.transfer_proposals where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if previous.estimate_id=p_estimate_id and previous.submitted_by=auth.uid() and previous.reason=why then return previous.id; end if;
    raise exception using errcode='MQ409',message='proposal request conflicts';
  end if;
  if source.report->>'status' is distinct from 'available' or coalesce((source.report#>>'{source,source,quantity}')::numeric,0)<=0 then
    raise exception using errcode='MQ422',message='choose an available positive estimate';
  end if;
  -- Derive lineage from saved rows, never from a client-supplied draft/location.
  select d.redistribution_id into original_draft from public.transfer_date_scenarios d
    join public.redistribution_drafts r on r.organization_id=d.organization_id and r.id=d.redistribution_id
      and r.location_id=d.location_id and r.source_location_id=d.source_location_id
    where d.organization_id=p_organization_id and d.id=source.scenario_id
      and d.location_id=source.location_id and d.source_location_id=source.source_location_id;
  if original_draft is null then raise exception using errcode='MQ422',message='source lineage unavailable'; end if;
  current_freight:=public.transfer_freight_preview(p_organization_id,source.scenario_id,true);
  if current_freight->>'status' is distinct from 'available' or current_freight->>'fingerprint' is distinct from source.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='freight evidence changed',hint='transfer_freight_changed';
  end if;
  if exists(select 1 from public.transfer_proposals where draft_id=original_draft and status='pending') then
    raise exception using errcode='MQ409',message='draft has a pending proposal',hint='transfer_pending';
  end if;
  select coalesce(max(revision),0)+1 into sequence from public.transfer_proposals where draft_id=original_draft;
  insert into public.transfer_proposals(organization_id,estimate_id,draft_id,location_id,source_location_id,revision,request_id,submitted_by,reason)
    values(p_organization_id,source.id,original_draft,source.location_id,source.source_location_id,sequence,p_request_id,auth.uid(),why) returning id into result;
  return result;
end; $$;
revoke all on function public.transfer_proposal_submit(uuid,uuid,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.transfer_proposal_submit(uuid,uuid,uuid,text) to authenticated;

create function public.transfer_proposal_decide(p_organization_id uuid,p_proposal_id uuid,p_request_id uuid,p_decision text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare proposal public.transfer_proposals; source public.transfer_freight_estimates; current_freight jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='transfer decision requires membership';
  end if;
  if p_request_id is null or p_decision is null or p_decision not in ('approved','rejected','withdrawn') or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid transfer decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.transfer-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='transfer decision requires membership';
  end if;
  select * into proposal from public.transfer_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations())) or (location_id=any(array(select app.scoped_locations())) and source_location_id=any(array(select app.scoped_locations())))) for update;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  if p_decision='withdrawn' then
    if proposal.submitted_by<>auth.uid() then raise exception using errcode='MQ403',message='only the author may withdraw'; end if;
  elsif proposal.submitted_by=auth.uid() or not(p_organization_id=any(array(select app.approving_organizations()))) then
    raise exception using errcode='MQ403',message='independent reviewer required';
  end if;
  if proposal.status<>'pending' then
    if proposal.decision_request_id=p_request_id and proposal.decided_by=auth.uid() and proposal.status=p_decision and proposal.decision_reason=why then return proposal.id; end if;
    raise exception using errcode='MQ409',message='proposal already decided';
  end if;
  if exists(select 1 from public.transfer_proposals where organization_id=p_organization_id and decision_request_id=p_request_id) then
    raise exception using errcode='MQ409',message='decision request conflicts';
  end if;
  if p_decision='approved' then
    select * into source from public.transfer_freight_estimates where organization_id=p_organization_id and id=proposal.estimate_id;
    if source.report#>'{source,receipts,p50,timing_review_required}' is distinct from 'false'::jsonb
      or source.report#>'{source,receipts,p90,timing_review_required}' is distinct from 'false'::jsonb then
      raise exception using errcode='MQ422',message='transfer timing review required',hint='transfer_timing_required';
    end if;
    current_freight:=public.transfer_freight_preview(p_organization_id,source.scenario_id,true);
    if current_freight->>'status' is distinct from 'available' or current_freight->>'fingerprint' is distinct from source.report->>'fingerprint' then
      raise exception using errcode='MQ409',message='freight evidence changed',hint='transfer_freight_changed';
    end if;
  end if;
  update public.transfer_proposals set status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp(),decision_reason=why,decision_request_id=p_request_id where id=proposal.id;
  return proposal.id;
end; $$;
revoke all on function public.transfer_proposal_decide(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.transfer_proposal_decide(uuid,uuid,uuid,text,text) to authenticated;

create view public.transfer_review_list with(security_invoker=true) as
select p.id,p.organization_id,p.estimate_id,p.draft_id,p.location_id,p.source_location_id,p.revision,p.created_at,p.status,
  c.report#>>'{source,source,destination,policy,item_code}' as item_code,
  c.report#>>'{source,source,destination,policy,location_code}' as location_code,
  c.report#>>'{source,source,source_location_code}' as source_code,
  c.report#>>'{source,source,destination,policy,unit}' as unit,
  c.report#>>'{source,source,quantity}' as quantity,c.report#>>'{source,dispatch,date}' as dispatch_date,
  c.report#>>'{source,receipts,p50,search,date}' as typical_receipt,c.report#>>'{source,receipts,p90,search,date}' as slow_receipt,
  c.report#>>'{terms,currency}' as currency,(c.report#>>'{terms,minor_units}')::integer as minor_units,
  c.report->>'subtotal' as subtotal,
  p.status='approved' and not exists(select 1 from public.transfer_proposals newer where newer.draft_id=p.draft_id and newer.status='approved' and newer.revision>p.revision) as selected,
  app.normalize_search(concat_ws(' ',c.report#>>'{source,source,destination,policy,item_code}',
    c.report#>>'{source,source,destination,policy,location_code}',c.report#>>'{source,source,source_location_code}')) as search_text
from public.transfer_proposals p join public.transfer_freight_estimates c on c.organization_id=p.organization_id and c.id=p.estimate_id;
revoke all on public.transfer_review_list from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.transfer_review_list to authenticated;
reset lock_timeout;
