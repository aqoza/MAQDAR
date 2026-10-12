-- Organization display preferences (Step 4). update_organization_preferences() is for owners and
-- admins, validates the default language, time zone and numbering system against their
-- allow-lists (MQ422 with the field as hint), and leaves update_organization_settings() as it was;
-- turning Arabic off there resets the default language. my_organizations() appends the
-- preferences and the effective time zone (the organization's zone, else its home country's).
-- Fixtures run as postgres; every block impersonates one user and returns with reset role.
begin;

select plan(52);

-- Fixture: organization X (home country Kuwait, Arabic on) with an owner, an admin, a planner and
-- a viewer; organization Y (defaults) with its own admin.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000001301', 'prefs-owner-x@test.local', now()),
  ('00000000-0000-4000-8000-000000001302', 'prefs-admin-x@test.local', now()),
  ('00000000-0000-4000-8000-000000001303', 'prefs-planner-x@test.local', now()),
  ('00000000-0000-4000-8000-000000001304', 'prefs-viewer-x@test.local', now()),
  ('00000000-0000-4000-8000-000000001311', 'prefs-admin-y@test.local', now());
insert into public.organizations (id, slug, name, base_currency, home_country, arabic_enabled) values
  ('00000000-0000-4000-8000-0000000013a0', 'prefs-org-x', 'Prefs Org X', 'KWD', 'KW', true),
  ('00000000-0000-4000-8000-0000000013b0', 'prefs-org-y', 'Prefs Org Y', 'SAR', 'SA', false);
insert into public.memberships (organization_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000013a0', '00000000-0000-4000-8000-000000001301', 'owner'),
  ('00000000-0000-4000-8000-0000000013a0', '00000000-0000-4000-8000-000000001302', 'admin'),
  ('00000000-0000-4000-8000-0000000013a0', '00000000-0000-4000-8000-000000001303', 'planner'),
  ('00000000-0000-4000-8000-0000000013a0', '00000000-0000-4000-8000-000000001304', 'viewer'),
  ('00000000-0000-4000-8000-0000000013b0', '00000000-0000-4000-8000-000000001311', 'admin');

-- The hint of the error a statement raises (the web app maps it to a form field), or null.
create function pg_temp.hint_of(q text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute q;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint;
end;
$$;

------------------------------------------------------------------------------------------------
-- Structure and privileges (as postgres)
------------------------------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.update_organization_preferences(uuid, text, text, text)', 'execute'),
  'anon cannot execute update_organization_preferences'
);
select ok(
  has_function_privilege('authenticated', 'public.update_organization_preferences(uuid, text, text, text)', 'execute'),
  'authenticated can execute update_organization_preferences (the function checks the role)'
);
select ok(
  not has_table_privilege('authenticated', 'public.organizations', 'UPDATE')
  and not has_any_column_privilege('authenticated', 'public.organizations', 'UPDATE'),
  'authenticated still has no UPDATE privilege on organizations, on the table or any column'
);
select has_function(
  'public', 'update_organization_settings', array['uuid', 'text', 'character', 'character', 'boolean'],
  'update_organization_settings keeps its Step 3 signature'
);
select is(
  (select proargnames from pg_proc where oid = 'public.my_organizations()'::regprocedure),
  array['id', 'slug', 'name', 'role', 'arabic_enabled', 'base_currency', 'home_country', 'is_active',
        'default_locale', 'time_zone', 'effective_time_zone', 'numbering_system'],
  'my_organizations returns the Step 3 columns followed by the four preference columns, in order'
);
select results_eq(
  $$select default_locale, time_zone, numbering_system from public.organizations
    where id = '00000000-0000-4000-8000-0000000013b0'$$,
  $$values ('en', null::text, 'latn')$$,
  'a new organization defaults to English, no time zone of its own and Latin digits'
);

------------------------------------------------------------------------------------------------
-- Not signed in
------------------------------------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'en', null, 'latn')$$,
  '42501', null, 'anon cannot call update_organization_preferences at all'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';
set local request.jwt.claim.sub = '';
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'en', null, 'latn')$$,
  'MQ401', null, 'authenticated without a sub claim is MQ401'
);
reset role;

------------------------------------------------------------------------------------------------
-- Admin of X
------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000001302", "role": "authenticated", "email": "prefs-admin-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000001302';

