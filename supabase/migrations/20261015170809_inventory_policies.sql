-- Step 11 additive, forward-only. Rollback preserves saved recommendations.
set lock_timeout='5s';
alter table public.planning_runs drop constraint planning_runs_kind_check;
alter table public.planning_runs add constraint planning_runs_kind_check check(kind in ('readiness','classification','forecast','preparation','policy'));

create table planning.policy_inputs (
  run_id uuid primary key references public.planning_runs(id) on delete cascade,
  payload jsonb not null
);
revoke all on planning.policy_inputs from public,anon,authenticated,service_role,maqdar_worker;
create table public.inventory_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null unique,
  location_id uuid not null,
  forecast_id uuid not null,
  item_id uuid not null,
  item_code text not null,
  unit text,
  status text not null check(status in ('available','insufficient_residuals','no_positive_history','unsupported_scale','calibration_failed')),
  summary jsonb not null,
  evidence jsonb not null,
  unique(organization_id,id),
  foreign key(organization_id,run_id,location_id) references public.planning_runs(organization_id,id,location_id) on delete cascade
);
comment on column public.inventory_policies.forecast_id is 'Historical source identity; retained with copied evidence even if the source run is removed.';
create index inventory_policies_source on public.inventory_policies(organization_id,forecast_id);
alter table public.inventory_policies enable row level security;
revoke all on public.inventory_policies from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.inventory_policies to authenticated;
create policy "members read" on public.inventory_policies for select to authenticated using (organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.inventory_policies as restrictive for select to authenticated using (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));

