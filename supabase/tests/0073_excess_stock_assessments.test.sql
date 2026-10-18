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
create function pg_temp.preview(ns integer[] default array[1,2,3,4]) returns jsonb language sql as $$select public.excess_stock_preview(pg_temp.id(1),pg_temp.choices(ns))$$;
create temporary table fixture(report jsonb,id uuid);
grant all on fixture to authenticated;
select pg_temp.login(10);
set local role authenticated;
insert into fixture(report) select pg_temp.preview();
select is((select report->>'status' from fixture),'available','all comparable lines ready');
select is((select report#>>'{lines,0,comparison,quantity_above}' from fixture),'18.000','exact stock less allocations less selected maximum');
select is((select report#>>'{lines,0,comparison,value_above}' from fixture),'20.250000','snapshot cost, not catalog cost');
select is((select report#>>'{lines,0,comparison,snapshot,date}' from fixture),'2026-10-10','future snapshot excluded before unit validation');
select is((select report#>>'{lines,2,comparison,snapshot,age}' from fixture),'7','seven-day boundary accepted');
select is((select report#>>'{lines,3,comparison,quantity_above}' from fixture),'0','negative available stock clamps comparison to zero');
select is((select report->'totals' from fixture),'[{"currency":"KWD","value":"26.244000"},{"currency":"SAR","value":"20.250000"}]'::jsonb,'exact products summed separately by currency, no cross-item quantity sum');
select is(pg_temp.preview(array[4,3,2,1]),(select report from fixture),'selection order does not change fingerprint');
select is(public.excess_stock_preview(pg_temp.id(1),jsonb_build_array(jsonb_build_object('policy_id',pg_temp.id(1001),'maximum',pg_temp.id(61))))#>>'{lines,0,comparison,quantity_above}','16.000','explicit older approval, not latest approval');
select is(public.excess_stock_preview(pg_temp.id(1),jsonb_build_array(jsonb_build_object('policy_id',pg_temp.id(1001),'maximum',pg_temp.id(61))))#>>'{lines,0,override,decision_reason}','Approved independently','override evidence retained');
select is((select count(*)::int from public.excess_stock_candidates where organization_id=pg_temp.id(1) and policy_id=pg_temp.id(1001)),3,'calculated and every approved revision remain selectable');
select is((select count(*)::int from public.excess_stock_candidates where policy_id=pg_temp.id(1055)),0,'prepared groups excluded from candidates');
select is(jsonb_array_length(pg_temp.preview(array(select generate_series(1,50)))->'lines'),50,'50 distinct items supported');
select throws_ok($$select pg_temp.preview(array(select generate_series(1,51)))$$,'MQ422','choose 1 to 50 policies','51 rejected');
select throws_ok($$select public.excess_stock_preview(pg_temp.id(1),'[]')$$,'MQ422','choose 1 to 50 policies','empty rejected');
select throws_ok($$select public.excess_stock_preview(pg_temp.id(1),'{}')$$,'MQ422','choose 1 to 50 policies','wrong container rejected');
select throws_ok($$select public.excess_stock_preview(pg_temp.id(1),'[null]')$$,'MQ422','invalid policy selection','null entry rejected');
select throws_ok($$select public.excess_stock_preview(pg_temp.id(1),'[{"policy_id":"invalid","maximum":"latest"}]')$$,'MQ422','invalid policy selection','invalid IDs and implicit maximum rejected');
select throws_ok($$select public.excess_stock_preview(pg_temp.id(1),pg_temp.choices(array[1])||'[{}]')$$,'MQ422','invalid policy selection','missing keys rejected');
select throws_ok($$select pg_temp.preview(array[1,1])$$,'MQ422','choose one maximum per policy','duplicate policy rejected');
select throws_ok($$select pg_temp.preview(array[1,52])$$,'MQ422','choose distinct items','different policies for same item rejected');
select throws_ok($$select pg_temp.preview(array[1,53])$$,'MQ422','choose one location and cutoff','mixed locations rejected');
select throws_ok($$select pg_temp.preview(array[1,54])$$,'MQ422','choose one location and cutoff','mixed cutoffs rejected');
select throws_ok($$select pg_temp.preview(array[55])$$,'MQ422','individual policies required','prepared policy rejected');
select throws_ok($$select pg_temp.preview(array[56])$$,'MQ404','assessment source unavailable','foreign tenant source hidden');
select throws_ok($$select public.excess_stock_save(pg_temp.id(1),pg_temp.choices(),' ',true,pg_temp.id(900),(select report->>'fingerprint' from fixture))$$,'MQ422','assessment reason and confirmation required','reason required');
select throws_ok($$select public.excess_stock_save(pg_temp.id(1),pg_temp.choices(),'Review',false,pg_temp.id(900),(select report->>'fingerprint' from fixture))$$,'MQ422','assessment reason and confirmation required','confirmation required');
reset role;
update public.stock_snapshots set snapshot_date='2026-10-02' where organization_id=pg_temp.id(1) and item_id=pg_temp.id(103);
set local role authenticated;
select is(pg_temp.preview()#>>'{lines,2,comparison,status}','stock_stale','eight-day boundary unavailable');
select is(pg_temp.preview()->'totals','null'::jsonb,'one unavailable line blocks complete totals');
select throws_ok($$select public.excess_stock_save(pg_temp.id(1),pg_temp.choices(),'Review',true,pg_temp.id(900),pg_temp.preview()->>'fingerprint')$$,'MQ422','every assessment line must be comparable','unavailable line blocks entire save');
select is((select count(*)::int from public.excess_stock_assessments),0,'no partial save');
reset role;
update public.stock_snapshots set snapshot_date='2026-10-03',unit_of_measure=null where organization_id=pg_temp.id(1) and item_id=pg_temp.id(103);
set local role authenticated;
select is(pg_temp.preview()#>>'{lines,2,comparison,status}','stock_unit_unknown','missing supplied unit is not inferred');
reset role;
update public.stock_snapshots set unit_of_measure='KG' where organization_id=pg_temp.id(1) and item_id=pg_temp.id(103);
set local role authenticated;
select is(pg_temp.preview()#>>'{lines,2,comparison,status}','unit_mismatch','incompatible supplied units unavailable');
reset role;
update public.stock_snapshots set unit_of_measure='EA',quantity=30.002 where organization_id=pg_temp.id(1) and item_id=pg_temp.id(103);
set local role authenticated;
-- A corrected source quantity must invalidate the earlier preview.
select throws_ok($$select public.excess_stock_save(pg_temp.id(1),pg_temp.choices(),'Review',true,pg_temp.id(900),(select report->>'fingerprint' from fixture))$$,'MQ409','assessment evidence changed; refresh preview','stale snapshot version rejected');
update fixture set report=pg_temp.preview();
update fixture set id=public.excess_stock_save(pg_temp.id(1),pg_temp.choices(),'  Review  ',true,pg_temp.id(900),report->>'fingerprint');
select is((select reason from public.excess_stock_assessments),'Review','reason normalized');
select is((select report from public.excess_stock_assessments),(select report from fixture),'complete immutable evidence copied');
select is(public.excess_stock_save(pg_temp.id(1),pg_temp.choices(array[4,3,2,1]),'Review',true,pg_temp.id(900),(select report->>'fingerprint' from fixture)),(select id from fixture),'identical reordered retry returns original');
select throws_ok($$select public.excess_stock_save(pg_temp.id(1),pg_temp.choices(),'Changed reason',true,pg_temp.id(900),(select report->>'fingerprint' from fixture))$$,'MQ409','assessment request conflicts','conflicting request rejected');
select throws_ok($$update public.excess_stock_assessments set reason='Changed'$$,'42501',null,'direct edits denied');
select throws_ok($$delete from public.excess_stock_assessments$$,'42501',null,'direct deletion denied');
select is((select line_count from public.excess_stock_assessment_list),4,'history line count');
select ok((select search_text like '%'||app.normalize_search('ITEM-3')||'%' from public.excess_stock_assessment_list),'history searchable by saved items');
select pg_temp.login(11);
select is((select count(*)::int from public.excess_stock_assessments),1,'viewer sees accessible history');
select throws_ok($$select public.excess_stock_save(pg_temp.id(1),pg_temp.choices(),'Review',true,pg_temp.id(901),pg_temp.preview()->>'fingerprint')$$,'MQ403','assessment saving requires an editor','viewer cannot save');
select pg_temp.login(12);
select is((select count(*)::int from public.excess_stock_assessments),0,'branch without location sees no saved evidence');
select is((select count(*)::int from public.excess_stock_candidates),0,'branch without location sees no candidates');
select throws_ok($$select pg_temp.preview()$$,'MQ404','assessment source unavailable','branch preview blocked');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*)::int from public.excess_stock_assessment_list),1,'branch grant reveals its location history');
select lives_ok($$select pg_temp.preview()$$,'branch member can inspect preview');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12);
set local role authenticated;
select is((select count(*)::int from public.excess_stock_assessment_list),0,'removed location immediately hides history');
select pg_temp.login(13,2);
select is((select count(*)::int from public.excess_stock_assessments),0,'foreign organization sees no assessments');
select throws_ok($$select pg_temp.preview()$$,'MQ404','assessment source unavailable','foreign preview blocked');
select pg_temp.login(10,2);
select is((select count(*)::int from public.excess_stock_assessments),0,'active organization claim narrows membership');
select pg_temp.login(10);
reset role;
update public.stock_snapshots set quantity=500 where organization_id=pg_temp.id(1) and item_id=pg_temp.id(101);
set local role authenticated;
select is(public.excess_stock_save(pg_temp.id(1),pg_temp.choices(),'Review',true,pg_temp.id(900),(select report->>'fingerprint' from fixture)),(select id from fixture),'retry survives source corrections');
select is((select report from public.excess_stock_assessments),(select report from fixture),'history survives source corrections');
select throws_ok($$select public.excess_stock_save(pg_temp.id(1),pg_temp.choices(),'Review',true,pg_temp.id(901),(select report->>'fingerprint' from fixture))$$,'MQ409','assessment evidence changed; refresh preview','new save must refresh');
reset role;
select is((select count(*)::int from public.audit_log where organization_id=pg_temp.id(1) and table_name='excess_stock_assessments'),1,'one insert audit for retries');
delete from public.planning_runs where id=pg_temp.id(201);
set local role authenticated;
select is((select report from public.excess_stock_assessments),(select report from fixture),'copied policy and override evidence survives source deletion');
select is(public.excess_stock_save(pg_temp.id(1),pg_temp.choices(),'Review',true,pg_temp.id(900),(select report->>'fingerprint' from fixture)),(select id from fixture),'original retry survives source deletion with live authority');
reset role;
set local role anon;
select throws_ok($$select public.excess_stock_preview(pg_temp.id(1),pg_temp.choices())$$,'42501',null,'anonymous preview denied');
reset role;
select * from finish();
rollback;
