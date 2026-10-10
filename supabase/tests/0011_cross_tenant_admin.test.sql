-- Cross-tenant and abuse checks for the Step 3 tenancy layer:
-- * an owner or admin of organization B gets nothing from organization A (rows or RPCs), and the
--   member RPCs answer the same for real and unknown targets (no membership oracle);
-- * only owners manage owner invitations; admins neither re-arm nor revoke them;
-- * invitation throttles count revoked rows, so revoking and re-inviting cannot reset them, and the
--   daily caps per address, per organization and per inviter hold;
-- * internal helpers and the hook are not executable by API roles; anon cannot call any RPC;
-- * a confirmed account without an e-mail address cannot accept an invitation;
-- * a branch user of A who is a viewer of B sees exactly the right locations with and without a claim.
begin;

select plan(40);

-- Fixture --------------------------------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner-a@test.local', now()),
  ('00000000-0000-4000-8000-0000000000a2', 'admin-a@test.local', now()),
  ('00000000-0000-4000-8000-0000000000a3', 'planner-a@test.local', now()),
  ('00000000-0000-4000-8000-0000000000a4', 'branch-a@test.local', now()),
  ('00000000-0000-4000-8000-0000000000b1', 'owner-b@test.local', now()),
  ('00000000-0000-4000-8000-0000000000b2', 'admin-b@test.local', now());
insert into auth.users (id, phone, email_confirmed_at, phone_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000c1', '966500000001', now(), now());

insert into public.organizations (id, slug, name) values
  ('00000000-0000-4000-8000-00000000aaaa', 'xt-org-a', 'Org A'),
  ('00000000-0000-4000-8000-00000000bbbb', 'xt-org-b', 'Org B');
insert into public.memberships (organization_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a1', 'owner'),
  ('00000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a2', 'admin'),
  ('00000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a3', 'planner'),
  ('00000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a4', 'branch_user'),
  ('00000000-0000-4000-8000-00000000bbbb', '00000000-0000-4000-8000-0000000000b1', 'owner'),
  ('00000000-0000-4000-8000-00000000bbbb', '00000000-0000-4000-8000-0000000000b2', 'admin'),
  ('00000000-0000-4000-8000-00000000bbbb', '00000000-0000-4000-8000-0000000000a4', 'viewer');
insert into public.locations (id, organization_id, code, name_en, location_type, country_code, timezone) values
  ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-00000000aaaa', 'A-1', 'A one', 'branch', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-0000000a0002', '00000000-0000-4000-8000-00000000aaaa', 'A-2', 'A two', 'branch', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-00000000bbbb', 'B-1', 'B one', 'branch', 'SA', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-0000000b0002', '00000000-0000-4000-8000-00000000bbbb', 'B-2', 'B two', 'branch', 'SA', 'Asia/Riyadh');
insert into public.membership_locations (organization_id, user_id, location_id) values
  ('00000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000a0001');
insert into public.organization_invitations (id, organization_id, email, role, invited_by, last_sent_at) values
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-00000000aaaa', 'future-owner@test.local', 'owner', '00000000-0000-4000-8000-0000000000a1', now() - interval '3 minutes'),
  ('00000000-0000-4000-8000-0000000e0002', '00000000-0000-4000-8000-00000000aaaa', 'future-planner@test.local', 'planner', '00000000-0000-4000-8000-0000000000a2', now() - interval '3 minutes');

-- Privileges -----------------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'app.membership_role(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.require_role(uuid, text[])', 'execute')
  and not has_function_privilege('authenticated', 'app.require_user()', 'execute')
  and not has_function_privilege('authenticated', 'app.lock_memberships(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.custom_access_token_hook(jsonb)', 'execute'),
  'authenticated cannot execute the internal helpers or the hook'
);
select is(
  (select count(*)::int
   from unnest(array[
     'public.create_organization(text, text, char, char, boolean)',
     'public.update_organization_settings(uuid, text, char, char, boolean)',
     'public.set_active_organization(uuid)', 'public.my_organizations()',
     'public.organization_members(uuid)', 'public.set_member_role(uuid, uuid, text)',
     'public.remove_member(uuid, uuid)', 'public.set_member_locations(uuid, uuid, uuid[])',
     'public.invite_member(uuid, text, text)', 'public.revoke_invitation(uuid)',
     'public.my_invitations()', 'public.accept_invitation(uuid)']) as f
   where has_function_privilege('anon', f::regprocedure, 'execute')),
  0,
  'anon cannot execute any tenancy RPC'
);

-- Admin of B against organization A ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b2", "role": "authenticated", "email": "admin-b@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b2';

