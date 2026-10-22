begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('bc251000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'regional-sourcing-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'regional-sourcing-a','Redistribution A'),(pg_temp.id(2),'regional-sourcing-b','Redistribution B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner'),
 (pg_temp.id(1),pg_temp.id(14),'planner'),(pg_temp.id(1),pg_temp.id(15),'admin'),(pg_temp.id(1),pg_temp.id(16),'approver');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=3 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,3) n;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(100),pg_temp.id(1),'ITEM','Item','Test','SET',99,'SAR'),(pg_temp.id(101),pg_temp.id(1),'OTHER','Other','Test','EA',1,'SAR');
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-10',12,2,1,'SAR','EA'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(21),'2026-10-10',35.125,2.250,1,'SAR','EA'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(21),'2026-10-11',999,0,1,'SAR','EA');
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(30+n),pg_temp.id(case when n=3 then 2 else 1 end),pg_temp.id(20+n),pg_temp.id(40+n),
 '2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}' from generate_series(0,3) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(50+n),pg_temp.id(case when n=3 then 2 else 1 end),pg_temp.id(30+n),pg_temp.id(20+n),pg_temp.id(200+n),pg_temp.id(100),'SAVED','EA','available',
 '{"protection":{"target":"20.000"}}',
 '{"options":{"lead_time":3,"review_interval":4},"forecast":{"to_date":"2026-10-10","method":"baseline-v1","source":{"unit_provenance":{"method":"source-units-v1","status":"consistent","unit":"EA","rows":1,"unknown_rows":0,"units":["EA"]}}}}' from generate_series(0,3) n;
insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id)
 select pg_temp.id(60+n),pg_temp.id(1),pg_temp.id(51),pg_temp.id(21),n,pg_temp.id(70+n),pg_temp.id(10),1,20+n,'Scenario',
 'approved',pg_temp.id(11),now(),'Approved scenario',pg_temp.id(80+n) from generate_series(1,2) n;
insert into public.network_links(id,organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis)
 values(pg_temp.id(90),pg_temp.id(1),pg_temp.id(21),pg_temp.id(20),2,4,'none');
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90)
values(pg_temp.id(110),pg_temp.id(1),'SUP','Supplier','SA','SAR',3,3);
insert into public.open_orders(organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,status,unit_of_measure) values
 (pg_temp.id(1),'OVERDUE','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-09',1.250,1,'SAR','open','EA'),
 (pg_temp.id(1),'LATE','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-18',0.750,1,'SAR','open','EA'),
 (pg_temp.id(1),'SOURCE','1',pg_temp.id(100),pg_temp.id(21),pg_temp.id(110),'2026-10-10',999,1,'SAR','open','EA');
create temporary table captured(draft_id uuid,report jsonb,id uuid);
grant all on captured to authenticated;
set local role authenticated;
select pg_temp.login(10);
insert into captured(draft_id) select public.replenishment_save(pg_temp.id(1),pg_temp.id(50),pg_temp.id(300),'calculated',null,'4',true,
  public.replenishment_preview(pg_temp.id(1),pg_temp.id(50),'calculated',null,'4',true)->>'fingerprint');
reset role;

insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
values(pg_temp.id(1),pg_temp.id(100),pg_temp.id(22),'2026-10-10',37,0,1,'SAR','EA');
insert into public.network_links(organization_id,from_location_id,to_location_id,lead_time_days_p50,lead_time_days_p90,freight_basis)
values(pg_temp.id(1),pg_temp.id(22),pg_temp.id(20),2,4,'none');
create temporary table sourcing(input jsonb,report jsonb,id uuid);
grant all on sourcing to authenticated;
select pg_temp.login(10);set local role authenticated;
insert into sourcing(input) select jsonb_build_object(
 'region_id',public.stock_region_save(pg_temp.id(1),'{"name_en":"Sourcing region","location_codes":["L0","L1","L2"],"confirmed":true}',pg_temp.id(500),
 public.stock_region_preview(pg_temp.id(1),'{"name_en":"Sourcing region","location_codes":["L0","L1","L2"],"confirmed":true}')->>'fingerprint'),
 'draft_id',draft_id,'commitments_confirmed',true,'lanes_confirmed',true,
 'sources',jsonb_build_array(jsonb_build_object('location_id',pg_temp.id(22),'policy_id',pg_temp.id(52),'maximum','calculated','backorders','0'),
 jsonb_build_object('location_id',pg_temp.id(21),'policy_id',pg_temp.id(51),'maximum','calculated','backorders','4.125'))) from captured;
