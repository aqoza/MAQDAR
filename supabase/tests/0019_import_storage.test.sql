-- Step 5a originals in Storage: the private imports bucket and its storage.objects policies.
-- * the bucket is private, with its 50,000,000-byte limit and MIME allow-list;
-- * three policies for authenticated (insert, select, delete), none for update;
-- * insert only to the server-generated path of a file (import_files.storage_path) of an import
--   that is still staging and whose original is not stored yet (app.uploadable_import_paths):
--   any other name under the organization's prefix, a canceled or succeeded import, an original
--   already recorded as stored, and another organization's path are denied with 42501;
-- * delete only of the originals of succeeded, canceled or expired imports
--   (app.deletable_import_paths): an open import's original stays, and a stored original that is
--   deleted cannot be replaced by uploading another file to its path (no swap of the audit copy);
-- * reads stay prefix-based: an editor reads every original of the active organization;
-- * the org_id claim narrows an editor of two organizations to the active one; viewers, branch
--   users and anon can neither insert, read nor delete; a malformed object is simply invisible.
-- Objects are inserted directly (the Storage API does the same insert as the calling user when it
-- signs an upload URL or uploads with the user's token).
begin;

select plan(36);

-- Fixture (as postgres). A: planner, viewer, branch user, and an owner who is also admin of B.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-a19000000001', 'imp19-planner-a@test.local', now()),
  ('00000000-0000-4000-8000-a19000000002', 'imp19-viewer-a@test.local', now()),
  ('00000000-0000-4000-8000-a19000000003', 'imp19-branch-a@test.local', now()),
  ('00000000-0000-4000-8000-a19000000004', 'imp19-owner-a-admin-b@test.local', now()),
  ('00000000-0000-4000-8000-b19000000001', 'imp19-planner-b@test.local', now());
insert into public.organizations (id, slug, name) values
  ('00000000-0000-4000-8000-a19000000000', 'imp19-org-a', 'Storage A'),
  ('00000000-0000-4000-8000-b19000000000', 'imp19-org-b', 'Storage B');
insert into public.memberships (organization_id, user_id, role) values
  ('00000000-0000-4000-8000-a19000000000', '00000000-0000-4000-8000-a19000000001', 'planner'),
  ('00000000-0000-4000-8000-a19000000000', '00000000-0000-4000-8000-a19000000002', 'viewer'),
  ('00000000-0000-4000-8000-a19000000000', '00000000-0000-4000-8000-a19000000003', 'branch_user'),
  ('00000000-0000-4000-8000-a19000000000', '00000000-0000-4000-8000-a19000000004', 'owner'),
  ('00000000-0000-4000-8000-b19000000000', '00000000-0000-4000-8000-a19000000004', 'admin'),
  ('00000000-0000-4000-8000-b19000000000', '00000000-0000-4000-8000-b19000000001', 'planner');
insert into public.locations (id, organization_id, code, name_en, location_type, country_code, timezone) values
  ('00000000-0000-4000-8000-a19010000001', '00000000-0000-4000-8000-a19000000000', 'L-1', 'Branch one', 'branch', 'SA', 'Asia/Riyadh');
insert into public.membership_locations (organization_id, user_id, location_id) values
  ('00000000-0000-4000-8000-a19000000000', '00000000-0000-4000-8000-a19000000003', '00000000-0000-4000-8000-a19010000001');

-- Imports: A1 staging (files 1, 3, 4 not stored; 2 and 5 stored), A2 succeeded, A3 canceled;
-- B1 staging, B2 succeeded.
insert into public.import_batches (id, organization_id, status, created_by) values
  ('00000000-0000-4000-8000-a190000b0001', '00000000-0000-4000-8000-a19000000000', 'staging', '00000000-0000-4000-8000-a19000000001'),
  ('00000000-0000-4000-8000-a190000b0002', '00000000-0000-4000-8000-a19000000000', 'succeeded', '00000000-0000-4000-8000-a19000000001'),
  ('00000000-0000-4000-8000-a190000b0003', '00000000-0000-4000-8000-a19000000000', 'canceled', '00000000-0000-4000-8000-a19000000001'),
  ('00000000-0000-4000-8000-b190000b0001', '00000000-0000-4000-8000-b19000000000', 'staging', '00000000-0000-4000-8000-b19000000001'),
  ('00000000-0000-4000-8000-b190000b0002', '00000000-0000-4000-8000-b19000000000', 'succeeded', '00000000-0000-4000-8000-b19000000001');
insert into public.import_files (organization_id, batch_id, file_no, entity, original_name, extension, size_bytes, sha256,
                                 storage_path, source_stored, columns, rows_total)
select o, b, n, 'brands', 'brands.csv', 'csv', 100, sha256(convert_to(b::text || n, 'UTF8')),
       o::text || '/' || b::text || '/' || n || '.csv', stored, '{brand_code}', 1
from (values
  ('00000000-0000-4000-8000-a19000000000'::uuid, '00000000-0000-4000-8000-a190000b0001'::uuid, 1, false),
  ('00000000-0000-4000-8000-a19000000000', '00000000-0000-4000-8000-a190000b0001', 2, true),
  ('00000000-0000-4000-8000-a19000000000', '00000000-0000-4000-8000-a190000b0001', 3, false),
  ('00000000-0000-4000-8000-a19000000000', '00000000-0000-4000-8000-a190000b0001', 4, false),
  ('00000000-0000-4000-8000-a19000000000', '00000000-0000-4000-8000-a190000b0001', 5, true),
  ('00000000-0000-4000-8000-a19000000000', '00000000-0000-4000-8000-a190000b0002', 1, true),
  ('00000000-0000-4000-8000-a19000000000', '00000000-0000-4000-8000-a190000b0003', 1, false),
  ('00000000-0000-4000-8000-b19000000000', '00000000-0000-4000-8000-b190000b0001', 1, false),
  ('00000000-0000-4000-8000-b19000000000', '00000000-0000-4000-8000-b190000b0002', 1, true)
) as f (o, b, n, stored);

insert into storage.objects (bucket_id, name, metadata) values
  ('imports', '00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/2.csv', '{"size": 100}'),
  ('imports', '00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0002/1.csv', '{"size": 100}'),
  ('imports', '00000000-0000-4000-8000-b19000000000/00000000-0000-4000-8000-b190000b0002/1.csv', '{"size": 100}'),
  ('imports', 'not-an-organization/00000000-0000-4000-8000-a190000b0001/1.csv', '{"size": 100}');

-- The names of the imports objects visible to the current role.
create function pg_temp.visible() returns text language sql stable as $$
  select coalesce(string_agg(name, ' ' order by name), '') from storage.objects where bucket_id = 'imports';
$$;

-- Inserts an original as the current role: 'ok' or the sqlstate.
create function pg_temp.put(p_name text) returns text language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner, metadata) values ('imports', p_name, auth.uid(), '{"size": 10}');
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- Deletes an original as the current role through the Storage API path: the rows deleted.
create function pg_temp.remove(p_name text) returns integer language plpgsql as $$
declare
  v integer;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'imports' and name = p_name;
  get diagnostics v = row_count;
  perform set_config('storage.allow_delete_query', 'false', true);
  return v;
