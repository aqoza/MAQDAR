-- Step 20b: planned dispositions of saved assessment lines, never operational stock movements.
-- Rollback: restore the prior web build; retain additive schema and review history.
set lock_timeout='5s';

create table public.excess_disposition_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  assessment_id uuid not null,
  item_id uuid not null,
  location_id uuid not null,
  kind text not null check(kind in ('supplier_return','scrap')),
  quantity numeric(18,3) not null check(quantity>0 and quantity<>'NaN'::numeric),
  reference_value numeric not null check(reference_value>=0 and reference_value not in ('NaN'::numeric,'Infinity'::numeric)),
  line jsonb not null,
  revision integer not null check(revision>0),
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
  unique(assessment_id,item_id,revision),
  foreign key(organization_id,assessment_id) references public.excess_stock_assessments(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
  check((status='pending' and decided_by is null and decided_at is null and decision_reason is null and decision_request_id is null)
    or (status<>'pending' and decided_by is not null and decided_at is not null and decision_request_id is not null
      and decision_reason is not null and length(btrim(decision_reason)) between 1 and 2000)),
  check(status not in ('approved','rejected') or decided_by<>submitted_by),
  check(status<>'withdrawn' or decided_by=submitted_by)
);
create unique index excess_disposition_one_pending on public.excess_disposition_proposals(assessment_id,item_id) where status='pending';
create index excess_disposition_created on public.excess_disposition_proposals(organization_id,created_at desc,id);
create index excess_disposition_location on public.excess_disposition_proposals(organization_id,location_id);
create index excess_disposition_approved on public.excess_disposition_proposals(assessment_id,item_id,revision desc) where status='approved';
alter table public.excess_disposition_proposals enable row level security;
revoke all on public.excess_disposition_proposals from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.excess_disposition_proposals to authenticated;
create policy "members read" on public.excess_disposition_proposals for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.excess_disposition_proposals as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.excess_disposition_proposals
  for each row execute function app.audit_business_row();
comment on table public.excess_disposition_proposals is 'Planned supplier-return or scrap quantities against immutable assessment lines. Latest approval selects a proposal for that exact assessment/item only. Separate assessments can overlap; approval neither establishes obsolescence/live availability nor reserves, writes off or moves stock. Catalog item identity is copied evidence and intentionally has no live item FK.';

