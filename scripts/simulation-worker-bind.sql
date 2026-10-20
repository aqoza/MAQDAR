-- OWNER REVIEW REQUIRED. psql -v acme_organization=<verified UUID> -f this-file
-- Separate from migrations: creates ONE new restricted LOGIN and a PAUSED binding.
-- No password in this file or its arguments. Set it with psql's \password prompt.
\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
select set_config('maqdar.reviewed_acme', :'acme_organization', true);
do $$ begin
 if not exists(select 1 from public.organizations where id=current_setting('maqdar.reviewed_acme')::uuid
  and upper(btrim(name))='ACME') then
  raise exception 'reviewed ACME organization not found';
 end if;
 if exists(select 1 from pg_roles where rolname='maqdar_acme_simulation') then
  raise exception 'runtime login already exists; inspect before provisioning';
 end if;
end; $$;
create role maqdar_acme_simulation login noinherit nosuperuser nocreatedb nocreaterole nobypassrls connection limit 2;
grant connect on database postgres to maqdar_acme_simulation;
grant maqdar_simulation_worker to maqdar_acme_simulation;
insert into planning.simulation_worker_scopes(login_oid,login_name,organization_id,enabled)
 select oid,rolname,current_setting('maqdar.reviewed_acme')::uuid,false from pg_roles where rolname='maqdar_acme_simulation';
commit;
\password maqdar_acme_simulation
