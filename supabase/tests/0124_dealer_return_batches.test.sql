begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('cd270000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(1))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'returns-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'returns-a','Returns A'),(pg_temp.id(2),'returns-b','Returns B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),(pg_temp.id(1),pg_temp.id(12),'branch_user'),
 (pg_temp.id(2),pg_temp.id(13),'owner'),(pg_temp.id(1),pg_temp.id(14),'planner'),(pg_temp.id(1),pg_temp.id(15),'approver'),(pg_temp.id(1),pg_temp.id(16),'admin');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values
 (pg_temp.id(101),pg_temp.id(1),'B','Branch','branch','SA','Asia/Riyadh'),
 (pg_temp.id(102),pg_temp.id(1),'H','Hub','hub','SA','Asia/Riyadh'),
 (pg_temp.id(103),pg_temp.id(1),'C','Central','central','SA','Asia/Riyadh'),
 (pg_temp.id(104),pg_temp.id(2),'OTHER','Other','branch','SA','Asia/Riyadh');
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(30),pg_temp.id(1),'P1','Part','Test','EA',1,'SAR');
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(101));
create temporary table fixture(input jsonb,saved uuid,report jsonb);
insert into fixture(input) values('{"item_code":"P1","source_code":"B","location_code":"H","quantity":"2.125","unit":"EA","requested_date":"2026-10-24","condition":"unknown","reason":"Declared excess","sale_reference":"INV-4","confirmed":true}');
grant all on fixture to authenticated;
create function pg_temp.save(n integer default 50,overrides jsonb default '{}') returns uuid language sql as $$select public.dealer_return_save(pg_temp.id(1),input||overrides,pg_temp.id(n)) from fixture$$;
create function pg_temp.review(n integer default 50,d text default 'approved',r text default 'Eligibility checked',c boolean default true) returns uuid language sql as $$
 select public.dealer_return_review(pg_temp.id(1),(select id from public.dealer_return_requests where request_id=pg_temp.id(n)),d,r,c)$$;
alter table fixture add column handoff uuid,add column payload jsonb;
create function pg_temp.export(n integer default 50) returns uuid language sql as $$
 select public.dealer_return_handoff_create(pg_temp.id(1),(select id from public.dealer_return_requests where request_id=pg_temp.id(n)))$$;

insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(31),pg_temp.id(1),'P2','Second part','Test','EA',1,'SAR');
alter table fixture add column batch uuid,add column handoff2 uuid,add column copied jsonb;
select pg_temp.login(10); set local role authenticated;
update fixture set saved=pg_temp.save();
select pg_temp.save(51,'{"item_code":"P2","quantity":"0.001","condition":"damaged"}');
select pg_temp.login(15);
select pg_temp.review(50); select pg_temp.review(51);
select pg_temp.login(10);
update fixture set handoff=pg_temp.export(50),handoff2=pg_temp.export(51);
update fixture set batch=public.dealer_return_batch_create(pg_temp.id(1),array[handoff,handoff2]);
update fixture set copied=(select payload from public.dealer_return_batches where id=batch);
select is(public.dealer_return_batch_create(pg_temp.id(1),array[handoff2,handoff]),batch,'reversed set is the same batch') from fixture;
select is((select count(*)::int from public.dealer_return_batches),1,'one batch');
select is((select payload from public.dealer_return_batches),(select copied from fixture),'copied original files');
select is((select line_count from public.dealer_return_batch_list),2,'line count excludes pooling');
select ok((select sources_available from public.dealer_return_batch_list),'original sources visible');
select is((select count(*)::int from public.dealer_return_batch_candidates where batch_count=1),2,'candidate reuse counts');
select public.dealer_return_batch_create(pg_temp.id(1),array[handoff]) from fixture;
select is((select overlap_count::int from public.dealer_return_batch_list where id=(select batch from fixture)),1,'overlap is explicit');
select throws_ok($$insert into public.dealer_return_batches select * from public.dealer_return_batches$$,'42501',null,'raw inserts denied');
select throws_ok($$update public.dealer_return_batches set payload='{}'$$,'42501',null,'raw updates denied');
select throws_ok($$delete from public.dealer_return_batches$$,'42501',null,'raw deletes denied');
select pg_temp.login(11);
select is((select count(*)::int from public.dealer_return_batches),2,'viewer reads copied files');
select throws_ok($$select public.dealer_return_batch_create(pg_temp.id(1),array[handoff,handoff2]) from fixture$$,'MQ403',null,'viewer cannot retry creation');
select throws_ok($$select public.dealer_return_batch_preview(pg_temp.id(1),array[handoff,handoff2]) from fixture$$,'MQ403',null,'viewer cannot preview creation');
select pg_temp.login(12);
select is((select count(*)::int from public.dealer_return_batches),0,'source-only member cannot inspect batches');
select is((select count(*)::int from public.dealer_return_batch_list),0,'source-only list and count hidden');
select is((select count(*)::int from public.dealer_return_batch_candidates),0,'source-only candidates hidden');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(102));
set local role authenticated;
select is((select count(*)::int from public.dealer_return_batch_list),2,'both endpoints allow list');
select is((select overlap_count::int from public.dealer_return_batch_list where id=(select batch from fixture)),1,'overlap visible only with scope');
reset role;
delete from public.membership_locations where location_id=pg_temp.id(101);
set local role authenticated;
select is((select count(*)::int from public.dealer_return_batches),0,'receiver-only member cannot inspect');
select pg_temp.login(13);
select is((select count(*)::int from public.dealer_return_batches),0,'foreign tenant cannot inspect batches');
select is((select count(*)::int from public.dealer_return_batch_list),0,'foreign tenant counts hidden');
select is((select count(*)::int from public.dealer_return_batch_candidates),0,'foreign tenant candidates hidden');
select throws_ok($$select public.dealer_return_batch_create(pg_temp.id(1),array[handoff,handoff2]) from fixture$$,'MQ403',null,'foreign editor cannot create in organization');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(13),'role','authenticated','org_id',pg_temp.id(2))::text,true);
select throws_ok($$select public.dealer_return_batch_create(pg_temp.id(2),array[handoff,handoff2]) from fixture$$,'MQ404',null,'foreign sources cannot be copied into own organization');
select pg_temp.login(10);
reset role;
delete from public.items where organization_id=pg_temp.id(1);
delete from auth.users where id=pg_temp.id(15);
set local role authenticated;
select is(public.dealer_return_batch_create(pg_temp.id(1),array[handoff,handoff2]),batch,'catalog and reviewer deletion do not rewrite retries') from fixture;
select is((select payload from public.dealer_return_batches where id=(select batch from fixture)),(select copied from fixture),'copied author and catalog evidence retained');
reset role;
delete from public.dealer_return_requests where organization_id=pg_temp.id(1);
set local role authenticated;
select is((select count(*)::int from public.dealer_return_handoffs),0,'actual handoffs cascade with source requests');
select is((select count(*)::int from public.dealer_return_batch_list),2,'copied batches survive source deletion');
select ok(not (select sources_available from public.dealer_return_batch_list where id=(select batch from fixture)),'unavailable source context is separate');
select is((select payload from public.dealer_return_batches where id=(select batch from fixture)),(select copied from fixture),'copied files byte content remains unchanged');
select throws_ok($$select public.dealer_return_batch_create(pg_temp.id(1),array[handoff,handoff2]) from fixture$$,'MQ404',null,'retry requires original sources');
reset role;
select is((select count(*)::int from public.audit_log where organization_id=pg_temp.id(1) and table_name='dealer_return_batches' and operation='INSERT'),2,'one insert audit per set');
select is((select count(*)::int from public.stock_snapshots where organization_id=pg_temp.id(1)),0,'no stock effects');
select is((select count(*)::int from public.open_orders where organization_id=pg_temp.id(1)),0,'no inbound effects');
delete from public.locations where id=pg_temp.id(102);
select is((select count(*)::int from public.dealer_return_batches),0,'actual receiving endpoint cascades copied batches');
select is((select count(*)::int from public.audit_log where organization_id=pg_temp.id(1) and table_name='dealer_return_batches' and operation='DELETE'),2,'cascade audited');
select * from finish(); rollback;