-- Source evidence is already member-readable. Explicit guards also protect use from definer writes.
create function public.excess_disposition_preview(p_organization_id uuid,p_assessment_id uuid,p_item_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare source public.excess_stock_assessments; saved_line jsonb; current_report jsonb; matches boolean:=false;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='assessment line unavailable';
  end if;
  select * into source from public.excess_stock_assessments a
    where a.organization_id=p_organization_id and a.id=p_assessment_id
      and (a.organization_id=any(array(select app.unscoped_organizations())) or a.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='assessment line unavailable'; end if;
  select value into saved_line from jsonb_array_elements(source.report->'lines')
    where value->>'item_id'=p_item_id::text;
  if saved_line is null then raise exception using errcode='MQ404',message='assessment line unavailable'; end if;
  -- Compare only this line. A correction to a different item must not invalidate it.
  begin
    current_report:=public.excess_stock_preview(p_organization_id,jsonb_build_array(jsonb_build_object(
      'policy_id',saved_line#>>'{comparison,policy_id}',
      'maximum',coalesce(saved_line#>>'{override,id}','calculated'))));
    matches:=current_report->>'status'='available' and current_report->'lines'->0=saved_line
      and current_report->>'location_id'=source.location_id::text and current_report->>'cutoff'=source.cutoff::text;
  exception when sqlstate 'MQ404' or sqlstate 'MQ422' then matches:=false;
  end;
  return jsonb_build_object('assessment_id',source.id,'location_id',source.location_id,
    'location_code',source.report->>'location_code','cutoff',source.cutoff,'line',saved_line,'matches',coalesce(matches,false));
end; $$;
revoke all on function public.excess_disposition_preview(uuid,uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.excess_disposition_preview(uuid,uuid,uuid) to authenticated;

create function public.excess_disposition_submit(p_organization_id uuid,p_assessment_id uuid,p_item_id uuid,
  p_kind text,p_quantity text,p_request_id uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare source jsonb; saved_line jsonb; previous public.excess_disposition_proposals; result uuid; sequence integer; amount numeric;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='disposition requires an editor';
  end if;
  if p_assessment_id is null or p_item_id is null or p_request_id is null or p_kind is null
    or p_kind not in ('supplier_return','scrap') or p_quantity is null or p_quantity !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid disposition proposal';
  end if;
  amount:=p_quantity::numeric;
  if amount<=0 then raise exception using errcode='MQ422',message='positive disposition quantity required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.excess-disposition:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='disposition requires an editor';
  end if;
  select * into previous from public.excess_disposition_proposals p
    where p.organization_id=p_organization_id and p.request_id=p_request_id;
  if found then
    if not(previous.organization_id=any(array(select app.unscoped_organizations())) or previous.location_id=any(array(select app.scoped_locations()))) then
      raise exception using errcode='MQ404',message='proposal unavailable';
    end if;
    if previous.assessment_id=p_assessment_id and previous.item_id=p_item_id and previous.kind=p_kind
      and previous.quantity=amount and previous.submitted_by=auth.uid() and previous.reason=why then return previous.id; end if;
    raise exception using errcode='MQ409',message='proposal request conflicts';
  end if;
  source:=public.excess_disposition_preview(p_organization_id,p_assessment_id,p_item_id);
  saved_line:=source->'line';
  if saved_line#>>'{comparison,status}' is distinct from 'available'
    or coalesce((saved_line#>>'{comparison,quantity_above}')::numeric,0)<=0
    or amount>(saved_line#>>'{comparison,quantity_above}')::numeric then
    raise exception using errcode='MQ422',message='quantity exceeds saved assessment line',hint='excess_disposition_quantity';
  end if;
  if source->'matches' is distinct from 'true'::jsonb then
    raise exception using errcode='MQ409',message='assessment evidence changed',hint='excess_disposition_changed';
  end if;
  if exists(select 1 from public.excess_disposition_proposals where assessment_id=p_assessment_id and item_id=p_item_id and status='pending') then
    raise exception using errcode='MQ409',message='assessment line has a pending proposal',hint='excess_disposition_pending';
  end if;
  select coalesce(max(revision),0)+1 into sequence from public.excess_disposition_proposals where assessment_id=p_assessment_id and item_id=p_item_id;
  insert into public.excess_disposition_proposals(organization_id,assessment_id,item_id,location_id,kind,quantity,reference_value,line,revision,request_id,submitted_by,reason)
    values(p_organization_id,p_assessment_id,p_item_id,(source->>'location_id')::uuid,p_kind,amount,
      amount*(saved_line#>>'{comparison,snapshot,unit_cost}')::numeric,saved_line,sequence,p_request_id,auth.uid(),why)
    returning id into result;
  return result;
end; $$;
revoke all on function public.excess_disposition_submit(uuid,uuid,uuid,text,text,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.excess_disposition_submit(uuid,uuid,uuid,text,text,uuid,text) to authenticated;

create function public.excess_disposition_decide(p_organization_id uuid,p_proposal_id uuid,p_request_id uuid,p_decision text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare proposal public.excess_disposition_proposals; evidence jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='disposition decision requires membership';
  end if;
  if p_request_id is null or p_decision is null or p_decision not in ('approved','rejected','withdrawn')
    or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid disposition decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.excess-disposition:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='disposition decision requires membership';
  end if;
  select * into proposal from public.excess_disposition_proposals p where p.organization_id=p_organization_id and p.id=p_proposal_id
    and (p.organization_id=any(array(select app.unscoped_organizations())) or p.location_id=any(array(select app.scoped_locations()))) for update;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  if p_decision='withdrawn' then
    if proposal.submitted_by<>auth.uid() then raise exception using errcode='MQ403',message='only the author may withdraw'; end if;
  elsif proposal.submitted_by=auth.uid() or not(p_organization_id=any(array(select app.approving_organizations()))) then
    raise exception using errcode='MQ403',message='independent reviewer required';
  end if;
  if proposal.status<>'pending' then
    if proposal.decision_request_id=p_request_id and proposal.decided_by=auth.uid()
      and proposal.status=p_decision and proposal.decision_reason=why then return proposal.id; end if;
    raise exception using errcode='MQ409',message='proposal already decided';
  end if;
  if exists(select 1 from public.excess_disposition_proposals where organization_id=p_organization_id and decision_request_id=p_request_id) then
    raise exception using errcode='MQ409',message='decision request conflicts';
  end if;
  if p_decision='approved' then
    evidence:=public.excess_disposition_preview(p_organization_id,proposal.assessment_id,proposal.item_id);
    if evidence->'matches' is distinct from 'true'::jsonb or evidence->'line' is distinct from proposal.line then
      raise exception using errcode='MQ409',message='assessment evidence changed',hint='excess_disposition_changed';
    end if;
  end if;
  update public.excess_disposition_proposals set status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp(),
    decision_reason=why,decision_request_id=p_request_id where id=proposal.id;
  return proposal.id;
end; $$;
revoke all on function public.excess_disposition_decide(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.excess_disposition_decide(uuid,uuid,uuid,text,text) to authenticated;

create view public.excess_disposition_list with(security_invoker=true) as
select p.id,p.organization_id,p.assessment_id,p.item_id,p.location_id,p.kind,p.quantity::text quantity,
  p.reference_value::text reference_value,p.line#>>'{comparison,unit}' unit,
  p.line#>>'{comparison,snapshot,currency}' currency,p.line#>>'{comparison,item_code}' item_code,
  p.line#>>'{comparison,location_code}' location_code,a.cutoff,p.created_at,p.revision,p.status,
  p.status='approved' and not exists(select 1 from public.excess_disposition_proposals newer
    where newer.assessment_id=p.assessment_id and newer.item_id=p.item_id and newer.status='approved' and newer.revision>p.revision) selected,
  app.normalize_search(concat_ws(' ',p.line#>>'{comparison,item_code}',p.line#>>'{comparison,location_code}',p.reason,p.decision_reason)) search_text
from public.excess_disposition_proposals p join public.excess_stock_assessments a on a.organization_id=p.organization_id and a.id=p.assessment_id;
revoke all on public.excess_disposition_list from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.excess_disposition_list to authenticated;
reset lock_timeout;