select lives_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', 'Asia/Dubai', 'arab')$$,
  'an admin sets Arabic as the default language, Asia/Dubai and Arabic-Indic digits'
);
select results_eq(
  $$select default_locale, time_zone, effective_time_zone, numbering_system
    from public.my_organizations() where id = '00000000-0000-4000-8000-0000000013a0'$$,
  $$values ('ar', 'Asia/Dubai', 'Asia/Dubai', 'arab')$$,
  'my_organizations returns the preferences, and the effective time zone is the chosen zone'
);
select results_eq(
  $$select id, slug, name, role, arabic_enabled, base_currency::text, home_country::text, is_active,
           default_locale, time_zone, effective_time_zone, numbering_system
    from public.my_organizations()$$,
  $$values ('00000000-0000-4000-8000-0000000013a0'::uuid, 'prefs-org-x', 'Prefs Org X', 'admin', true, 'KWD', 'KW', false,
            'ar', 'Asia/Dubai', 'Asia/Dubai', 'arab')$$,
  'every named column of my_organizations is selectable and correct for the admin'
);

select lives_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', '', 'arab')$$,
  'an empty time zone is accepted'
);
select results_eq(
  $$select time_zone, effective_time_zone from public.my_organizations() where id = '00000000-0000-4000-8000-0000000013a0'$$,
  $$select null::text, c.timezone from public.countries c where c.code = 'KW'$$,
  'an empty time zone resets to null and the effective zone follows the home country (Kuwait)'
);

select lives_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', 'UTC', 'arab')$$,
  'UTC is accepted'
);
select results_eq(
  $$select time_zone, effective_time_zone from public.my_organizations() where id = '00000000-0000-4000-8000-0000000013a0'$$,
  $$values ('UTC', 'UTC')$$,
  'UTC is stored and is the effective zone'
);

select lives_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', null, 'arab')$$,
  'a null time zone is accepted'
);
select results_eq(
  $$select time_zone, effective_time_zone from public.my_organizations() where id = '00000000-0000-4000-8000-0000000013a0'$$,
  $$select null::text, c.timezone from public.countries c where c.code = 'KW'$$,
  'a null time zone resets to null and the effective zone follows the home country again'
);

select lives_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', '  Asia/Qatar  ', 'arab')$$,
  'a zone with surrounding blanks is accepted'
);
select is(
  (select time_zone from public.organizations where id = '00000000-0000-4000-8000-0000000013a0'),
  'Asia/Qatar',
  'the zone is stored trimmed'
);

-- Values outside the allow-lists.
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', 'Mars/Base', 'arab')$$,
  'MQ422', null, 'an unknown time zone is MQ422'
);
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', 'Factory', 'arab')$$,
  'MQ422', null, 'the IANA placeholder zone Factory is MQ422'
);
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', 'Europe/London', 'arab')$$,
  'MQ422', null, 'a real IANA zone outside the countries'' zones is MQ422'
);
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', 'asia/dubai', 'arab')$$,
  'MQ422', null, 'zone names are matched exactly (case matters)'
);
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'fr', null, 'arab')$$,
  'MQ422', null, 'an unknown default language is MQ422'
);
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', null, null, 'arab')$$,
  'MQ422', null, 'a null default language is MQ422'
);
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', null, 'roman')$$,
  'MQ422', null, 'an unknown numbering system is MQ422'
);
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', null, null)$$,
  'MQ422', null, 'a null numbering system is MQ422'
);
select is(
  pg_temp.hint_of($$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', 'Mars/Base', 'arab')$$),
  'time_zone',
  'an unknown time zone names the time_zone field in the hint'
);
select is(
  pg_temp.hint_of($$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'fr', null, 'arab')$$),
  'default_locale',
  'an unknown default language names the default_locale field in the hint'
);
select is(
  pg_temp.hint_of($$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', null, 'roman')$$),
  'numbering_system',
  'an unknown numbering system names the numbering_system field in the hint'
);
select results_eq(
  $$select default_locale, time_zone, numbering_system from public.organizations
    where id = '00000000-0000-4000-8000-0000000013a0'$$,
  $$values ('ar', 'Asia/Qatar', 'arab')$$,
  'the rejected calls changed nothing'
);
select throws_ok(
  $$update public.organizations set default_locale = 'en' where id = '00000000-0000-4000-8000-0000000013a0'$$,
  '42501', null, 'an admin cannot update the organizations table directly'
);

-- Turning Arabic off through the unchanged settings RPC resets the default language.
select lives_ok(
  $$select public.update_organization_settings('00000000-0000-4000-8000-0000000013a0', 'Prefs Org X', 'KWD', 'KW', false)$$,
  'update_organization_settings turns Arabic off while Arabic is the default language'
);
select results_eq(
  $$select arabic_enabled, default_locale, time_zone, numbering_system
    from public.my_organizations() where id = '00000000-0000-4000-8000-0000000013a0'$$,
  $$values (false, 'en', 'Asia/Qatar', 'arab')$$,
  'turning Arabic off resets the default language to en and keeps the zone and numbering system'
);
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', null, 'latn')$$,
  'MQ422', null, 'Arabic cannot be the default language while Arabic is off'
);
select is(
  pg_temp.hint_of($$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', null, 'latn')$$),
  'default_locale',
  'and the hint names the default_locale field'
);
select lives_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'en', 'Asia/Riyadh', 'latn')$$,
  'English with another regional zone is accepted while Arabic is off'
);
select lives_ok(
  $$select public.update_organization_settings('00000000-0000-4000-8000-0000000013a0', 'Prefs Org X', 'KWD', 'KW', true)$$,
  'Arabic is turned back on'
);
select results_eq(
  $$select arabic_enabled, default_locale, time_zone, numbering_system from public.organizations
    where id = '00000000-0000-4000-8000-0000000013a0'$$,
  $$values (true, 'en', 'Asia/Riyadh', 'latn')$$,
  'turning Arabic back on does not change the default language'
);
reset role;

