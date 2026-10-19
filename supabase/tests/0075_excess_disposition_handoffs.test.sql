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
create temporary table fixture(assessment uuid,proposal uuid,later uuid);
grant all on fixture to authenticated;
create function pg_temp.submit(q text default '3.333',k text default 'supplier_return',req integer default 901,it integer default 101) returns uuid language sql as $$select public.excess_disposition_submit(pg_temp.id(1),(select assessment from fixture),pg_temp.id(it),k,q,pg_temp.id(req),' Planned disposition ')$$;
create function pg_temp.decide(d text default 'approved',req integer default 951) returns uuid language sql as $$select public.excess_disposition_decide(pg_temp.id(1),(select proposal from fixture),pg_temp.id(req),d,'Reviewed')$$;
create function pg_temp.evidence() returns jsonb language sql as $$select public.excess_disposition_preview(pg_temp.id(1),(select assessment from fixture),pg_temp.id(101))$$;
select pg_temp.login(14);
set local role authenticated;
insert into fixture(assessment) select public.excess_stock_save(pg_temp.id(1),pg_temp.choices(),'Assessment',true,pg_temp.id(900),public.excess_stock_preview(pg_temp.id(1),pg_temp.choices())->>'fingerprint');

reset role;
alter table fixture add column handoff uuid;
create temporary table original(payload jsonb);
grant all on original to authenticated;
create function pg_temp.handoff() returns uuid language sql as $$select public.excess_disposition_handoff_create(pg_temp.id(1),(select proposal from fixture))$$;
set local role authenticated;
update fixture set proposal=pg_temp.submit();
select throws_ok($$select pg_temp.handoff()$$,'MQ409','selected approval required','pending proposal cannot export');
select pg_temp.login(10);
select pg_temp.decide('rejected',948);
select throws_ok($$select pg_temp.handoff()$$,'MQ409','selected approval required','rejected proposal cannot export');
select pg_temp.login(14);
update fixture set proposal=pg_temp.submit('3.333','supplier_return',910);
select pg_temp.decide('withdrawn',949);
select throws_ok($$select pg_temp.handoff()$$,'MQ409','selected approval required','withdrawn proposal cannot export');
update fixture set proposal=pg_temp.submit('3.333','supplier_return',911);
select pg_temp.login(10);
select pg_temp.decide();
select throws_ok($$select public.excess_disposition_handoff_create(pg_temp.id(1),null)$$,'MQ422','proposal required','explicit proposal required');
select pg_temp.login(11);
select throws_ok($$select pg_temp.handoff()$$,'MQ403','handoff requires an editor','viewer cannot create');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.handoff()$$,'MQ403','handoff requires an editor','foreign tenant cannot create');
select pg_temp.login(14);
reset role;
update public.stock_snapshots set quantity=31 where item_id=pg_temp.id(102);
set local role authenticated;
update fixture set handoff=pg_temp.handoff();
insert into original select payload from public.excess_disposition_handoffs;
select is((select count(*)::int from public.excess_disposition_handoffs),1,'unrelated line changes do not block first save');
select is((select payload->>'schema_version' from original),'excess-disposition-handoff-v1','versioned payload');
select is((select payload#>>'{disposition,quantity}' from original),'3.333','exact quantity string');
select is((select payload#>>'{disposition,reference_value}' from original),'3.749625','reference product retained without currency rounding');
select is((select payload#>>'{disposition,kind}' from original),'supplier_return','explicit return intent retained');
select is((select payload->'line' from original),(select line from public.excess_disposition_proposals where id=(select proposal from fixture)),'complete original chosen line copied');
select is((select payload#>>'{assessment,reason}' from original),'Assessment','assessment reason retained');
select is((select payload#>>'{proposal,approval_reason}' from original),'Reviewed','independent approval reason retained');
select is((select selected from public.excess_disposition_handoff_list),true,'live selection separate');
select ok(not (select payload ? 'selected' from original),'live selection absent from payload');
select is(pg_temp.handoff(),(select handoff from fixture),'stable retry');
select throws_ok($$insert into public.excess_disposition_handoffs select * from public.excess_disposition_handoffs$$,'42501',null,'direct inserts denied');
select throws_ok($$update public.excess_disposition_handoffs set payload='{}'$$,'42501',null,'direct edits denied');
select throws_ok($$delete from public.excess_disposition_handoffs$$,'42501',null,'direct deletes denied');
select pg_temp.login(11);
select is((select count(*)::int from public.excess_disposition_handoff_list),1,'viewer reads original handoff');
select pg_temp.login(12);
select is((select count(*)::int from public.excess_disposition_handoffs),0,'unscoped branch hides payload');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*)::int from public.excess_disposition_handoff_list),1,'branch location grant reveals history');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12);
set local role authenticated;
select is((select count(*)::int from public.excess_disposition_handoff_list),0,'removed location grant hides history');
select pg_temp.login(13,2);
select is((select count(*)::int from public.excess_disposition_handoffs),0,'cross-tenant payload hidden');
select pg_temp.login(14,2);
select is((select count(*)::int from public.excess_disposition_handoffs),0,'active claim narrows reads');
select pg_temp.login(14);
update fixture set later=proposal,proposal=pg_temp.submit('4','scrap',902);
select pg_temp.login(10);
select pg_temp.decide('approved',952);
select is((select selected from public.excess_disposition_handoff_list),false,'replacement approval makes old handoff historical');
select pg_temp.login(14);
select is(public.excess_disposition_handoff_create(pg_temp.id(1),(select later from fixture)),(select handoff from fixture),'historical replay returns original');
reset role;
update public.stock_snapshots set unit_cost=1.126 where item_id=pg_temp.id(101) and snapshot_date='2026-10-10';
set local role authenticated;
select throws_ok($$select pg_temp.handoff()$$,'MQ409','assessment evidence changed','changed selected evidence blocks first export');
select is(public.excess_disposition_handoff_create(pg_temp.id(1),(select later from fixture)),(select handoff from fixture),'source correction does not block existing retry');
select is((select payload from public.excess_disposition_handoffs),(select payload from original),'corrections and selection changes preserve original payload');
reset role;
update public.stock_snapshots set unit_cost=1.125 where item_id=pg_temp.id(101) and snapshot_date='2026-10-10';
set local role authenticated;
-- A newer selected proposal leaves the unexported previous approval ineligible.
update fixture set later=proposal,proposal=pg_temp.submit('5','scrap',903);
select pg_temp.login(10);
select pg_temp.decide('approved',953);
select pg_temp.login(14);
select throws_ok($$select public.excess_disposition_handoff_create(pg_temp.id(1),(select later from fixture))$$,'MQ409','selected approval required','historical first export blocked');
reset role;
delete from public.planning_runs where id=pg_temp.id(201);
set local role authenticated;
select throws_ok($$select pg_temp.handoff()$$,'MQ409','assessment evidence changed','missing policy blocks first export');
select is((select payload from public.excess_disposition_handoffs),(select payload from original),'saved files survive source policy deletion');
reset role;
select is((select count(*)::int from public.audit_log where organization_id=pg_temp.id(1) and table_name='excess_disposition_handoffs'),1,'retries add no audit');
select is((select quantity from public.stock_snapshots where item_id=pg_temp.id(101) and snapshot_date='2026-10-10'),30.001::numeric,'handoffs never move stock');
set local role anon;
select throws_ok($$select pg_temp.handoff()$$,'42501',null,'anonymous execution denied');
select throws_ok($$select * from public.excess_disposition_handoffs$$,'42501',null,'anonymous reads denied');
reset role;
set local role service_role;
select throws_ok($$select pg_temp.handoff()$$,'42501',null,'no integration write capability');
select throws_ok($$select * from public.excess_disposition_handoffs$$,'42501',null,'no implicit integration read capability');
reset role;
delete from public.excess_stock_assessments where id=(select assessment from fixture);
select is((select count(*)::int from public.excess_disposition_handoffs where organization_id=pg_temp.id(1)),0,'assessment deletion follows parent cascade');
select * from finish();
rollback;
