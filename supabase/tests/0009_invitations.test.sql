-- Invitations (Step 3): invite_member, my_invitations, accept_invitation and revoke_invitation
-- proven by SQLSTATE, plus the read policy and privileges of organization_invitations.
--
-- Fixture: organization A with owner O, admin AD and planner P; N is a confirmed user with no
-- memberships (new@test.local), W a confirmed user with another address (wrong@test.local) and UC
-- an unconfirmed user (unconfirmed@test.local). now() is the transaction timestamp, so the
-- cooldown and expiry clocks are moved by postgres between RPC calls.
begin;

select plan(53);

insert into auth.users (id, email, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000001', 'owner-a@test.local', now()),
  ('00000000-0000-4000-8000-000000000002', 'admin-a@test.local', now()),
  ('00000000-0000-4000-8000-000000000003', 'planner-a@test.local', now()),
  ('00000000-0000-4000-8000-000000000004', 'new@test.local', now()),
  ('00000000-0000-4000-8000-000000000005', 'wrong@test.local', now()),
  ('00000000-0000-4000-8000-000000000006', 'unconfirmed@test.local', null);
insert into public.organizations (id, slug, name)
values ('00000000-0000-4000-8000-0000000000a0', 'org-a', 'Org A');
insert into public.memberships (organization_id, user_id, role)
values
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000001', 'owner'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000002', 'admin'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000003', 'planner');

------------------------------------------------------------------------------------------------
-- invite_member
------------------------------------------------------------------------------------------------

-- As AD (admin).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "admin-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select results_eq(
  $$select email, resend from public.invite_member('00000000-0000-4000-8000-0000000000a0', '  New@Test.local ', 'planner')$$,
  $$values ('new@test.local'::text, false)$$,
  'admin invites a new address: one row, lower-cased and trimmed, not a resend'
);
select throws_ok(
  $$select * from public.invite_member('00000000-0000-4000-8000-0000000000a0', 'anyone@test.local', 'owner')$$,
  'MQ422',
  null,
  'an admin cannot invite an owner (role ceiling)'
);
select throws_ok(
  $$select * from public.invite_member('00000000-0000-4000-8000-0000000000a0', 'anyone@test.local', 'superuser')$$,
  'MQ422',
  null,
  'an unknown role is rejected'
);
select throws_ok(
  $$select * from public.invite_member('00000000-0000-4000-8000-0000000000a0', 'Planner-A@test.local', 'viewer')$$,
  'MQ409',
  null,
  'inviting an existing member''s address (any case) is a conflict'
);
select throws_ok(
  $$select * from public.invite_member('00000000-0000-4000-8000-0000000000a0', 'new@test.local', 'planner')$$,
  'MQ429',
  null,
  'a second send inside two minutes is refused'
);

-- As postgres: remember the invitation id and age it past the cooldown with an older expiry.
reset role;
do $$
begin
  perform set_config(
    'test.inv_new',
    (select i.id::text from public.organization_invitations i
     where i.organization_id = '00000000-0000-4000-8000-0000000000a0' and i.email = 'new@test.local'),
    true
  );
end
$$;
update public.organization_invitations
set created_at = now() - interval '3 days',
    last_sent_at = now() - interval '3 minutes',
    expires_at = now() + interval '4 days'
where id = current_setting('test.inv_new')::uuid;

-- As AD again: the resend re-arms the same row.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "admin-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select results_eq(
  $$select id, email, resend from public.invite_member('00000000-0000-4000-8000-0000000000a0', 'new@test.local', 'planner')$$,
  $$values (current_setting('test.inv_new')::uuid, 'new@test.local'::text, true)$$,
  'after the cooldown the call is a resend of the same invitation'
);

reset role;
select is(
  (select send_count from public.organization_invitations where id = current_setting('test.inv_new')::uuid),
  2,
  'a resend increments send_count'
);
select is(
  (select expires_at from public.organization_invitations where id = current_setting('test.inv_new')::uuid),
  now() + interval '7 days',
  'a resend moves expires_at to seven days from now'
);
select is(
  (select last_sent_at from public.organization_invitations where id = current_setting('test.inv_new')::uuid),
  now(),
  'a resend stamps last_sent_at'
);

