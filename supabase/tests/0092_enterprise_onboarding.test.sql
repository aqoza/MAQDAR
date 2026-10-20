begin;
select plan(36);

insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000001','owner@test.local',now()),
 ('00000000-0000-4000-8000-000000000002','planner@test.local',now()),
 ('00000000-0000-4000-8000-000000000003','other@test.local',now());
insert into public.organizations(id,slug,name) values
 ('00000000-0000-4000-8000-0000000000a0','onboarding-a','A'),
 ('00000000-0000-4000-8000-0000000000b0','onboarding-b','B');
insert into public.memberships(organization_id,user_id,role) values
 ('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-000000000001','owner'),
 ('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-000000000002','planner'),
 ('00000000-0000-4000-8000-0000000000b0','00000000-0000-4000-8000-000000000003','owner');
select ok(not has_schema_privilege('authenticated','onboarding','USAGE'),'queue schema is private');
select ok(not has_table_privilege('authenticated','onboarding.policies','UPDATE'),'admins cannot raise caps');
select ok(not has_table_privilege('service_role','onboarding.jobs','SELECT'),'worker has RPC-only access');
select ok(not has_function_privilege('authenticated','public.onboarding_claim()','EXECUTE'),'session cannot claim mail');
select ok(not has_function_privilege('anon','public.onboarding_enqueue(uuid,uuid,text[],text)','EXECUTE'),'anonymous cannot queue');

set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.onboarding_enqueue('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-0000000000f0',array['x@test.local'],'viewer')$$,'MQ403',null,'bulk is opt-in per workspace');
select throws_ok($$select public.onboarding_status('00000000-0000-4000-8000-0000000000b0')$$,'MQ403',null,'other tenant queue hidden');
reset role;
insert into onboarding.policies values('00000000-0000-4000-8000-0000000000a0',2000,2000,now()+interval '90 days','Approved enterprise POC onboarding');
set local role authenticated;
select lives_ok($$select public.onboarding_enqueue('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-0000000000f0',array(select 'person'||n||'@test.local' from generate_series(1,1001)n),'viewer')$$,'1001 recipients queue atomically');
select lives_ok($$select public.onboarding_enqueue('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-0000000000f0',array(select 'person'||n||'@test.local' from generate_series(1,1001)n),'viewer')$$,'same batch retries are idempotent');
select throws_ok($$select public.onboarding_enqueue('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-0000000000f0',array['different@test.local'],'viewer')$$,'MQ409',null,'changed payload cannot reuse batch');
select throws_ok($$select public.onboarding_enqueue('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-0000000000f1',array['person1@test.local'],'viewer')$$,'MQ409',null,'overlapping pending addresses rejected');
select throws_ok($$select public.onboarding_enqueue('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-0000000000f1',array['same@test.local','SAME@test.local'],'viewer')$$,'MQ422',null,'duplicates rejected in SQL too');
select throws_ok($$select public.onboarding_enqueue('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-0000000000f1',array['new@test.local'],'owner')$$,'MQ422',null,'bulk cannot grant owner');
select is((public.onboarding_status('00000000-0000-4000-8000-0000000000a0')->'batches'->0->>'total')::integer,1001,'progress total is exact');
reset role;
select is((select count(*)::integer from public.organization_invitations where organization_id='00000000-0000-4000-8000-0000000000a0'),0,'enqueue creates no accounts or active invitations');
-- A busy administrator must still be able to see/cancel older pending work after newer batches.
update onboarding.batches set created_at=now()-interval '1 day' where id='00000000-0000-4000-8000-0000000000f0';
insert into onboarding.batches(id,organization_id,created_by,role,fingerprint)
select md5('recent-onboarding-'||n)::uuid,'00000000-0000-4000-8000-0000000000a0'::uuid,
  '00000000-0000-4000-8000-000000000001'::uuid,'viewer','synthetic-'||n from generate_series(1,10)n;
insert into onboarding.jobs(batch_id,email,state)
select md5('recent-onboarding-'||n)::uuid,'closed-'||n||'@test.local','sent' from generate_series(1,10)n;
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.onboarding_status('00000000-0000-4000-8000-0000000000a0')->'batches') b
  where b->>'id'='00000000-0000-4000-8000-0000000000f0'),'older active batch stays visible beyond ten recent batches');
