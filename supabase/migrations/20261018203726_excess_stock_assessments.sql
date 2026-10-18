-- Step 20: immutable, as-of excess assessments. Roll back the web build while retaining
-- these additive objects and saved history. No stock, commitments or orders are changed.
set lock_timeout='5s';

create table public.excess_stock_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  cutoff date not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  reason text not null check(length(btrim(reason)) between 1 and 2000),
  confirmed boolean not null check(confirmed),
  report jsonb not null,
  unique(organization_id,id),
  unique(organization_id,request_id),
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
create index excess_stock_created on public.excess_stock_assessments(organization_id,created_at desc,id);
create index excess_stock_location on public.excess_stock_assessments(organization_id,location_id,cutoff);
alter table public.excess_stock_assessments enable row level security;
revoke all on public.excess_stock_assessments from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.excess_stock_assessments to authenticated;
create policy "members read" on public.excess_stock_assessments for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.excess_stock_assessments as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.excess_stock_assessments
  for each row execute function app.audit_business_row();
comment on table public.excess_stock_assessments is 'Immutable stock-above-maximum comparisons, not transferable surplus or obsolescence. Source policy references are copied evidence; source corrections/deletion do not rewrite history. Location/organization deletion cascades.';

-- Pure bounded validation only; no table access or elevated privileges.
create function app.excess_stock_selection(p_selections jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare entry jsonb; result jsonb:='[]';
begin
  if jsonb_typeof(p_selections) is distinct from 'array' then
    raise exception using errcode='MQ422',message='choose 1 to 50 policies';
  end if;
  if jsonb_array_length(p_selections) not between 1 and 50 then
    raise exception using errcode='MQ422',message='choose 1 to 50 policies';
  end if;
  for entry in select value from jsonb_array_elements(p_selections) loop
    if jsonb_typeof(entry) is distinct from 'object' then
      raise exception using errcode='MQ422',message='invalid policy selection';
    end if;
    if (select count(*) from jsonb_object_keys(entry))<>2
      or jsonb_typeof(entry->'policy_id') is distinct from 'string'
      or jsonb_typeof(entry->'maximum') is distinct from 'string'
      or entry->>'policy_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (entry->>'maximum'<>'calculated' and entry->>'maximum' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception using errcode='MQ422',message='invalid policy selection';
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('policy_id',lower(entry->>'policy_id'),'maximum',lower(entry->>'maximum')));
  end loop;
  if (select count(distinct value->>'policy_id') from jsonb_array_elements(result))<>jsonb_array_length(result) then
    raise exception using errcode='MQ422',message='choose one maximum per policy';
  end if;
  return (select jsonb_agg(value order by value->>'policy_id') from jsonb_array_elements(result));
end; $$;
revoke all on function app.excess_stock_selection(jsonb) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function app.excess_stock_selection(jsonb) to authenticated;

