-- Step 22e: immutable whole-network planning exports.
-- Additive/forward-only. Roll back the web build while retaining saved evidence.
set lock_timeout='5s';
create table public.network_transfer_handoffs(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,
  proposal_id uuid not null,source_location_id uuid not null,required_location_ids uuid[] not null,
  created_by uuid not null,created_at timestamptz not null default clock_timestamp(),payload jsonb not null,
  unique(organization_id,id),unique(organization_id,proposal_id),
  foreign key(organization_id,proposal_id) references public.network_transfer_proposals(organization_id,id) on delete cascade,
  foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete cascade,
  check(cardinality(required_location_ids) between 2 and 21 and array_position(required_location_ids,null) is null),
  check((payload->>'schema_version'='network-transfer-handoff-v1' and payload->>'purpose'='planning_only') is true)
);
create index network_handoffs_recent on public.network_transfer_handoffs(organization_id,created_at desc,id);
create index network_handoffs_source on public.network_transfer_handoffs(organization_id,source_location_id);
alter table public.network_transfer_handoffs enable row level security;
revoke all on public.network_transfer_handoffs from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.network_transfer_handoffs to authenticated;
create policy "members read" on public.network_transfer_handoffs for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "all locations" on public.network_transfer_handoffs as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or required_location_ids <@ array(select app.scoped_locations()));
create trigger audit_business_row after insert or update or delete on public.network_transfer_handoffs
  for each row execute function app.audit_business_row();
comment on table public.network_transfer_handoffs is 'One immutable planning handoff per approved whole-network proposal. Every participating location is required; no reservation, transfer order or execution.';

create function public.network_handoff_create(p_organization_id uuid,p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare proposal public.network_transfer_proposals; estimate public.network_freight_estimates;
  existing uuid; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb; current_freight jsonb;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network handoff requires an editor';
  end if;
  if p_proposal_id is null then raise exception using errcode='MQ422',message='proposal required'; end if;
  -- Share review's lock: a new selected approval cannot race a first export.
  perform pg_advisory_xact_lock(hashtextextended('maqdar.network-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network handoff requires an editor';
  end if;
  select * into proposal from public.network_transfer_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations()))
      or required_location_ids <@ array(select app.scoped_locations())) for key share;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  -- Row-lock waits, including parent deletion, must not retain obsolete authority.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network handoff requires an editor';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(proposal.required_location_ids <@ array(select app.scoped_locations())) then
    raise exception using errcode='MQ404',message='proposal unavailable';
  end if;
  select id into existing from public.network_transfer_handoffs where organization_id=p_organization_id and proposal_id=p_proposal_id;
  -- Only authority is live on a retry. Never regenerate an existing snapshot.
  if found then return existing; end if;
  if proposal.status<>'approved' or exists(select 1 from public.network_transfer_proposals
    where organization_id=p_organization_id and allocation_id=proposal.allocation_id
      and status='approved' and revision>proposal.revision) then
    raise exception using errcode='MQ409',message='selected approval required',hint='network_selection_changed';
  end if;
  select * into estimate from public.network_freight_estimates where organization_id=p_organization_id and id=proposal.estimate_id
    and source_location_id=proposal.source_location_id and required_location_ids=proposal.required_location_ids;
  if not found or app.network_review_timing_clear(estimate.report) is distinct from true then
    raise exception using errcode='MQ422',message='network timing review required',hint='network_timing_required';
  end if;
  current_freight:=public.network_freight_preview(p_organization_id,estimate.scenario_id,true);
  if current_freight->>'status' is distinct from 'available'
    or current_freight->>'fingerprint' is distinct from estimate.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='freight evidence changed',hint='network_freight_changed';
  end if;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','network-transfer-handoff-v1','purpose','planning_only',
    'notice','As-of whole-network planning evidence. Zero branches need no transfer. No stock reservation, transfer order, inbound update or arrival guarantee.',
    'handoff_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'proposal',jsonb_build_object('id',proposal.id,'revision',proposal.revision,'estimate_id',estimate.id,'allocation_id',proposal.allocation_id,
      'submitted_by',proposal.submitted_by,'submitted_at',proposal.created_at,'reason',proposal.reason,
      'approved_by',proposal.decided_by,'approved_at',proposal.decided_at,'approval_reason',proposal.decision_reason),
    'estimate',estimate.report);
  insert into public.network_transfer_handoffs(id,organization_id,proposal_id,source_location_id,required_location_ids,created_by,created_at,payload)
    values(result,p_organization_id,proposal.id,proposal.source_location_id,proposal.required_location_ids,auth.uid(),captured,snapshot);
  return result;
end; $$;
revoke all on function public.network_handoff_create(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function public.network_handoff_create(uuid,uuid) to authenticated;

create view public.network_handoff_list with(security_invoker=true) as
select h.id,h.organization_id,h.proposal_id,h.source_location_id,h.created_at,
  h.payload#>>'{estimate,source,source,source_policy,item_code}' item_code,
  h.payload#>>'{estimate,source,source,source_location_code}' source_code,
  h.payload#>>'{estimate,source,dispatch,date}' dispatch_date,
  jsonb_array_length(h.payload#>'{estimate,lines}') branch_count,
  h.payload#>>'{estimate,source,source,allocated}' quantity,
  h.payload#>>'{estimate,source,source,source_policy,unit}' unit,
  h.payload#>'{estimate,totals}' totals,p.selected,
  app.normalize_search(concat_ws(' ',h.payload#>>'{estimate,source,source,source_policy,item_code}',
    h.payload#>>'{estimate,source,source,source_location_code}',
    (select string_agg(v->>'location_code',' ') from jsonb_array_elements(h.payload#>'{estimate,lines}') v))) search_text
from public.network_transfer_handoffs h join public.network_review_list p on p.organization_id=h.organization_id and p.id=h.proposal_id;
revoke all on public.network_handoff_list from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.network_handoff_list to authenticated;
reset lock_timeout;
