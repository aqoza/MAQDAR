-- Step 22. Additive, planning-only; roll back the application, retain saved evidence.
set lock_timeout='5s';

-- Integer thousandths, exact products and quotient/remainder: no floating point or
-- rounded division. UUID order breaks equal remainders independently of input order.
create function app.network_allocate(p_surplus numeric,p_lines jsonb)
returns jsonb language sql immutable set search_path='' as $$
  with inputs as (
    select (v->>'location_id')::uuid location_id, floor((v->>'gap')::numeric*1000) gap
    from jsonb_array_elements(p_lines) v
  ), budget as (
    select least(floor(greatest(p_surplus,0)*1000),sum(gap)) quantity,sum(gap) total from inputs
  ), shares as (
    select i.*,case when b.total>0 then div(b.quantity*i.gap,b.total) else 0 end base,
      case when b.total>0 then mod(b.quantity*i.gap,b.total) else 0 end remainder,b.quantity
    from inputs i cross join budget b
  ), ranked as (
    select *,row_number() over(order by remainder desc,location_id) rank,
      quantity-sum(base) over() remaining from shares
  )
  select coalesce(jsonb_agg(jsonb_build_object('location_id',location_id,
    'quantity',((base+case when rank<=remaining then 1 else 0 end)/1000)::numeric(18,3)::text)
    order by location_id),'[]'::jsonb) from ranked
