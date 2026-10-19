begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'excess-'||n||'@test.local' from generate_series(10,14) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'excess-a','Excess A'),(pg_temp.id(2),'excess-b','Excess B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner'),(pg_temp.id(1),pg_temp.id(14),'planner');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=2 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,2) n;
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 select pg_temp.id(100+n),pg_temp.id(1),'ITEM-'||n,'Item','Test','SET',999,'SAR' from generate_series(1,55) n;
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(200+n),pg_temp.id(case when n=56 then 2 else 1 end),pg_temp.id(case when n=56 then 22 when n=53 then 21 else 20 end),pg_temp.id(300+n),
 '2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}' from generate_series(1,56) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(1000+n),pg_temp.id(case when n=56 then 2 else 1 end),pg_temp.id(200+n),pg_temp.id(case when n=56 then 22 when n=53 then 21 else 20 end),pg_temp.id(400+n),
 pg_temp.id(case when n=52 then 101 else 100+n end),'ITEM-'||n,case when n=2 then 'KG' else 'EA' end,'available',
 '{"protection":{"target":"10.001"}}',
 jsonb_build_object('options',jsonb_build_object('lead_time',3,'review_interval',4),'forecast',jsonb_build_object('to_date',case when n=54 then '2026-10-09' else '2026-10-10' end,
 'method',case when n=55 then 'regional-v1' else 'baseline-v1' end,'source',jsonb_build_object('unit_provenance',
 jsonb_build_object('method','source-units-v1','status','consistent','unit',case when n=2 then 'KG' else 'EA' end,'rows',1,'unknown_rows',0,'units',jsonb_build_array(case when n=2 then 'KG' else 'EA' end)))))
 from generate_series(1,56) n;
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
 select pg_temp.id(1),pg_temp.id(100+n),pg_temp.id(20),case when n=3 then date '2026-10-03' else date '2026-10-10' end,
 case when n=4 then 1 else 30.001 end,2,case when n=3 then 0.333 else 1.125 end,case when n=2 then 'SAR' else 'KWD' end,case when n=2 then 'KG' else 'EA' end
 from generate_series(1,51) n;
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
 values(pg_temp.id(1),pg_temp.id(101),pg_temp.id(20),'2026-10-11',999,0,999,'SAR','KG');
insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id)
 select pg_temp.id(60+n),pg_temp.id(1),pg_temp.id(1001),pg_temp.id(20),n,pg_temp.id(70+n),pg_temp.id(14),1,10.001+2*n,'Explicit maximum',
 'approved',pg_temp.id(10),now(),'Approved independently',pg_temp.id(80+n) from generate_series(1,2) n;
create function pg_temp.choices(ns integer[] default array[1,2,3,4]) returns jsonb language sql as $$select jsonb_agg(jsonb_build_object('policy_id',pg_temp.id(1000+n),'maximum','calculated')) from unnest(ns) n$$;

update public.stock_snapshots set quantity=30.001,currency='KWD' where snapshot_date<='2026-10-10';
create temporary table fixture(n integer,assessment uuid,proposal uuid,handoff uuid);
create temporary table batches(ids uuid[],id uuid,payload jsonb);
grant all on fixture,batches to authenticated;
create function pg_temp.ids(ns integer[] default array[1,2]) returns uuid[] language sql as $$select array_agg(handoff order by n) from fixture where n=any(ns)$$;
create function pg_temp.preview(ns integer[] default array[1,2]) returns jsonb language sql as $$select public.excess_disposition_handoff_batch_preview(pg_temp.id(1),pg_temp.ids(ns))$$;
create function pg_temp.batch(ns integer[] default array[1,2]) returns uuid language sql as $$select public.excess_disposition_handoff_batch_create(pg_temp.id(1),pg_temp.ids(ns))$$;
select pg_temp.login(14);
set local role authenticated;
do $$declare a uuid; p uuid; h uuid; n integer; choices jsonb;
begin
 for n in 1..51 loop
  choices:=pg_temp.choices(array[n]);
  a:=public.excess_stock_save(pg_temp.id(1),choices,'Batch source',true,gen_random_uuid(),public.excess_stock_preview(pg_temp.id(1),choices)->>'fingerprint');
  p:=public.excess_disposition_submit(pg_temp.id(1),a,pg_temp.id(100+n),'scrap','3.333',gen_random_uuid(),'Batch disposition');
  perform pg_temp.login(10);
  perform public.excess_disposition_decide(pg_temp.id(1),p,gen_random_uuid(),'approved','Independent review');
  perform pg_temp.login(14);
  h:=public.excess_disposition_handoff_create(pg_temp.id(1),p);
  insert into fixture values(n,a,p,h);
 end loop;
