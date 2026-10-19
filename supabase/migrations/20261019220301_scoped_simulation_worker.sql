-- No tenant binding, LOGIN, password, queue purge or existing-row update.
-- Routing is activated separately by the reviewed owner-run binding script.
set lock_timeout='5s';
create role maqdar_simulation_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
grant maqdar_simulation_worker to postgres;
grant usage on schema app to maqdar_simulation_worker;

create table planning.simulation_worker_scopes (
 login_oid oid primary key,
 login_name name not null unique,
 organization_id uuid not null unique references public.organizations(id) on delete restrict,
 enabled boolean not null default true
);
alter table planning.simulation_worker_scopes enable row level security;
revoke all on planning.simulation_worker_scopes from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
comment on table planning.simulation_worker_scopes is
 'Operator-owned runtime identity binding. A disabled binding pauses consumption; it never routes back to the global consumer. OID plus name prevents dropped/recreated logins inheriting scope.';

create function app.simulation_scope_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('maqdar.simulation.routing',0));
 if tg_op='INSERT' or tg_op='DELETE' or
   (old.login_oid,old.login_name,old.organization_id) is distinct from (new.login_oid,new.login_name,new.organization_id) then
  if exists(select 1 from public.planning_runs where kind='simulation' and status in ('queued','running')
   and (organization_id=case when tg_op<>'INSERT' then old.organization_id end
    or organization_id=case when tg_op<>'DELETE' then new.organization_id end)) then
   raise exception using errcode='MQ409',message='simulation routing requires an idle organization';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 if not exists(select 1 from pg_roles where oid=new.login_oid and rolname=new.login_name
  and rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole and not rolbypassrls
  and pg_has_role(oid,'maqdar_simulation_worker','MEMBER') and not pg_has_role(oid,'maqdar_worker','MEMBER')) then
  raise exception using errcode='42501',message='dedicated simulation login required';
 end if;
 return new;
end; $$;
revoke all on function app.simulation_scope_guard() from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
create trigger simulation_scope_guard before insert or update or delete on planning.simulation_worker_scopes
 for each row execute function app.simulation_scope_guard();

create function app.scoped_simulation_identity() returns uuid
language plpgsql security definer set search_path='' as $$
declare organization uuid;
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('maqdar.simulation.routing',0));
 select s.organization_id into organization from planning.simulation_worker_scopes s
 join pg_roles r on r.oid=s.login_oid and r.rolname=s.login_name
 where r.rolname=session_user and s.enabled and r.rolcanlogin
  and not r.rolsuper and not r.rolcreatedb and not r.rolcreaterole and not r.rolbypassrls
  and pg_has_role(r.oid,'maqdar_simulation_worker','MEMBER') and not pg_has_role(r.oid,'maqdar_worker','MEMBER');
 if organization is null then raise exception using errcode='42501',message='simulation runtime is not enabled'; end if;
 return organization;
end; $$;

-- Selection is authorized BEFORE the equivalent of pgmq.read changes vt/read_ct.
-- Keep the existing queue-first + run-SKIP-LOCKED lock order and lease durations.
-- Null scope is the existing shared consumer; non-null scope is simulations only.
create function app.planning_claim_scoped(p_organization_id uuid)
returns table(run_id uuid,lease_token uuid)
language plpgsql security definer set search_path='' as $$
declare m record; r public.planning_runs; new_token uuid;
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('maqdar.simulation.routing',0));
 for n in 1..10 loop
  select q.*,p.id as resolved_run into m from pgmq.q_planning q
   left join public.planning_runs p on p.id::text=q.message->>'run_id'
   where q.vt<=clock_timestamp() and
    ((p_organization_id is not null and p.organization_id=p_organization_id and p.kind='simulation')
     or (p_organization_id is null and not exists(select 1 from planning.simulation_worker_scopes s
      where s.organization_id=p.organization_id and p.kind='simulation')))
   order by q.msg_id limit 1 for update of q skip locked;
  if not found then return; end if;
  update pgmq.q_planning set vt=clock_timestamp()+interval '120 seconds',read_ct=read_ct+1
   where msg_id=m.msg_id returning vt into m.vt;
  select * into r from public.planning_runs where id=m.resolved_run for update skip locked;
  if not found then
   if m.resolved_run is not null then continue; end if;
   perform pgmq.archive('planning',m.msg_id); continue;
  end if;
  if r.status not in ('queued','running') then perform pgmq.archive('planning',m.msg_id); continue; end if;
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
revoke all on function app.planning_claim_scoped(uuid) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;

create or replace function app.planning_claim()
returns table(run_id uuid,lease_token uuid)
language sql security definer set search_path='' as $$select * from app.planning_claim_scoped(null)$$;

create function app.scoped_simulation_claim()
returns table(run_id uuid,lease_token uuid)
language sql security definer set search_path='' as $$
 select * from app.planning_claim_scoped(app.scoped_simulation_identity())
$$;

create function app.scoped_simulation_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare organization uuid:=app.scoped_simulation_identity();
begin
 perform 1 from public.planning_runs where id=p_run_id and organization_id=organization and kind='simulation' for update;
 if not found then return null; end if;
 return app.simulation_task(p_run_id,p_token);
end; $$;
create function app.scoped_simulation_fail(p_run_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare organization uuid:=app.scoped_simulation_identity();
begin
 perform 1 from public.planning_runs where id=p_run_id and organization_id=organization and kind='simulation' for update;
 if not found then return false; end if;
 return app.planning_fail(p_run_id,p_token);
end; $$;
create function app.scoped_simulation_finish(p_run_id uuid,p_token uuid,p_output jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare organization uuid:=app.scoped_simulation_identity();
begin
 perform 1 from public.planning_runs where id=p_run_id and organization_id=organization and kind='simulation' for update;
 if not found then return false; end if;
 return app.simulation_finish(p_run_id,p_token,p_output);
end; $$;
revoke all on function app.scoped_simulation_identity(),app.scoped_simulation_claim(),app.scoped_simulation_task(uuid,uuid),
 app.scoped_simulation_fail(uuid,uuid),app.scoped_simulation_finish(uuid,uuid,jsonb)
 from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function app.scoped_simulation_identity(),app.scoped_simulation_claim(),app.scoped_simulation_task(uuid,uuid),
 app.scoped_simulation_fail(uuid,uuid),app.scoped_simulation_finish(uuid,uuid,jsonb) to maqdar_simulation_worker;
reset lock_timeout;
