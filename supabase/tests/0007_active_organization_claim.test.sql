-- Active-organization claim: the org_id claim of the JWT narrows the set helpers (and therefore the
-- policies built on them) to one organization and can never widen them. A claim for an organization
-- the user does not belong to, or a malformed claim, matches nothing; an empty or absent claim falls
-- back to every membership. The boolean helpers and the RPCs ignore the claim: memberships stay the
-- source of truth, so removing a member takes effect on the next statement.
begin;

select plan(58);

-- Fixture: U owns A and is a planner of B; C exists without U; N belongs nowhere.
-- One location per organization (C's proves a non-member claim does not leak anything).
insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000001', 'u@test.local', now()),
  ('00000000-0000-4000-8000-000000000002', 'nobody@test.local', now());
insert into public.organizations (id, slug, name)
values
  ('00000000-0000-4000-8000-0000000000aa', 'org-a', 'Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'org-b', 'Org B'),
  ('00000000-0000-4000-8000-0000000000cc', 'org-c', 'Org C');
insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-000000000001', 'planner');
insert into public.locations (id, organization_id, code, name_en, location_type, country_code, timezone)
values
  ('00000000-0000-4000-8000-00000000aa10', '00000000-0000-4000-8000-0000000000aa', 'RUH-DC', 'Riyadh DC', 'central', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-00000000bb10', '00000000-0000-4000-8000-0000000000bb', 'JED-BR', 'Jeddah branch', 'branch', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-00000000cc10', '00000000-0000-4000-8000-0000000000cc', 'DMM-DC', 'Dammam DC', 'central', 'SA', 'Asia/Riyadh');

select has_function('app', 'active_organization_claim', '{}'::name[], 'app.active_organization_claim() exists');
select ok(
  has_function_privilege('authenticated', 'app.active_organization_claim()', 'execute'),
  'authenticated can execute active_organization_claim'
);

------------------------------------------------------------------------------------------------
-- As U with org_id = A: everything narrows to A.
------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "u@test.local", "org_id": "00000000-0000-4000-8000-0000000000aa"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(app.active_organization_claim(), '00000000-0000-4000-8000-0000000000aa', 'claim A: active_organization_claim returns A as text');
select results_eq(
  'select org::text from app.member_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000aa')$$,
  'claim A: member_organizations is exactly {A}'
);
select results_eq(
  'select org::text from app.editable_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000aa')$$,
  'claim A: editable_organizations is exactly {A}'
);
select results_eq(
  'select org::text from app.admin_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000aa')$$,
  'claim A: admin_organizations is exactly {A} (U is owner)'
);
select results_eq(
  'select org::text from app.approving_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000aa')$$,
  'claim A: approving_organizations is exactly {A} (U is owner)'
);
select results_eq(
  'select org::text from app.unscoped_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000aa')$$,
  'claim A: unscoped_organizations is exactly {A}'
);
select is_empty('select * from app.scoped_locations()', 'claim A: scoped_locations is empty (U is not a branch_user)');
select results_eq(
  'select id::text from public.locations order by id',
  $$values ('00000000-0000-4000-8000-00000000aa10')$$,
  'claim A: only A''s location is visible'
);
select results_eq(
  'select slug from public.organizations order by slug',
  $$values ('org-a')$$,
  'claim A: only organization A is visible'
);
select results_eq(
  'select id::text, is_active from public.my_organizations()',
  $$values ('00000000-0000-4000-8000-0000000000aa', false), ('00000000-0000-4000-8000-0000000000bb', false)$$,
  'claim A: my_organizations lists both organizations, none active before set_active_organization'
);

