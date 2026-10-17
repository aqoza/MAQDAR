-- Step 16e: immutable transfer planning exports; no reservation or execution.
-- Rollback restores the prior web build and retains this additive schema/evidence.
set lock_timeout = '5s';
create table public.transfer_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  proposal_id uuid not null,
  location_id uuid not null,
  source_location_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  payload jsonb not null,
  unique(organization_id,id),
  unique(organization_id,proposal_id),
  foreign key(organization_id,proposal_id) references public.transfer_proposals(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
  foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete cascade,
  check(location_id<>source_location_id),
  check((payload->>'schema_version' = 'transfer-handoff-v1' and payload->>'purpose' = 'planning_only') is true)
);
create index transfer_handoffs_recent on public.transfer_handoffs(organization_id,created_at desc,id);
create index transfer_handoffs_location on public.transfer_handoffs(organization_id,location_id);
create index transfer_handoffs_source on public.transfer_handoffs(organization_id,source_location_id);
alter table public.transfer_handoffs enable row level security;
revoke all on public.transfer_handoffs from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.transfer_handoffs to authenticated;
create policy "members read" on public.transfer_handoffs for select to authenticated using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.transfer_handoffs as restrictive for select to authenticated using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create policy "source scope" on public.transfer_handoffs as restrictive for select to authenticated using(organization_id=any(array(select app.unscoped_organizations())) or source_location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.transfer_handoffs for each row execute function app.audit_business_row();
comment on table public.transfer_handoffs is 'One immutable as-of planning export per selected approved transfer proposal. No stock reservation, transfer order, inbound or execution. Both endpoint access is required.';

create function public.transfer_handoff_create(p_organization_id uuid,p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare proposal public.transfer_proposals; estimate public.transfer_freight_estimates;
  existing uuid; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb; current_freight jsonb;
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='transfer handoff requires an editor';
  end if;
  if p_proposal_id is null then raise exception using errcode='MQ422',message='proposal required'; end if;
  -- Share review's lock so a new approved selection cannot race export creation.
  perform pg_advisory_xact_lock(hashtextextended('maqdar.transfer-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='transfer handoff requires an editor';
  end if;
  select * into proposal from public.transfer_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations())) or
      (location_id=any(array(select app.scoped_locations())) and source_location_id=any(array(select app.scoped_locations()))));
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  select id into existing from public.transfer_handoffs where organization_id=p_organization_id and proposal_id=p_proposal_id;
  -- Retry authority is live; an existing snapshot is never recreated/reinterpreted.
  if found then return existing; end if;
  if proposal.status<>'approved' or exists(select 1 from public.transfer_proposals
    where organization_id=p_organization_id and draft_id=proposal.draft_id and status='approved' and revision>proposal.revision) then
    raise exception using errcode='MQ409',message='selected approval required',hint='transfer_selection_changed';
  end if;
  select * into estimate from public.transfer_freight_estimates where organization_id=p_organization_id and id=proposal.estimate_id
    and location_id=proposal.location_id and source_location_id=proposal.source_location_id;
  if not found or estimate.report->>'status' is distinct from 'available' or coalesce((estimate.report#>>'{source,source,quantity}')::numeric,0)<=0 then
    raise exception using errcode='MQ422',message='available positive estimate required';
  end if;
  if estimate.report#>'{source,receipts,p50,timing_review_required}' is distinct from 'false'::jsonb
    or estimate.report#>'{source,receipts,p90,timing_review_required}' is distinct from 'false'::jsonb then
    raise exception using errcode='MQ422',message='transfer timing review required',hint='transfer_timing_required';
  end if;
  current_freight:=public.transfer_freight_preview(p_organization_id,estimate.scenario_id,true);
  if current_freight->>'status' is distinct from 'available' or current_freight->>'fingerprint' is distinct from estimate.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='freight evidence changed',hint='transfer_freight_changed';
  end if;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','transfer-handoff-v1','purpose','planning_only',
    'notice','As-of planning evidence only. Not a stock reservation, transfer order, inbound quantity or arrival guarantee.',
    'handoff_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'proposal',jsonb_build_object('id',proposal.id,'revision',proposal.revision,'estimate_id',estimate.id,'redistribution_id',proposal.draft_id,
      'submitted_by',proposal.submitted_by,'submitted_at',proposal.created_at,'reason',proposal.reason,
      'approved_by',proposal.decided_by,'approved_at',proposal.decided_at,'approval_reason',proposal.decision_reason),
    'estimate',estimate.report);
  insert into public.transfer_handoffs(id,organization_id,proposal_id,location_id,source_location_id,created_by,created_at,payload)
    values(result,p_organization_id,proposal.id,proposal.location_id,proposal.source_location_id,auth.uid(),captured,snapshot);
  return result;
end; $$;
revoke all on function public.transfer_handoff_create(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.transfer_handoff_create(uuid,uuid) to authenticated;

create view public.transfer_handoff_list with(security_invoker=true) as
select h.id,h.organization_id,h.proposal_id,h.location_id,h.source_location_id,h.created_at,
  h.payload#>>'{estimate,source,source,destination,policy,item_code}' as item_code,
  h.payload#>>'{estimate,source,source,destination,policy,location_code}' as location_code,
  h.payload#>>'{estimate,source,source,source_location_code}' as source_code,
  h.payload#>>'{estimate,source,source,quantity}' as quantity,
  h.payload#>>'{estimate,source,source,destination,policy,unit}' as unit,
  h.payload#>>'{estimate,terms,currency}' as currency,(h.payload#>>'{estimate,terms,minor_units}')::integer as minor_units,
  h.payload#>>'{estimate,subtotal}' as subtotal,p.selected,
  app.normalize_search(concat_ws(' ',h.payload#>>'{estimate,source,source,destination,policy,item_code}',
    h.payload#>>'{estimate,source,source,destination,policy,location_code}',h.payload#>>'{estimate,source,source,source_location_code}')) as search_text
from public.transfer_handoffs h join public.transfer_review_list p on p.organization_id=h.organization_id and p.id=h.proposal_id;
revoke all on public.transfer_handoff_list from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.transfer_handoff_list to authenticated;
reset lock_timeout;
