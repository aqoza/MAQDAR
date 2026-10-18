-- Step 19h: immutable, as-of planning exports. No order or inbound writes.
set lock_timeout = '5s';
create table public.event_purchase_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  proposal_id uuid not null,
  location_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  payload jsonb not null,
  unique(organization_id,id),
  unique(organization_id,proposal_id),
  foreign key(organization_id,proposal_id) references public.event_purchase_proposals(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
  check((payload->>'schema_version' = 'event-purchase-handoff-v1' and payload->>'purpose' = 'planning_only') is true)
);
create index event_purchase_handoffs_recent on public.event_purchase_handoffs(organization_id,created_at desc,id);
create index event_purchase_handoffs_location on public.event_purchase_handoffs(organization_id,location_id);
alter table public.event_purchase_handoffs enable row level security;
revoke all on public.event_purchase_handoffs from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.event_purchase_handoffs to authenticated;
create policy "members read" on public.event_purchase_handoffs for select to authenticated using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.event_purchase_handoffs as restrictive for select to authenticated using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.event_purchase_handoffs for each row execute function app.audit_business_row();
comment on table public.event_purchase_handoffs is 'One immutable as-of planning export per approved proposal. Downloads are not orders, inbound or acknowledgments. Retry identity is the proposal itself.';

create function public.event_purchase_handoff_create(p_organization_id uuid,p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare proposal public.event_purchase_proposals; estimate public.event_purchase_cost_estimates;
  draft public.event_replenishment_drafts; scenario public.event_policy_scenarios; policy public.inventory_policies;
  supplier_scenario uuid;
  existing uuid; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb; current_price jsonb;
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='handoff requires an editor';
  end if;
  if p_proposal_id is null then raise exception using errcode='MQ422',message='proposal required'; end if;
  -- Shared with submit/decide: a new selection cannot race the handoff selection check.
  perform pg_advisory_xact_lock(hashtextextended('maqdar.event-purchase-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='handoff requires an editor';
  end if;
  select * into proposal from public.event_purchase_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  select id into existing from public.event_purchase_handoffs where organization_id=p_organization_id and proposal_id=p_proposal_id;
  -- Existing exports are historical evidence. Replays still require live authority/scope,
  -- but do not reinterpret or replace the captured approval after price/selection changes.
  if found then return existing; end if;
  if proposal.status<>'approved' or exists(select 1 from public.event_purchase_proposals
      where organization_id=p_organization_id and draft_id=proposal.draft_id and status='approved' and revision>proposal.revision) then
    raise exception using errcode='MQ409',message='selected approval required',hint='handoff_selection_changed';
  end if;
  select * into estimate from public.event_purchase_cost_estimates where organization_id=p_organization_id and id=proposal.estimate_id and location_id=proposal.location_id;
  if not found or estimate.report->>'status' is distinct from 'available' or coalesce((estimate.report#>>'{adjusted,quantity}')::numeric,0)<=0 then
    raise exception using errcode='MQ422',message='available positive estimate required';
  end if;
  if estimate.report#>'{source,policy_recalculation_required}' is distinct from 'false'::jsonb then
    raise exception using errcode='MQ422',message='policy recalculation required',hint='event_purchase_policy_required';
  end if;
  if estimate.report#>'{source,event_before_receipt}' is distinct from '[]'::jsonb then
    raise exception using errcode='MQ422',message='event timing review required',hint='event_purchase_timing_required';
  end if;
  current_price:=public.event_purchase_cost_preview(p_organization_id,estimate.delivery_id,true);
  if current_price->>'status' is distinct from 'available' or current_price->>'fingerprint' is distinct from estimate.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='price evidence changed',hint='event_purchase_price_changed';
  end if;
  select s.id into supplier_scenario from public.event_delivery_scenarios d
    join public.event_supplier_scenarios s on s.organization_id=d.organization_id and s.id=d.supplier_scenario_id and s.location_id=d.location_id
    where d.organization_id=p_organization_id and d.id=estimate.delivery_id and d.location_id=proposal.location_id and s.draft_id=proposal.draft_id;
  if not found then raise exception using errcode='MQ422',message='source lineage unavailable'; end if;
  select * into draft from public.event_replenishment_drafts where organization_id=p_organization_id and id=proposal.draft_id and location_id=proposal.location_id;
  if not found then raise exception using errcode='MQ422',message='draft unavailable'; end if;
  select * into scenario from public.event_policy_scenarios where organization_id=p_organization_id and id=draft.scenario_id and location_id=proposal.location_id;
  if not found then raise exception using errcode='MQ422',message='event policy unavailable'; end if;
  select * into policy from public.inventory_policies where organization_id=p_organization_id and id=scenario.policy_id and location_id=proposal.location_id;
  if not found then raise exception using errcode='MQ422',message='policy unavailable'; end if;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','event-purchase-handoff-v1','purpose','planning_only','selected_quantity_basis','full_event_adjusted',
    'notice','As-of planning evidence only. Not an order, supplier acceptance or inbound quantity.',
    'handoff_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'proposal',jsonb_build_object('id',proposal.id,'revision',proposal.revision,'estimate_id',estimate.id,'draft_id',draft.id,
      'submitted_by',proposal.submitted_by,'submitted_at',proposal.created_at,'reason',proposal.reason,
      'approved_by',proposal.decided_by,'approved_at',proposal.decided_at,'approval_reason',proposal.decision_reason),
    'evidence',jsonb_build_object('event_id',scenario.event_id,'event_policy_id',scenario.id,'delivery_id',estimate.delivery_id,
      'supplier_scenario_id',supplier_scenario,'policy_id',policy.id,'forecast_id',policy.forecast_id,'draft_fingerprint',draft.report->>'fingerprint'),
    'estimate',estimate.report);
  insert into public.event_purchase_handoffs(id,organization_id,proposal_id,location_id,created_by,created_at,payload)
    values(result,p_organization_id,proposal.id,proposal.location_id,auth.uid(),captured,snapshot);
  return result;
end; $$;
revoke all on function public.event_purchase_handoff_create(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_purchase_handoff_create(uuid,uuid) to authenticated;

create view public.event_purchase_handoff_list with(security_invoker=true) as
select h.id,h.organization_id,h.proposal_id,h.location_id,h.created_at,
  h.payload#>>'{estimate,source,source,draft,scenario,event,source,item_code}' as item_code,
  h.payload#>>'{estimate,source,source,draft,scenario,event,source,location_code}' as location_code,
  h.payload#>>'{estimate,source,source,supplier,code}' as supplier_code,
  h.payload#>>'{estimate,adjusted,quantity}' as quantity,h.payload#>>'{estimate,source,source,draft,scenario,event,input,unit}' as unit,
  h.payload#>>'{estimate,price,currency}' as currency,(h.payload#>>'{estimate,price,minor_units}')::integer as minor_units,
  h.payload#>>'{estimate,adjusted,subtotal}' as subtotal,p.selected,
  h.payload#>>'{estimate,source,source,draft,scenario,event,input,name}' as event_name,
  app.normalize_search(concat_ws(' ',h.payload#>>'{estimate,source,source,draft,scenario,event,source,item_code}',h.payload#>>'{estimate,source,source,draft,scenario,event,input,name}')) as search_text
from public.event_purchase_handoffs h join public.event_purchase_review_list p on p.organization_id=h.organization_id and p.id=h.proposal_id;
revoke all on public.event_purchase_handoff_list from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.event_purchase_handoff_list to authenticated;
reset lock_timeout;