create function pg_temp.preview(overrides jsonb default '{}') returns jsonb language sql as $$select public.regional_sourcing_preview(pg_temp.id(1),input||overrides) from sourcing$$;
create function pg_temp.save(n integer default 600,overrides jsonb default '{}',fingerprint text default null) returns uuid language sql as $$select public.regional_sourcing_save(pg_temp.id(1),input||overrides,pg_temp.id(n),coalesce(fingerprint,report->>'fingerprint')) from sourcing$$;
update sourcing set report=pg_temp.preview();
select is((select report->>'status' from sourcing),'available','all members have complete evidence');
select is((select (report->>'total_surplus')::numeric from sourcing),25.75::numeric,'source inbound and future snapshot excluded');
select is((select (report->>'allocated')::numeric from sourcing),12::numeric,'destination gap includes saved inbound once');
select is((select report#>>'{lines,0,quantity}' from sourcing),'4.078','largest remainder source one');
select is((select report#>>'{lines,1,quantity}' from sourcing),'7.922','largest remainder source two');
select is((select (report#>>'{lines,0,retained_available}')::numeric from sourcing),24.672::numeric,'source commitments protected before allocation');
select is((select (report->>'remaining_gap')::numeric from sourcing),0::numeric,'gap is covered without excess');
select is((select report#>>'{destination,orders,0,overdue}' from sourcing),'true','overdue evidence retained');
select is((select report#>>'{destination,orders,1,late}' from sourcing),'true','late evidence retained');
select is((select jsonb_array_length(report#>'{region,definition,locations}') from sourcing),3,'copies entire region');
select is((select report#>>'{input,sources,1,backorders}' from sourcing),'0.000','normalizes decimal strings');
select is(pg_temp.preview(jsonb_build_object('sources',(select jsonb_agg(v order by v->>'location_id') from sourcing,jsonb_array_elements(input->'sources') v))),(select report from sourcing),'selection order does not change evidence');
select throws_ok($$select pg_temp.preview('{"sources":[]}')$$,'MQ422',null,'requires all source members');
select throws_ok($$select pg_temp.preview(jsonb_build_object('sources',(select jsonb_build_array(input->'sources'->0) from sourcing)))$$,'MQ422',null,'omitted member fails');
select throws_ok($$select pg_temp.preview(jsonb_build_object('sources',(select jsonb_build_array(input->'sources'->0,input->'sources'->0) from sourcing)))$$,'MQ422',null,'duplicate member fails');
select throws_ok($$select pg_temp.preview('{"region_id":null}')$$,'MQ422',null,'null region rejected');
select throws_ok($$select pg_temp.preview('{"commitments_confirmed":false}')$$,'MQ422',null,'commitments mandatory');
select throws_ok($$select pg_temp.preview('{"lanes_confirmed":false}')$$,'MQ422',null,'lanes mandatory');
select throws_ok($$select pg_temp.preview('{"sources":null}')$$,'MQ422',null,'malformed arrays rejected');
select throws_ok($$select pg_temp.preview(jsonb_build_object('sources',jsonb_set((select input->'sources' from sourcing),'{0,backorders}','"NaN"')))$$,'MQ422',null,'nonfinite backorders rejected');
select throws_ok($$select pg_temp.preview(jsonb_build_object('sources',jsonb_set((select input->'sources' from sourcing),'{0,backorders}','"-1"')))$$,'MQ422',null,'negative backorders rejected');
select throws_ok($$select pg_temp.preview(jsonb_build_object('sources',jsonb_set((select input->'sources' from sourcing),'{0,backorders}','"0.0001"')))$$,'MQ422',null,'excess precision rejected');
select throws_ok($$select pg_temp.preview(jsonb_build_object('sources',jsonb_set((select input->'sources' from sourcing),'{0,policy_id}',to_jsonb(pg_temp.id(51)))))$$,'MQ404',null,'policy must belong to explicitly selected member');
select is((pg_temp.preview(jsonb_build_object('sources',jsonb_set((select input->'sources' from sourcing),'{1,maximum}',to_jsonb(pg_temp.id(61)))))#>>'{lines,0,source_policy,revision}')::integer,1,'explicit approved revision retained');
select throws_ok($$select pg_temp.save(601,'{}','bad')$$,'MQ422',null,'fingerprint required');
update sourcing set id=pg_temp.save();
select is(pg_temp.save(),(select id from sourcing),'identical retry returns original');
select throws_ok($$select pg_temp.save(600,'{}',repeat('f',64))$$,'MQ409',null,'conflicting retry fails');
select is((select count(*)::int from public.regional_sourcing_scenarios),1,'one immutable record');
select is((select count(*)::int from public.regional_sourcing_list),1,'invoker history visible');
select throws_ok($$update public.regional_sourcing_scenarios set report='{}'$$,'42501',null,'no direct update');
select throws_ok($$delete from public.regional_sourcing_scenarios$$,'42501',null,'no direct delete');
select pg_temp.login(11);
select is((select count(*)::int from public.regional_sourcing_scenarios),1,'viewer may inspect');
select throws_ok($$select pg_temp.save()$$,'MQ403',null,'viewer cannot save or retry');
select pg_temp.login(16);
select throws_ok($$select pg_temp.save()$$,'MQ403',null,'approver cannot save');
select pg_temp.login(12);
select is((select count(*)::int from public.regional_sourcing_list),0,'one-location scope hides full scenario');
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'one-location scope prevents partial preview');
select pg_temp.login(13,2);
select is((select count(*)::int from public.regional_sourcing_scenarios),0,'foreign organization cannot read');
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'foreign organization cannot preview');
select throws_ok($$select pg_temp.save()$$,'MQ403',null,'foreign organization cannot write');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21)),(pg_temp.id(1),pg_temp.id(12),pg_temp.id(22));
select pg_temp.login(12);set local role authenticated;
select is((select count(*)::int from public.regional_sourcing_list),1,'all-location member reads full history');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12) and location_id=pg_temp.id(22);
select pg_temp.login(12);set local role authenticated;
select is((select count(*)::int from public.regional_sourcing_list),0,'revocation of any member hides history');
reset role;
update public.stock_snapshots set quantity=38 where location_id=pg_temp.id(22);
select pg_temp.login(10);set local role authenticated;
select throws_ok($$select pg_temp.save(601)$$,'MQ409',null,'changed stock cannot save stale preview');
select is(pg_temp.save(),(select id from sourcing),'saved retry retains original stock');
reset role;
update public.stock_snapshots set unit_of_measure=null where location_id=pg_temp.id(22);
set local role authenticated;
select is(pg_temp.preview()->>'status','unavailable','missing units make complete scenario unavailable');
select is(pg_temp.preview()->>'allocated',null,'incomplete totals unknown, not zero');
select throws_ok($$select pg_temp.save(601,'{}',pg_temp.preview()->>'fingerprint')$$,'MQ422',null,'unavailable evidence cannot save');
reset role;
update public.stock_snapshots set unit_of_measure='EA',quantity=0 where organization_id=pg_temp.id(1) and location_id in(pg_temp.id(21),pg_temp.id(22));
set local role authenticated;
select is((pg_temp.preview()->>'allocated')::numeric,0::numeric,'zero surplus is available zero');
select is((pg_temp.preview()->>'remaining_gap')::numeric,12::numeric,'zero surplus leaves gap');
select ok((pg_temp.preview()#>>'{lines,0,retained_available}')::numeric<0,'negative retained commitment balance is not clamped');
select lives_ok($$select pg_temp.save(601,'{}',pg_temp.preview()->>'fingerprint')$$,'complete zero scenario saves');
select public.stock_region_archive(pg_temp.id(1),(select (input->>'region_id')::uuid from sourcing));
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'archived region prevents new previews');
select throws_ok($$select pg_temp.save(602)$$,'MQ404',null,'archived region prevents new saves');
select is(pg_temp.save(),(select id from sourcing),'retry survives region archive');
reset role;
delete from public.replenishment_drafts where organization_id=pg_temp.id(1);
delete from public.inventory_policies where organization_id=pg_temp.id(1);
delete from public.stock_regions where organization_id=pg_temp.id(1);
set local role authenticated;
select is((select report from public.regional_sourcing_scenarios where id=(select id from sourcing)),(select report from sourcing),'copies survive source deletion');
select is(pg_temp.save(),(select id from sourcing),'retry survives source deletion with current access');
reset role;
select is((select count(*)::int from public.audit_log where organization_id=pg_temp.id(1) and table_name='regional_sourcing_scenarios' and operation='INSERT'),2,'one audit per saved scenario');
delete from public.stock_snapshots where location_id=pg_temp.id(22);
delete from public.planning_runs where location_id=pg_temp.id(22);
delete from public.locations where id=pg_temp.id(22);
select is((select count(*)::int from public.regional_sourcing_scenarios),0,'any member deletion cascades');
select is((select count(*)::int from public.audit_log where organization_id=pg_temp.id(1) and table_name='regional_sourcing_scenarios' and operation='DELETE'),2,'location deletion audits copied scenario');
select ok(not has_function_privilege('anon','public.regional_sourcing_preview(uuid,jsonb)','EXECUTE'),'anonymous has no preview grant');
select ok(not has_function_privilege('service_role','public.regional_sourcing_save(uuid,jsonb,uuid,text)','EXECUTE'),'service has no save grant');
select ok(not has_table_privilege('maqdar_worker','public.regional_sourcing_scenarios','SELECT'),'worker has no history grant');
select * from finish();rollback;
