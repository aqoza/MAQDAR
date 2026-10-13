-- Import pipeline (Step 5a): privileges and isolation of the import tables and the ingest schema,
-- the RPC role matrix, import_create_batch caps and mapping checks, idempotent creation, chunk
-- staging (exact replays, overlaps, shape), sealing (contiguity, rows_total, the original in
-- Storage), validated versus invalid, commit refusals (errors, status, validation older than
-- 24 hours, another committing batch), the sweep (expiry, abandoned commits, staging cleanup),
-- cancel (a failed stepped commit keeps the rows it applied) and the delete rules, the creation
-- cap counted in the ledger (deleted imports still count), lost UNLOGGED staging (atomic and
-- stepped commits end expired with staging_lost instead of succeeding; a seal refuses), and a
-- stepped commit idle for more than 30 minutes (its own next step continues it; cancel abandons
-- it).
-- Cell, row and set validation is in 0017, merges in 0018. The try-lock (import_in_progress)
-- needs a second session and is covered by engine/tests/test_import_concurrency.py.
-- Everything runs in one transaction, so now() is fixed: expiry, abandonment and old validations
-- are simulated by moving timestamps back as postgres.
begin;

select plan(198);

------------------------------------------------------------------------------------------------
-- Helpers (created as postgres; pg_temp functions run with the privileges of the calling role)
------------------------------------------------------------------------------------------------

-- "<sqlstate> <hint>" of a statement that is expected to fail, or 'no error'.
create function pg_temp.err(statement text)
returns text
language plpgsql
as $$
declare
  v_state text;
  v_hint text;
begin
  execute statement;
  return 'no error';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return rtrim(v_state || ' ' || coalesce(v_hint, ''));
end;
$$;

-- The sqlstate alone (privilege errors carry a server-specific hint).
create function pg_temp.state(statement text)
returns text
language sql
as $$
  select split_part(pg_temp.err(statement), ' ', 1);
$$;

-- Batch ids of this file: 00000000-0000-4000-8000-a16b0000000n.
create function pg_temp.batch(n integer)
returns uuid
language sql
immutable
as $$
  select ('00000000-0000-4000-8000-a16b' || lpad(n::text, 8, '0'))::uuid;
$$;

-- One manifest entry of import_create_batch.
create function pg_temp.file(p_file_no integer, p_entity text, p_columns text[], p_rows_total integer, p_size bigint default 100)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'file_no', p_file_no, 'entity', p_entity, 'original_name', p_entity || '.csv', 'extension', 'csv',
    'content_type', 'text/csv', 'size_bytes', p_size,
    'sha256', encode(sha256(convert_to(p_entity || ':' || p_file_no || ':' || p_rows_total, 'UTF8')), 'hex'),
    'rows_total', p_rows_total, 'columns', to_jsonb(p_columns));
$$;

create function pg_temp.new_batch(p_batch uuid, p_files jsonb, p_organization uuid default '00000000-0000-4000-8000-a16000000000')
returns jsonb
language sql
as $$
  select public.import_create_batch(p_batch, p_organization, p_files);
$$;

create function pg_temp.stage(p_batch uuid, p_file_no integer, p_first_row integer, p_rows text)
returns jsonb
language sql
as $$
  select public.import_stage_chunk(p_batch, p_file_no::smallint, p_first_row, p_rows);
$$;

create function pg_temp.seal(p_batch uuid, p_file_no integer, p_rows_total integer)
returns jsonb
language sql
as $$
  select public.import_seal_file(p_batch, p_file_no::smallint, p_rows_total);
$$;

-- Chunk rows [row_no, brand_code, name_en, null x 4] for a brands file that maps brand_code, name_en.
create function pg_temp.brand_rows(p_first_row integer, variadic p_codes text[])
returns text
language sql
immutable
as $$
  select jsonb_agg(jsonb_build_array(p_first_row + u.o - 1, u.code, 'Brand ' || u.code, null, null, null, null) order by u.o)::text
  from unnest(p_codes) with ordinality as u(code, o);
$$;

-- Chunk rows for an items file that maps item_code, name_en, brand_code, product_group,
-- unit_of_measure, unit_cost and currency (positions 1, 2 and 4-8 of 11).
create function pg_temp.item_rows(p_first_row integer, p_brand text, variadic p_codes text[])
returns text
language sql
immutable
as $$
  select jsonb_agg(jsonb_build_array(p_first_row + u.o - 1, u.code, 'Item ' || u.code, null, p_brand, 'battery', 'EA', '1', 'SAR', null, null, null) order by u.o)::text
  from unnest(p_codes) with ordinality as u(code, o);
$$;

create function pg_temp.items_columns()
returns text[]
language sql
immutable
as $$
  select array['item_code', 'name_en', 'brand_code', 'product_group', 'unit_of_measure', 'unit_cost', 'currency'];
$$;

-- "batches/files/errors" the calling role can read.
create function pg_temp.visible()
returns text
language sql
stable
as $$
  select format('%s/%s/%s', (select count(*) from public.import_batches), (select count(*) from public.import_files),
                (select count(*) from public.import_errors));
$$;

-- The outcome of the six batch-scoped RPCs (stage, seal, commit, resume, cancel, delete).
create function pg_temp.batch_calls(p_batch uuid, p_states_only boolean default false)
returns text
language sql
as $$
  select string_agg(case when p_states_only then split_part(r.e, ' ', 1) else r.e end, ',' order by r.n)
  from (values
    (1, pg_temp.err(format('select pg_temp.stage(%L, 1, 1, %L)', p_batch, '[[1, "X-1", "X", null, null, null, null]]'))),
    (2, pg_temp.err(format('select pg_temp.seal(%L, 1, 1)', p_batch))),
    (3, pg_temp.err(format('select public.import_commit_step(%L)', p_batch))),
    (4, pg_temp.err(format('select public.import_resume(%L)', p_batch))),
    (5, pg_temp.err(format('select public.import_cancel_step(%L)', p_batch))),
    (6, pg_temp.err(format('select public.import_delete(%L)', p_batch)))
  ) as r(n, e);
$$;

-- Calls import_commit_step until the batch leaves committing (at most 50 calls).
create function pg_temp.commit_until_settled(p_batch uuid)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
  v_calls integer := 0;
begin
  loop
    v_result := public.import_commit_step(p_batch);
    v_calls := v_calls + 1;
    exit when v_result ->> 'status' <> 'committing' or v_calls >= 50;
  end loop;
  return v_result;
end;
$$;

-- RPC results that several assertions look at.
create temp table results (name text primary key, result jsonb) on commit drop;
grant select, insert on pg_temp.results to authenticated;

------------------------------------------------------------------------------------------------
-- Fixture (as postgres). Organization A: planner, viewer, branch user, owner, and a user who is a
-- planner in A and B (the stale-tab case). Organization B: its owner. One brand in A that a
-- stepped commit loses after validation.
------------------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-a16000000001', 'imp16-planner-a@test.local', now()),
  ('00000000-0000-4000-8000-a16000000002', 'imp16-viewer-a@test.local', now()),
  ('00000000-0000-4000-8000-a16000000003', 'imp16-branch-a@test.local', now()),
  ('00000000-0000-4000-8000-a16000000004', 'imp16-owner-a@test.local', now()),
  ('00000000-0000-4000-8000-a16000000005', 'imp16-dual@test.local', now()),
  ('00000000-0000-4000-8000-b16000000001', 'imp16-owner-b@test.local', now());
insert into public.organizations (id, slug, name)
values
  ('00000000-0000-4000-8000-a16000000000', 'imp16-org-a', 'Org A'),
  ('00000000-0000-4000-8000-b16000000000', 'imp16-org-b', 'Org B');
insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-a16000000000', '00000000-0000-4000-8000-a16000000001', 'planner'),
  ('00000000-0000-4000-8000-a16000000000', '00000000-0000-4000-8000-a16000000002', 'viewer'),
  ('00000000-0000-4000-8000-a16000000000', '00000000-0000-4000-8000-a16000000003', 'branch_user'),
  ('00000000-0000-4000-8000-a16000000000', '00000000-0000-4000-8000-a16000000004', 'owner'),
  ('00000000-0000-4000-8000-a16000000000', '00000000-0000-4000-8000-a16000000005', 'planner'),
  ('00000000-0000-4000-8000-b16000000000', '00000000-0000-4000-8000-b16000000001', 'owner'),
  ('00000000-0000-4000-8000-b16000000000', '00000000-0000-4000-8000-a16000000005', 'planner');
insert into public.brands (id, organization_id, code, name_en)
values ('00000000-0000-4000-8000-a16030000001', '00000000-0000-4000-8000-a16000000000', 'BR-GONE', 'Deleted after validation');

------------------------------------------------------------------------------------------------
-- Structure (as postgres): ingest is private, the import tables are select-only, RPC grants
------------------------------------------------------------------------------------------------
select is(
  array(select r || ':' || p
        from unnest(array['anon', 'authenticated', 'service_role']) as r
        cross join unnest(array['USAGE', 'CREATE']) as p
        where has_schema_privilege(r, 'ingest', p)),
  '{}'::text[],
  'ingest: no usage or create for anon, authenticated or service_role'
);
select tables_are(
  'ingest',
  array['contract_entities', 'contract_columns', 'staged_rows', 'staged_chunks', 'pending_errors', 'import_creations'],
  'ingest holds the two contract tables, the three staging tables and the creation ledger'
);
select is(
  array(select c.relname::text from pg_class c
        where c.relnamespace = 'ingest'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
        order by 1),
  '{}'::text[],
  'ingest: row level security is enabled on every table'
);
select is(
  array(select c.relname || ':' || r || ':' || p
        from pg_class c
        cross join unnest(array['anon', 'authenticated', 'service_role']) as r
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p
        where c.relnamespace = 'ingest'::regnamespace and c.relkind = 'r' and has_table_privilege(r, c.oid, p)),
  '{}'::text[],
  'ingest: no table privilege for any API role'
);
select is(
  array(select t || ':' || p
        from unnest(array['import_batches', 'import_files', 'import_errors']) as t
        cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as p
        where has_table_privilege('authenticated', 'public.' || t, p)),
  '{}'::text[],
  'authenticated cannot write the import tables (RPC only)'
);
select is(
  array(select t from unnest(array['import_batches', 'import_files', 'import_errors']) as t
        where not has_table_privilege('authenticated', 'public.' || t, 'SELECT')
           or has_table_privilege('anon', 'public.' || t, 'SELECT')),
  '{}'::text[],
  'authenticated may select the import tables, anon may not'
);
select policies_are('public', 'import_batches', array['editors read'], 'import_batches has the single editors read policy');
select policies_are('public', 'import_files', array['editors read'], 'import_files has the single editors read policy');
select policies_are('public', 'import_errors', array['editors read'], 'import_errors has the single editors read policy');
select is(
  (select string_agg(p.proname, ',' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'import\_%'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE')),
  'import_cancel_step,import_commit_step,import_create_batch,import_delete,import_resume,import_seal_file,import_stage_chunk',
  'the seven import RPCs are executable by authenticated only'
);
select is(
  array(select p.oid::regprocedure::text
        from pg_proc p
        where p.pronamespace = 'app'::regnamespace
          and (p.proname like 'import\_%' or p.proname in ('require_import_editor', 'demand_history_window'))
          and (has_function_privilege('anon', p.oid, 'EXECUTE')
               or has_function_privilege('authenticated', p.oid, 'EXECUTE')
               or has_function_privilege('service_role', p.oid, 'EXECUTE'))),
  '{}'::text[],
  'no API role may execute the internal import functions'
);

------------------------------------------------------------------------------------------------
-- Role matrix of import_create_batch
------------------------------------------------------------------------------------------------
set local role anon;
select is(
  pg_temp.state($$select pg_temp.new_batch(pg_temp.batch(90), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))$$),
  '42501',
  'anon cannot call import_create_batch'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
set local request.jwt.claim.sub = '';
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(90), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))$$),
  'MQ401',
  'signed out: MQ401'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a16000000002", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a16000000002';
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(90), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))$$),
  'MQ403 role',
  'a viewer of A gets MQ403 role'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a16000000003", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a16000000003';
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(90), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))$$),
  'MQ403 role',
  'a branch user of A gets MQ403 role'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-b16000000001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-b16000000001';
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(90), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))$$),
  'MQ404 organization_id',
  'the owner of B importing into A gets MQ404 organization_id'
);

-- The planner of A and B on a tab whose token still names B.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a16000000005", "role": "authenticated", "org_id": "00000000-0000-4000-8000-b16000000000"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a16000000005';
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(90), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))$$),
  'MQ404 organization_id',
  'a stale org_id claim (B) importing into A gets MQ404 organization_id'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a16000000005", "role": "authenticated", "org_id": "00000000-0000-4000-8000-a16000000000"}';
select is(
  (pg_temp.new_batch(pg_temp.batch(90), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))) ->> 'status',
  'staging',
  'the same user with the org_id claim of A creates the import'
);
select is(
  (public.import_cancel_step(pg_temp.batch(90))) ->> 'status',
  'canceled',
  'and cancels it'
);
select lives_ok($$select public.import_delete(pg_temp.batch(90))$$, 'and deletes it');

------------------------------------------------------------------------------------------------
-- import_create_batch: manifest checks (planner of A, no org_id claim)
------------------------------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a16000000001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a16000000001';

select is(pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), '{}'::jsonb)$$), 'MQ422 files', 'files must be an array');
select is(pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), '[]'::jsonb)$$), 'MQ422 files', 'an import has at least one file');
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99),
    (select jsonb_agg(pg_temp.file(i, 'demand_history', array['item_code', 'location_code', 'demand_date', 'quantity'], 1))
     from generate_series(1, 61) as i))$$),
  'MQ422 files',
  'an import has at most 60 files'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(null, jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))$$),
  'MQ422 batch_id',
  'the import id is required'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(pg_temp.file(1, 'widgets', array['widget_code'], 1)))$$),
  'MQ422 mapping',
  'an unknown entity is MQ422 mapping'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(
    pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1), pg_temp.file(2, 'brands', array['brand_code', 'name_en'], 1)))$$),
  'MQ422 files',
  'a master-data entity appears in one file only'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en', 'colour'], 1)))$$),
  'MQ422 mapping',
  'an unknown column is MQ422 mapping'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en', 'name_en'], 1)))$$),
  'MQ422 mapping',
  'a column mapped twice is MQ422 mapping'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(pg_temp.file(1, 'items', array['name_en', 'product_group'], 1)))$$),
  'MQ422 mapping',
  'a missing key column is MQ422 mapping'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(
    pg_temp.file(1, 'holiday_overrides', array['country_code', 'starts_on', 'ends_on', 'kind', 'name_en'], 1)))$$),
  'MQ422 mapping',
  'a nullable key column (holiday work_calendar_code) must be mapped too'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(pg_temp.file(1, 'items', array['item_code', 'unit_cost'], 1)))$$),
  'MQ422 mapping',
  'an incomplete column group (unit_cost without currency) is MQ422 mapping'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(
    pg_temp.file(1, 'demand_history', array['item_code', 'location_code', 'demand_date'], 1)))$$),
  'MQ422 mapping',
  'a demand file without a quantity column is MQ422 mapping'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1, 50000001)))$$),
  'MQ422 size_bytes',
  'a file of more than 50,000,000 bytes is refused'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1000001)))$$),
  'MQ422 rows_total',
  'a file of more than 1,000,000 rows is refused'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(
    pg_temp.file(1, 'demand_history', array['item_code', 'location_code', 'demand_date', 'quantity'], 600000),
    pg_temp.file(2, 'demand_history', array['item_code', 'location_code', 'demand_date', 'quantity'], 400001)))$$),
  'MQ422 rows_total',
  'an import of more than 1,000,000 rows in all is refused'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(
    pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1) || jsonb_build_object('sha256', upper(encode(sha256('x'::bytea), 'hex')))))$$),
  'MQ422 sha256',
  'sha256 is lower-case hex'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(
    pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1) || '{"extension": "xls"}'::jsonb))$$),
  'MQ422 extension',
  'only csv, tsv, txt and xlsx are accepted'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(
    pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1) || '{"original_name": ""}'::jsonb))$$),
  'MQ422 original_name',
  'original_name has 1 to 255 characters'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(pg_temp.file(61, 'brands', array['brand_code', 'name_en'], 1)))$$),
  'MQ422 file_no',
  'file_no is 1 to 60'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(
    pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1) || '{"file_no": "1"}'::jsonb))$$),
  'MQ422 file_no',
  'file_no is a JSON number'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(99), jsonb_build_array(
    pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1), pg_temp.file(1, 'items', array['item_code'], 1)))$$),
  'MQ422 file_no',
  'a file number appears once'
);
select is(pg_temp.visible(), '0/0/0', 'refused manifests leave nothing behind');