select is((select count(*)::int from public.organization_invitations where organization_id = '00000000-0000-4000-8000-00000000aaaa'), 0, 'admin of B reads none of A''s invitations');
select is((select count(*)::int from public.membership_locations where organization_id = '00000000-0000-4000-8000-00000000aaaa'), 0, 'admin of B reads none of A''s location assignments');
select is((select count(*)::int from public.memberships where organization_id = '00000000-0000-4000-8000-00000000aaaa'), 0, 'admin of B reads none of A''s memberships');
select is((select count(*)::int from public.locations where organization_id = '00000000-0000-4000-8000-00000000aaaa'), 0, 'admin of B reads none of A''s locations');
select throws_ok($$select * from public.organization_members('00000000-0000-4000-8000-00000000aaaa')$$, 'MQ403', null, 'admin of B cannot list A''s members');
select throws_ok($$select * from public.invite_member('00000000-0000-4000-8000-00000000aaaa', 'someone@test.local', 'viewer')$$, 'MQ403', null, 'admin of B cannot invite into A');
select throws_ok($$select public.revoke_invitation('00000000-0000-4000-8000-0000000e0002')$$, 'MQ404', null, 'admin of B cannot revoke A''s invitation (and learns nothing)');
select throws_ok($$select public.set_member_role('00000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a3', 'viewer')$$, 'MQ403', null, 'admin of B cannot change roles in A');
select throws_ok($$select public.remove_member('00000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a3')$$, 'MQ403', null, 'admin of B cannot remove a member of A');
select throws_ok($$select public.remove_member('00000000-0000-4000-8000-00000000aaaa', gen_random_uuid())$$, 'MQ403', null, 'remove_member answers the same for an unknown user (no membership oracle)');
select throws_ok($$select public.set_member_locations('00000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a4', '{}')$$, 'MQ403', null, 'admin of B cannot assign A''s locations');
select throws_ok($$select public.update_organization_settings('00000000-0000-4000-8000-00000000aaaa', 'Hijacked', 'SAR', 'SA', false)$$, 'MQ403', null, 'admin of B cannot change A''s settings');
select throws_ok($$select public.set_active_organization('00000000-0000-4000-8000-00000000aaaa')$$, 'MQ403', null, 'admin of B cannot make A active');
reset role;

-- Owner invitations are owner business ---------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated", "email": "admin-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a2';
select throws_ok($$select public.revoke_invitation('00000000-0000-4000-8000-0000000e0001')$$, 'MQ403', null, 'an admin cannot revoke an owner invitation');
select throws_ok($$select * from public.invite_member('00000000-0000-4000-8000-00000000aaaa', 'future-owner@test.local', 'viewer')$$, 'MQ403', null, 'an admin cannot re-arm or downgrade an owner invitation');
select lives_ok($$select public.revoke_invitation('00000000-0000-4000-8000-0000000e0002')$$, 'an admin revokes a planner invitation');
reset role;
select is((select role from public.organization_invitations where id = '00000000-0000-4000-8000-0000000e0001'), 'owner', 'the owner invitation kept its role');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated", "email": "owner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select lives_ok($$select public.revoke_invitation('00000000-0000-4000-8000-0000000e0001')$$, 'an owner revokes an owner invitation');

-- Throttles survive revoke and re-invite -------------------------------------------------------
select lives_ok($$select * from public.invite_member('00000000-0000-4000-8000-00000000aaaa', 'target@test.local', 'viewer')$$, 'first invitation to the address');
select lives_ok($$select public.revoke_invitation((select id from public.organization_invitations where email = 'target@test.local' and revoked_at is null))$$, 'revoke it');
select throws_ok($$select * from public.invite_member('00000000-0000-4000-8000-00000000aaaa', 'target@test.local', 'viewer')$$, 'MQ429', 'an invitation was sent less than two minutes ago', 'the cooldown still applies after a revoke');
reset role;

-- Four more invite/revoke rounds, each after the cooldown, reach five rows for the address today.
do $$
declare
  i integer;
begin
  for i in 2..5 loop
    update public.organization_invitations set last_sent_at = now() - interval '3 minutes' where email = 'target@test.local';
    perform set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated", "email": "owner-a@test.local"}', true);
    perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
    perform public.invite_member('00000000-0000-4000-8000-00000000aaaa', 'target@test.local', 'viewer');
    update public.organization_invitations set revoked_at = now() where email = 'target@test.local' and revoked_at is null;
  end loop;
  update public.organization_invitations set last_sent_at = now() - interval '3 minutes' where email = 'target@test.local';
end
$$;
select is((select count(*)::int from public.organization_invitations where email = 'target@test.local'), 5, 'five invitations to the address exist today');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated", "email": "owner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select throws_ok($$select * from public.invite_member('00000000-0000-4000-8000-00000000aaaa', 'target@test.local', 'viewer')$$, 'MQ429', 'too many invitations to this address today', 'a sixth invitation to the same address in 24 hours is refused');
reset role;

