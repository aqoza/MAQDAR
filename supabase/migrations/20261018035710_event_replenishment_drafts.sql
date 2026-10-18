-- Step 19c. Additive, independent planning evidence; no order/policy mutations.
-- Rollback restores the previous web build and retains these saved records.
set lock_timeout='5s';
create table public.event_replenishment_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  scenario_id uuid not null,
  location_id uuid not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null,
  unique(organization_id,id),
  unique(organization_id,request_id),
  foreign key(organization_id,scenario_id) references public.event_policy_scenarios(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
create index event_replenishment_history on public.event_replenishment_drafts(organization_id,scenario_id,created_at desc,id);
create index event_replenishment_location on public.event_replenishment_drafts(organization_id,location_id);
alter table public.event_replenishment_drafts enable row level security;
revoke all on public.event_replenishment_drafts from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.event_replenishment_drafts to authenticated;
create policy "members read" on public.event_replenishment_drafts for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.event_replenishment_drafts as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.event_replenishment_drafts
  for each row execute function app.audit_business_row();
comment on table public.event_replenishment_drafts is 'Independent fixed-event replenishment comparisons. No overrides, reservations, procurement scenarios or execution.';

create function public.event_replenishment_preview(p_organization_id uuid,p_scenario_id uuid,p_backorders text,p_orders_confirmed boolean,p_event_uncommitted boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  s public.event_policy_scenarios; current_scenario jsonb; baseline jsonb; result jsonb;
  status text; baseline_gap numeric; adjusted_gap numeric; baseline_maximum numeric; adjusted_maximum numeric;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='event replenishment source unavailable';
  end if;
  select * into s from public.event_policy_scenarios x where x.organization_id=p_organization_id and x.id=p_scenario_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='event replenishment source unavailable'; end if;
  if p_backorders is null or p_backorders!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or p_orders_confirmed is null or p_event_uncommitted is null then
    raise exception using errcode='MQ422',message='enter backorders and confirmations';
  end if;
  -- Revalidate the original sources rather than silently substituting a changed
  -- policy or event. Both inputs remain independently tenant/location scoped.
  current_scenario:=public.event_policy_preview(p_organization_id,s.event_id,s.policy_id,s.report#>>'{input,reason}');
  if current_scenario is distinct from s.report or s.report->>'status' is distinct from 'available'
    or s.location_id::text is distinct from s.report->>'location_id' then
    status:='scenario_changed';
  else
    -- One statement snapshot and the existing stock/inbound completeness rules.
    -- This does not create an ordinary replenishment draft or select an override.
    baseline:=public.replenishment_preview(p_organization_id,s.policy_id,'calculated',null,p_backorders,p_orders_confirmed);
    status:=baseline->>'status';
    if status='available' and not p_event_uncommitted then status:='event_unconfirmed'; end if;
    if status='available' then
      baseline_maximum:=(s.report#>>'{periods,protection,baseline,target}')::numeric;
      adjusted_maximum:=(s.report#>>'{periods,protection,adjusted,target}')::numeric;
      baseline_gap:=greatest(baseline_maximum-(baseline->>'inventory_position')::numeric,0);
      adjusted_gap:=greatest(adjusted_maximum-(baseline->>'inventory_position')::numeric,0);
      if adjusted_gap>999999999999999.999 then
        status:='quantity_out_of_range'; baseline_gap:=null; adjusted_gap:=null;
      end if;
    end if;
  end if;
  result:=jsonb_build_object('method','event-replenishment-v1','status',status,
    'input',jsonb_build_object('scenario_id',s.id,'backorders',trim_scale(p_backorders::numeric)::text,
      'orders_confirmed',p_orders_confirmed,'event_uncommitted',p_event_uncommitted),
    'location_id',s.location_id,'scenario',s.report,'baseline',baseline,
    'baseline_maximum',trim_scale(baseline_maximum)::text,'adjusted_maximum',trim_scale(adjusted_maximum)::text,
    'baseline_gap',trim_scale(baseline_gap)::text,'adjusted_gap',trim_scale(adjusted_gap)::text,
    'gap_increase',trim_scale(adjusted_gap-baseline_gap)::text);
  return result||jsonb_build_object('fingerprint',encode(extensions.digest(result::text,'sha256'),'hex'));
end; $$;
revoke all on function public.event_replenishment_preview(uuid,uuid,text,boolean,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_replenishment_preview(uuid,uuid,text,boolean,boolean) to authenticated;

create function public.event_replenishment_save(p_organization_id uuid,p_scenario_id uuid,p_backorders text,p_orders_confirmed boolean,p_event_uncommitted boolean,p_request_id uuid,p_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.event_replenishment_drafts; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event replenishment save forbidden';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_backorders is null or p_backorders!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or p_orders_confirmed is null or p_event_uncommitted is null then
    raise exception using errcode='MQ422',message='invalid event replenishment save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.event-replenishment:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event replenishment save forbidden';
  end if;
  select * into previous from public.event_replenishment_drafts x where x.organization_id=p_organization_id and x.request_id=p_request_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.submitted_by=auth.uid() and previous.scenario_id=p_scenario_id
      and (previous.report#>>'{input,backorders}')::numeric=p_backorders::numeric
      and previous.report#>'{input,orders_confirmed}'=to_jsonb(p_orders_confirmed)
      and previous.report#>'{input,event_uncommitted}'=to_jsonb(p_event_uncommitted)
      and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='event replenishment request conflicts';
  end if;
  report:=public.event_replenishment_preview(p_organization_id,p_scenario_id,p_backorders,p_orders_confirmed,p_event_uncommitted);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='event replenishment evidence changed; refresh preview'; end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='event replenishment unavailable'; end if;
  insert into public.event_replenishment_drafts(organization_id,scenario_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_scenario_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $$;
revoke all on function public.event_replenishment_save(uuid,uuid,text,boolean,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_replenishment_save(uuid,uuid,text,boolean,boolean,uuid,text) to authenticated;
reset lock_timeout;