------------------------------------------------------------------------------------------------
-- As U with org_id = B: everything narrows to B (planner).
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "u@test.local", "org_id": "00000000-0000-4000-8000-0000000000bb"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(app.active_organization_claim(), '00000000-0000-4000-8000-0000000000bb', 'claim B: active_organization_claim returns B as text');
select results_eq(
  'select org::text from app.member_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000bb')$$,
  'claim B: member_organizations is exactly {B}'
);
select results_eq(
  'select org::text from app.editable_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000bb')$$,
  'claim B: editable_organizations is exactly {B} (planner edits)'
);
select is_empty('select * from app.admin_organizations()', 'claim B: admin_organizations is empty (planner is not admin)');
select results_eq(
  'select org::text from app.unscoped_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000bb')$$,
  'claim B: unscoped_organizations is exactly {B}'
);
select results_eq(
  'select id::text from public.locations order by id',
  $$values ('00000000-0000-4000-8000-00000000bb10')$$,
  'claim B: only B''s location is visible'
);

------------------------------------------------------------------------------------------------
-- As U with org_id = C (not a member): the claim cannot widen access.
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "u@test.local", "org_id": "00000000-0000-4000-8000-0000000000cc"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is_empty('select * from app.member_organizations()', 'claim C: member_organizations is empty');
select is_empty('select * from app.editable_organizations()', 'claim C: editable_organizations is empty');
select is((select count(*)::int from public.locations), 0, 'claim C: no locations are visible');
select is((select count(*)::int from public.organizations), 0, 'claim C: no organizations are visible');

------------------------------------------------------------------------------------------------
-- As U with a garbage claim: fail closed.
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "u@test.local", "org_id": "not-a-uuid"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(app.active_organization_claim(), 'not-a-uuid', 'garbage claim: active_organization_claim returns the raw text');
select is_empty('select * from app.member_organizations()', 'garbage claim: member_organizations is empty');
select is_empty('select * from app.editable_organizations()', 'garbage claim: editable_organizations is empty');
select is((select count(*)::int from public.locations), 0, 'garbage claim: no locations are visible');

------------------------------------------------------------------------------------------------
-- As U with org_id = '': treated as absent.
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "u@test.local", "org_id": ""}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(app.active_organization_claim(), null::text, 'empty claim: active_organization_claim returns null');
select results_eq(
  'select org::text from app.member_organizations() as org order by 1',
  $$values ('00000000-0000-4000-8000-0000000000aa'), ('00000000-0000-4000-8000-0000000000bb')$$,
  'empty claim: member_organizations is {A, B}'
);
select results_eq(
  'select id::text from public.locations order by id',
  $$values ('00000000-0000-4000-8000-00000000aa10'), ('00000000-0000-4000-8000-00000000bb10')$$,
  'empty claim: both locations are visible'
);

------------------------------------------------------------------------------------------------
-- As U with no org_id claim at all: every membership.
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "u@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(app.active_organization_claim(), null::text, 'no claim: active_organization_claim returns null');
select results_eq(
  'select org::text from app.member_organizations() as org order by 1',
  $$values ('00000000-0000-4000-8000-0000000000aa'), ('00000000-0000-4000-8000-0000000000bb')$$,
  'no claim: member_organizations is {A, B}'
);
select results_eq(
  'select org::text from app.editable_organizations() as org order by 1',
  $$values ('00000000-0000-4000-8000-0000000000aa'), ('00000000-0000-4000-8000-0000000000bb')$$,
  'no claim: editable_organizations is {A, B}'
);
select results_eq(
  'select org::text from app.admin_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000aa')$$,
  'no claim: admin_organizations is {A} only'
);
select results_eq(
  'select org::text from app.unscoped_organizations() as org order by 1',
  $$values ('00000000-0000-4000-8000-0000000000aa'), ('00000000-0000-4000-8000-0000000000bb')$$,
  'no claim: unscoped_organizations is {A, B}'
);
select results_eq(
  'select id::text from public.locations order by id',
  $$values ('00000000-0000-4000-8000-00000000aa10'), ('00000000-0000-4000-8000-00000000bb10')$$,
  'no claim: both locations are visible'
);

