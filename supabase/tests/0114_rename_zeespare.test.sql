begin;
select plan(9);

-- No live database object still carries the retired internal name.
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prosrc ilike '%maqdar%' and n.nspname not in ('pg_catalog','information_schema')),0,
  'no function body names maqdar');
select is((select count(*)::int from pg_roles where rolname ilike 'maqdar%_worker'),0,
  'no maqdar capability roles remain');
select is((select count(*)::int from cron.job where jobname ilike 'maqdar%'),0,'no maqdar cron jobs remain');
select is((select count(*)::int from pg_description where description ilike '%maqdar%'),0,'no comment names maqdar');

-- Renamed capability roles stay NOLOGIN capabilities.
select ok(exists(select 1 from pg_roles where rolname='zeespare_worker' and not rolcanlogin),'zeespare_worker is a NOLOGIN role');
select ok(exists(select 1 from pg_roles where rolname='zeespare_simulation_worker' and not rolcanlogin),
  'zeespare_simulation_worker is a NOLOGIN role');
select set_eq($$select jobname::text from cron.job where jobname like 'zeespare-%'$$,
  array['zeespare-demand-partitions','zeespare-import-housekeeping'],'cron jobs are renamed');

-- New keys use zeespare_sk_; old display prefixes remain valid only for historical rows.
select is((select pg_get_constraintdef(oid) from pg_constraint where conname='api_keys_display_prefix_check'),
  $$CHECK ((display_prefix ~ '^(zeespare|maqdar)_sk_[0-9A-Za-z]{4}$'::text))$$,'display prefix accepts the legacy branch for history');
select ok((select prosrc from pg_proc where oid='public.create_api_key(uuid,text,text[],integer,bytea,text,text)'::regprocedure)
  like '%^zeespare_sk_%','create_api_key accepts only zeespare_sk_ prefixes');

select * from finish();
rollback;