end; $$;
select is(pg_temp.preview()#>>'{summary,reference_value}','7.499250','sum exact products without currency rounding');
select is(pg_temp.preview()#>>'{summary,line_count}','2','line count retained');
select is(pg_temp.preview()#>>'{summary,kind}','scrap','common disposition kind');
select ok(not(pg_temp.preview()->'summary' ? 'quantity'),'no pooled quantity');
select is((select count(distinct value#>>'{disposition,unit}')::int from jsonb_array_elements(pg_temp.preview()->'lines')),2,'different known line units stay separate');
select throws_ok($$select public.excess_disposition_handoff_batch_create(pg_temp.id(1),null)$$,'MQ422',null,'null set rejected');
select throws_ok($$select public.excess_disposition_handoff_batch_create(pg_temp.id(1),'{}')$$,'MQ422',null,'empty set rejected');
select throws_ok($$select public.excess_disposition_handoff_batch_create(pg_temp.id(1),array[null::uuid])$$,'MQ422',null,'null member rejected');
select throws_ok($$select public.excess_disposition_handoff_batch_create(pg_temp.id(1),pg_temp.ids()||pg_temp.ids())$$,'MQ422',null,'duplicate handoff rejected');
select throws_ok($$select public.excess_disposition_handoff_batch_create(pg_temp.id(1),array[pg_temp.id(9999)])$$,'MQ404',null,'missing handoff rejected');
select throws_ok($$select pg_temp.batch(array(select generate_series(1,51)))$$,'MQ422',null,'51 lines rejected');
select throws_ok($$select public.excess_disposition_handoff_batch_create(pg_temp.id(1),array[pg_temp.ids(),pg_temp.ids()])$$,'MQ422',null,'multidimensional input rejected');
reset role;
update public.excess_disposition_handoffs set payload=jsonb_set(payload,'{disposition,location_id}',to_jsonb('a2000000-0000-4000-8000-000000000021'::text)) where id=(select handoff from fixture where n=2);
set local role authenticated;
select throws_ok($$select pg_temp.batch()$$,'MQ422','incompatible batch headers','incompatible location_id rejects the entire set');
reset role;
update public.excess_disposition_handoffs set payload=jsonb_set(payload,'{disposition,location_id}',(select payload#>'{disposition,location_id}' from public.excess_disposition_handoffs where id=(select handoff from fixture where n=1))) where id=(select handoff from fixture where n=2);
set local role authenticated;
reset role;
update public.excess_disposition_handoffs set payload=jsonb_set(payload,'{disposition,kind}',to_jsonb('supplier_return'::text)) where id=(select handoff from fixture where n=2);
set local role authenticated;
select throws_ok($$select pg_temp.batch()$$,'MQ422','incompatible batch headers','incompatible kind rejects the entire set');
reset role;
update public.excess_disposition_handoffs set payload=jsonb_set(payload,'{disposition,kind}',(select payload#>'{disposition,kind}' from public.excess_disposition_handoffs where id=(select handoff from fixture where n=1))) where id=(select handoff from fixture where n=2);
set local role authenticated;
reset role;
update public.excess_disposition_handoffs set payload=jsonb_set(payload,'{disposition,currency}',to_jsonb('SAR'::text)) where id=(select handoff from fixture where n=2);
set local role authenticated;
select throws_ok($$select pg_temp.batch()$$,'MQ422','incompatible batch headers','incompatible currency rejects the entire set');
reset role;
update public.excess_disposition_handoffs set payload=jsonb_set(payload,'{disposition,currency}',(select payload#>'{disposition,currency}' from public.excess_disposition_handoffs where id=(select handoff from fixture where n=1))) where id=(select handoff from fixture where n=2);
set local role authenticated;
reset role;
update public.excess_disposition_handoffs set payload=jsonb_set(payload,'{disposition,cutoff}',to_jsonb('2026-10-09'::text)) where id=(select handoff from fixture where n=2);
set local role authenticated;
select throws_ok($$select pg_temp.batch()$$,'MQ422','incompatible batch headers','incompatible cutoff rejects the entire set');
reset role;
update public.excess_disposition_handoffs set payload=jsonb_set(payload,'{disposition,cutoff}',(select payload#>'{disposition,cutoff}' from public.excess_disposition_handoffs where id=(select handoff from fixture where n=1))) where id=(select handoff from fixture where n=2);
set local role authenticated;

reset role;
update public.excess_disposition_handoffs set payload=jsonb_set(payload,'{disposition,item_code}','"ITEM-1"') where id=(select handoff from fixture where n=2);
set local role authenticated;
select throws_ok($$select pg_temp.batch()$$,'MQ422','repeated item in batch','reused saved code rejected');
reset role;
update public.excess_disposition_handoffs set payload=jsonb_set(payload,'{disposition,item_code}','"ITEM-2"') where id=(select handoff from fixture where n=2);
set local role authenticated;
-- A different assessment for the same item remains selected independently, but cannot be pooled.
do $$declare a uuid; p uuid; h uuid; choices jsonb:=pg_temp.choices(array[1]); begin
 a:=public.excess_stock_save(pg_temp.id(1),choices,'Other assessment',true,gen_random_uuid(),public.excess_stock_preview(pg_temp.id(1),choices)->>'fingerprint');
 p:=public.excess_disposition_submit(pg_temp.id(1),a,pg_temp.id(101),'scrap','4',gen_random_uuid(),'Other choice');
 perform pg_temp.login(10); perform public.excess_disposition_decide(pg_temp.id(1),p,gen_random_uuid(),'approved','Reviewed'); perform pg_temp.login(14);
 h:=public.excess_disposition_handoff_create(pg_temp.id(1),p); insert into fixture values(52,a,p,h);
end; $$;
select throws_ok($$select pg_temp.batch(array[1,52])$$,'MQ422','repeated item in batch','same item from independent assessment rejected');
select is((select count(*)::int from public.excess_disposition_handoff_batches),0,'failed sets save nothing');
insert into batches(ids,id) values(pg_temp.ids(),pg_temp.batch());
update batches set payload=(select payload from public.excess_disposition_handoff_batches where id=batches.id);
select is((select payload->>'schema_version' from batches),'excess-disposition-handoff-batch-v1','versioned package');
select is((select payload->'lines' from batches),(select jsonb_agg(payload order by id) from public.excess_disposition_handoffs where id=any(pg_temp.ids())),'complete originals copied in canonical order');
select is(public.excess_disposition_handoff_batch_create(pg_temp.id(1),array[(pg_temp.ids())[2],(pg_temp.ids())[1]]),(select id from batches),'reversed order replays original');
select is(pg_temp.preview()->>'existing_batch_id',(select id::text from batches),'preview identifies existing set');
select lives_ok($$select pg_temp.batch(array[1])$$,'overlap allowed');
select lives_ok($$select pg_temp.batch(array(select generate_series(1,50)))$$,'50-line boundary accepted');
select is((select overlap_count::int from public.excess_disposition_handoff_batch_list where id=(select id from batches)),2,'other packages sharing members are counted');
select is((select batch_count::int from public.excess_disposition_handoff_batch_candidates where id=(select handoff from fixture where n=1)),3,'picker exposes reuse');
select is((select selection from public.excess_disposition_handoff_batch_list where id=(select id from batches)),'current','selection is live context');
select ok(not(select payload ? 'selection' from batches),'live context absent from saved package');
select throws_ok($$insert into public.excess_disposition_handoff_batches select * from public.excess_disposition_handoff_batches$$,'42501',null,'direct insert denied');
select throws_ok($$update public.excess_disposition_handoff_batches set payload='{}'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.excess_disposition_handoff_batches$$,'42501',null,'direct delete denied');
select pg_temp.login(11);
select is((select count(*)::int from public.excess_disposition_handoff_batch_list),3,'viewer reads history');
select throws_ok($$select pg_temp.batch()$$,'MQ403',null,'viewer cannot create or replay');
select pg_temp.login(12);
select is((select count(*)::int from public.excess_disposition_handoff_batches),0,'unassigned branch cannot read package');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*)::int from public.excess_disposition_handoff_batch_list),3,'assigned branch reads history');
select throws_ok($$select pg_temp.preview()$$,'MQ403',null,'assigned branch cannot create preview');
select pg_temp.login(13,2);
select is((select count(*)::int from public.excess_disposition_handoff_batch_list),0,'other tenant cannot read history');
select throws_ok($$select pg_temp.batch()$$,'MQ403',null,'other tenant cannot create or replay');
select throws_ok($$select public.excess_disposition_handoff_batch_create(pg_temp.id(2),pg_temp.ids())$$,'MQ404',null,'foreign IDs cannot enter caller tenant');
select pg_temp.login(14,2);
select is((select count(*)::int from public.excess_disposition_handoff_batches),0,'active claim narrows reads');
select pg_temp.login(14);
reset role;
update public.stock_snapshots set unit_cost=2 where item_id=pg_temp.id(101) and snapshot_date='2026-10-10';
set local role authenticated;
select throws_ok($$select pg_temp.batch(array[1,3])$$,'MQ409','assessment evidence changed','one changed line blocks entire new set');
select is(pg_temp.batch(),(select id from batches),'existing set survives evidence correction');
select is((select payload from public.excess_disposition_handoff_batches where id=(select id from batches)),(select payload from batches),'original exact copy retained');
reset role;
update public.stock_snapshots set unit_cost=1.125 where item_id=pg_temp.id(101) and snapshot_date='2026-10-10';
set local role authenticated;
do $$declare p uuid; begin
 p:=public.excess_disposition_submit(pg_temp.id(1),(select assessment from fixture where n=1),pg_temp.id(101),'scrap','4',gen_random_uuid(),'Replacement');
 perform pg_temp.login(10); perform public.excess_disposition_decide(pg_temp.id(1),p,gen_random_uuid(),'approved','Reviewed'); perform pg_temp.login(14);
end; $$;
select is((select selection from public.excess_disposition_handoff_batch_list where id=(select id from batches)),'historical','replacement approval marks batch historical');
select throws_ok($$select pg_temp.batch(array[1,3])$$,'MQ409','selected approval required','historical line blocks new set');
select is(pg_temp.batch(),(select id from batches),'historical set retains retry identity');
reset role;
select is((select count(*)::int from public.audit_log where table_name='excess_disposition_handoff_batches' and organization_id=pg_temp.id(1)),3,'exactly one audit per saved set');
select is((select quantity from public.stock_snapshots where item_id=pg_temp.id(101) and snapshot_date='2026-10-10'),30.001::numeric,'no stock movement');
delete from public.excess_stock_assessments where id=(select assessment from fixture where n=1);
set local role authenticated;
select is((select selection from public.excess_disposition_handoff_batch_list where id=(select id from batches)),'unavailable','deleted source is unavailable context');
select is((select payload from public.excess_disposition_handoff_batches where id=(select id from batches)),(select payload from batches),'copied package survives source cascade');
select throws_ok($$select pg_temp.batch()$$,'MQ404',null,'retry still requires source visibility');
reset role;
set local role anon;
select throws_ok($$select * from public.excess_disposition_handoff_batches$$,'42501',null,'anonymous reads denied');
select throws_ok($$select pg_temp.batch()$$,'42501',null,'anonymous writes denied');
reset role;
set local role service_role;
select throws_ok($$select * from public.excess_disposition_handoff_batches$$,'42501',null,'no integration read permission');
select throws_ok($$select pg_temp.batch()$$,'42501',null,'no integration write permission');
reset role;
delete from public.stock_snapshots where location_id=pg_temp.id(20);
delete from public.planning_runs where location_id=pg_temp.id(20);
delete from public.locations where id=pg_temp.id(20);
select is((select count(*)::int from public.excess_disposition_handoff_batches where organization_id=pg_temp.id(1)),0,'location deletion cascades copied packages');
select * from finish();
rollback;