------------------------------------------------------------------------------------------------
-- The boolean helpers ignore the claim (claim says B, questions are about A, B and C).
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "u@test.local", "org_id": "00000000-0000-4000-8000-0000000000bb"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is(app.is_member('00000000-0000-4000-8000-0000000000aa'), true, 'claim B: is_member(A) is true (claim ignored)');
select is(app.can_edit('00000000-0000-4000-8000-0000000000aa'), true, 'claim B: can_edit(A) is true (owner, claim ignored)');
select is(app.is_member('00000000-0000-4000-8000-0000000000bb'), true, 'claim B: is_member(B) is true');
select is(app.can_edit('00000000-0000-4000-8000-0000000000bb'), true, 'claim B: can_edit(B) is true (planner edits)');
select is(app.is_member('00000000-0000-4000-8000-0000000000cc'), false, 'claim B: is_member(C) is false');
select is(app.can_edit('00000000-0000-4000-8000-0000000000cc'), false, 'claim B: can_edit(C) is false');

------------------------------------------------------------------------------------------------
-- set_active_organization is membership-based: switching to A works while the claim says B.
------------------------------------------------------------------------------------------------
select lives_ok(
  $$select public.set_active_organization('00000000-0000-4000-8000-0000000000aa')$$,
  'claim B: set_active_organization(A) succeeds (U is a member of A)'
);
select results_eq(
  'select active_organization_id::text from public.user_settings',
  $$values ('00000000-0000-4000-8000-0000000000aa')$$,
  'claim B: U reads their own settings row pointing at A'
);
select results_eq(
  'select id::text, is_active from public.my_organizations()',
  $$values ('00000000-0000-4000-8000-0000000000aa', true), ('00000000-0000-4000-8000-0000000000bb', false)$$,
  'claim B: my_organizations lists both organizations with only A active'
);

reset role;
select is(
  (select active_organization_id::text from public.user_settings where user_id = '00000000-0000-4000-8000-000000000001'),
  '00000000-0000-4000-8000-0000000000aa',
  'user_settings.active_organization_id is A (checked as postgres)'
);

-- Even a non-member claim does not hide my_organizations.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "u@test.local", "org_id": "00000000-0000-4000-8000-0000000000cc"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select results_eq(
  'select id::text, is_active from public.my_organizations()',
  $$values ('00000000-0000-4000-8000-0000000000aa', true), ('00000000-0000-4000-8000-0000000000bb', false)$$,
  'claim C: my_organizations still lists both organizations with A active'
);

------------------------------------------------------------------------------------------------
-- Removing the membership takes effect immediately, whatever the token says.
------------------------------------------------------------------------------------------------
reset role;
delete from public.memberships
where organization_id = '00000000-0000-4000-8000-0000000000aa'
  and user_id = '00000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "u@test.local", "org_id": "00000000-0000-4000-8000-0000000000aa"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select is_empty('select * from app.member_organizations()', 'after removal, claim A: member_organizations is empty');
select is_empty('select * from app.editable_organizations()', 'after removal, claim A: editable_organizations is empty');
select is((select count(*)::int from public.locations), 0, 'after removal, claim A: no locations are visible');
select is(app.is_member('00000000-0000-4000-8000-0000000000aa'), false, 'after removal, claim A: is_member(A) is false');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "u@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select results_eq(
  'select org::text from app.member_organizations() as org',
  $$values ('00000000-0000-4000-8000-0000000000bb')$$,
  'after removal, no claim: member_organizations is {B}'
);
select results_eq(
  'select id::text, is_active from public.my_organizations()',
  $$values ('00000000-0000-4000-8000-0000000000bb', false)$$,
  'after removal, no claim: my_organizations lists only B, not active (settings still point at A)'
);

------------------------------------------------------------------------------------------------
-- A user with no memberships gets nothing, with or without a claim.
------------------------------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "nobody@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select is_empty('select * from app.member_organizations()', 'no memberships: member_organizations is empty');
select is_empty('select * from app.editable_organizations()', 'no memberships: editable_organizations is empty');
select is((select count(*)::int from public.locations), 0, 'no memberships: no locations are visible');
select is_empty('select * from public.my_organizations()', 'no memberships: my_organizations returns no rows');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "nobody@test.local", "org_id": "00000000-0000-4000-8000-0000000000aa"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select is_empty('select * from app.member_organizations()', 'no memberships, claim A: member_organizations is still empty');
select is((select count(*)::int from public.locations), 0, 'no memberships, claim A: no locations are visible');
reset role;

select * from finish();

rollback;