update public.organization_invitations
set send_count = 10, last_sent_at = now() - interval '3 minutes'
where id = current_setting('test.inv_new')::uuid;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "admin-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select throws_ok(
  $$select * from public.invite_member('00000000-0000-4000-8000-0000000000a0', 'new@test.local', 'planner')$$,
  'MQ429',
  null,
  'an invitation already sent ten times cannot be resent'
);

reset role;
update public.organization_invitations
set send_count = 2, last_sent_at = now()
where id = current_setting('test.inv_new')::uuid;

select throws_ok(
  $$insert into public.organization_invitations (organization_id, email, role)
    values ('00000000-0000-4000-8000-0000000000a0', 'new@test.local', 'viewer')$$,
  '23505',
  null,
  'only one pending invitation per organization and address, even for postgres'
);

-- As O (owner): owners may invite owners.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "owner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

select results_eq(
  $$select email, resend from public.invite_member('00000000-0000-4000-8000-0000000000a0', 'second-owner@test.local', 'owner')$$,
  $$values ('second-owner@test.local'::text, false)$$,
  'an owner can invite another owner'
);

-- As P (planner): no invitation rights, no visibility.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "role": "authenticated", "email": "planner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';

select throws_ok(
  $$select * from public.invite_member('00000000-0000-4000-8000-0000000000a0', 'someone@test.local', 'viewer')$$,
  'MQ403',
  null,
  'a planner cannot invite'
);
select is((select count(*)::int from public.organization_invitations), 0, 'a planner sees no invitation rows');

-- Without a session (authenticated role, no sub claim).
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
set local request.jwt.claim.sub = '';

select throws_ok(
  $$select * from public.invite_member('00000000-0000-4000-8000-0000000000a0', 'someone@test.local', 'viewer')$$,
  'MQ401',
  null,
  'invite_member without a session raises MQ401'
);

------------------------------------------------------------------------------------------------
-- Read policy and privileges on organization_invitations
------------------------------------------------------------------------------------------------

-- As AD: reads the organization's rows, cannot write directly.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "admin-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select results_eq(
  'select email from public.organization_invitations order by email',
  $$values ('new@test.local'::text), ('second-owner@test.local'::text)$$,
  'an admin sees the invitation rows of the organization'
);
select throws_ok(
  $$insert into public.organization_invitations (organization_id, email, role)
    values ('00000000-0000-4000-8000-0000000000a0', 'direct@test.local', 'viewer')$$,
  '42501',
  null,
  'authenticated cannot insert invitations directly'
);
select throws_ok(
  $$update public.organization_invitations set role = 'owner'$$,
  '42501',
  null,
  'authenticated cannot update invitations directly'
);
select throws_ok(
  $$delete from public.organization_invitations$$,
  '42501',
  null,
  'authenticated cannot delete invitations directly'
);

-- As N (no memberships).
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "new@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';

select is((select count(*)::int from public.organization_invitations), 0, 'a non-member sees no invitation rows');

reset role;
select ok(
  has_table_privilege('authenticated', 'public.organization_invitations'::regclass, 'SELECT'),
  'authenticated keeps select on organization_invitations (gated by the policy)'
);
select is(
  (select bool_or(has_table_privilege('authenticated', 'public.organization_invitations'::regclass, p))
   from unnest(array['INSERT', 'UPDATE', 'DELETE']) as p),
  false,
  'authenticated has no insert, update or delete privilege on organization_invitations'
);
select is(
  (select bool_or(has_table_privilege('anon', 'public.organization_invitations'::regclass, p))
   from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p),
  false,
  'anon has no privileges on organization_invitations'
);
select is(
  (select bool_or(has_function_privilege('anon', f, 'execute'))
   from unnest(array['public.invite_member(uuid, text, text)', 'public.revoke_invitation(uuid)',
                     'public.my_invitations()', 'public.accept_invitation(uuid)']) as f),
  false,
  'anon cannot execute the invitation RPCs'
);
select is(
  (select bool_and(has_function_privilege('authenticated', f, 'execute'))
   from unnest(array['public.invite_member(uuid, text, text)', 'public.revoke_invitation(uuid)',
                     'public.my_invitations()', 'public.accept_invitation(uuid)']) as f),
  true,
  'authenticated can execute the invitation RPCs'
);