------------------------------------------------------------------------------------------------
-- K1: a brands file and an items file with errors. Idempotent creation.
------------------------------------------------------------------------------------------------
create function pg_temp.k1_files()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 2, 50000000),
    pg_temp.file(2, 'items', pg_temp.items_columns(), 5));
$$;

insert into pg_temp.results values ('k1', pg_temp.new_batch(pg_temp.batch(1), pg_temp.k1_files()));
select is(
  (select format('%s %s %s', r.result ->> 'status', r.result ->> 'rows_total', r.result ->> 'error_count') from pg_temp.results r where r.name = 'k1'),
  'staging 7 0',
  'create returns a staging batch with 7 rows declared (a 50,000,000-byte file is accepted)'
);
select is(
  (select r.result -> 'files' from pg_temp.results r where r.name = 'k1'),
  '[{"file_no": 1, "entity": "brands", "storage_path": "00000000-0000-4000-8000-a16000000000/00000000-0000-4000-8000-a16b00000001/1.csv"},
    {"file_no": 2, "entity": "items", "storage_path": "00000000-0000-4000-8000-a16000000000/00000000-0000-4000-8000-a16b00000001/2.csv"}]'::jsonb,
  'create returns the server-generated storage paths <organization>/<batch>/<file_no>.<extension>'
);
select is(
  (select format('%s %s %s %s', b.created_by, b.file_count, b.source, b.expires_at = now() + interval '24 hours')
   from public.import_batches b where b.id = pg_temp.batch(1)),
  '00000000-0000-4000-8000-a16000000001 2 wizard t',
  'the batch records its creator, two files, source wizard and a 24-hour expiry'
);
select is(
  (select array_agg(f.columns::text order by f.file_no) from public.import_files f where f.batch_id = pg_temp.batch(1)),
  array['{brand_code,name_en}', '{item_code,name_en,brand_code,product_group,unit_of_measure,unit_cost,currency}'],
  'the files keep the mapped columns in contract order'
);
select is(
  (pg_temp.new_batch(pg_temp.batch(1), pg_temp.k1_files())) -> 'files',
  (select r.result -> 'files' from pg_temp.results r where r.name = 'k1'),
  'a retry with the same id and manifest returns the same import'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(1), pg_temp.k1_files() || jsonb_build_array(pg_temp.file(3, 'suppliers', array['supplier_code'], 1)))$$),
  'MQ409 batch_id',
  'the same id with another manifest is MQ409 batch_id'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a16000000004", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a16000000004';
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(1), pg_temp.k1_files())$$),
  'MQ409 batch_id',
  'the same id and manifest from another user (the owner of A) is MQ409 batch_id'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-b16000000001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-b16000000001';
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(1), pg_temp.k1_files(), '00000000-0000-4000-8000-b16000000000')$$),
  'MQ409 batch_id',
  'the same id in another organization is MQ409 batch_id'
);

------------------------------------------------------------------------------------------------
-- K1: chunks (planner of A)
------------------------------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a16000000001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a16000000001';

select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 2, 1, pg_temp.item_rows(1, 'BR-NEW', 'P-1', 'P-2'))$$),
  'MQ409 parent',
  'items cannot stage before the brands file of the same import is sealed'
);

insert into pg_temp.results values ('k1_chunk1', pg_temp.stage(pg_temp.batch(1), 1, 1, pg_temp.brand_rows(1, 'BR-NEW')));
select is(
  (select format('%s %s %s %s', r.result ->> 'staged', r.result ->> 'errors_added', r.result ->> 'replayed', r.result -> 'batch' ->> 'rows_staged')
   from pg_temp.results r where r.name = 'k1_chunk1'),
  '1 0 false 1',
  'a brands chunk stages one row without errors'
);
select is(
  (pg_temp.stage(pg_temp.batch(1), 1, 1, pg_temp.brand_rows(1, 'BR-NEW'))) - 'replayed',
  (select r.result - 'replayed' from pg_temp.results r where r.name = 'k1_chunk1'),
  'an exact replay returns the stored result'
);
select is(
  (pg_temp.stage(pg_temp.batch(1), 1, 1, pg_temp.brand_rows(1, 'BR-NEW'))) ->> 'replayed',
  'true',
  'and says it was a replay'
);
select is(
  (select format('%s %s', b.rows_staged, b.error_count) from public.import_batches b where b.id = pg_temp.batch(1)),
  '1 0',
  'replays stage nothing more'
);
select throws_ok(
  $$select pg_temp.stage(pg_temp.batch(1), 1, 1, pg_temp.brand_rows(1, 'BR-OTHER'))$$,
  'MQ409', 'a different chunk was already staged at this row',
  'a different chunk at a staged first_row is MQ409'
);

