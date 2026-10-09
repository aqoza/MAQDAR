-- Proves the pgTAP harness runs in CI. The CLI installs pgtap itself and fails the run when a
-- test directory yields no tests, so this file stays until the first real table (Step 3) brings
-- real RLS tests. Every test file is wrapped in a transaction that is rolled back.
begin;

select plan(2);

select ok(true, 'pgTAP harness runs');

select has_schema('public', 'public schema exists');

select * from finish();

rollback;