------------------------------------------------------------------------------------------------
-- my_invitations
------------------------------------------------------------------------------------------------

-- As N.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "new@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';

select results_eq(
  $$select id, organization_id, organization_name, role, invited_by_email, expires_at from public.my_invitations()$$,
  $$values (current_setting('test.inv_new')::uuid, '00000000-0000-4000-8000-0000000000a0'::uuid, 'Org A'::text,
            'planner'::text, 'admin-a@test.local'::text, now() + interval '7 days')$$,
  'N sees exactly the pending invitation for new@test.local with organization name, role and inviter'
);

-- As W.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "role": "authenticated", "email": "wrong@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';

select is((select count(*)::int from public.my_invitations()), 0, 'W has no invitations');

-- Expired invitations are hidden.
reset role;
update public.organization_invitations
set expires_at = now() - interval '1 day'
where id = current_setting('test.inv_new')::uuid;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "new@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';

select is((select count(*)::int from public.my_invitations()), 0, 'an expired invitation is not listed');

reset role;
update public.organization_invitations
set expires_at = now() + interval '7 days'
where id = current_setting('test.inv_new')::uuid;

------------------------------------------------------------------------------------------------
-- accept_invitation
------------------------------------------------------------------------------------------------

-- As postgres: an invitation for the unconfirmed user.
insert into public.organization_invitations (id, organization_id, email, role, invited_by)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a0', 'unconfirmed@test.local', 'viewer',
        '00000000-0000-4000-8000-000000000001');

-- As W: the address does not match.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "role": "authenticated", "email": "wrong@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.accept_invitation(current_setting('test.inv_new')::uuid)$$,
  'MQ422',
  null,
  'a user with a different address cannot accept'
);

-- As UC: e-mail not confirmed.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000006", "role": "authenticated", "email": "unconfirmed@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000006';

select throws_ok(
  $$select public.accept_invitation('00000000-0000-4000-8000-0000000000e1')$$,
  'MQ401',
  null,
  'an unconfirmed user cannot accept'
);

-- Without a session.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
set local request.jwt.claim.sub = '';

select throws_ok(
  $$select public.accept_invitation(current_setting('test.inv_new')::uuid)$$,
  'MQ401',
  null,
  'accept_invitation without a session raises MQ401'
);

-- Expired: MQ404 even for the right address.
reset role;
update public.organization_invitations
set expires_at = now() - interval '1 day'
where id = current_setting('test.inv_new')::uuid;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "new@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';

select throws_ok(
  $$select public.accept_invitation(current_setting('test.inv_new')::uuid)$$,
  'MQ404',
  null,
  'an expired invitation cannot be accepted'
);

reset role;
update public.organization_invitations
set expires_at = now() + interval '7 days'
where id = current_setting('test.inv_new')::uuid;

-- As N: accepting works once.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "new@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';

select is(
  public.accept_invitation(current_setting('test.inv_new')::uuid),
  '00000000-0000-4000-8000-0000000000a0'::uuid,
  'N accepts and gets the organization id back'
);