-- Shape: every row is [row_no, 6 cells], a string for provided columns and null otherwise.
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 2, '[[2, "BR-X", "X", null, null, null]]')$$),
  'MQ422 rows',
  'a row with too few cells is MQ422 rows'
);
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 2, '[[2, "BR-X", "X", null, null, null, null, null]]')$$),
  'MQ422 rows',
  'a row with too many cells is MQ422 rows'
);
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 2, '[[3, "BR-X", "X", null, null, null, null]]')$$),
  'MQ422 rows',
  'a row number that does not continue from first_row is MQ422 rows'
);
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 2, '[[2, null, "X", null, null, null, null]]')$$),
  'MQ422 rows',
  'null in a provided column is MQ422 rows'
);
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 2, '[[2, "BR-X", "X", "اسم", null, null, null]]')$$),
  'MQ422 rows',
  'a value in a column the file does not provide is MQ422 rows'
);
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 2, '[[2, "BR-X", 5, null, null, null, null]]')$$),
  'MQ422 rows',
  'a number cell is MQ422 rows (cells are canonical strings)'
);
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 2, '[["2", "BR-X", "X", null, null, null, null]]')$$),
  'MQ422 rows',
  'a row number given as a string is MQ422 rows'
);
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 2, '[[2, "BR-X", "' || repeat('x', 4001) || '", null, null, null, null]]')$$),
  'MQ422 rows',
  'a cell of more than 4,000 characters is MQ422 rows'
);
select is(pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 2, 'not json')$$), 'MQ422 rows', 'text that is not JSON is MQ422 rows');
select is(pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 2, '{}')$$), 'MQ422 rows', 'an object is MQ422 rows');
select is(pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 2, '[]')$$), 'MQ422 rows', 'an empty chunk is MQ422 rows');
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 0, '[[0, "BR-X", "X", null, null, null, null]]')$$),
  'MQ422 first_row',
  'first_row starts at 1'
);
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 2, pg_temp.brand_rows(2, 'BR-X', 'BR-Y'))$$),
  'MQ422 rows',
  'rows beyond the declared rows_total are MQ422 rows'
);
select throws_ok(
  $$select pg_temp.stage(pg_temp.batch(1), 1, 2,
    (select jsonb_agg(jsonb_build_array(i, 'BR-' || i, 'n', null, null, null, null) order by i)::text from generate_series(2, 5002) as i))$$,
  'MQ422', 'a chunk has 1 to 5000 rows',
  'a master-data chunk holds at most 5,000 rows'
);
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 9, 1, pg_temp.brand_rows(1, 'BR-X'))$$),
  'MQ404 file_no',
  'an unknown file number is MQ404 file_no'
);
select is(
  (select format('%s %s', f.rows_staged, f.error_count) from public.import_files f where f.batch_id = pg_temp.batch(1) and f.file_no = 1),
  '1 0',
  'refused chunks stage nothing'
);

-- Seal: contiguity, rows_total, then the original (missing: warning).
select is(pg_temp.err($$select pg_temp.seal(pg_temp.batch(1), 1, 2)$$), 'MQ409 chunks', 'a file with rows missing cannot be sealed');

insert into pg_temp.results values (
  'k1_chunk2',
  pg_temp.stage(pg_temp.batch(1), 1, 2, '[[2, "BR-LONG", "' || repeat('x', 4000) || '", null, null, null, null]]'));
select is(
  (select format('%s %s', r.result ->> 'staged', r.result ->> 'errors_added') from pg_temp.results r where r.name = 'k1_chunk2'),
  '1 1',
  'a cell of exactly 4,000 characters stages and is reported per cell'
);
select is(
  (select format('%s %s %s %s', e.row_no, e.column_name, e.code, char_length(e.value))
   from public.import_errors e where e.batch_id = pg_temp.batch(1) and e.file_no = 1 and e.level = 'error'),
  '2 name_en too_long 200',
  'too_long names the column and keeps 200 characters of the value'
);
select is(pg_temp.err($$select pg_temp.seal(pg_temp.batch(1), 1, 3)$$), 'MQ422 rows_total', 'sealing with another rows_total is MQ422');

insert into pg_temp.results values ('k1_seal1', pg_temp.seal(pg_temp.batch(1), 1, 2));
select is(
  (select format('%s %s %s %s %s', r.result ->> 'status', r.result ->> 'source_stored', r.result ->> 'error_count',
                 r.result ->> 'warning_count', r.result -> 'batch' ->> 'status')
   from pg_temp.results r where r.name = 'k1_seal1'),
  'sealed false 1 1 staging',
  'the sealed brands file has its error and one warning; the batch stays staging while files remain'
);
select is(
  (select format('%s %s %s %s', e.row_no, e.column_name, e.level, e.detail)
   from public.import_errors e where e.batch_id = pg_temp.batch(1) and e.file_no = 1 and e.code = 'source_missing'),
  '0  warning {"storage_path": "00000000-0000-4000-8000-a16000000000/00000000-0000-4000-8000-a16b00000001/1.csv"}',
  'no original in Storage: a source_missing warning on row 0 names the path'
);
select is(
  (pg_temp.seal(pg_temp.batch(1), 1, 2)) - 'batch',
  (select r.result - 'batch' from pg_temp.results r where r.name = 'k1_seal1'),
  'sealing again returns the state and adds nothing'
);
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(1), 1, 3, pg_temp.brand_rows(3, 'BR-Z'))$$),
  'MQ409 status',
  'a sealed file takes no more chunks'
);

-- Items: the brand comes from the sealed brands file; an overlap; duplicates across and within chunks.
select is(
  (pg_temp.stage(pg_temp.batch(1), 2, 1, pg_temp.item_rows(1, 'BR-NEW', 'P-1', 'P-2'))) ->> 'errors_added',
  '0',
  'items referring to a brand of the sealed brands file stage without errors'
);
select throws_ok(
  $$select pg_temp.stage(pg_temp.batch(1), 2, 2, pg_temp.item_rows(2, 'BR-NEW', 'P-7', 'P-8'))$$,
  'MQ409', 'these rows overlap a staged chunk',
  'a chunk overlapping a staged chunk is MQ409'
);
insert into pg_temp.results values ('k1_items2', pg_temp.stage(pg_temp.batch(1), 2, 3, pg_temp.item_rows(3, 'BR-NEW', 'P-2', 'P-3', 'P-3')));
select is(
  (select format('%s %s %s %s', r.result ->> 'rows', r.result ->> 'staged', r.result ->> 'duplicates', r.result ->> 'errors_added')
   from pg_temp.results r where r.name = 'k1_items2'),
  '3 1 2 2',
  'duplicate keys are not staged and become errors'
);
select results_eq(
  $$select e.row_no, e.column_name, e.value, e.detail from public.import_errors e
    where e.batch_id = pg_temp.batch(1) and e.code = 'duplicate_key' order by e.row_no$$,
  $$values (3, '', 'P-2', '{"first_row": 2, "first_file_no": 2}'::jsonb), (5, '', 'P-3', '{"first_row": 4, "first_file_no": 2}'::jsonb)$$,
  'duplicate_key names the row that holds the key, across chunks and within one'
);

-- The original of the items file is in Storage with another size.
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
values ('imports', '00000000-0000-4000-8000-a16000000000/00000000-0000-4000-8000-a16b00000001/2.csv',
        '00000000-0000-4000-8000-a16000000001', '{"size": 99}');
set local role authenticated;

insert into pg_temp.results values ('k1_seal2', pg_temp.seal(pg_temp.batch(1), 2, 5));
select is(
  (select format('%s %s', r.result ->> 'rows_staged', r.result ->> 'source_stored') from pg_temp.results r where r.name = 'k1_seal2'),
  '3 false',
  'the items file seals with three distinct keys; an original of the wrong size is not accepted'
);
select is(
  (select format('%s %s %s', e.row_no, e.level, e.detail)
   from public.import_errors e where e.batch_id = pg_temp.batch(1) and e.file_no = 2 and e.code = 'source_size_mismatch'),
  '0 error {"actual": 99, "expected": 100}',
  'an original of another size is a source_size_mismatch error'
);
select is(
  (select format('%s %s %s %s', b.status, b.error_count, b.warning_count, b.validated_at is null)
   from public.import_batches b where b.id = pg_temp.batch(1)),
  'invalid 4 1 t',
  'with every file sealed and errors present the batch is invalid'
);
select is(
  (select f.error_counts from public.import_files f where f.batch_id = pg_temp.batch(1) and f.file_no = 2),
  '{"duplicate_key": {"": 2}, "source_size_mismatch": {"": 1}}'::jsonb,
  'error_counts groups the file''s errors by code and column'
);

------------------------------------------------------------------------------------------------
-- Isolation while K1 exists
------------------------------------------------------------------------------------------------
select is(pg_temp.visible(), '1/2/5', 'the planner of A reads K1, its two files and five errors and warnings');

