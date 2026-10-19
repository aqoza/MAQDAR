-- Step 20c: immutable disposition planning exports. No operational writes.
-- Rollback: restore the prior web build; retain additive schema and saved history.
set lock_timeout='5s';
create table public.excess_disposition_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  proposal_id uuid not null,
  location_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  payload jsonb not null,
  unique(organization_id,id),
  unique(organization_id,proposal_id),
  foreign key(organization_id,proposal_id) references public.excess_disposition_proposals(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
  check((payload->>'schema_version'='excess-disposition-handoff-v1' and payload->>'purpose'='planning_only') is true)
);
create index excess_disposition_handoffs_recent on public.excess_disposition_handoffs(organization_id,created_at desc,id);
create index excess_disposition_handoffs_location on public.excess_disposition_handoffs(organization_id,location_id);
alter table public.excess_disposition_handoffs enable row level security;
revoke all on public.excess_disposition_handoffs from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.excess_disposition_handoffs to authenticated;
create policy "members read" on public.excess_disposition_handoffs for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.excess_disposition_handoffs as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.excess_disposition_handoffs
  for each row execute function app.audit_business_row();
comment on table public.excess_disposition_handoffs is 'One immutable planning handoff per disposition approval. Reference value is neither recovery proceeds nor an accounting write-off. Exports do not establish supplier eligibility or live availability, reserve stock, create returns or move stock. Parent assessment/proposal and location deletion cascades.';

create function public.excess_disposition_handoff_create(p_organization_id uuid,p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare proposal public.excess_disposition_proposals; assessment public.excess_stock_assessments;
  evidence jsonb; comparison jsonb; existing uuid; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='handoff requires an editor';
  end if;
  if p_proposal_id is null then raise exception using errcode='MQ422',message='proposal required'; end if;
  -- Serialize with submit/decide so a replacement approval cannot race selection.
  perform pg_advisory_xact_lock(hashtextextended('maqdar.excess-disposition:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='handoff requires an editor';
  end if;
  select * into proposal from public.excess_disposition_proposals p
    where p.organization_id=p_organization_id and p.id=p_proposal_id
      and (p.organization_id=any(array(select app.unscoped_organizations())) or p.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  select id into existing from public.excess_disposition_handoffs
    where organization_id=p_organization_id and proposal_id=p_proposal_id;
  -- Retries require live authority and scope, but preserve original historical evidence.
  if found then return existing; end if;
  if proposal.status<>'approved' or exists(select 1 from public.excess_disposition_proposals newer
      where newer.organization_id=p_organization_id and newer.assessment_id=proposal.assessment_id
        and newer.item_id=proposal.item_id and newer.status='approved' and newer.revision>proposal.revision) then
    raise exception using errcode='MQ409',message='selected approval required',hint='handoff_selection_changed';
  end if;
  evidence:=public.excess_disposition_preview(p_organization_id,proposal.assessment_id,proposal.item_id);
  if evidence->'matches' is distinct from 'true'::jsonb or evidence->'line' is distinct from proposal.line then
    raise exception using errcode='MQ409',message='assessment evidence changed',hint='excess_disposition_changed';
  end if;
  select * into assessment from public.excess_stock_assessments
    where organization_id=p_organization_id and id=proposal.assessment_id and location_id=proposal.location_id;
  if not found then raise exception using errcode='MQ404',message='assessment unavailable'; end if;
  comparison:=proposal.line->'comparison';
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','excess-disposition-handoff-v1','purpose','planning_only',
    'notice','As-of disposition planning evidence only. Not a supplier return, scrap execution, stock reservation or accounting write-off. Reference value is not recovery proceeds.',
    'handoff_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'proposal',jsonb_build_object('id',proposal.id,'revision',proposal.revision,'submitted_by',proposal.submitted_by,
      'submitted_at',proposal.created_at,'reason',proposal.reason,'approved_by',proposal.decided_by,
      'approved_at',proposal.decided_at,'approval_reason',proposal.decision_reason),
    'assessment',jsonb_build_object('id',assessment.id,'submitted_by',assessment.submitted_by,'created_at',assessment.created_at,
      'reason',assessment.reason,'as_of_confirmed',assessment.confirmed,'fingerprint',assessment.report->>'fingerprint'),
    'disposition',jsonb_build_object('kind',proposal.kind,'item_id',proposal.item_id,'item_code',comparison->>'item_code',
      'location_id',proposal.location_id,'location_code',comparison->>'location_code','cutoff',assessment.cutoff,
      'quantity',proposal.quantity::text,'unit',comparison->>'unit','reference_value',proposal.reference_value::text,
      'currency',comparison#>>'{snapshot,currency}'),
    'line',proposal.line);
  insert into public.excess_disposition_handoffs(id,organization_id,proposal_id,location_id,created_by,created_at,payload)
    values(result,p_organization_id,proposal.id,proposal.location_id,auth.uid(),captured,snapshot);
  return result;
end; $$;
revoke all on function public.excess_disposition_handoff_create(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.excess_disposition_handoff_create(uuid,uuid) to authenticated;

create view public.excess_disposition_handoff_list with(security_invoker=true) as
select h.id,h.organization_id,h.proposal_id,h.location_id,h.created_at,p.assessment_id,p.item_id,p.selected,
  h.payload#>>'{disposition,item_code}' item_code,h.payload#>>'{disposition,location_code}' location_code,
  h.payload#>>'{disposition,kind}' kind,h.payload#>>'{disposition,quantity}' quantity,
  h.payload#>>'{disposition,unit}' unit,h.payload#>>'{disposition,reference_value}' reference_value,
  h.payload#>>'{disposition,currency}' currency,(h.payload#>>'{disposition,cutoff}')::date cutoff,
  app.normalize_search(concat_ws(' ',h.payload#>>'{disposition,item_code}',h.payload#>>'{disposition,location_code}',
    h.payload#>>'{proposal,reason}',h.payload#>>'{proposal,approval_reason}',h.payload#>>'{assessment,reason}')) search_text
from public.excess_disposition_handoffs h join public.excess_disposition_list p on p.organization_id=h.organization_id and p.id=h.proposal_id;
revoke all on public.excess_disposition_handoff_list from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.excess_disposition_handoff_list to authenticated;
reset lock_timeout;