------------------------------------------------------------------------------------------------
-- Other roles
------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000001303", "role": "authenticated", "email": "prefs-planner-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000001303';
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', 'UTC', 'arab')$$,
  'MQ403', null, 'a planner cannot change the preferences'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000001304", "role": "authenticated", "email": "prefs-viewer-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000001304';
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', 'UTC', 'arab')$$,
  'MQ403', null, 'a viewer cannot change the preferences'
);
select results_eq(
  $$select role, default_locale, time_zone, effective_time_zone, numbering_system from public.my_organizations()$$,
  $$values ('viewer', 'en', 'Asia/Riyadh', 'Asia/Riyadh', 'latn')$$,
  'a viewer reads the preferences through my_organizations'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000001311", "role": "authenticated", "email": "prefs-admin-y@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000001311';
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', 'UTC', 'arab')$$,
  'MQ403', null, 'the admin of another organization cannot change X''s preferences'
);
select throws_ok(
  $$select public.update_organization_preferences(gen_random_uuid(), 'en', 'UTC', 'latn')$$,
  'MQ403', null, 'an unknown organization answers the same MQ403 (no existence oracle)'
);
select results_eq(
  $$select id, default_locale, time_zone, effective_time_zone, numbering_system from public.my_organizations()$$,
  $$select '00000000-0000-4000-8000-0000000013b0'::uuid, 'en', null::text, c.timezone, 'latn' from public.countries c where c.code = 'SA'$$,
  'my_organizations for the admin of Y lists only Y, following Saudi Arabia''s zone'
);
select lives_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013b0', 'en', 'Asia/Bahrain', 'arab')$$,
  'the admin of Y changes Y'
);
select throws_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013b0', 'ar', 'Asia/Bahrain', 'arab')$$,
  'MQ422', null, 'Arabic cannot become Y''s default language while Y has Arabic off'
);
reset role;

select results_eq(
  $$select default_locale, time_zone, numbering_system from public.organizations
    where id = '00000000-0000-4000-8000-0000000013a0'$$,
  $$values ('en', 'Asia/Riyadh', 'latn')$$,
  'the refused calls of the planner, the viewer and the admin of Y left X unchanged'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-000000001301", "role": "authenticated", "email": "prefs-owner-x@test.local"}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000001301';
select lives_ok(
  $$select public.update_organization_preferences('00000000-0000-4000-8000-0000000013a0', 'ar', 'Asia/Muscat', 'arab')$$,
  'an owner changes the preferences'
);
select results_eq(
  $$select default_locale, time_zone, effective_time_zone, numbering_system
    from public.my_organizations() where id = '00000000-0000-4000-8000-0000000013a0'$$,
  $$values ('ar', 'Asia/Muscat', 'Asia/Muscat', 'arab')$$,
  'the owner''s change is visible through my_organizations'
);
reset role;

------------------------------------------------------------------------------------------------
-- The table keeps the invariant for direct writes too (as postgres)
------------------------------------------------------------------------------------------------
update public.organizations set default_locale = 'ar' where id = '00000000-0000-4000-8000-0000000013b0';
select is(
  (select default_locale from public.organizations where id = '00000000-0000-4000-8000-0000000013b0'),
  'en',
  'a direct write of ar while Arabic is off is reset to en by the sync trigger'
);
select throws_ok(
  $$update public.organizations set numbering_system = 'roman' where id = '00000000-0000-4000-8000-0000000013b0'$$,
  '23514', null, 'the table refuses an unknown numbering system'
);

select * from finish();

rollback;