select is(
  pg_temp.state($$insert into public.import_batches (id, organization_id) values (gen_random_uuid(), '00000000-0000-4000-8000-a16000000000')$$)
    || ',' || pg_temp.state($$insert into public.import_files (organization_id, batch_id, file_no, entity, original_name, extension, size_bytes, sha256, storage_path, columns, rows_total)
                            values ('00000000-0000-4000-8000-a16000000000', '00000000-0000-4000-8000-a16b00000001', 3, 'brands', 'x.csv', 'csv', 1, sha256('x'::bytea),
                                    '00000000-0000-4000-8000-a16000000000/00000000-0000-4000-8000-a16b00000001/3.csv', '{brand_code}', 1)$$)
    || ',' || pg_temp.state($$insert into public.import_errors (organization_id, batch_id, file_no, row_no, code, level)
                            values ('00000000-0000-4000-8000-a16000000000', '00000000-0000-4000-8000-a16b00000001', 1, 1, 'required', 'error')$$),
  '42501,42501,42501',
  'an editor cannot insert into the import tables directly'
);
select is(
  pg_temp.state($$update public.import_batches set status = 'validated', error_count = 0$$)
    || ',' || pg_temp.state($$update public.import_files set error_count = 0$$)
    || ',' || pg_temp.state($$update public.import_errors set level = 'warning'$$),
  '42501,42501,42501',
  'an editor cannot update the import tables directly'
);
select is(
  pg_temp.state($$delete from public.import_batches$$)
    || ',' || pg_temp.state($$delete from public.import_files$$)
    || ',' || pg_temp.state($$delete from public.import_errors$$),
  '42501,42501,42501',
  'an editor cannot delete from the import tables directly'
);
select is(
  pg_temp.state($$select count(*) from ingest.staged_rows$$)
    || ',' || pg_temp.state($$select count(*) from ingest.contract_columns$$)
    || ',' || pg_temp.state($$select app.import_check_cells(pg_temp.batch(1), 1::smallint, 1, 2)$$),
  '42501,42501,42501',
  'an editor reaches neither the ingest schema nor the internal import functions'
);
select is(
  pg_temp.err($$select pg_temp.stage('00000000-0000-4000-8000-a16bffffffff', 1, 1, '[]')$$),
  'MQ404 batch_id',
  'an unknown import is MQ404 batch_id'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-b16000000001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-b16000000001';
select is(pg_temp.visible(), '0/0/0', 'the owner of B reads no import rows of A');
select is(
  pg_temp.batch_calls(pg_temp.batch(1)),
  'MQ404 batch_id,MQ404 batch_id,MQ404 batch_id,MQ404 batch_id,MQ404 batch_id,MQ404 batch_id',
  'the owner of B gets MQ404 batch_id (as for an unknown id) from every RPC on an import of A'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a16000000002", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a16000000002';
select is(pg_temp.visible(), '0/0/0', 'a viewer of A reads no import rows');
select is(
  pg_temp.batch_calls(pg_temp.batch(1)),
  'MQ403 role,MQ403 role,MQ403 role,MQ403 role,MQ403 role,MQ403 role',
  'a viewer of A gets MQ403 role from every RPC on an import of A'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a16000000003", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a16000000003';
select is(pg_temp.visible(), '0/0/0', 'a branch user of A reads no import rows');
select is(
  pg_temp.batch_calls(pg_temp.batch(1)),
  'MQ403 role,MQ403 role,MQ403 role,MQ403 role,MQ403 role,MQ403 role',
  'a branch user of A gets MQ403 role from every RPC on an import of A'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a16000000005", "role": "authenticated", "org_id": "00000000-0000-4000-8000-b16000000000"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a16000000005';
select is(pg_temp.visible(), '0/0/0', 'a planner of A whose token names B reads no import rows of A');
select is(
  pg_temp.batch_calls(pg_temp.batch(1)),
  'MQ404 organization_id,MQ404 organization_id,MQ404 organization_id,MQ404 organization_id,MQ404 organization_id,MQ404 organization_id',
  'a stale org_id claim gets MQ404 organization_id from every RPC on an import of A'
);

------------------------------------------------------------------------------------------------
-- K1: commit refusals, cancel and delete (planner of A)
------------------------------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a16000000001", "role": "authenticated"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a16000000001';

select is(pg_temp.err($$select public.import_commit_step(pg_temp.batch(1))$$), 'MQ409 status', 'an invalid import cannot commit');
select is(pg_temp.err($$select public.import_resume(pg_temp.batch(1))$$), 'MQ409 status', 'an invalid import cannot resume');
select is(pg_temp.err($$select public.import_commit_step(pg_temp.batch(1), 0)$$), 'MQ422 max_rows', 'max_rows is at least 1');

reset role;
update public.import_batches set status = 'validated', validated_at = now() where id = pg_temp.batch(1);
set local role authenticated;
select is(
  pg_temp.err($$select public.import_commit_step(pg_temp.batch(1))$$),
  'MQ409 errors',
  'a validated import that still counts errors is refused with MQ409 errors'
);
select is(pg_temp.err($$select public.import_delete(pg_temp.batch(1))$$), 'MQ409 status', 'an open import cannot be deleted');
select is(
  (select format('%s %s', r ->> 'status', r ->> 'done') from public.import_cancel_step(pg_temp.batch(1)) as r),
  'canceled true',
  'cancel marks the import canceled and clears its staging in one call'
);

reset role;
select is(
  (select format('%s %s %s', (select count(*) from ingest.staged_rows s where s.batch_id = pg_temp.batch(1)),
                 (select count(*) from ingest.staged_chunks c where c.batch_id = pg_temp.batch(1)),
                 (select b.staging_cleared_at is not null from public.import_batches b where b.id = pg_temp.batch(1)))),
  '0 0 t',
  'cancel removed the staged rows and chunks of K1'
);
set local role authenticated;

select lives_ok($$select public.import_delete(pg_temp.batch(1))$$, 'a canceled import can be deleted');
select is(pg_temp.visible(), '0/0/0', 'deleting K1 removed its files and errors');

------------------------------------------------------------------------------------------------
-- Open imports (3), the sweep and the delete rules
------------------------------------------------------------------------------------------------
select is(
  array[(pg_temp.new_batch(pg_temp.batch(11), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))) ->> 'status',
        (pg_temp.new_batch(pg_temp.batch(12), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))) ->> 'status',
        (pg_temp.new_batch(pg_temp.batch(13), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))) ->> 'status'],
  array['staging', 'staging', 'staging'],
  'three imports can be open at once'
);
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(14), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))$$),
  'MQ409 open_batches',
  'a fourth open import is MQ409 open_batches'
);
select is(pg_temp.err($$select public.import_delete(pg_temp.batch(13))$$), 'MQ409 status', 'a staging import cannot be deleted');
select is(
  (pg_temp.stage(pg_temp.batch(11), 1, 1, pg_temp.brand_rows(1, 'BR-O1'))) ->> 'staged',
  '1',
  'O1 stages its row'
);

-- O1 idles past its expiry; the next cancel sweeps it.
reset role;
update public.import_batches set expires_at = now() - interval '1 minute' where id = pg_temp.batch(11);
set local role authenticated;

select is((public.import_cancel_step(pg_temp.batch(12))) ->> 'status', 'canceled', 'O2 is canceled');
select is(
  (select format('%s %s', b.status, b.finished_at is not null) from public.import_batches b where b.id = pg_temp.batch(11)),
  'expired t',
  'the sweep expired O1, idle for more than 24 hours'
);
select is(
  pg_temp.err($$select pg_temp.stage(pg_temp.batch(11), 1, 2, pg_temp.brand_rows(2, 'BR-O1B'))$$),
  'MQ409 status',
  'an expired import takes no more chunks'
);

