-- Privilege snapshot (Step 5a). Since the import migration, new public tables and sequences are no
-- longer granted to the API roles by default, so every object needs explicit grants; this file
-- pins the result:
-- * for every public table and sequence, the privileges of anon, authenticated and service_role;
-- * EXECUTE on every function in public and app, for PUBLIC and the three API roles;
-- * the default ACL of postgres in public, schema usage, and the private ingest schema;
-- * every security-definer function pins search_path to ''.
-- A new table, sequence or function fails here until its grants are reviewed and added below.
-- No API role holds TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on a public table (the import
-- migration revoked them from service_role, now and by default), and public_holidays_id_seq is
-- service_role's only. Known and reviewed: the trigger functions app.set_updated_at() and
-- app.organizations_sync_locale() keep EXECUTE for PUBLIC (a trigger function cannot be called
-- directly); new public functions still default to EXECUTE for PUBLIC and the API roles (the
-- PUBLIC grant is a global built-in default a per-schema rule cannot revoke), so every RPC revokes
-- explicitly and the function snapshot below fails for any new function until it is reviewed.
begin;

select plan(12);

select set_eq(
  $$select c.relname::text collate "default", r.rolname, c.relkind::text,
           array_to_string(array(
             select p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p
             where has_table_privilege(r.rolname, c.oid, p)), ',')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'::text), ('authenticated'), ('service_role')) as r (rolname)
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')$$,
  $$values
    ('brands', 'anon', 'r', ''),
    ('brands', 'authenticated', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('brands', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('countries', 'anon', 'r', ''),
    ('countries', 'authenticated', 'r', 'SELECT'),
    ('countries', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('currencies', 'anon', 'r', ''),
    ('currencies', 'authenticated', 'r', 'SELECT'),
    ('currencies', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('demand_history', 'anon', 'p', ''),
    ('demand_history', 'authenticated', 'p', 'SELECT,INSERT,UPDATE,DELETE'),
    ('demand_history', 'service_role', 'p', 'SELECT,INSERT,UPDATE,DELETE'),
    ('fx_rates', 'anon', 'r', ''),
    ('fx_rates', 'authenticated', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('fx_rates', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('holiday_overrides', 'anon', 'r', ''),
    ('holiday_overrides', 'authenticated', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('holiday_overrides', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('import_batches', 'anon', 'r', ''),
    ('import_batches', 'authenticated', 'r', 'SELECT'),
    ('import_batches', 'service_role', 'r', 'SELECT,DELETE'),
    ('import_errors', 'anon', 'r', ''),
    ('import_errors', 'authenticated', 'r', 'SELECT'),
    ('import_errors', 'service_role', 'r', 'SELECT,DELETE'),
    ('import_files', 'anon', 'r', ''),
    ('import_files', 'authenticated', 'r', 'SELECT'),
    ('import_files', 'service_role', 'r', 'SELECT,DELETE'),
    ('item_interchanges', 'anon', 'r', ''),
    ('item_interchanges', 'authenticated', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('item_interchanges', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('item_supersessions', 'anon', 'r', ''),
    ('item_supersessions', 'authenticated', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('item_supersessions', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('items', 'anon', 'r', ''),
    ('items', 'authenticated', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('items', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('locations', 'anon', 'r', ''),
    ('locations', 'authenticated', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('locations', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('membership_locations', 'anon', 'r', ''),
    ('membership_locations', 'authenticated', 'r', 'SELECT'),
    ('membership_locations', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('memberships', 'anon', 'r', ''),
    ('memberships', 'authenticated', 'r', 'SELECT'),
    ('memberships', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('network_links', 'anon', 'r', ''),
    ('network_links', 'authenticated', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('network_links', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('organization_invitations', 'anon', 'r', ''),
    ('organization_invitations', 'authenticated', 'r', 'SELECT'),
    ('organization_invitations', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('organizations', 'anon', 'r', ''),
    ('organizations', 'authenticated', 'r', 'SELECT'),
    ('organizations', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('public_holidays', 'anon', 'r', ''),
    ('public_holidays', 'authenticated', 'r', 'SELECT'),
    ('public_holidays', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('ramadan_windows', 'anon', 'r', ''),
    ('ramadan_windows', 'authenticated', 'r', 'SELECT'),
    ('ramadan_windows', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('supplier_items', 'anon', 'r', ''),
    ('supplier_items', 'authenticated', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('supplier_items', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('suppliers', 'anon', 'r', ''),
    ('suppliers', 'authenticated', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('suppliers', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('user_settings', 'anon', 'r', ''),
    ('user_settings', 'authenticated', 'r', 'SELECT'),
    ('user_settings', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('work_calendars', 'anon', 'r', ''),
    ('work_calendars', 'authenticated', 'r', 'SELECT,INSERT,UPDATE,DELETE'),
    ('work_calendars', 'service_role', 'r', 'SELECT,INSERT,UPDATE,DELETE')$$,
  'every public table: the privileges of anon, authenticated and service_role match the reviewed snapshot'
);

select set_eq(
  $$select c.relname::text collate "default", r.rolname,
           array_to_string(array(
             select p from unnest(array['USAGE', 'SELECT', 'UPDATE']) as p
             where has_sequence_privilege(r.rolname, c.oid, p)), ',')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'::text), ('authenticated'), ('service_role')) as r (rolname)
    where n.nspname = 'public' and c.relkind = 'S'$$,
  $$values
    ('import_errors_id_seq', 'anon', ''),
    ('import_errors_id_seq', 'authenticated', ''),
    ('import_errors_id_seq', 'service_role', ''),
    ('public_holidays_id_seq', 'anon', ''),
    ('public_holidays_id_seq', 'authenticated', ''),
    ('public_holidays_id_seq', 'service_role', 'USAGE,SELECT,UPDATE')$$,
  'every public sequence: the privileges of anon, authenticated and service_role match the reviewed snapshot'
);

select set_eq(
  $$select (n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')') collate "default",
           array_to_string(array(
             select r from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r
             where has_function_privilege(r, p.oid, 'EXECUTE')), ',')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prokind in ('f', 'p')$$,
  $$values
    ('app.active_organization_claim()', 'authenticated,service_role'),
    ('app.admin_organizations()', 'authenticated,service_role'),
    ('app.approving_organizations()', 'authenticated,service_role'),
    ('app.can_edit(uuid)', 'authenticated,service_role'),
    ('app.custom_access_token_hook(jsonb)', ''),
    ('app.deletable_import_paths()', 'authenticated'),
    ('app.demand_history_window()', ''),
    ('app.editable_organizations()', 'authenticated,service_role'),
    ('app.ensure_demand_history_partitions(date, date)', 'service_role'),
    ('app.guard_location_parent_cycle()', ''),
    ('app.guard_supersession_cycle()', ''),
    ('app.import_add_counts(jsonb, jsonb)', ''),
    ('app.import_add_error(uuid, smallint, text, jsonb)', ''),
    ('app.import_analyze_demand_months(date, date)', ''),
    ('app.import_append_timing(jsonb, text, integer)', ''),
    ('app.import_batch_for_editor(uuid, boolean)', ''),
    ('app.import_batch_state(uuid)', ''),
    ('app.import_batch_tables(uuid)', ''),
    ('app.import_batches_drop_staging()', ''),
    ('app.import_check_cells(uuid, smallint, integer, integer)', ''),
    ('app.import_check_refs(uuid, smallint, integer, integer, text)', ''),
    ('app.import_check_sets(uuid, smallint)', ''),
    ('app.import_commit_atomic(uuid)', ''),
    ('app.import_commit_unit(uuid, integer)', ''),
    ('app.import_counts(integer, integer, integer, integer, integer)', ''),
    ('app.import_drop_staging(uuid, integer)', ''),
    ('app.import_failure_code(text, text, text)', ''),
    ('app.import_file_context(uuid, smallint, text)', ''),
    ('app.import_file_state(uuid, smallint)', ''),
    ('app.import_flush_errors(uuid, smallint)', ''),
    ('app.import_merge_brands(uuid, smallint, integer, integer)', ''),
    ('app.import_merge_demand_history(uuid, smallint, integer, integer)', ''),
    ('app.import_merge_fx_rates(uuid, smallint, integer, integer)', ''),
    ('app.import_merge_holiday_overrides(uuid, smallint, integer, integer)', ''),
    ('app.import_merge_item_interchanges(uuid, smallint, integer, integer)', ''),
    ('app.import_merge_item_supersessions(uuid, smallint, integer, integer)', ''),
    ('app.import_merge_items(uuid, smallint, integer, integer)', ''),
    ('app.import_merge_location_parents(uuid, smallint, integer, integer)', ''),
    ('app.import_merge_locations(uuid, smallint, integer, integer)', ''),
    ('app.import_merge_network_links(uuid, smallint, integer, integer)', ''),
    ('app.import_merge_supplier_items(uuid, smallint, integer, integer)', ''),
    ('app.import_merge_suppliers(uuid, smallint, integer, integer)', ''),
    ('app.import_merge_unit(uuid, smallint, text, integer, integer, integer)', ''),
    ('app.import_merge_work_calendars(uuid, smallint, integer, integer)', ''),
    ('app.import_nk(text, text[])', ''),
    ('app.import_prepare_stats(uuid, text[])', ''),
    ('app.import_provided(text, text[])', ''),
    ('app.import_require_resolved(integer)', ''),
    ('app.import_rows_brands(uuid, uuid, smallint, integer, integer)', ''),
    ('app.import_rows_demand_history(uuid, uuid, smallint, integer, integer)', ''),
    ('app.import_rows_fx_rates(uuid, uuid, smallint, integer, integer)', ''),
    ('app.import_rows_holiday_overrides(uuid, uuid, smallint, integer, integer)', ''),
    ('app.import_rows_item_interchanges(uuid, uuid, smallint, integer, integer)', ''),
    ('app.import_rows_item_supersessions(uuid, uuid, smallint, integer, integer)', ''),
    ('app.import_rows_items(uuid, uuid, smallint, integer, integer)', ''),
    ('app.import_rows_locations(uuid, uuid, smallint, integer, integer)', ''),
    ('app.import_rows_network_links(uuid, uuid, smallint, integer, integer)', ''),
    ('app.import_rows_supplier_items(uuid, uuid, smallint, integer, integer)', ''),
    ('app.import_rows_suppliers(uuid, uuid, smallint, integer, integer)', ''),
    ('app.import_rows_work_calendars(uuid, uuid, smallint, integer, integer)', ''),
    ('app.import_staging_intact(uuid, boolean)', ''),
    ('app.import_sweep(integer, uuid)', ''),
    ('app.is_member(uuid)', 'authenticated,service_role'),
    ('app.lock_memberships(uuid)', 'service_role'),
    ('app.member_organizations()', 'authenticated,service_role'),
    ('app.membership_role(uuid)', 'service_role'),
    ('app.normalize_search(text)', 'authenticated,service_role'),
    ('app.organizations_sync_locale()', 'public,anon,authenticated,service_role'),
    ('app.refuse_delete_with_demand()', ''),
    ('app.require_import_editor(uuid)', ''),
    ('app.require_role(uuid, text[])', 'service_role'),
    ('app.require_user()', 'service_role'),
    ('app.scoped_locations()', 'authenticated,service_role'),
    ('app.set_updated_at()', 'public,anon,authenticated,service_role'),
    ('app.unscoped_organizations()', 'authenticated,service_role'),
    ('app.uploadable_import_paths()', 'authenticated'),
    ('public.accept_invitation(uuid)', 'authenticated,service_role'),
    ('public.create_organization(text, text, character, character, boolean)', 'authenticated,service_role'),
    ('public.import_cancel_step(uuid)', 'authenticated'),
    ('public.import_commit_step(uuid, integer)', 'authenticated'),
    ('public.import_create_batch(uuid, uuid, jsonb)', 'authenticated'),
    ('public.import_delete(uuid)', 'authenticated'),
    ('public.import_resume(uuid)', 'authenticated'),
    ('public.import_seal_file(uuid, smallint, integer)', 'authenticated'),
    ('public.import_stage_chunk(uuid, smallint, integer, text)', 'authenticated'),
    ('public.invite_member(uuid, text, text)', 'authenticated,service_role'),
    ('public.my_invitations()', 'authenticated,service_role'),
    ('public.my_organizations()', 'authenticated,service_role'),
    ('public.organization_members(uuid)', 'authenticated,service_role'),
    ('public.remove_member(uuid, uuid)', 'authenticated,service_role'),
    ('public.revoke_invitation(uuid)', 'authenticated,service_role'),
    ('public.set_active_organization(uuid)', 'authenticated,service_role'),
    ('public.set_member_locations(uuid, uuid, uuid[])', 'authenticated,service_role'),
    ('public.set_member_role(uuid, uuid, text)', 'authenticated,service_role'),
    ('public.update_organization_preferences(uuid, text, text, text)', 'authenticated,service_role'),
    ('public.update_organization_settings(uuid, text, character, character, boolean)', 'authenticated,service_role')$$,
  'every public and app function: EXECUTE for PUBLIC, anon, authenticated and service_role matches the reviewed snapshot'
);

select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_table_privilege('anon', c.oid, p)),
  0,
  'anon has no privilege on any public table'
);
select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p
   cross join unnest(array['anon', 'authenticated', 'service_role']) as r
   where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege(r, c.oid, p)),
  0,
  'no API role has TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on any public table'
);

-- Default privileges of postgres (the migration owner) in public.
select is(
  (select count(*)::int
   from pg_default_acl d
   cross join lateral aclexplode(d.defaclacl) as a
   join pg_roles r on r.oid = a.grantee
   where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype = 'r' and r.rolname in ('anon', 'authenticated', 'service_role')
     and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')),
  0,
  'new public tables are not granted SELECT, INSERT, UPDATE or DELETE to any API role by default'
);
select is(
  (select count(*)::int
   from pg_default_acl d
   cross join lateral aclexplode(d.defaclacl) as a
   join pg_roles r on r.oid = a.grantee
   where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype = 'S' and r.rolname in ('anon', 'authenticated', 'service_role')),
  0,
  'new public sequences are not granted to any API role by default'
);
select set_eq(
  $$select r.rolname::text collate "default", d.defaclobjtype::text, a.privilege_type::text collate "default"
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) as a
    join pg_roles r on r.oid = a.grantee
    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
      and r.rolname in ('anon', 'authenticated', 'service_role')$$,
  $$values ('anon', 'f', 'EXECUTE'), ('authenticated', 'f', 'EXECUTE'), ('service_role', 'f', 'EXECUTE')$$,
  'the default ACL of postgres in public grants the API roles exactly the reviewed set'
);

-- Schemas.
select set_eq(
  $$select n.nspname::text collate "default", r.rolname, p.privilege
    from pg_namespace n
    cross join (values ('anon'::text), ('authenticated'), ('service_role')) as r (rolname)
    cross join (values ('USAGE'::text), ('CREATE')) as p (privilege)
    where n.nspname in ('public', 'app', 'ingest', 'partitions') and has_schema_privilege(r.rolname, n.oid, p.privilege)$$,
  $$values ('public', 'anon', 'USAGE'), ('public', 'authenticated', 'USAGE'), ('public', 'service_role', 'USAGE'),
           ('app', 'authenticated', 'USAGE'), ('app', 'service_role', 'USAGE')$$,
  'schema privileges: public for the API roles, app for authenticated and service_role, ingest and partitions for none, CREATE nowhere'
);
select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['anon', 'authenticated', 'service_role']) as r
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p
   where n.nspname = 'ingest' and c.relkind in ('r', 'p') and has_table_privilege(r, c.oid, p)),
  0,
  'no API role has any privilege on an ingest table'
);

-- search_path pinning.
select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app') and p.prosecdef
     and not coalesce(p.proconfig[1] = 'search_path=""', false)),
  0,
  'every security-definer function in public and app pins search_path to the empty string'
);
select results_eq(
  $$select (n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')') collate "default"
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) as c where c like 'search_path=%')
    order by 1$$,
  $$values ('app.import_nk(text, text[])'::text)$$,
  'only app.import_nk has no pinned search_path (deliberately inlinable, executable by no API role)'
);

select * from finish();

rollback;
