-- Step 25f: whole-regional planning review, never transfer execution.
set lock_timeout='5s';

create function app.regional_review_timing_clear(report jsonb)
returns boolean language sql immutable set search_path='' as $$
  select report->>'status'='available'
    and exists(select 1 from jsonb_array_elements(report->'lines') f where (f->>'quantity')::numeric>0)
    and not exists(
      select 1 from jsonb_array_elements(report->'lines') f where (f->>'quantity')::numeric>0 and not exists(
        select 1 from jsonb_array_elements(report#>'{source,lines}') d
        where d->>'location_id'=f->>'location_id' and d->>'status'='available'
          and d#>'{receipts,p50,timing_review_required}'='false'::jsonb
          and d#>'{receipts,p90,timing_review_required}'='false'::jsonb
          and nullif(d#>>'{receipts,p50,search,date}','') is not null
          and nullif(d#>>'{receipts,p90,search,date}','') is not null
      )
    )
$$;
revoke all on function app.regional_review_timing_clear(jsonb) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function app.regional_review_timing_clear(jsonb) to authenticated;

create table public.regional_transfer_proposals(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,
  estimate_id uuid not null,sourcing_id uuid not null,
  required_location_ids uuid[] not null,
  revision integer not null check(revision>0),request_id uuid not null,submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  reason text not null check(length(btrim(reason)) between 1 and 2000),
  status text not null default 'pending' check(status in ('pending','approved','rejected','withdrawn')),
  decided_by uuid,decided_at timestamptz,decision_reason text,decision_request_id uuid,
  unique(organization_id,id),unique(organization_id,request_id),unique(organization_id,decision_request_id),
  unique(sourcing_id,revision),
  check(cardinality(required_location_ids) between 2 and 20 and array_position(required_location_ids,null) is null),
  foreign key(organization_id,estimate_id) references public.regional_freight_estimates(organization_id,id) on delete cascade,
  foreign key(organization_id,sourcing_id) references public.regional_sourcing_scenarios(organization_id,id) on delete cascade,
  check((status='pending' and decided_by is null and decided_at is null and decision_reason is null and decision_request_id is null)
    or (status<>'pending' and decided_by is not null and decided_at is not null and decision_request_id is not null
      and decision_reason is not null and length(btrim(decision_reason)) between 1 and 2000)),
  check(status not in ('approved','rejected') or decided_by<>submitted_by),
  check(status<>'withdrawn' or decided_by=submitted_by)
);
create unique index regional_transfer_one_pending on public.regional_transfer_proposals(sourcing_id) where status='pending';
create index regional_transfer_recent on public.regional_transfer_proposals(organization_id,created_at desc,id);
create index regional_transfer_estimate on public.regional_transfer_proposals(organization_id,estimate_id);
create index regional_transfer_approved on public.regional_transfer_proposals(sourcing_id,revision desc) where status='approved';
alter table public.regional_transfer_proposals enable row level security;
revoke all on public.regional_transfer_proposals from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.regional_transfer_proposals to authenticated;
create policy "members read" on public.regional_transfer_proposals for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "all locations" on public.regional_transfer_proposals as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or required_location_ids <@ array(select app.scoped_locations()));
create trigger audit_business_row after insert or update or delete on public.regional_transfer_proposals for each row execute function app.audit_business_row();
comment on table public.regional_transfer_proposals is 'One complete regional proposal, one terminal decision; latest approval per original sourcing is a planning selection only.';

create function public.regional_transfer_submit(p_organization_id uuid,p_estimate_id uuid,p_request_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare source public.regional_freight_estimates; previous public.regional_transfer_proposals;
  result uuid; sequence integer; original_sourcing uuid; current_freight jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional proposal requires an editor';
  end if;
  if p_request_id is null or p_estimate_id is null or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid regional proposal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.regional-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional proposal requires an editor';
  end if;
  select * into source from public.regional_freight_estimates where organization_id=p_organization_id and id=p_estimate_id
    and (organization_id=any(array(select app.unscoped_organizations()))
      or required_location_ids <@ array(select app.scoped_locations()));
  if not found then raise exception using errcode='MQ404',message='estimate unavailable'; end if;
  -- Parent waits must not retain obsolete role or location authority.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional proposal requires an editor';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(source.required_location_ids <@ array(select app.scoped_locations())) then
    raise exception using errcode='MQ404',message='estimate unavailable';
  end if;
  select * into previous from public.regional_transfer_proposals where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if previous.estimate_id=p_estimate_id and previous.submitted_by=auth.uid() and previous.reason=why then return previous.id; end if;
    raise exception using errcode='MQ409',message='proposal request conflicts';
  end if;
  if source.report->>'status' is distinct from 'available' or not exists(
    select 1 from jsonb_array_elements(source.report->'lines') f where (f->>'quantity')::numeric>0
  ) then raise exception using errcode='MQ422',message='choose a complete positive estimate'; end if;
  -- Derive the selection identity from the saved chain, never client locations or sourcing IDs.
  select d.sourcing_id into original_sourcing from public.regional_date_scenarios d
    join public.regional_sourcing_scenarios a on a.organization_id=d.organization_id and a.id=d.sourcing_id
    where d.organization_id=p_organization_id and d.id=source.scenario_id
      and d.required_location_ids=source.required_location_ids and a.required_location_ids=source.required_location_ids;
  if original_sourcing is null then raise exception using errcode='MQ422',message='source lineage unavailable'; end if;
  perform 1 from public.locations where organization_id=p_organization_id and id=any(source.required_location_ids) order by id for share;
  perform 1 from public.stock_regions where organization_id=p_organization_id and id=(source.report#>>'{source,source,region,id}')::uuid for share;
  perform 1 from public.network_links where organization_id=p_organization_id and id in
    (select (v#>>'{terms,id}')::uuid from jsonb_array_elements(source.report->'lines') v) order by id for share;
  perform 1 from public.regional_freight_estimates where organization_id=p_organization_id and id=source.id for key share;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional proposal requires an editor';
  end if;
  current_freight:=public.regional_freight_preview(p_organization_id,source.scenario_id,true);
  if current_freight->>'status' is distinct from 'available'
    or current_freight->>'fingerprint' is distinct from source.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='freight evidence changed',hint='regional_freight_changed';
  end if;
  if exists(select 1 from public.regional_transfer_proposals where sourcing_id=original_sourcing and status='pending') then
    raise exception using errcode='MQ409',message='sourcing has a pending proposal',hint='regional_pending';
  end if;
  select coalesce(max(revision),0)+1 into sequence from public.regional_transfer_proposals where sourcing_id=original_sourcing;
  insert into public.regional_transfer_proposals(organization_id,estimate_id,sourcing_id,
    required_location_ids,revision,request_id,submitted_by,reason)
    values(p_organization_id,source.id,original_sourcing,source.required_location_ids,
      sequence,p_request_id,auth.uid(),why) returning id into result;
  return result;
end; $$;
revoke all on function public.regional_transfer_submit(uuid,uuid,uuid,text) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function public.regional_transfer_submit(uuid,uuid,uuid,text) to authenticated;

create function public.regional_transfer_decide(p_organization_id uuid,p_proposal_id uuid,p_request_id uuid,p_decision text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare proposal public.regional_transfer_proposals; source public.regional_freight_estimates; current_freight jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='regional decision requires membership';
  end if;
  if p_proposal_id is null or p_request_id is null or p_decision is null
    or p_decision not in ('approved','rejected','withdrawn') or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid regional decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.regional-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='regional decision requires membership';
  end if;
  select * into proposal from public.regional_transfer_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations()))
      or required_location_ids <@ array(select app.scoped_locations()));
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='regional decision requires membership';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(proposal.required_location_ids <@ array(select app.scoped_locations())) then
    raise exception using errcode='MQ404',message='proposal unavailable';
  end if;
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
  if exists(select 1 from public.regional_transfer_proposals where organization_id=p_organization_id and decision_request_id=p_request_id) then
    raise exception using errcode='MQ409',message='decision request conflicts';
  end if;
  if p_decision='approved' then
    select * into source from public.regional_freight_estimates where organization_id=p_organization_id and id=proposal.estimate_id;
  perform 1 from public.locations where organization_id=p_organization_id and id=any(source.required_location_ids) order by id for share;
  perform 1 from public.stock_regions where organization_id=p_organization_id and id=(source.report#>>'{source,source,region,id}')::uuid for share;
  perform 1 from public.network_links where organization_id=p_organization_id and id in
    (select (v#>>'{terms,id}')::uuid from jsonb_array_elements(source.report->'lines') v) order by id for share;
  perform 1 from public.regional_freight_estimates where organization_id=p_organization_id and id=source.id for key share;
  end if;
  perform 1 from public.regional_transfer_proposals where organization_id=p_organization_id and id=proposal.id for update;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  -- Locks may wait behind archive, deletion or role/access changes. Recheck live authority.
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='regional decision requires membership';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(proposal.required_location_ids <@ array(select app.scoped_locations())) then
    raise exception using errcode='MQ404',message='proposal unavailable';
  end if;
  if p_decision<>'withdrawn' and not(p_organization_id=any(array(select app.approving_organizations()))) then
    raise exception using errcode='MQ403',message='independent reviewer required';
  end if;
  if p_decision='approved' then
    if app.regional_review_timing_clear(source.report) is distinct from true then
      raise exception using errcode='MQ422',message='regional timing review required',hint='regional_timing_required';
    end if;
    current_freight:=public.regional_freight_preview(p_organization_id,source.scenario_id,true);
    if current_freight->>'status' is distinct from 'available'
      or current_freight->>'fingerprint' is distinct from source.report->>'fingerprint' then
      raise exception using errcode='MQ409',message='freight evidence changed',hint='regional_freight_changed';
    end if;
  end if;
  update public.regional_transfer_proposals set status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp(),
    decision_reason=why,decision_request_id=p_request_id where id=proposal.id;
  return proposal.id;
end; $$;
revoke all on function public.regional_transfer_decide(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function public.regional_transfer_decide(uuid,uuid,uuid,text,text) to authenticated;

create view public.regional_review_list with(security_invoker=true) as
select p.id,p.organization_id,p.estimate_id,p.sourcing_id,p.revision,p.created_at,p.status,
  c.report#>>'{source,source,destination,policy,item_code}' item_code,
  c.report#>>'{source,source,destination,policy,location_code}' destination_code,
  c.report#>>'{source,source,region,name_en}' region_name,
  c.report#>>'{source,source,region,name_ar}' region_name_ar,
  c.report#>>'{source,source,destination,policy,cutoff}' cutoff,
  jsonb_array_length(c.report->'lines') source_count,
  p.status='approved' and not exists(select 1 from public.regional_transfer_proposals newer
    where newer.sourcing_id=p.sourcing_id and newer.status='approved' and newer.revision>p.revision) selected,
  app.normalize_search(concat_ws(' ',c.report#>>'{source,source,destination,policy,item_code}',
    c.report#>>'{source,source,destination,policy,location_code}',c.report#>>'{source,source,region,name_en}',
    c.report#>>'{source,source,region,name_ar}',
    (select string_agg(v->>'location_code',' ') from jsonb_array_elements(c.report->'lines') v))) search_text
from public.regional_transfer_proposals p join public.regional_freight_estimates c on c.organization_id=p.organization_id and c.id=p.estimate_id;
revoke all on public.regional_review_list from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant select on public.regional_review_list to authenticated;
reset lock_timeout;