reset role;
select is(
  (select format('%s %s', (select count(*) from ingest.staged_rows s where s.batch_id = pg_temp.batch(11)),
                 (select b.staging_cleared_at is null from public.import_batches b where b.id = pg_temp.batch(11)))),
  '1 t',
  'a sweep without a row budget leaves the staging rows of O1'
);
set local role authenticated;

select is(
  (pg_temp.new_batch(pg_temp.batch(14), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))) ->> 'status',
  'staging',
  'with O1 expired and O2 canceled a new import can open'
);

reset role;
select is(
  (select format('%s %s', (select count(*) from ingest.staged_rows s where s.batch_id = pg_temp.batch(11)),
                 (select b.staging_cleared_at is not null from public.import_batches b where b.id = pg_temp.batch(11)))),
  '0 t',
  'the sweep in import_create_batch removed the staging rows of the expired import'
);
set local role authenticated;

select lives_ok($$select public.import_delete(pg_temp.batch(11))$$, 'an expired import can be deleted');
select lives_ok($$select public.import_delete(pg_temp.batch(12))$$, 'a canceled import can be deleted');
select is(
  array[(public.import_cancel_step(pg_temp.batch(13))) ->> 'status', (public.import_cancel_step(pg_temp.batch(14))) ->> 'status'],
  array['canceled', 'canceled'],
  'O3 and O4 are canceled'
);
select lives_ok(
  $$select public.import_delete(pg_temp.batch(13)); select public.import_delete(pg_temp.batch(14))$$,
  'and deleted'
);
select is(pg_temp.visible(), '0/0/0', 'no import of A is left');

-- At most 50 imports per organization in 24 hours, counted in the creation ledger: the six imports
-- of A created above were all deleted and still count.
reset role;
select is(
  (select format('%s %s', (select count(*) from public.import_batches where organization_id = '00000000-0000-4000-8000-a16000000000'),
                 (select count(*) from ingest.import_creations where organization_id = '00000000-0000-4000-8000-a16000000000'))),
  '0 6',
  'A has no import left, but the ledger still holds its six creations'
);
insert into ingest.import_creations (organization_id, batch_id)
select '00000000-0000-4000-8000-a16000000000', gen_random_uuid() from generate_series(1, 44);
set local role authenticated;
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(20), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))$$),
  'MQ429 batches_per_day',
  'the 51st import within 24 hours is MQ429 batches_per_day, although six of the 50 were deleted'
);
reset role;
update ingest.import_creations set created_at = now() - interval '25 hours'
where ctid = (select c.ctid from ingest.import_creations c
              where c.organization_id = '00000000-0000-4000-8000-a16000000000' order by c.created_at, c.batch_id limit 1);
set local role authenticated;
select is(
  (pg_temp.new_batch(pg_temp.batch(20), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))) ->> 'status',
  'staging',
  'a creation 25 hours ago no longer counts'
);
reset role;
select is(
  (select format('%s %s', count(*), count(*) filter (where created_at <= now() - interval '24 hours'))
   from ingest.import_creations where organization_id = '00000000-0000-4000-8000-a16000000000'),
  '50 0',
  'the creation purged the old ledger row and recorded itself'
);
set local role authenticated;
select is((public.import_cancel_step(pg_temp.batch(20))) ->> 'status', 'canceled', 'that import is canceled again');
select lives_ok($$select public.import_delete(pg_temp.batch(20))$$, 'and deleted');
select is(
  pg_temp.err($$select pg_temp.new_batch(pg_temp.batch(21), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 1)))$$),
  'MQ429 batches_per_day',
  'deleting it did not give its place back'
);
reset role;
delete from ingest.import_creations where organization_id = '00000000-0000-4000-8000-a16000000000';
delete from public.import_batches where organization_id = '00000000-0000-4000-8000-a16000000000';
set local role authenticated;

------------------------------------------------------------------------------------------------
-- K2: a clean import with its original. Validation age, another committing import, abandonment.
------------------------------------------------------------------------------------------------
select is(
  (pg_temp.new_batch(pg_temp.batch(2), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 2, 42)))) ->> 'status',
  'staging',
  'K2 is created'
);
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
values ('imports', '00000000-0000-4000-8000-a16000000000/00000000-0000-4000-8000-a16b00000002/1.csv',
        '00000000-0000-4000-8000-a16000000001', '{"size": 42}');
set local role authenticated;

select is(
  (pg_temp.stage(pg_temp.batch(2), 1, 1, pg_temp.brand_rows(1, 'BR-K2A', 'BR-K2B'))) ->> 'errors_added',
  '0',
  'K2 stages two valid brands'
);
insert into pg_temp.results values ('k2_seal', pg_temp.seal(pg_temp.batch(2), 1, 2));
select is(
  (select format('%s %s %s %s', r.result ->> 'source_stored', r.result ->> 'warning_count', r.result -> 'batch' ->> 'status',
                 r.result -> 'batch' ->> 'validated_at' is not null)
   from pg_temp.results r where r.name = 'k2_seal'),
  'true 0 validated t',
  'an original of the declared size is accepted and an import without errors is validated'
);

reset role;
update public.import_batches set validated_at = now() - interval '25 hours' where id = pg_temp.batch(2);
set local role authenticated;
select is(
  pg_temp.err($$select public.import_commit_step(pg_temp.batch(2))$$),
  'MQ409 validation_expired',
  'a validation older than 24 hours is MQ409 validation_expired'
);

-- K3 is committing (stepped) in the same organization.
reset role;
update public.import_batches set validated_at = now() where id = pg_temp.batch(2);
insert into public.import_batches (id, organization_id, status, commit_mode, created_by, commit_started_at, last_step_at, progress)
values (pg_temp.batch(3), '00000000-0000-4000-8000-a16000000000', 'committing', 'stepped', '00000000-0000-4000-8000-a16000000001',
        now(), now(), '{"phase": "merge", "steps": 3}');
set local role authenticated;
select is(
  pg_temp.err($$select public.import_commit_step(pg_temp.batch(2))$$),
  'MQ409 another_commit',
  'one committing import per organization: K2 waits for K3 with MQ409 another_commit'
);
select is(
  (select b.status from public.import_batches b where b.id = pg_temp.batch(2)),
  'validated',
  'the refused commit left K2 validated'
);

-- K3 has had no step for 31 minutes: the next commit call fails it as abandoned and K2 commits.
reset role;
update public.import_batches set last_step_at = now() - interval '31 minutes' where id = pg_temp.batch(3);
set local role authenticated;
select is(
  (select format('%s %s %s %s %s', r ->> 'status', r ->> 'commit_mode', r ->> 'done', r ->> 'unit', r -> 'counts' -> 'brands' ->> 'inserted')
   from public.import_commit_step(pg_temp.batch(2)) as r),
  'succeeded atomic true atomic 2',
  'K2 commits atomically once the abandoned K3 frees the slot'
);
select is(
  (select format('%s %s %s', b.status, b.failure_code, b.expires_at = now() + interval '24 hours')
   from public.import_batches b where b.id = pg_temp.batch(3)),
  'failed abandoned t',
  'the sweep failed K3 as abandoned and gave it 24 hours to resume'
);
select is(
  (select count(*)::integer from public.brands where code in ('BR-K2A', 'BR-K2B')),
  2,
  'K2 inserted its two brands'
);
select is(
  (select format('%s %s', r ->> 'done', r ->> 'units') from public.import_commit_step(pg_temp.batch(2)) as r),
  'true 0',
  'committing a succeeded import again does nothing'
);
select is(pg_temp.err($$select public.import_cancel_step(pg_temp.batch(2))$$), 'MQ409 status', 'a succeeded import cannot be canceled');