reset role;
select is(
  (select role from public.memberships
   where organization_id = '00000000-0000-4000-8000-0000000000a0' and user_id = '00000000-0000-4000-8000-000000000004'),
  'planner',
  'N is now a planner of organization A'
);
select ok(
  (select accepted_at is not null from public.organization_invitations where id = current_setting('test.inv_new')::uuid),
  'the accepted invitation carries accepted_at'
);
select is(
  (select accepted_by from public.organization_invitations where id = current_setting('test.inv_new')::uuid),
  '00000000-0000-4000-8000-000000000004'::uuid,
  'the accepted invitation carries accepted_by'
);
select is(
  (select active_organization_id from public.user_settings where user_id = '00000000-0000-4000-8000-000000000004'),
  '00000000-0000-4000-8000-0000000000a0'::uuid,
  'accepting makes the organization active'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "new@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';

select is((select count(*)::int from public.my_invitations()), 0, 'N has no pending invitations after accepting');
select results_eq(
  'select id, role, is_active from public.my_organizations()',
  $$values ('00000000-0000-4000-8000-0000000000a0'::uuid, 'planner'::text, true)$$,
  'my_organizations lists A as the active organization with the invited role'
);
select throws_ok(
  $$select public.accept_invitation(current_setting('test.inv_new')::uuid)$$,
  'MQ404',
  null,
  'an invitation cannot be accepted twice'
);
select throws_ok(
  $$select public.accept_invitation('00000000-0000-4000-8000-0000000000ff')$$,
  'MQ404',
  null,
  'an unknown invitation id is not found'
);

------------------------------------------------------------------------------------------------
-- Existing members keep their role
------------------------------------------------------------------------------------------------

reset role;
insert into public.organization_invitations (id, organization_id, email, role, invited_by)
values ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a0', 'planner-a@test.local', 'viewer',
        '00000000-0000-4000-8000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "role": "authenticated", "email": "planner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';

select is(
  public.accept_invitation('00000000-0000-4000-8000-0000000000e3'),
  '00000000-0000-4000-8000-0000000000a0'::uuid,
  'an existing member can accept an invitation to their organization'
);

reset role;
select is(
  (select role from public.memberships
   where organization_id = '00000000-0000-4000-8000-0000000000a0' and user_id = '00000000-0000-4000-8000-000000000003'),
  'planner',
  'the existing member keeps their role (viewer invitation does not downgrade)'
);
select results_eq(
  $$select accepted_at is not null, accepted_by from public.organization_invitations where id = '00000000-0000-4000-8000-0000000000e3'$$,
  $$values (true, '00000000-0000-4000-8000-000000000003'::uuid)$$,
  'the invitation is marked accepted by the existing member'
);

------------------------------------------------------------------------------------------------
-- revoke_invitation
------------------------------------------------------------------------------------------------

insert into public.organization_invitations (id, organization_id, email, role, invited_by)
values ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000a0', 'wrong@test.local', 'viewer',
        '00000000-0000-4000-8000-000000000001');

-- As W (not a member).
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "role": "authenticated", "email": "wrong@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.revoke_invitation('00000000-0000-4000-8000-0000000000e4')$$,
  'MQ404',
  null,
  'a non-member cannot revoke, even their own invitation (MQ404: nothing is revealed)'
);

-- As P.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000003", "role": "authenticated", "email": "planner-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';

select throws_ok(
  $$select public.revoke_invitation('00000000-0000-4000-8000-0000000000e4')$$,
  'MQ404',
  null,
  'a planner cannot revoke (MQ404: only owners and admins see invitations)'
);

-- As AD.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "admin-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select lives_ok(
  $$select public.revoke_invitation('00000000-0000-4000-8000-0000000000e4')$$,
  'an admin revokes a pending invitation'
);

reset role;
select results_eq(
  $$select revoked_at is not null, revoked_by from public.organization_invitations where id = '00000000-0000-4000-8000-0000000000e4'$$,
  $$values (true, '00000000-0000-4000-8000-000000000002'::uuid)$$,
  'the revoked invitation carries revoked_at and revoked_by'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "admin-a@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';

select throws_ok(
  $$select public.revoke_invitation('00000000-0000-4000-8000-0000000000e4')$$,
  'MQ404',
  null,
  'a revoked invitation cannot be revoked again'
);
select throws_ok(
  $$select public.revoke_invitation('00000000-0000-4000-8000-0000000000e3')$$,
  'MQ404',
  null,
  'an accepted invitation is no longer pending'
);
select throws_ok(
  $$select public.revoke_invitation('00000000-0000-4000-8000-0000000000ff')$$,
  'MQ404',
  null,
  'an unknown invitation id cannot be revoked'
);

-- As W: the revoked invitation to their own address is gone.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000000005", "role": "authenticated", "email": "wrong@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';

select throws_ok(
  $$select public.accept_invitation('00000000-0000-4000-8000-0000000000e4')$$,
  'MQ404',
  null,
  'a revoked invitation cannot be accepted'
);

reset role;
select is(
  (select count(*)::int from public.memberships where user_id = '00000000-0000-4000-8000-000000000005'),
  0,
  'the failed attempts gave W no membership'
);

select * from finish();

rollback;