create function public.excess_stock_preview(p_organization_id uuid,p_selections jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
  selections jsonb; entry jsonb; p public.inventory_policies; comparison jsonb; report jsonb;
  lines jsonb:='[]'; totals jsonb; first_location uuid; first_cutoff date; cutoff date;
  seen_items uuid[]:='{}'; all_ready boolean:=true; override_id uuid; override_evidence jsonb;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='assessment source unavailable';
  end if;
  selections:=app.excess_stock_selection(p_selections);
  for entry in select value from jsonb_array_elements(selections) loop
    -- Explicit tenant and location guards also protect calls made by the definer save RPC.
    select i.* into p from public.inventory_policies i join public.planning_runs r
      on r.organization_id=i.organization_id and r.id=i.run_id and r.location_id=i.location_id
      where i.organization_id=p_organization_id and i.id=(entry->>'policy_id')::uuid
        and r.kind='policy' and r.status='succeeded'
        and (i.organization_id=any(array(select app.unscoped_organizations())) or i.location_id=any(array(select app.scoped_locations())));
    if not found then raise exception using errcode='MQ404',message='assessment source unavailable'; end if;
    if p.item_id is null or p.evidence#>>'{forecast,method}'='regional-v1'
      or coalesce(p.evidence#>'{forecast,source}' ? 'preparation',false) then
      raise exception using errcode='MQ422',message='individual policies required';
    end if;
    if p.item_id=any(seen_items) then raise exception using errcode='MQ422',message='choose distinct items'; end if;
    seen_items:=array_append(seen_items,p.item_id);
    cutoff:=(p.evidence#>>'{forecast,to_date}')::date;
    if cutoff is null or not isfinite(cutoff) or cutoff not between date '0001-01-01' and date '9999-12-31' then
      raise exception using errcode='MQ422',message='policy cutoff unavailable';
    end if;
    if first_location is null then first_location:=p.location_id; first_cutoff:=cutoff; end if;
    if p.location_id<>first_location or cutoff<>first_cutoff then
      raise exception using errcode='MQ422',message='choose one location and cutoff';
    end if;
    override_id:=case when entry->>'maximum'='calculated' then null else (entry->>'maximum')::uuid end;
    comparison:=public.policy_stock_comparison(p_organization_id,p.id,cutoff,
      case when override_id is null then 'calculated' else 'approved' end,override_id);
    if comparison->>'maximum' is not null and ((comparison->>'maximum')::numeric<0
      or (comparison->>'maximum')::numeric in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)) then
      raise exception using errcode='MQ422',message='policy maximum invalid';
    end if;
    override_evidence:=null;
    if override_id is not null then
      select jsonb_build_object('id',o.id,'revision',o.revision,'submitted_by',o.submitted_by,
        'reason',o.reason,'decided_by',o.decided_by,'decided_at',o.decided_at,'decision_reason',o.decision_reason,
        'reorder_point',o.reorder_point::text,'order_up_to',o.order_up_to::text)
      into override_evidence from public.policy_overrides o where o.organization_id=p_organization_id
        and o.policy_id=p.id and o.location_id=p.location_id and o.id=override_id and o.status='approved';
      if not found then raise exception using errcode='MQ404',message='assessment revision unavailable'; end if;
    end if;
    all_ready:=all_ready and comparison->>'status'='available';
    lines:=lines||jsonb_build_array(jsonb_build_object('item_id',p.item_id,'comparison',comparison,
      'policy',jsonb_build_object('status',p.status,'summary',p.summary,'evidence',p.evidence),
      'override',override_evidence));
  end loop;
  if all_ready then
    select jsonb_agg(jsonb_build_object('currency',v.currency,'value',v.value::text) order by v.currency)
    into totals from (select value#>>'{comparison,snapshot,currency}' currency,
      sum((value#>>'{comparison,value_above}')::numeric) value from jsonb_array_elements(lines)
      group by value#>>'{comparison,snapshot,currency}') v;
  end if;
  report:=jsonb_build_object('method','excess-stock-v1','location_id',first_location,
    'location_code',lines#>>'{0,comparison,location_code}','cutoff',first_cutoff,'selections',selections,
    'status',case when all_ready then 'available' else 'unavailable' end,'lines',lines,'totals',totals);
  return report||jsonb_build_object('fingerprint',encode(sha256(convert_to(report::text,'UTF8')),'hex'));
end; $$;
revoke all on function public.excess_stock_preview(uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.excess_stock_preview(uuid,jsonb) to authenticated;

create function public.excess_stock_save(p_organization_id uuid,p_selections jsonb,p_reason text,
  p_confirmed boolean,p_request_id uuid,p_fingerprint text) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.excess_stock_assessments; selections jsonb; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='assessment saving requires an editor';
  end if;
  selections:=app.excess_stock_selection(p_selections);
  if p_confirmed is distinct from true or p_request_id is null or p_fingerprint is null
    or p_fingerprint !~ '^[a-f0-9]{64}$' or p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='assessment reason and confirmation required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.excess-stock:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='assessment saving requires an editor';
  end if;
  select * into previous from public.excess_stock_assessments a
    where a.organization_id=p_organization_id and a.request_id=p_request_id;
  if found then
    if not(previous.organization_id=any(array(select app.unscoped_organizations()))
      or previous.location_id=any(array(select app.scoped_locations()))) then
      raise exception using errcode='MQ404',message='assessment unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.reason=btrim(p_reason)
      and previous.report->'selections'=selections and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='assessment request conflicts';
  end if;
  report:=public.excess_stock_preview(p_organization_id,selections);
  if report->>'fingerprint' is distinct from p_fingerprint then
    raise exception using errcode='MQ409',message='assessment evidence changed; refresh preview';
  end if;
  if report->>'status' is distinct from 'available' then
    raise exception using errcode='MQ422',message='every assessment line must be comparable';
  end if;
  insert into public.excess_stock_assessments(organization_id,location_id,cutoff,request_id,submitted_by,reason,confirmed,report)
    values(p_organization_id,(report->>'location_id')::uuid,(report->>'cutoff')::date,p_request_id,auth.uid(),btrim(p_reason),true,report)
    returning id into result;
  return result;
end; $$;
revoke all on function public.excess_stock_save(uuid,jsonb,text,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.excess_stock_save(uuid,jsonb,text,boolean,uuid,text) to authenticated;

create view public.excess_stock_candidates with(security_invoker=true) as
select p.id::text||':'||choice.maximum id,p.organization_id,p.id policy_id,p.item_id,p.location_id,p.item_code,
  l.code location_code,p.evidence#>>'{forecast,to_date}' cutoff,p.unit,r.finished_at,
  choice.maximum,choice.quantity,choice.revision,
  app.normalize_search(p.item_code||' '||l.code||' '||p.id::text) search_text
from public.inventory_policies p
join public.planning_runs r on r.organization_id=p.organization_id and r.id=p.run_id and r.location_id=p.location_id
join public.locations l on l.organization_id=p.organization_id and l.id=p.location_id
cross join lateral (
  select 'calculated'::text maximum,p.summary#>>'{protection,target}' quantity,null::integer revision
  union all
  select o.id::text,o.order_up_to::text,o.revision from public.policy_overrides o
    where o.organization_id=p.organization_id and o.policy_id=p.id and o.location_id=p.location_id and o.status='approved'
) choice
where r.kind='policy' and r.status='succeeded' and p.status='available' and p.item_id is not null
  and p.evidence#>>'{forecast,method}' is distinct from 'regional-v1'
  and not(coalesce(p.evidence#>'{forecast,source}' ? 'preparation',false));

create view public.excess_stock_assessment_list with(security_invoker=true) as
select a.id,a.organization_id,a.location_id,a.cutoff,a.created_at,a.reason,
  a.report->>'location_code' location_code,jsonb_array_length(a.report->'lines') line_count,a.report->'totals' totals,
  app.normalize_search(a.reason||' '||(a.report->>'location_code')||' '||
    (select string_agg(line#>>'{comparison,item_code}',' ') from jsonb_array_elements(a.report->'lines') line)) search_text
from public.excess_stock_assessments a;
revoke all on public.excess_stock_candidates,public.excess_stock_assessment_list from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.excess_stock_candidates,public.excess_stock_assessment_list to authenticated;
reset lock_timeout;
