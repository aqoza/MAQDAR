-- Step 7, additive and forward-only. Stop workers to roll back application code;
-- retain run history and queue state until a reviewed follow-up migration.
set lock_timeout = '5s';
create extension if not exists pgmq;
select pgmq.create('planning');
revoke all on schema pgmq from public, anon, authenticated, service_role;
revoke all on all tables in schema pgmq from public, anon, authenticated, service_role;
revoke all on all sequences in schema pgmq from public, anon, authenticated, service_role;
revoke all on all functions in schema pgmq from public, anon, authenticated, service_role;

-- An operator provisions a LOGIN that is a member of this capability role.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='maqdar_worker') then
    create role maqdar_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end; $$;
grant maqdar_worker to postgres;
grant usage on schema app to maqdar_worker;
create schema planning;
revoke all on schema planning from public, anon, authenticated, service_role, maqdar_worker;

create table public.planning_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  request_id uuid not null,
  kind text not null default 'readiness' check (kind = 'readiness'),
  from_date date not null check (isfinite(from_date)),
  to_date date not null check (isfinite(to_date)),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','canceled')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  error_code text check (error_code in ('worker_error','attempts_exhausted')),
  unique (organization_id,id),
  unique (organization_id,request_id),
  foreign key (organization_id,location_id) references public.locations(organization_id,id),
  check (to_date >= from_date and to_date-from_date <= 1095),
  check ((status in ('succeeded','failed','canceled')) = (finished_at is not null)),
  check ((status = 'succeeded') = (result is not null))
);
create unique index planning_runs_one_active on public.planning_runs(organization_id) where status in ('queued','running');
create index planning_runs_recent on public.planning_runs(organization_id,created_at desc,id);
create index planning_runs_location on public.planning_runs(organization_id,location_id);
alter table public.planning_runs enable row level security;
revoke all on public.planning_runs from public, anon, authenticated, service_role, maqdar_worker;
grant select on public.planning_runs to authenticated;
create policy "members read" on public.planning_runs for select to authenticated
  using (organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.planning_runs as restrictive for select to authenticated
  using (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));

-- Lease tokens and transport IDs never appear in the public run record.
create table planning.leases (
  run_id uuid primary key references public.planning_runs(id) on delete cascade,
  message_id bigint not null unique,
  token uuid,
  expires_at timestamptz
);
revoke all on planning.leases from public, anon, authenticated, service_role, maqdar_worker;