create function public.policy_enqueue(p_organization_id uuid,p_forecast_id uuid,p_request_id uuid,p_lead_time integer,p_review_interval integer,p_service_level numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare f public.forecast_results; source_run public.planning_runs; location_code text; run uuid; payload jsonb;
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='policy planning requires an editor';
  end if;
  if p_lead_time is null or p_lead_time not between 0 and 89 or p_review_interval is null or p_review_interval not between 1 and 90
    or p_service_level is null or p_service_level not between 0.5 and 0.999 then
    raise exception using errcode='MQ422',message='invalid policy parameters';
  end if;
  select * into f from public.forecast_results where organization_id=p_organization_id and id=p_forecast_id;
  if not found or f.status<>'selected' then raise exception using errcode='MQ422',message='choose a selected forecast'; end if;
  select * into source_run from public.planning_runs where organization_id=p_organization_id and id=f.run_id;
  if source_run.status is distinct from 'succeeded' or source_run.kind is distinct from 'forecast'
    or coalesce(source_run.options->>'method','') not in ('baseline-v1','expanded-v1','regional-v1')
    or coalesce((source_run.options->>'horizon')::integer,0)<p_lead_time+p_review_interval then
    raise exception using errcode='MQ422',message='forecast must cover the protection period';
  end if;
  select code into location_code from public.locations where organization_id=p_organization_id and id=f.location_id;
  run:=app.planning_enqueue_kind(p_organization_id,location_code,source_run.from_date,source_run.to_date,p_request_id,'policy',
    jsonb_build_object('method','policy-v1','forecast_id',p_forecast_id,'lead_time',p_lead_time,'review_interval',p_review_interval,'service_level',trim_scale(p_service_level)::text));
  -- Capture once at enqueue, including for concurrent idempotent replays. Never recreate terminal staging.
  if (select status from public.planning_runs where id=run)='queued' and not exists(select 1 from planning.policy_inputs where run_id=run) then
    payload:=jsonb_build_object('kind','policy','method','policy-v1','computed_at',statement_timestamp(),
      'options',(select options from public.planning_runs where id=run),
      'forecast',jsonb_build_object('id',f.id,'run_id',f.run_id,'item_id',f.item_id,'item_code',f.item_code,
        'unit',f.evidence->'source'->'preparation'->>'unit','method',source_run.options->>'method',
        'horizon',source_run.options->'horizon','to_date',source_run.to_date,'source',f.evidence->'source','output',f.evidence->'output'));
    if octet_length(payload::text)>20000000 then raise exception using errcode='MQ422',message='policy input too large'; end if;
    insert into planning.policy_inputs(run_id,payload) values(run,payload);
  end if;
  return run;
end; $$;
revoke all on function public.policy_enqueue(uuid,uuid,uuid,integer,integer,numeric) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.policy_enqueue(uuid,uuid,uuid,integer,integer,numeric) to authenticated;

create function app.policy_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.planning_runs; l planning.leases;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if not found or r.kind<>'policy' or r.status<>'running' then return null; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return null; end if;
  return (select payload from planning.policy_inputs where run_id=r.id);
end; $$;
revoke all on function app.policy_task(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;

create or replace function app.planning_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.planning_runs where id=p_run_id and kind='policy') then return app.policy_task(p_run_id,p_token); end if;
  if exists(select 1 from public.planning_runs where id=p_run_id and kind='preparation') then return app.preparation_task(p_run_id,p_token); end if;
  if exists(select 1 from public.planning_runs where id=p_run_id and kind='forecast') then return app.forecast_task(p_run_id,p_token); end if;
  return app.planning_task_classification(p_run_id,p_token);
end; $$;

create function app.policy_period_valid(p jsonb,days integer) returns boolean
language plpgsql immutable set search_path='' as $$
declare key text;
begin
  if jsonb_typeof(p) is distinct from 'object' or p->'days' is distinct from to_jsonb(days) then return false; end if;
  foreach key in array array['forecast','quantile','target','safety_stock'] loop
    if jsonb_typeof(p->key) is distinct from 'string' or (p->>key)!~'^[0-9]{1,34}\.[0-9]{3}$' then return false; end if;
  end loop;
  return (p->>'target')::numeric >= greatest((p->>'forecast')::numeric,(p->>'quantile')::numeric)
    and (p->>'safety_stock')::numeric=(p->>'target')::numeric-(p->>'forecast')::numeric;
end; $$;
revoke all on function app.policy_period_valid(jsonb,integer) from public,anon,authenticated,service_role,maqdar_worker;

create function app.policy_finish(p_run_id uuid,p_token uuid,p_rows jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.planning_runs; l planning.leases; input jsonb; output jsonb;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if not found or r.kind<>'policy' or r.status<>'running' then return false; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return false; end if;
  select payload into input from planning.policy_inputs where run_id=r.id;
  if input is null or jsonb_typeof(p_rows) is distinct from 'array' then raise exception using errcode='MQ422',message='invalid policy output'; end if;
  if jsonb_array_length(p_rows)<>1 or octet_length(p_rows::text)>1000000 then raise exception using errcode='MQ422',message='invalid policy output'; end if;
  output:=p_rows->0;
  if jsonb_typeof(output) is distinct from 'object' or coalesce(output->>'status','') not in ('available','insufficient_residuals','no_positive_history','unsupported_scale','calibration_failed')
    or output->>'method' is distinct from 'iid-error-paths-v1'
    or output->'samples' is distinct from (case when output->>'status'='available' then '5000'::jsonb else '0'::jsonb end)
    or jsonb_typeof(output->'calibration') is distinct from 'array'
    or coalesce(output->>'seed','')!~'^[a-f0-9]{64}$'
    or coalesce(output->>'residual_count','')!~'^[0-9]{1,3}$'
    or coalesce(output->>'positive_days','')!~'^[0-9]{1,4}$' then
    raise exception using errcode='MQ422',message='invalid policy evidence';
  end if;
  if output->>'status'='available' then
    if not app.policy_period_valid(output->'lead_time',(r.options->>'lead_time')::integer)
      or not app.policy_period_valid(output->'protection',(r.options->>'lead_time')::integer+(r.options->>'review_interval')::integer)
      or jsonb_array_length(output->'calibration')<>3*(input->'forecast'->>'horizon')::integer
      or (output->>'residual_count')::integer<>jsonb_array_length(output->'calibration')
      or (output->>'residual_count')::integer<20
      or (output->'protection'->>'target')::numeric<(output->'lead_time'->>'target')::numeric then
      raise exception using errcode='MQ422',message='incomplete policy evidence';
    end if;
  elsif output->'lead_time' is distinct from 'null'::jsonb or output->'protection' is distinct from 'null'::jsonb
    or jsonb_array_length(output->'calibration')<>0 then
    raise exception using errcode='MQ422',message='unavailable policy must not contain thresholds';
  end if;
  insert into public.inventory_policies(organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
  values(r.organization_id,r.id,r.location_id,(input->'forecast'->>'id')::uuid,(input->'forecast'->>'item_id')::uuid,
    input->'forecast'->>'item_code',input->'forecast'->>'unit',output->>'status',output-'calibration',input||jsonb_build_object('output',output));
  if l.expires_at<=clock_timestamp() then raise exception using errcode='MQ409',message='policy lease expired'; end if;
  update public.planning_runs set status='succeeded',finished_at=clock_timestamp(),error_code=null,
    result=jsonb_build_object('version',1,'method','policy-v1','computed_at',input->'computed_at','item_count',1) where id=r.id;
  perform pgmq.archive('planning',l.message_id);
  delete from planning.leases where run_id=r.id;
  return true;
end; $$;
revoke all on function app.policy_finish(uuid,uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function app.policy_finish(uuid,uuid,jsonb) to maqdar_worker;

create function app.policy_input_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status in ('succeeded','failed','canceled') then delete from planning.policy_inputs where run_id=new.id; end if;
  return new;
end; $$;
revoke all on function app.policy_input_cleanup() from public,anon,authenticated,service_role,maqdar_worker;
create trigger policy_input_cleanup after update of status on public.planning_runs for each row execute function app.policy_input_cleanup();
create or replace function app.planning_claim()
returns table(run_id uuid,lease_token uuid) language plpgsql security definer set search_path = '' as $$
declare m record; r public.planning_runs; new_token uuid;
begin
  -- Bound stale-message draining (e.g. an organization was deleted).
  for n in 1..10 loop
    select * into m from pgmq.read('planning',120,1);
    if not found then return; end if;
    -- The queue row is locked first by pgmq.read. Never wait for a run lock held
    -- by completion/cancellation, which acquires these locks in the other order.
    select * into r from public.planning_runs where id=(m.message->>'run_id')::uuid for update skip locked;
    if not found then
      if exists(select 1 from public.planning_runs where id=(m.message->>'run_id')::uuid) then continue; end if;
      perform pgmq.archive('planning',m.msg_id); continue;
    end if;
    if r.status not in ('queued','running') then
      perform pgmq.archive('planning',m.msg_id); continue;
    end if;
    if r.attempts>=3 then
      update public.planning_runs set status='failed',error_code='attempts_exhausted',finished_at=clock_timestamp() where id=r.id;
      perform pgmq.archive('planning',m.msg_id);
      delete from planning.leases where planning.leases.run_id=r.id;
      continue;
    end if;
    if r.kind='policy' or (r.kind='forecast' and r.options->>'method' in ('expanded-v1','regional-v1')) then
      select vt into m.vt from pgmq.set_vt('planning',m.msg_id,900);
    end if;
    new_token:=gen_random_uuid();
    update planning.leases set token=new_token,expires_at=m.vt where planning.leases.run_id=r.id and message_id=m.msg_id;
    if not found then raise exception 'planning transport mismatch'; end if;
    update public.planning_runs set status='running',attempts=attempts+1,started_at=clock_timestamp(),error_code=null where id=r.id;
    return query select r.id,new_token;
    return;
  end loop;
end; $$;
reset lock_timeout;
