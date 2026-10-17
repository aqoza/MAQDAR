-- Step 19: additive, immutable planning evidence. Rollback restores the previous
-- web build and retains this table/RPCs; no existing business data is rewritten.
set lock_timeout='5s';
create table public.planned_event_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  forecast_id uuid not null,
  location_id uuid not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  event_type text not null check(event_type in ('campaign','recall','tender')),
  name text not null check(length(name) between 1 and 200),
  report jsonb not null,
  unique(organization_id,id),
  unique(organization_id,request_id),
  foreign key(organization_id,forecast_id) references public.forecast_results(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
create index planned_event_source on public.planned_event_scenarios(organization_id,forecast_id,created_at desc,id);
create index planned_event_location on public.planned_event_scenarios(organization_id,location_id);
alter table public.planned_event_scenarios enable row level security;
revoke all on public.planned_event_scenarios from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.planned_event_scenarios to authenticated;
create policy "members read" on public.planned_event_scenarios for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.planned_event_scenarios as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.planned_event_scenarios
  for each row execute function app.audit_business_row();
comment on table public.planned_event_scenarios is 'Independent baseline-plus-addition scenarios. No automatic stacking, adjusted uncertainty, policy changes, reservations or orders.';

create function public.planned_event_source(p_organization_id uuid,p_forecast_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  f public.forecast_results; r public.planning_runs; reason text:='available';
  days jsonb; day jsonb; n integer:=0; unit text; location_code text;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='event source unavailable';
  end if;
  -- Explicit scope also protects callers through the definer save RPC.
  select * into f from public.forecast_results x where x.organization_id=p_organization_id and x.id=p_forecast_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='event source unavailable'; end if;
  select * into r from public.planning_runs x where x.organization_id=p_organization_id and x.id=f.run_id;
  select code into location_code from public.locations where organization_id=p_organization_id and id=f.location_id;
  unit:=f.evidence#>>'{source,unit_provenance,unit}';
  days:=f.evidence#>'{output,forecast}';
  if r.kind is distinct from 'forecast' or r.status is distinct from 'succeeded' or f.status<>'selected'
    or f.evidence#>>'{output,status}' is distinct from 'selected' then reason:='forecast_unavailable';
  elsif coalesce(f.evidence#>'{source,preparation}','null'::jsonb)<>'null'::jsonb
    or r.options->>'method'='regional-v1' then reason:='prepared_group';
  elsif f.evidence#>>'{source,unit_provenance,status}' is distinct from 'consistent'
    or unit is null or unit not in ('EA','SET','L','KG') then reason:='unit_unknown';
  elsif jsonb_typeof(days) is distinct from 'array' then reason:='source_invalid';
  elsif jsonb_array_length(days) not between 1 and 90 then reason:='source_invalid';
  else
    for day in select value from jsonb_array_elements(days) loop
      n:=n+1;
      if day->>'date' is distinct from (r.to_date+n)::text
        or coalesce(day->>'quantity','') !~ '^[0-9]{1,15}(\.[0-9]{1,6})?$' then
        reason:='source_invalid'; exit;
      end if;
    end loop;
  end if;
  return jsonb_build_object('status',reason,'forecast_id',f.id,'run_id',f.run_id,
    'location_id',f.location_id,'location_code',location_code,'item_id',f.item_id,
    'item_code',f.item_code,'item_name',f.item_name,'unit',unit,'cutoff',r.to_date,
    'model',f.model,'method',r.options->>'method','summary',f.summary,'evidence',f.evidence);
end; $$;
revoke all on function public.planned_event_source(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.planned_event_source(uuid,uuid) to authenticated;

-- Canonical inputs give numerically equivalent retries the same identity.
create function app.planned_event_input(p_type text,p_name text,p_reason text,p_unit text,p_additions jsonb,p_confirmed boolean)
returns jsonb language plpgsql immutable set search_path='' as $$
declare entry jsonb; additions jsonb;
begin
  if p_type is null or p_type not in ('campaign','recall','tender') or p_name is null or p_reason is null
    or length(btrim(p_name)) not between 1 and 200 or length(btrim(p_reason)) not between 1 and 2000
    or p_unit is null or p_unit not in ('EA','SET','L','KG') or p_confirmed is null
    or jsonb_typeof(p_additions) is distinct from 'array' then
    raise exception using errcode='MQ422',message='invalid event input';
  end if;
  if jsonb_array_length(p_additions) not between 1 and 90 then
    raise exception using errcode='MQ422',message='invalid event additions';
  end if;
  for entry in select value from jsonb_array_elements(p_additions) loop
    if jsonb_typeof(entry) is distinct from 'object' or coalesce(entry->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(entry->'quantity') is distinct from 'string'
      or coalesce(entry->>'quantity','') !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$' then
      raise exception using errcode='MQ422',message='invalid event addition';
    end if;
  end loop;
  if (select count(distinct value->>'date') from jsonb_array_elements(p_additions))<>jsonb_array_length(p_additions) then
    raise exception using errcode='MQ422',message='duplicate event dates';
  end if;
  select jsonb_agg(jsonb_build_object('date',value->>'date','quantity',trim_scale((value->>'quantity')::numeric)::text) order by value->>'date')
    into additions from jsonb_array_elements(p_additions);
  return jsonb_build_object('event_type',p_type,'name',btrim(p_name),'reason',btrim(p_reason),'unit',p_unit,
    'additions',additions,'confirmed',p_confirmed);
end; $$;
revoke all on function app.planned_event_input(text,text,text,text,jsonb,boolean) from public,anon,authenticated,service_role,maqdar_worker;

create function public.planned_event_preview(p_organization_id uuid,p_forecast_id uuid,p_type text,p_name text,
  p_reason text,p_unit text,p_additions jsonb,p_confirmed boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source jsonb; input jsonb; daily jsonb; report jsonb; total_base numeric; total_added numeric; total_adjusted numeric;
begin
  source:=public.planned_event_source(p_organization_id,p_forecast_id);
  if source->>'status'<>'available' then raise exception using errcode='MQ422',message='event source incompatible'; end if;
  input:=app.planned_event_input(p_type,p_name,p_reason,p_unit,p_additions,p_confirmed);
  if p_unit<>source->>'unit' or exists(
    select 1 from jsonb_array_elements(input->'additions') a
    where not exists(select 1 from jsonb_array_elements(source#>'{evidence,output,forecast}') d where d->>'date'=a->>'date')
  ) then raise exception using errcode='MQ422',message='event unit or dates incompatible'; end if;
  select jsonb_agg(jsonb_build_object('date',day_date,'baseline',trim_scale(baseline)::text,'addition',trim_scale(addition)::text,
    'adjusted',trim_scale(baseline+addition)::text) order by day_date),sum(baseline),sum(addition),sum(baseline+addition)
  into daily,total_base,total_added,total_adjusted from (
    select d->>'date' as day_date,(d->>'quantity')::numeric baseline,coalesce((a->>'quantity')::numeric,0) addition
    from jsonb_array_elements(source#>'{evidence,output,forecast}') d
    left join jsonb_array_elements(input->'additions') a on a->>'date'=d->>'date'
  ) x;
  report:=jsonb_build_object('method','planned-event-v1','source',source,'input',input,'daily',daily,
    'totals',jsonb_build_object('baseline',trim_scale(total_base)::text,'addition',trim_scale(total_added)::text,'adjusted',trim_scale(total_adjusted)::text));
  return report||jsonb_build_object('fingerprint',encode(extensions.digest(report::text,'sha256'),'hex'));
end; $$;
revoke all on function public.planned_event_preview(uuid,uuid,text,text,text,text,jsonb,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.planned_event_preview(uuid,uuid,text,text,text,text,jsonb,boolean) to authenticated;

create function public.planned_event_save(p_organization_id uuid,p_forecast_id uuid,p_type text,p_name text,
  p_reason text,p_unit text,p_additions jsonb,p_confirmed boolean,p_request_id uuid,p_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.planned_event_scenarios; input jsonb; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event save forbidden';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_confirmed is distinct from true then
    raise exception using errcode='MQ422',message='invalid event save';
  end if;
  input:=app.planned_event_input(p_type,p_name,p_reason,p_unit,p_additions,p_confirmed);
  perform pg_advisory_xact_lock(hashtextextended('maqdar.planned-event:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event save forbidden';
  end if;
  select * into previous from public.planned_event_scenarios s where s.organization_id=p_organization_id and s.request_id=p_request_id
    and (s.organization_id=any(array(select app.unscoped_organizations())) or s.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.forecast_id=p_forecast_id and previous.submitted_by=auth.uid()
      and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='event request conflicts';
  end if;
  report:=public.planned_event_preview(p_organization_id,p_forecast_id,p_type,p_name,p_reason,p_unit,p_additions,p_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='event evidence changed; refresh preview'; end if;
  insert into public.planned_event_scenarios(organization_id,forecast_id,location_id,request_id,submitted_by,event_type,name,report)
    values(p_organization_id,p_forecast_id,(report#>>'{source,location_id}')::uuid,p_request_id,auth.uid(),p_type,btrim(p_name),report)
    returning id into result;
  return result;
end; $$;
revoke all on function public.planned_event_save(uuid,uuid,text,text,text,text,jsonb,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.planned_event_save(uuid,uuid,text,text,text,text,jsonb,boolean,uuid,text) to authenticated;
reset lock_timeout;