-- Per-inviter cap: 50 invitations by the admin of A in the last 24 hours.
insert into public.organization_invitations (organization_id, email, role, invited_by, last_sent_at, revoked_at)
select '00000000-0000-4000-8000-00000000aaaa', 'bulk-' || g || '@test.local', 'viewer', '00000000-0000-4000-8000-0000000000a2', now() - interval '1 hour', now()
from generate_series(1, 50) as g;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a2", "role": "authenticated", "email": "admin-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a2';
select throws_ok($$select * from public.invite_member('00000000-0000-4000-8000-00000000aaaa', 'one-more@test.local', 'viewer')$$, 'MQ429', 'too many invitations sent by you today', 'an inviter is capped at 50 invitations a day');
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated", "email": "owner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
select lives_ok($$select * from public.invite_member('00000000-0000-4000-8000-00000000aaaa', 'one-more@test.local', 'viewer')$$, 'another inviter of the same organization is not affected');
reset role;

-- Per-organization cap: 100 invitations sent from B in the last 24 hours.
insert into public.organization_invitations (organization_id, email, role, invited_by, last_sent_at, revoked_at)
select '00000000-0000-4000-8000-00000000bbbb', 'org-bulk-' || g || '@test.local', 'viewer', null, now() - interval '1 hour', now()
from generate_series(1, 100) as g;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000b1", "role": "authenticated", "email": "owner-b@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000b1';
select throws_ok($$select * from public.invite_member('00000000-0000-4000-8000-00000000bbbb', 'b-new@test.local', 'viewer')$$, 'MQ429', 'too many invitations from this organization today', 'an organization is capped at 100 invitations a day');
reset role;

-- A confirmed account without an e-mail cannot accept --------------------------------------------
insert into public.organization_invitations (id, organization_id, email, role, invited_by) values
  ('00000000-0000-4000-8000-0000000e0003', '00000000-0000-4000-8000-00000000aaaa', 'phone-user@test.local', 'owner', '00000000-0000-4000-8000-0000000000a1');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000c1", "role": "authenticated", "phone": "966500000001"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000c1';
select throws_ok($$select public.accept_invitation('00000000-0000-4000-8000-0000000e0003')$$, 'MQ422', null, 'an account without an e-mail address cannot accept an invitation');
reset role;
select is((select count(*)::int from public.memberships where user_id = '00000000-0000-4000-8000-0000000000c1'), 0, 'and gains no membership');

-- An invitation cannot be both accepted and revoked ----------------------------------------------
select throws_ok(
  $$update public.organization_invitations set accepted_at = now(), revoked_at = now() where id = '00000000-0000-4000-8000-0000000e0003'$$,
  '23514', null, 'the table refuses an invitation that is both accepted and revoked'
);

-- Branch user of A who is also a viewer of B ----------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a4", "role": "authenticated", "email": "branch-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a4';
select results_eq(
  $$select array_agg(x order by x) from app.unscoped_organizations() as x$$,
  $$values (array['00000000-0000-4000-8000-00000000bbbb'::uuid])$$,
  'no claim: unscoped only where the user is not a branch user (B)'
);
select results_eq(
  $$select array_agg(x order by x) from app.scoped_locations() as x$$,
  $$values (array['00000000-0000-4000-8000-0000000a0001'::uuid])$$,
  'no claim: scoped to the assigned location of A'
);
select results_eq(
  $$select code from public.locations order by code$$,
  $$values ('A-1'), ('B-1'), ('B-2')$$,
  'no claim: the assigned location of A plus every location of B'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a4", "role": "authenticated", "email": "branch-a@test.local", "org_id": "00000000-0000-4000-8000-00000000aaaa"}';
select is((select count(*)::int from app.unscoped_organizations()), 0, 'claim A: no unscoped organization');
select results_eq(
  $$select code from public.locations order by code$$,
  $$values ('A-1')$$,
  'claim A: only the assigned location'
);

set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a4", "role": "authenticated", "email": "branch-a@test.local", "org_id": "00000000-0000-4000-8000-00000000bbbb"}';
select is((select count(*)::int from app.scoped_locations()), 0, 'claim B: the A assignment does not apply');
select results_eq(
  $$select code from public.locations order by code$$,
  $$values ('B-1'), ('B-2')$$,
  'claim B: every location of B, nothing of A'
);
reset role;

-- The planner of A cannot use membership RPCs either ------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-0000000000a3", "role": "authenticated", "email": "planner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a3';
select throws_ok($$select public.remove_member('00000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a4')$$, 'MQ403', null, 'a planner cannot remove another member');
select lives_ok($$select public.remove_member('00000000-0000-4000-8000-00000000aaaa', '00000000-0000-4000-8000-0000000000a3')$$, 'a planner can leave');
reset role;

select * from finish();

rollback;