reset role;
select is(
  (select format('%s %s', (select count(*) from ingest.staged_rows s where s.batch_id = pg_temp.batch(2)),
                 (select b.staging_cleared_at is not null from public.import_batches b where b.id = pg_temp.batch(2)))),
  '0 t',
  'the atomic commit removed the staging rows of K2'
);
set local role authenticated;

select is(pg_temp.err($$select public.import_delete(pg_temp.batch(3))$$), 'MQ409 status', 'a failed import cannot be deleted');
select is((public.import_cancel_step(pg_temp.batch(3))) ->> 'status', 'canceled', 'a failed import can be canceled');
select is(pg_temp.err($$select public.import_resume(pg_temp.batch(3))$$), 'MQ409 status', 'a canceled import cannot resume');
select lives_ok(
  $$select public.import_delete(pg_temp.batch(2)); select public.import_delete(pg_temp.batch(3))$$,
  'succeeded and canceled imports can be deleted'
);
select is(pg_temp.visible(), '0/0/0', 'K2 and K3 are gone with their files and errors');

------------------------------------------------------------------------------------------------
-- S1: a stepped commit (5,001 items) that fails after its first unit; cancel keeps the applied rows
------------------------------------------------------------------------------------------------
select is(
  (pg_temp.new_batch(pg_temp.batch(5), jsonb_build_array(pg_temp.file(1, 'items', pg_temp.items_columns(), 5001)))) ->> 'status',
  'staging',
  'S1 is created with 5,001 items'
);
select is(
  (pg_temp.stage(pg_temp.batch(5), 1, 1, pg_temp.item_rows(1, '', variadic array(select 'S-' || i from generate_series(1, 5000) as i)))) ->> 'staged',
  '5000',
  'a chunk of 5,000 items stages'
);
select is(
  (pg_temp.stage(pg_temp.batch(5), 1, 5001, pg_temp.item_rows(5001, 'BR-GONE', 'S-5001'))) ->> 'errors_added',
  '0',
  'item 5,001 refers to brand BR-GONE, which exists'
);
select is(
  (pg_temp.seal(pg_temp.batch(5), 1, 5001)) -> 'batch' ->> 'status',
  'validated',
  'S1 is validated'
);

reset role;
delete from public.brands where id = '00000000-0000-4000-8000-a16030000001';
set local role authenticated;

insert into pg_temp.results values ('s1_commit', pg_temp.commit_until_settled(pg_temp.batch(5)));
select is(
  (select format('%s %s %s', r.result ->> 'status', r.result ->> 'commit_mode', r.result ->> 'failure_code')
   from pg_temp.results r where r.name = 's1_commit'),
  'failed stepped changed_during_commit',
  'S1 commits stepped and fails when item 5,001 loses its brand'
);
select is(
  (select format('%s %s %s', f.merged_through_row, b.progress ->> 'file_no', b.progress ->> 'through_row')
   from public.import_batches b join public.import_files f on f.batch_id = b.id
   where b.id = pg_temp.batch(5)),
  '5000 1 5000',
  'the cursor stays after the first 5,000 rows'
);
select is(
  (select format('%s %s %s %s %s', e.row_no, e.column_name, e.code, e.value, e.detail)
   from public.import_errors e where e.batch_id = pg_temp.batch(5) and e.level = 'error'),
  '5001 brand_code unknown_reference BR-GONE {"phase": "commit"}',
  'the commit records the reference that vanished as a commit-phase error'
);
select is(
  (select count(*)::integer from public.items where code like 'S-%'),
  5000,
  'the first unit applied 5,000 items'
);
select is(pg_temp.err($$select public.import_commit_step(pg_temp.batch(5))$$), 'MQ409 status', 'a failed import needs import_resume before committing');
select is(pg_temp.err($$select public.import_delete(pg_temp.batch(5))$$), 'MQ409 status', 'a failed import cannot be deleted before it is canceled');
select is(
  (select format('%s %s', r ->> 'status', r ->> 'done') from public.import_cancel_step(pg_temp.batch(5)) as r),
  'canceled true',
  'cancel takes the failed import to canceled'
);
select is(
  (select count(*)::integer from public.items where code like 'S-%'),
  5000,
  'cancel keeps the rows a failed stepped commit applied'
);
select lives_ok($$select public.import_delete(pg_temp.batch(5))$$, 'S1 is deleted');
select is(
  (select count(*)::integer from public.items where code like 'S-%'),
  5000,
  'deleting the import keeps the applied rows too'
);

------------------------------------------------------------------------------------------------
-- Lost staging (crash recovery empties the UNLOGGED tables; simulated by deleting as postgres)
-- and stepped commits idle for more than 30 minutes
------------------------------------------------------------------------------------------------

-- L1: a validated atomic import whose staged rows are gone (the chunk bookkeeping is intact).
select is(
  (pg_temp.new_batch(pg_temp.batch(31), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 2)))) ->> 'status',
  'staging',
  'L1 is created'
);
select is((pg_temp.stage(pg_temp.batch(31), 1, 1, pg_temp.brand_rows(1, 'BR-L1A', 'BR-L1B'))) ->> 'staged', '2', 'L1 stages two brands');
select is((pg_temp.seal(pg_temp.batch(31), 1, 2)) -> 'batch' ->> 'status', 'validated', 'L1 is validated');
reset role;
delete from ingest.staged_rows where batch_id = pg_temp.batch(31);
set local role authenticated;
select is(
  (select format('%s %s %s %s %s', r ->> 'status', r ->> 'failure_code', r ->> 'done', r ->> 'units', coalesce(r ->> 'commit_mode', '-'))
   from public.import_commit_step(pg_temp.batch(31)) as r),
  'expired staging_lost true 0 -',
  'a validated import whose staged rows were lost commits nothing: expired with failure_code staging_lost'
);
select is((select count(*)::integer from public.brands where code like 'BR-L1%'), 0, 'L1 wrote no brand');
select is(pg_temp.err($$select public.import_commit_step(pg_temp.batch(31))$$), 'MQ409 status', 'an import that lost its staging cannot commit again');
select lives_ok($$select public.import_delete(pg_temp.batch(31))$$, 'and can be deleted');

-- L2: a validated stepped import (5,001 brands) whose staging is gone before its first step.
select is(
  (pg_temp.new_batch(pg_temp.batch(32), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 5001)))) ->> 'status',
  'staging',
  'L2 is created with 5,001 brands'
);
select is(
  array[(pg_temp.stage(pg_temp.batch(32), 1, 1, pg_temp.brand_rows(1, variadic array(select 'BR-L2-' || i from generate_series(1, 5000) as i)))) ->> 'staged',
        (pg_temp.stage(pg_temp.batch(32), 1, 5001, pg_temp.brand_rows(5001, 'BR-L2-5001'))) ->> 'staged',
        (pg_temp.seal(pg_temp.batch(32), 1, 5001)) -> 'batch' ->> 'status'],
  array['5000', '1', 'validated'],
  'L2 stages and is validated'
);
reset role;
delete from ingest.staged_rows where batch_id = pg_temp.batch(32);
delete from ingest.staged_chunks where batch_id = pg_temp.batch(32);
set local role authenticated;
select is(
  (select format('%s %s %s', r ->> 'status', r ->> 'failure_code', r ->> 'units') from public.import_commit_step(pg_temp.batch(32)) as r),
  'expired staging_lost 0',
  'a stepped import whose staging was lost before the commit ends expired with staging_lost, nothing written'
);
select is((select count(*)::integer from public.brands where code like 'BR-L2-%'), 0, 'L2 wrote no brand');
select lives_ok($$select public.import_delete(pg_temp.batch(32))$$, 'L2 is deleted');