reset role;
set local role service_role;
select ok(public.onboarding_claim() is not null,'worker claims guarded invitation');
select is(public.onboarding_claim(),null::jsonb,'global pace prevents an immediate second claim');
reset role;
select is((select count(*)::integer from onboarding.attempts where organization_id='00000000-0000-4000-8000-0000000000a0'),1,'attempt ledger counts each preparation');
select set_config('test.job',(select id::text from onboarding.jobs where state='sending'),true);
select set_config('test.lease',(select lease::text from onboarding.jobs where state='sending'),true);
set local role service_role;
select throws_ok($$select public.onboarding_finish(current_setting('test.job')::uuid,'00000000-0000-4000-8000-000000000099','sent')$$,'MQ409',null,'wrong lease cannot acknowledge');
select lives_ok($$select public.onboarding_finish(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,'uncertain')$$,'ambiguous send held for review');
reset role;
select is((select state from onboarding.jobs where id=current_setting('test.job')::uuid),'uncertain','uncertain work is not automatically requeued');
-- Revoke inviter authority before a scheduled delivery. No remaining messages may be claimed.
update public.memberships set role='viewer' where user_id='00000000-0000-4000-8000-000000000001';
update onboarding.delivery_control set next_send_at='-infinity';
set local role service_role;
select is(public.onboarding_claim(),null::jsonb,'lost administrator role prevents delivery');
reset role;
update public.memberships set role='owner' where user_id='00000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.onboarding_cancel('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-0000000000f0')$$,'remaining batch can be cancelled');
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select public.organization_members_page('00000000-0000-4000-8000-0000000000a0')$$,'MQ403',null,'planner cannot list private member emails');
reset role;

insert into auth.users(id,email,email_confirmed_at)
select md5('large-directory-'||n)::uuid,'large'||lpad(n::text,4,'0')||'@test.local',now() from generate_series(1,1001)n;
insert into public.memberships(organization_id,user_id,role)
select '00000000-0000-4000-8000-0000000000a0'::uuid,md5('large-directory-'||n)::uuid,'viewer' from generate_series(1,1001)n;
insert into public.organization_invitations(organization_id,email,role,invited_by)
select '00000000-0000-4000-8000-0000000000a0'::uuid,'pending'||lpad(n::text,4,'0')||'@test.local','viewer','00000000-0000-4000-8000-000000000001'::uuid from generate_series(1,1001)n;
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.organization_members_page('00000000-0000-4000-8000-0000000000a0')->>'total')::integer,1003,'member count includes rows beyond 1000');
select is(jsonb_array_length(public.organization_members_page('00000000-0000-4000-8000-0000000000a0',11)->'rows'),3,'last member page remains reachable');
select is((public.organization_members_page('00000000-0000-4000-8000-0000000000a0',1,'large1001')->>'total')::integer,1,'server search reaches later member');
select is((public.organization_invitations_page('00000000-0000-4000-8000-0000000000a0',1,'pending1001')->>'total')::integer,1,'server search reaches later invitation');
select throws_ok($$select public.organization_members_page('00000000-0000-4000-8000-0000000000a0',0)$$,'MQ422',null,'invalid page refused');
select throws_ok($$select public.organization_invitations_page('00000000-0000-4000-8000-0000000000b0')$$,'MQ403',null,'other tenant invitations hidden');
select lives_ok($$select count(*) from generate_series(1,1001) n cross join lateral
  public.invite_member('00000000-0000-4000-8000-0000000000a0','enterprise'||n||'@test.local','viewer')$$,
  'approved inviter can prepare 1001 invitations without the former 50/100 caps');
reset role;
update onboarding.policies set valid_until=now()-interval '1 second' where organization_id='00000000-0000-4000-8000-0000000000a0';
set local role authenticated;
select throws_ok($$select * from public.invite_member('00000000-0000-4000-8000-0000000000a0','after-expiry@test.local','viewer')$$,'MQ429',null,'expired policy restores normal daily protections');
reset role;
update onboarding.policies set valid_until=now()+interval '90 days' where organization_id='00000000-0000-4000-8000-0000000000a0';
-- A cancelled in-flight job cannot be acknowledged, and its unsent invitation is revoked.
insert into onboarding.batches(id,organization_id,created_by,role,fingerprint) values
 ('00000000-0000-4000-8000-0000000000f2','00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-000000000001','viewer','synthetic');
insert into onboarding.jobs(batch_id,email,state,lease,lease_until,invitation_id)
select '00000000-0000-4000-8000-0000000000f2'::uuid,'cancel@test.local','sending',
 '00000000-0000-4000-8000-0000000000f3'::uuid,now()+interval '5 minutes',id
 from public.organization_invitations where email='enterprise1@test.local';
select set_config('test.cancel_job',(select id::text from onboarding.jobs where batch_id='00000000-0000-4000-8000-0000000000f2'),true);
set local role authenticated;
select lives_ok($$select public.onboarding_cancel('00000000-0000-4000-8000-0000000000a0','00000000-0000-4000-8000-0000000000f2')$$,'cancel handles an in-flight lease');
reset role;
select ok((select revoked_at is not null from public.organization_invitations where email='enterprise1@test.local'),'cancelled in-flight invitation cannot grant access');
set local role service_role;
select throws_ok($$select public.onboarding_finish(current_setting('test.cancel_job')::uuid,'00000000-0000-4000-8000-0000000000f3','sent')$$,'MQ409',null,'cancelled work cannot be marked sent');

select * from finish();
rollback;