end;
$$;

-- Bucket and policies -----------------------------------------------------------------------
select is(
  (select row(public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'imports'),
  row(false, 50000000::bigint, array['text/csv', 'text/plain', 'text/tab-separated-values', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])::text,
  'the imports bucket is private, limited to 50,000,000 bytes and the CSV, TSV, text and Excel types'
);
select results_eq(
  $$select policyname::text collate "default", cmd::text collate "default", roles::text collate "default" from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like '%imports%' order by policyname$$,
  $$values ('editors delete imports'::text, 'DELETE'::text, '{authenticated}'::text),
           ('editors read imports', 'SELECT', '{authenticated}'),
           ('editors upload imports', 'INSERT', '{authenticated}')$$,
  'three imports policies on storage.objects, for authenticated only, and none for update'
);
select results_eq(
  $$select policyname::text collate "default", coalesce(with_check, qual)::text collate "default" from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname in ('editors upload imports', 'editors delete imports')
    order by policyname$$,
  $$values
    ('editors delete imports'::text, '((bucket_id = ''imports''::text) AND (name = ANY (ARRAY( SELECT app.deletable_import_paths() AS deletable_import_paths))))'::text),
    ('editors upload imports', '((bucket_id = ''imports''::text) AND (name = ANY (ARRAY( SELECT app.uploadable_import_paths() AS uploadable_import_paths))))')$$,
  'upload and delete are bound to the server-generated paths through the set-based helpers'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'editors read imports'
     and qual ~ $re$^\(\(bucket_id = 'imports'::text\) AND \(\(storage\.foldername\(name\)\)\[1\] = ANY \(ARRAY\( SELECT \(o\.o\)::text AS o\s+FROM app\.editable_organizations\(\) o\(o\)\)\)\)\)$$re$),
  1,
  'reads are bucket imports and the first folder among the editable organizations, compared as text'
);