-- L3: a stepped commit (5,001 brands, one row per unit) idle for 31 minutes continues; then its
-- staging is lost and the next unit ends it as expired without writing more.
select is(
  array[(pg_temp.new_batch(pg_temp.batch(33), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 5001)))) ->> 'status',
        (pg_temp.stage(pg_temp.batch(33), 1, 1, pg_temp.brand_rows(1, variadic array(select 'BR-L3-' || i from generate_series(1, 5000) as i)))) ->> 'staged',
        (pg_temp.stage(pg_temp.batch(33), 1, 5001, pg_temp.brand_rows(5001, 'BR-L3-5001'))) ->> 'staged',
        (pg_temp.seal(pg_temp.batch(33), 1, 5001)) -> 'batch' ->> 'status'],
  array['staging', '5000', '1', 'validated'],
  'L3 is created, staged and validated'
);
select is(
  (select format('%s %s', r ->> 'status', r ->> 'commit_mode') from public.import_commit_step(pg_temp.batch(33), 1) as r),
  'committing stepped',
  'L3 starts a stepped commit of one row per unit'
);
reset role;
update public.import_batches set last_step_at = now() - interval '31 minutes' where id = pg_temp.batch(33);
set local role authenticated;
select is(
  (select format('%s %s', r ->> 'status', coalesce(r ->> 'failure_code', '-')) from public.import_commit_step(pg_temp.batch(33), 1) as r),
  'committing -',
  'a stepped commit idle for 31 minutes continues when its own step comes (it is not failed as abandoned first)'
);
select is(
  (select format('%s %s', b.last_step_at >= now(), f.merged_through_row between 2 and 5000)
   from public.import_batches b join public.import_files f on f.batch_id = b.id where b.id = pg_temp.batch(33)),
  't t',
  'the continued step refreshed last_step_at and merged more rows'
);
reset role;
insert into pg_temp.results
select 'l3_merged', to_jsonb(f.merged_through_row) from public.import_files f where f.batch_id = pg_temp.batch(33);
delete from ingest.staged_rows where batch_id = pg_temp.batch(33);
delete from ingest.staged_chunks where batch_id = pg_temp.batch(33);
set local role authenticated;
insert into pg_temp.results values ('l3_commit', pg_temp.commit_until_settled(pg_temp.batch(33)));
select is(
  (select format('%s %s %s', r.result ->> 'status', r.result ->> 'failure_code', r.result ->> 'done') from pg_temp.results r where r.name = 'l3_commit'),
  'expired staging_lost true',
  'the next unit finds its rows no longer staged: the import ends expired with staging_lost, not succeeded'
);
select is(
  (select count(*)::integer from public.brands where code like 'BR-L3-%'),
  (select (r.result #>> '{}')::integer from pg_temp.results r where r.name = 'l3_merged'),
  'only the rows merged before the loss were written'
);
select is(
  (select format('%s %s', f.status, f.merged_through_row = (select (r.result #>> '{}')::integer from pg_temp.results r where r.name = 'l3_merged'))
   from public.import_files f where f.batch_id = pg_temp.batch(33)),
  'sealed t',
  'the file keeps its cursor and is not marked merged'
);
select is(pg_temp.err($$select public.import_resume(pg_temp.batch(33))$$), 'MQ409 status', 'an import that lost its staging cannot resume');
select lives_ok($$select public.import_delete(pg_temp.batch(33))$$, 'L3 is deleted');

-- L4: an idle stepped commit can be abandoned (cancel) once it has had no step for 30 minutes.
select is(
  array[(pg_temp.new_batch(pg_temp.batch(34), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 5001)))) ->> 'status',
        (pg_temp.stage(pg_temp.batch(34), 1, 1, pg_temp.brand_rows(1, variadic array(select 'BR-L4-' || i from generate_series(1, 5000) as i)))) ->> 'staged',
        (pg_temp.stage(pg_temp.batch(34), 1, 5001, pg_temp.brand_rows(5001, 'BR-L4-5001'))) ->> 'staged',
        (pg_temp.seal(pg_temp.batch(34), 1, 5001)) -> 'batch' ->> 'status',
        (public.import_commit_step(pg_temp.batch(34), 1)) ->> 'status'],
  array['staging', '5000', '1', 'validated', 'committing'],
  'L4 is staged, validated and starts a stepped commit'
);
select is(pg_temp.err($$select public.import_cancel_step(pg_temp.batch(34))$$), 'MQ409 status', 'a commit that is running (stepped recently) cannot be canceled');
reset role;
update public.import_batches set last_step_at = now() - interval '31 minutes' where id = pg_temp.batch(34);
insert into pg_temp.results
select 'l4_brands', to_jsonb(count(*)) from public.brands where code like 'BR-L4-%';
set local role authenticated;
select is(
  (select format('%s %s %s', r ->> 'status', r ->> 'failure_code', r ->> 'done') from public.import_cancel_step(pg_temp.batch(34)) as r),
  'canceled abandoned true',
  'a stepped commit idle for 31 minutes is abandoned by cancel and its staging cleared'
);
select is(
  (select count(*)::integer from public.brands where code like 'BR-L4-%'),
  (select (r.result #>> '{}')::integer from pg_temp.results r where r.name = 'l4_brands'),
  'abandoning keeps the rows the commit applied'
);
select lives_ok($$select public.import_delete(pg_temp.batch(34))$$, 'L4 is deleted');

-- L5: a file whose staged rows were lost between two chunks cannot be sealed.
select is(
  (pg_temp.new_batch(pg_temp.batch(35), jsonb_build_array(pg_temp.file(1, 'brands', array['brand_code', 'name_en'], 2)))) ->> 'status',
  'staging',
  'L5 is created'
);
select is((pg_temp.stage(pg_temp.batch(35), 1, 1, pg_temp.brand_rows(1, 'BR-L5A'))) ->> 'staged', '1', 'L5 stages its first row');
reset role;
delete from ingest.staged_rows where batch_id = pg_temp.batch(35);
delete from ingest.staged_chunks where batch_id = pg_temp.batch(35);
set local role authenticated;
select is((pg_temp.stage(pg_temp.batch(35), 1, 2, pg_temp.brand_rows(2, 'BR-L5B'))) ->> 'staged', '1', 'L5 stages its second row after the loss');
select is(pg_temp.err($$select pg_temp.seal(pg_temp.batch(35), 1, 2)$$), 'MQ409 staging_lost', 'sealing a file whose staged rows were lost is MQ409 staging_lost');
select is((public.import_cancel_step(pg_temp.batch(35))) ->> 'status', 'canceled', 'L5 is canceled');

------------------------------------------------------------------------------------------------
-- Demand: several files of one entity, at most 10,000 rows per chunk
------------------------------------------------------------------------------------------------
select is(
  (pg_temp.new_batch(pg_temp.batch(6), jsonb_build_array(
    pg_temp.file(1, 'demand_history', array['item_code', 'location_code', 'demand_date', 'quantity'], 10001),
    pg_temp.file(2, 'demand_history', array['item_code', 'location_code', 'demand_date', 'quantity'], 1)))) -> 'files' -> 1 ->> 'entity',
  'demand_history',
  'demand may come in several files'
);
select throws_ok(
  $$select pg_temp.stage(pg_temp.batch(6), 1, 1,
    (select jsonb_agg(jsonb_build_array(i, 'S-1', 'L-1', '2024-01-01', '1', null) order by i)::text from generate_series(1, 10001) as i))$$,
  'MQ422', 'a chunk has 1 to 10000 rows',
  'a demand chunk holds at most 10,000 rows'
);
select is((public.import_cancel_step(pg_temp.batch(6))) ->> 'status', 'canceled', 'the demand import is canceled');

select * from finish();

rollback;