create function public.planning_enqueue(p_organization_id uuid,p_location_code text,p_from date,p_to date,p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.planning_runs; location uuid; run uuid; msg bigint;
begin
  if not (p_organization_id = any(array(select app.editable_organizations()))) or p_organization_id is null then
    raise exception using errcode='MQ403',message='planning requires an editor';
  end if;
  if p_request_id is null or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_to < p_from or p_to-p_from > 1095 then
    raise exception using errcode='MQ422',message='invalid planning window';
  end if;
  select id into location from public.locations where organization_id=p_organization_id and code=p_location_code and is_active;
  if location is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.planning:'||p_organization_id::text,0));
  select * into r from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if r.location_id<>location or r.from_date<>p_from or r.to_date<>p_to then
      raise exception using errcode='MQ409',message='request id already used with different parameters';
    end if;
    return r.id;
  end if;
  if exists(select 1 from public.planning_runs where organization_id=p_organization_id and status in ('queued','running')) then
    raise exception using errcode='MQ409',message='a planning run is already active';
  end if;
  if (select count(*) from public.planning_runs where organization_id=p_organization_id and created_at>now()-interval '24 hours')>=20 then
    raise exception using errcode='MQ429',message='planning run limit reached';
  end if;
  insert into public.planning_runs(organization_id,location_id,request_id,from_date,to_date,created_by)
  values(p_organization_id,location,p_request_id,p_from,p_to,auth.uid()) returning id into run;
  select pgmq.send('planning',jsonb_build_object('run_id',run)) into msg;
  insert into planning.leases(run_id,message_id) values(run,msg);
  return run;
end; $$;
revoke all on function public.planning_enqueue(uuid,text,date,date,uuid) from public,anon,authenticated,service_role;
grant execute on function public.planning_enqueue(uuid,text,date,date,uuid) to authenticated;

create function public.planning_cancel(p_organization_id uuid,p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.planning_runs; msg bigint;
begin
  if p_organization_id is null or not (p_organization_id = any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='planning requires an editor';
  end if;
  select * into r from public.planning_runs where organization_id=p_organization_id and id=p_run_id for update;
  if not found then raise exception using errcode='MQ404',message='no such run'; end if;
  if r.status not in ('queued','running') then return; end if;
  update public.planning_runs set status='canceled',finished_at=clock_timestamp(),error_code=null where id=r.id;
  select message_id into msg from planning.leases where run_id=r.id;
  perform pgmq.archive('planning',msg);
  delete from planning.leases where run_id=r.id;
end; $$;
revoke all on function public.planning_cancel(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.planning_cancel(uuid,uuid) to authenticated;

create function app.planning_claim()
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
    new_token:=gen_random_uuid();
    update planning.leases set token=new_token,expires_at=m.vt where planning.leases.run_id=r.id and message_id=m.msg_id;
    if not found then raise exception 'planning transport mismatch'; end if;
    update public.planning_runs set status='running',attempts=attempts+1,started_at=clock_timestamp(),error_code=null where id=r.id;
    return query select r.id,new_token;
    return;
  end loop;
end; $$;
revoke all on function app.planning_claim() from public,anon,authenticated,service_role;
grant execute on function app.planning_claim() to maqdar_worker;

create function app.planning_execute(p_run_id uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path = '' set plan_cache_mode = force_custom_plan as $$
declare r public.planning_runs; l planning.leases; summary jsonb;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if not found or r.status<>'running' then return false; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return false; end if;
  -- One set-based scan, one MVCC statement snapshot. Sparse missing days are not observations.
  with demand as materialized (
    select d.item_id,d.demand_date,d.quantity,d.lost_sales_quantity
    from public.demand_history d join public.items i on i.organization_id=d.organization_id and i.id=d.item_id
    where d.organization_id=r.organization_id and d.location_id=r.location_id
      and d.demand_date between r.from_date and r.to_date and i.status<>'discontinued'
  )
  select jsonb_build_object(
    'version',1,'computed_at',statement_timestamp(),
    'active_items',(select count(*) from public.items where organization_id=r.organization_id and status<>'discontinued'),
    'items_with_history',count(distinct item_id),'stored_rows',count(*),
    'days_with_records',count(distinct demand_date),
    'positive_demand_rows',count(*) filter(where quantity>0),
    'first_record',min(demand_date),'last_record',max(demand_date),
    'quantity',coalesce(sum(quantity),0)::text,'lost_sales_quantity',coalesce(sum(lost_sales_quantity),0)::text
  ) into summary from demand;
  -- A late worker cannot publish after losing its lease.
  if l.expires_at<=clock_timestamp() then return false; end if;
  update public.planning_runs set status='succeeded',result=summary,finished_at=clock_timestamp(),error_code=null where id=r.id;
  perform pgmq.archive('planning',l.message_id);
  delete from planning.leases where run_id=r.id;
  return true;
end; $$;
revoke all on function app.planning_execute(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app.planning_execute(uuid,uuid) to maqdar_worker;

create function app.planning_fail(p_run_id uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.planning_runs; l planning.leases;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if not found or r.status<>'running' then return false; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return false; end if;
  if r.attempts>=3 then
    update public.planning_runs set status='failed',error_code='attempts_exhausted',finished_at=clock_timestamp() where id=r.id;
    perform pgmq.archive('planning',l.message_id);
    delete from planning.leases where run_id=r.id;
  else
    update public.planning_runs set status='queued',error_code='worker_error' where id=r.id;
    update planning.leases set token=null,expires_at=null where run_id=r.id;
    perform pgmq.set_vt('planning',l.message_id,15*r.attempts);
  end if;
  return true;
end; $$;
revoke all on function app.planning_fail(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app.planning_fail(uuid,uuid) to maqdar_worker;
reset lock_timeout;