-- Planner of A ------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a19000000001", "role": "authenticated", "email": "imp19-planner-a@test.local", "org_id": "00000000-0000-4000-8000-a19000000000"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a19000000001';

select is(
  pg_temp.put('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/1.csv'),
  'ok',
  'an editor of A uploads the original of a file of A''s import that is still staging'
);
select is(
  array[pg_temp.put('00000000-0000-4000-8000-a19000000000/not-a-batch/anything.bin'),
        pg_temp.put('00000000-0000-4000-8000-a19000000000/x.exe'),
        pg_temp.put('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/9.csv'),
        pg_temp.put('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/3.txt')],
  array['42501', '42501', '42501', '42501'],
  'any other name under A''s prefix (another folder, no folder, a file number or extension of no file) is denied'
);
select is(
  pg_temp.put('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0003/1.csv'),
  '42501',
  'a canceled import takes no upload'
);
select is(
  pg_temp.put('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/5.csv'),
  '42501',
  'an original already recorded as stored cannot be uploaded again'
);
select is(
  array[pg_temp.put('00000000-0000-4000-8000-b19000000000/00000000-0000-4000-8000-b190000b0001/1.csv'),
        pg_temp.put('not-a-uuid/00000000-0000-4000-8000-a190000b0001/1.csv'),
        pg_temp.put('../00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/3.csv')],
  array['42501', '42501', '42501'],
  'B''s staging path, a malformed first folder and a path traversal are denied'
);
select is(
  pg_temp.visible(),
  '00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/1.csv 00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/2.csv 00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0002/1.csv',
  'an editor of A reads exactly A''s originals'
);
select is(
  (select count(*)::int from storage.objects where name like 'not-an-organization/%'),
  0,
  'a malformed object is invisible, and reading near it raises nothing'
);
with u as (
  update storage.objects set metadata = '{"size": 1}'
  where name = '00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0002/1.csv'
  returning 1
)
select is((select count(*)::int from u), 0, 'no update policy: an editor cannot rewrite an original in place');
select is(
  pg_temp.remove('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/2.csv'),
  0,
  'the original of an import that is still open cannot be deleted'
);
select is(
  pg_temp.remove('00000000-0000-4000-8000-b19000000000/00000000-0000-4000-8000-b190000b0002/1.csv'),
  0,
  'an editor of A deletes nothing under B''s prefix'
);
select is(
  pg_temp.remove('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0002/1.csv'),
  1,
  'the original of a succeeded import can be deleted (the delete flow removes it before import_delete)'
);
select is(
  pg_temp.put('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0002/1.csv'),
  '42501',
  'and nothing can be uploaded in its place: the audit copy of a finished import cannot be swapped'
);
reset role;

-- Viewer and branch user of A -------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a19000000002", "role": "authenticated", "email": "imp19-viewer-a@test.local", "org_id": "00000000-0000-4000-8000-a19000000000"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a19000000002';
select is(
  pg_temp.put('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/3.csv'),
  '42501',
  'a viewer of A cannot upload, not even to an uploadable path'
);
select is(pg_temp.visible(), '', 'a viewer of A reads no originals');

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a19000000003", "role": "authenticated", "email": "imp19-branch-a@test.local", "org_id": "00000000-0000-4000-8000-a19000000000"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a19000000003';
select is(
  pg_temp.put('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/3.csv'),
  '42501',
  'a branch user of A cannot upload'
);
select is(pg_temp.visible(), '', 'a branch user of A reads no originals');
reset role;
-- The succeeded import's original again, for the delete checks below.
insert into storage.objects (bucket_id, name, metadata) values
  ('imports', '00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0002/1.csv', '{"size": 100}');
set local role authenticated;
select is(
  pg_temp.remove('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0002/1.csv'),
  0,
  'a branch user of A deletes nothing, not even a deletable original'
);
reset role;

