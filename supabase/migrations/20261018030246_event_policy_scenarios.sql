-- Step 19b: additive saved comparisons. Rollback retains evidence and restores
-- the previous web build; existing policies, overrides and orders are untouched.
set lock_timeout='5s';
create table public.event_policy_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  event_id uuid not null,
  policy_id uuid not null,
  location_id uuid not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null,
  unique(organization_id,id),
  unique(organization_id,request_id),
  foreign key(organization_id,event_id) references public.planned_event_scenarios(organization_id,id) on delete cascade,
  foreign key(organization_id,policy_id) references public.inventory_policies(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
create index event_policy_history on public.event_policy_scenarios(organization_id,event_id,created_at desc,id);
create index event_policy_location on public.event_policy_scenarios(organization_id,location_id);
alter table public.event_policy_scenarios enable row level security;
revoke all on public.event_policy_scenarios from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.event_policy_scenarios to authenticated;
create policy "members read" on public.event_policy_scenarios for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.event_policy_scenarios as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.event_policy_scenarios
  for each row execute function app.audit_business_row();
comment on table public.event_policy_scenarios is 'Independent fixed-event comparisons against calculated policies. No activation, override carry-forward, reservations or replenishment changes.';

-- Pure calculation over saved evidence. No current catalog data or overrides.
create function app.event_policy_calculate(e jsonb,p jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare
  f jsonb:=p->'forecast'; o jsonb:=p->'options'; days jsonb; d jsonb; a jsonb;
  daily jsonb:='[]'; periods jsonb:='{}'; base jsonb; adjusted jsonb; key text;
  lead integer; review integer; horizon integer; n integer:=0; period_days integer;
  cutoff date; introduced date; discontinued date; day_date date;
  added numeric; lead_added numeric:=0; protection_added numeric:=0; outside_added numeric:=0;
begin
  if e->>'method' is distinct from 'planned-event-v1' or e#>'{input,confirmed}' is distinct from 'true'::jsonb
    or e#>>'{source,status}' is distinct from 'available' or p->>'method' is distinct from 'policy-v1'
    or p#>>'{output,status}' is distinct from 'available' then
    return jsonb_build_object('status','evidence_invalid');
  end if;
  if f->>'id' is distinct from e#>>'{source,forecast_id}'
    or f->>'run_id' is distinct from e#>>'{source,run_id}'
    or f->>'item_id' is distinct from e#>>'{source,item_id}'
    or f->>'to_date' is distinct from e#>>'{source,cutoff}'
    or f->>'method' is distinct from e#>>'{source,method}'
    or f->>'unit' is distinct from e#>>'{input,unit}'
    or f->'source' is distinct from e#>'{source,evidence,source}'
    or f->'output' is distinct from e#>'{source,evidence,output}' then
    return jsonb_build_object('status','source_mismatch');
  end if;
  days:=f#>'{output,forecast}';
  if coalesce(f->>'method','') not in ('baseline-v1','expanded-v1')
    or coalesce(f#>'{source,preparation}','null'::jsonb)<>'null'::jsonb
    or f#>>'{source,unit_provenance,status}' is distinct from 'consistent'
    or f#>>'{source,unit_provenance,unit}' is distinct from f->>'unit'
    or coalesce(f->>'unit','') not in ('EA','SET','L','KG')
    or coalesce(o->>'lead_time','')!~'^[0-9]{1,2}$'
    or coalesce(o->>'review_interval','')!~'^[0-9]{1,2}$'
    or coalesce(o->>'service_level','')!~'^0\.[0-9]{1,3}$'
    or coalesce(f->>'horizon','')!~'^[0-9]{1,2}$'
    or jsonb_typeof(days) is distinct from 'array'
    or jsonb_typeof(e#>'{input,additions}') is distinct from 'array'
    or coalesce(f->>'to_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (f#>>'{source,introduced_on}' is not null and f#>>'{source,introduced_on}'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    or (f#>>'{source,discontinued_on}' is not null and f#>>'{source,discontinued_on}'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    or not(f->'source' ?& array['introduced_on','discontinued_on']) then
    return jsonb_build_object('status','evidence_invalid');
  end if;
  lead:=(o->>'lead_time')::integer; review:=(o->>'review_interval')::integer;
  horizon:=(f->>'horizon')::integer; cutoff:=(f->>'to_date')::date;
  introduced:=(f#>>'{source,introduced_on}')::date;
  discontinued:=(f#>>'{source,discontinued_on}')::date;
  if cutoff is null or f#>>'{source,end_day}' is distinct from cutoff::text
    or lead not between 0 and 89 or review not between 1 and 90 or horizon not between 1 and 90
    or lead+review>horizon or jsonb_array_length(days)<>horizon
    or (o->>'service_level')::numeric not between .5 and .999
    or (introduced is not null and discontinued is not null and introduced>discontinued)
    or not app.policy_period_valid(p#>'{output,lead_time}',lead)
    or not app.policy_period_valid(p#>'{output,protection}',lead+review)
    or (p#>>'{output,protection,target}')::numeric<(p#>>'{output,lead_time,target}')::numeric then
    return jsonb_build_object('status','evidence_invalid');
  end if;
  -- Validate additions even when the affected date is outside both policy periods.
  if jsonb_array_length(e#>'{input,additions}') not between 1 and horizon
    or (select count(distinct value->>'date') from jsonb_array_elements(e#>'{input,additions}'))
      <>jsonb_array_length(e#>'{input,additions}') then
    return jsonb_build_object('status','evidence_invalid');
  end if;
  for a in select value from jsonb_array_elements(e#>'{input,additions}') loop
    if jsonb_typeof(a->'quantity') is distinct from 'string'
      or coalesce(a->>'quantity','')!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
      or not exists(select 1 from jsonb_array_elements(days) x where x->>'date'=a->>'date') then
      return jsonb_build_object('status','evidence_invalid');
    end if;
  end loop;
  for d in select value from jsonb_array_elements(days) loop
    n:=n+1; day_date:=cutoff+n;
    if d->>'date' is distinct from day_date::text or coalesce(d->>'quantity','')!~'^[0-9]{1,15}(\.[0-9]{1,6})?$' then
      return jsonb_build_object('status','evidence_invalid');
    end if;
    select coalesce(sum((value->>'quantity')::numeric),0) into added
      from jsonb_array_elements(e#>'{input,additions}') where value->>'date'=day_date::text;
    if added>0 and ((introduced is not null and day_date<introduced) or (discontinued is not null and day_date>discontinued)) then
      return jsonb_build_object('status','lifecycle_conflict');
    end if;
    if n<=lead then lead_added:=lead_added+added; end if;
    if n<=lead+review then protection_added:=protection_added+added; else outside_added:=outside_added+added; end if;
    daily:=daily||jsonb_build_array(jsonb_build_object('date',day_date,'addition',trim_scale(added)::text,
      'in_lead_time',n<=lead,'in_protection',n<=lead+review));
  end loop;
  foreach key in array array['lead_time','protection'] loop
    base:=p->'output'->key;
    added:=case when key='lead_time' then lead_added else protection_added end;
    period_days:=case when key='lead_time' then lead else lead+review end;
    adjusted:=jsonb_build_object('days',period_days,'safety_stock',base->>'safety_stock',
      'forecast',trim_scale((base->>'forecast')::numeric+added)::text,
      'quantile',trim_scale((base->>'quantile')::numeric+added)::text,
      'target',trim_scale((base->>'target')::numeric+added)::text);
    periods:=periods||jsonb_build_object(key,jsonb_build_object('baseline',base,'addition',trim_scale(added)::text,'adjusted',adjusted));
  end loop;
  return jsonb_build_object('status','available','periods',periods,'daily',daily,'outside_addition',trim_scale(outside_added)::text);
exception when invalid_datetime_format or datetime_field_overflow then
  return jsonb_build_object('status','evidence_invalid');
end; $$;
revoke all on function app.event_policy_calculate(jsonb,jsonb) from public,anon,authenticated,service_role,maqdar_worker;

create function public.event_policy_preview(p_organization_id uuid,p_event_id uuid,p_policy_id uuid,p_reason text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.planned_event_scenarios; p public.inventory_policies; r public.planning_runs; result jsonb; report jsonb;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='event policy source unavailable';
  end if;
  if p_reason is null or p_reason!~'[^[:space:]]' or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='event policy reason required';
  end if;
  select * into e from public.planned_event_scenarios x where x.organization_id=p_organization_id and x.id=p_event_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='event policy source unavailable'; end if;
  select * into p from public.inventory_policies x where x.organization_id=p_organization_id and x.id=p_policy_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='event policy source unavailable'; end if;
  select * into r from public.planning_runs where organization_id=p_organization_id and id=p.run_id;
  if p.status<>'available' or r.status is distinct from 'succeeded' or r.kind is distinct from 'policy' then
    result:=jsonb_build_object('status','policy_unavailable');
  elsif p.forecast_id<>e.forecast_id or p.location_id<>e.location_id
    or p.item_id::text is distinct from e.report#>>'{source,item_id}'
    or p.unit is distinct from e.report#>>'{input,unit}'
    or e.location_id::text is distinct from e.report#>>'{source,location_id}'
    or e.forecast_id::text is distinct from e.report#>>'{source,forecast_id}' then
    result:=jsonb_build_object('status','source_mismatch');
  elsif r.to_date::text is distinct from p.evidence#>>'{forecast,to_date}'
    or p.summary is distinct from (p.evidence->'output')-'calibration'
    or r.options is distinct from p.evidence->'options' then
    result:=jsonb_build_object('status','evidence_invalid');
  else result:=app.event_policy_calculate(e.report,p.evidence); end if;
  report:=jsonb_build_object('method','event-policy-v1',
    'input',jsonb_build_object('event_id',e.id,'policy_id',p.id,'reason',btrim(p_reason)),
    'event',e.report,'policy',jsonb_build_object('id',p.id,'run_id',p.run_id,'evidence',p.evidence),
    'location_id',e.location_id)||result;
  return report||jsonb_build_object('fingerprint',encode(extensions.digest(report::text,'sha256'),'hex'));
end; $$;
revoke all on function public.event_policy_preview(uuid,uuid,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_policy_preview(uuid,uuid,uuid,text) to authenticated;

create function public.event_policy_save(p_organization_id uuid,p_event_id uuid,p_policy_id uuid,p_reason text,p_request_id uuid,p_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.event_policy_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event policy save forbidden';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_reason is null or p_reason!~'[^[:space:]]' or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid event policy save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.event-policy:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event policy save forbidden';
  end if;
  select * into previous from public.event_policy_scenarios s where s.organization_id=p_organization_id and s.request_id=p_request_id
    and (s.organization_id=any(array(select app.unscoped_organizations())) or s.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.submitted_by=auth.uid() and previous.event_id=p_event_id and previous.policy_id=p_policy_id
      and previous.report#>>'{input,reason}'=btrim(p_reason) and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='event policy request conflicts';
  end if;
  report:=public.event_policy_preview(p_organization_id,p_event_id,p_policy_id,p_reason);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='event policy evidence changed; refresh preview'; end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='event policy unavailable'; end if;
  insert into public.event_policy_scenarios(organization_id,event_id,policy_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_event_id,p_policy_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $$;
revoke all on function public.event_policy_save(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_policy_save(uuid,uuid,uuid,text,uuid,text) to authenticated;
reset lock_timeout;