$$;
revoke all on function app.network_allocate(numeric,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
-- Pure arithmetic, not an authority helper; needed by the invoker preview.
grant execute on function app.network_allocate(numeric,jsonb) to authenticated;

create function public.network_allocation_preview(
  p_organization_id uuid,p_draft_ids uuid[],p_source_policy_id uuid,p_basis text,
  p_override_id uuid default null,p_backorders text default null,
  p_commitments_confirmed boolean default null,p_lanes_confirmed boolean default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  draft_id uuid; evidence jsonb; first_evidence jsonb; lines jsonb:='[]'; shares jsonb;
  source public.locations; destination public.locations; result jsonb;
  status text:='available'; surplus numeric; total_gap numeric:=0; allocated numeric;
begin
  if auth.uid() is null then raise exception using errcode='MQ401',message='sign in required'; end if;
  if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='allocation inputs unavailable';
  end if;
  if p_draft_ids is null or cardinality(p_draft_ids) not between 1 and 20
    or array_ndims(p_draft_ids)<>1 or array_position(p_draft_ids,null) is not null
    or (select count(distinct x) from unnest(p_draft_ids) x)<>cardinality(p_draft_ids) then
    raise exception using errcode='MQ422',message='choose one to twenty distinct branch drafts';
  end if;
  for draft_id in select x from unnest(p_draft_ids) x order by x loop
    evidence:=public.redistribution_preview(p_organization_id,draft_id,p_source_policy_id,p_basis,
      p_override_id,p_backorders,p_commitments_confirmed,p_lanes_confirmed);
    if first_evidence is null then
      first_evidence:=evidence;
      select * into source from public.locations where organization_id=p_organization_id
        and id=(evidence->>'source_location_id')::uuid;
      if source.id is null or not source.is_active or source.location_type not in ('central','hub') then
        status:='source_location_unavailable';
      end if;
    end if;
    select * into destination from public.locations where organization_id=p_organization_id
      and id=(evidence->>'location_id')::uuid;
    if exists(select 1 from jsonb_array_elements(lines) v where v->>'location_id'=evidence->>'location_id') then
      raise exception using errcode='MQ422',message='choose one draft per branch';
    end if;
    if destination.id is null or not destination.is_active or destination.location_type<>'branch' then
      status:='branch_location_unavailable';
    elsif evidence->>'status'<>'available' and status='available' then status:='line_unavailable'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('draft_id',draft_id,
      'location_id',evidence->>'location_id','location_code',destination.code,
      'location_type',destination.location_type,'active',destination.is_active,
      'gap',evidence->'destination'->>'gap','quantity',null,'remaining_gap',null,
      'evidence',evidence));
  end loop;
  select jsonb_agg(v order by (v->>'location_id')::uuid) into lines from jsonb_array_elements(lines) v;
  if status='available' then
    surplus:=(first_evidence->>'source_surplus')::numeric;
    select sum((v->>'gap')::numeric) into total_gap from jsonb_array_elements(lines) v;
    shares:=app.network_allocate(surplus,lines);
    select jsonb_agg(l||jsonb_build_object('quantity',s->>'quantity',
      'remaining_gap',((l->>'gap')::numeric-(s->>'quantity')::numeric)::text)
      order by (l->>'location_id')::uuid),
      sum((s->>'quantity')::numeric)
    into lines,allocated from jsonb_array_elements(lines) l
      join jsonb_array_elements(shares) s on s->>'location_id'=l->>'location_id';
  end if;
  result:=jsonb_build_object('method','network-allocation-v1','status',status,
    'source_policy_id',p_source_policy_id,'source_location_id',source.id,
    'source_location_code',source.code,'source_location_type',source.location_type,'source_active',source.is_active,
    'item_id',first_evidence->>'source_item_id','source_policy',first_evidence->'source_policy',
    'basis',p_basis,'override_id',p_override_id,'backorders',first_evidence->>'backorders',
    'commitments_confirmed',p_commitments_confirmed,'lanes_confirmed',p_lanes_confirmed,
    'source_surplus',surplus::text,'total_gap',case when status='available' then total_gap::text end,
    'allocated',allocated::text,'remaining_surplus',(surplus-allocated)::text,
    'retained_available',case when status='available' then
      ((first_evidence->'source_policy'->'snapshot'->>'available')::numeric-p_backorders::numeric-allocated)::text end,
    'lines',lines);
  return result||jsonb_build_object('fingerprint',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
end; $$;
revoke all on function public.network_allocation_preview(uuid,uuid[],uuid,text,uuid,text,boolean,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.network_allocation_preview(uuid,uuid[],uuid,text,uuid,text,boolean,boolean) to authenticated;

create table public.network_allocation_scenarios(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  source_location_id uuid not null, required_location_ids uuid[] not null,
  request_id uuid not null, submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null check(report->>'method'='network-allocation-v1' and report->>'status'='available'),
  unique(organization_id,id),unique(organization_id,request_id),
  check(cardinality(required_location_ids) between 2 and 21 and array_position(required_location_ids,null) is null),
  foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete cascade
);
comment on table public.network_allocation_scenarios is 'Copied, immutable network allocation evidence; every saved location is required for reads. No stock reservation or transfer execution.';
create index network_allocation_recent on public.network_allocation_scenarios(organization_id,created_at desc,id);
create index network_allocation_locations on public.network_allocation_scenarios using gin(required_location_ids);
alter table public.network_allocation_scenarios enable row level security;
revoke all on public.network_allocation_scenarios from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.network_allocation_scenarios to authenticated;
create policy "members read" on public.network_allocation_scenarios for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
-- The array is derived only by the save RPC; subset comparison uses one scoped-location InitPlan.
create policy "all locations" on public.network_allocation_scenarios as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or required_location_ids <@ array(select app.scoped_locations()));
create trigger audit_business_row after insert or update or delete on public.network_allocation_scenarios for each row execute function app.audit_business_row();

-- Copied evidence survives policy/draft deletion; deleting any participating location
-- removes the whole scenario, just like existing location-bound planning history.
create function app.delete_location_network_allocations() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  delete from public.network_allocation_scenarios
    where organization_id=old.organization_id and required_location_ids @> array[old.id];
  return old;
end; $$;
revoke all on function app.delete_location_network_allocations() from public,anon,authenticated,service_role,maqdar_worker;
create trigger delete_network_allocations before delete on public.locations
  for each row execute function app.delete_location_network_allocations();

create function public.network_allocation_save(
  p_organization_id uuid,p_draft_ids uuid[],p_source_policy_id uuid,p_basis text,
  p_override_id uuid default null,p_backorders text default null,
  p_commitments_confirmed boolean default null,p_lanes_confirmed boolean default null,
  p_request_id uuid default null,p_fingerprint text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.network_allocation_scenarios; report jsonb; result uuid; required_ids uuid[];
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='allocation requires an editor';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_commitments_confirmed is distinct from true or p_lanes_confirmed is distinct from true
    or p_draft_ids is null or cardinality(p_draft_ids) not between 1 and 20
    or array_ndims(p_draft_ids)<>1 or array_position(p_draft_ids,null) is not null
    or (select count(distinct x) from unnest(p_draft_ids) x)<>cardinality(p_draft_ids)
    or p_backorders is null or p_backorders!~'^[0-9]{1,15}(\.[0-9]{1,3})?$' then
    raise exception using errcode='MQ422',message='invalid allocation request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.network-allocation:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='allocation requires an editor';
  end if;
  select * into previous from public.network_allocation_scenarios where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='allocation unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->>'fingerprint'=p_fingerprint
      and previous.report->>'source_policy_id'=p_source_policy_id::text and previous.report->>'basis'=p_basis
      and (previous.report->>'override_id')::uuid is not distinct from p_override_id
      and (previous.report->>'backorders')::numeric=p_backorders::numeric
      and (select array_agg((v->>'draft_id')::uuid order by (v->>'draft_id')::uuid) from jsonb_array_elements(previous.report->'lines') v)
        =(select array_agg(x order by x) from unnest(p_draft_ids) x) then return previous.id; end if;
    raise exception using errcode='MQ409',message='allocation request conflicts';
  end if;
  report:=public.network_allocation_preview(p_organization_id,p_draft_ids,p_source_policy_id,p_basis,
    p_override_id,p_backorders,p_commitments_confirmed,p_lanes_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='allocation unavailable'; end if;
  select array_agg(x order by x) into required_ids from (
    select (report->>'source_location_id')::uuid x union
    select (v->>'location_id')::uuid from jsonb_array_elements(report->'lines') v
  ) required;
  -- Prevent a location deletion racing the insert and leaving a dangling required-location array.
  perform 1 from public.locations where organization_id=p_organization_id and id=any(required_ids) order by id for key share;
  if (select count(*) from public.locations where organization_id=p_organization_id and id=any(required_ids))<>cardinality(required_ids) then
    raise exception using errcode='MQ409',message='locations changed; refresh preview';
  end if;
  insert into public.network_allocation_scenarios(organization_id,source_location_id,required_location_ids,request_id,submitted_by,report)
    values(p_organization_id,(report->>'source_location_id')::uuid,required_ids,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $$;
revoke all on function public.network_allocation_save(uuid,uuid[],uuid,text,uuid,text,boolean,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.network_allocation_save(uuid,uuid[],uuid,text,uuid,text,boolean,boolean,uuid,text) to authenticated;

create view public.network_allocation_list with(security_invoker=true) as
select id,organization_id,created_at,source_location_id,
  report->>'source_location_code' source_code,report->'source_policy'->>'item_code' item_code,
  report->'source_policy'->>'cutoff' cutoff,report->'source_policy'->>'unit' unit,
  report->>'allocated' allocated,jsonb_array_length(report->'lines') branch_count,
  app.normalize_search(concat_ws(' ',report->>'source_location_code',report->'source_policy'->>'item_code',
    (select string_agg(v->>'location_code',' ') from jsonb_array_elements(report->'lines') v))) search_text
from public.network_allocation_scenarios;
create view public.network_allocation_source_options with(security_invoker=true) as
select distinct p.id,p.organization_id,p.item_id,p.location_id,p.unit,p.item_code,p.cutoff,p.source_code,p.finished_at,p.maximum,
  app.normalize_search(concat_ws(' ',p.source_code,p.item_code)) search_text
from public.redistribution_source_options p join public.locations l on l.organization_id=p.organization_id and l.id=p.location_id
where l.is_active and l.location_type in ('central','hub');
create view public.network_allocation_branch_options with(security_invoker=true) as
select d.id,d.organization_id,d.location_id,p.item_id,l.code location_code,d.created_at,
  d.report->'policy'->>'unit' unit,d.report->'policy'->>'cutoff' cutoff,d.report->>'gap' gap,
  app.normalize_search(l.code) search_text,s.id source_policy_id
from public.replenishment_drafts d
join public.inventory_policies p on p.organization_id=d.organization_id and p.id=d.policy_id
join public.locations l on l.organization_id=d.organization_id and l.id=d.location_id
join public.inventory_policies s on s.organization_id=d.organization_id and s.item_id=p.item_id
  and s.unit=d.report->'policy'->>'unit' and s.evidence->'forecast'->>'to_date'=d.report->'policy'->>'cutoff'
join public.network_links n on n.organization_id=d.organization_id and n.from_location_id=s.location_id
  and n.to_location_id=d.location_id and n.is_active
where d.report->>'status'='available' and l.is_active and l.location_type='branch';
revoke all on public.network_allocation_list,public.network_allocation_source_options,public.network_allocation_branch_options from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.network_allocation_list,public.network_allocation_source_options,public.network_allocation_branch_options to authenticated;
reset lock_timeout;