-- Owner of A who is also admin of B: the org_id claim decides -------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a19000000004", "role": "authenticated", "email": "imp19-owner-a-admin-b@test.local", "org_id": "00000000-0000-4000-8000-a19000000000"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-a19000000004';
select is(
  pg_temp.put('00000000-0000-4000-8000-b19000000000/00000000-0000-4000-8000-b190000b0001/1.csv'),
  '42501',
  'with the claim on A, an editor of both cannot upload to B''s staging path (stale tab)'
);
select is(
  pg_temp.remove('00000000-0000-4000-8000-b19000000000/00000000-0000-4000-8000-b190000b0002/1.csv'),
  0,
  'with the claim on A, an editor of both cannot delete B''s deletable original'
);
select is(
  pg_temp.visible(),
  '00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/1.csv 00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/2.csv 00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0002/1.csv',
  'with the claim on A, an editor of both reads only A''s originals'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-a19000000004", "role": "authenticated", "email": "imp19-owner-a-admin-b@test.local", "org_id": "00000000-0000-4000-8000-b19000000000"}';
select is(
  pg_temp.put('00000000-0000-4000-8000-b19000000000/00000000-0000-4000-8000-b190000b0001/1.csv'),
  'ok',
  'with the claim on B, the same user uploads to B''s staging path'
);
select is(
  pg_temp.visible(),
  '00000000-0000-4000-8000-b19000000000/00000000-0000-4000-8000-b190000b0001/1.csv 00000000-0000-4000-8000-b19000000000/00000000-0000-4000-8000-b190000b0002/1.csv',
  'with the claim on B, the same user reads only B''s originals'
);
select is(
  pg_temp.put('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/3.csv'),
  '42501',
  'with the claim on B, the same user cannot upload to A''s staging path'
);
reset role;

-- Planner of B -----------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-b19000000001", "role": "authenticated", "email": "imp19-planner-b@test.local", "org_id": "00000000-0000-4000-8000-b19000000000"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-b19000000001';
select is(
  pg_temp.visible(),
  '00000000-0000-4000-8000-b19000000000/00000000-0000-4000-8000-b190000b0001/1.csv 00000000-0000-4000-8000-b19000000000/00000000-0000-4000-8000-b190000b0002/1.csv',
  'an editor of B reads B''s originals and none of A''s'
);
select is(
  pg_temp.put('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/4.csv'),
  '42501',
  'an editor of B cannot upload to A''s staging path'
);
select is(
  pg_temp.remove('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0002/1.csv'),
  0,
  'an editor of B cannot delete A''s deletable original'
);
select is(
  pg_temp.remove('00000000-0000-4000-8000-b19000000000/00000000-0000-4000-8000-b190000b0002/1.csv'),
  1,
  'an editor of B deletes the original of B''s succeeded import'
);
reset role;

-- anon -------------------------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
set local request.jwt.claim.sub = '';
select is(
  pg_temp.put('00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/3.csv'),
  '42501',
  'anon cannot upload'
);
select is(pg_temp.visible(), '', 'anon reads no originals');
reset role;

-- Helpers and what happened ----------------------------------------------------------------------
select is(
  array(select p.oid::regprocedure::text || ':' || p.prosecdef::text || ':' || p.provolatile::text
        from pg_proc p where p.oid in ('app.uploadable_import_paths()'::regprocedure, 'app.deletable_import_paths()'::regprocedure)
        order by 1),
  array['app.deletable_import_paths():true:s', 'app.uploadable_import_paths():true:s'],
  'both path helpers are stable security-definer functions'
);
select is(
  (select string_agg(name, ' ' order by name) from storage.objects
   where bucket_id = 'imports' and name like '00000000-0000-4000-8000-a19000000000/%'),
  '00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/1.csv 00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0001/2.csv 00000000-0000-4000-8000-a19000000000/00000000-0000-4000-8000-a190000b0002/1.csv',
  'A keeps the planner''s upload, the open import''s stored original and the re-inserted succeeded original; nothing denied was written'
);
select is(
  (select string_agg(name, ' ' order by name) from storage.objects
   where bucket_id = 'imports' and name like '00000000-0000-4000-8000-b19000000000/%'),
  '00000000-0000-4000-8000-b19000000000/00000000-0000-4000-8000-b190000b0001/1.csv',
  'B has the upload made with the claim on B; its succeeded original was deleted by its planner'
);

select * from finish();

rollback;
