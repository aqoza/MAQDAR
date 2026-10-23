begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('bc25b000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'regional-review-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'regional-review-a','Redistribution A'),(pg_temp.id(2),'regional-review-b','Redistribution B');
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
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(21),'2026-10-10',26.375,2.250,1,'SAR','EA'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(21),'2026-10-11',999,0,1,'SAR','EA');
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(30+n),pg_temp.id(case when n=3 then 2 else 1 end),pg_temp.id(20+n),pg_temp.id(40+n),
 '2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}' from generate_series(0,3) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(50+n),pg_temp.id(case when n=3 then 2 else 1 end),pg_temp.id(30+n),pg_temp.id(20+n),pg_temp.id(200+n),pg_temp.id(100),'SAVED','EA','available',
 '{"protection":{"target":"20.000"}}',
 '{"options":{"lead_time":10,"review_interval":4},"forecast":{"to_date":"2026-10-10","method":"baseline-v1","source":{"unit_provenance":{"method":"source-units-v1","status":"consistent","unit":"EA","rows":1,"unknown_rows":0,"units":["EA"]}}}}' from generate_series(0,3) n;
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
update sourcing set id=pg_temp.save();
reset role;
insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays)
values(pg_temp.id(700),pg_temp.id(1),'DATES','Dates','SA',array[6,7],false);
update public.locations set work_calendar_id=pg_temp.id(700) where organization_id=pg_temp.id(1);
create temporary table dates(report jsonb,id uuid);
grant all on dates to authenticated;
create function pg_temp.date_preview(requested date default '2026-10-10',confirmed boolean default true) returns jsonb language sql as $$select public.regional_date_preview(pg_temp.id(1),id,requested,confirmed) from sourcing$$;
create function pg_temp.date_save(n integer default 800,fingerprint text default null) returns uuid language sql as $$select public.regional_date_save(pg_temp.id(1),s.id,'2026-10-10',true,pg_temp.id(n),coalesce(fingerprint,d.report->>'fingerprint')) from sourcing s cross join dates d$$;
set local role authenticated;
insert into dates(report) select pg_temp.date_preview();
update dates set id=pg_temp.date_save();
reset role;
update public.network_links set freight_basis='per_shipment',freight_cost=1.005,currency='SAR',freight_valid_from='2026-10-12' where organization_id=pg_temp.id(1);
create temporary table freight(report jsonb,id uuid);
grant all on freight to authenticated;
create function pg_temp.freight_preview(confirmed boolean default true) returns jsonb language sql as $$select public.regional_freight_preview(pg_temp.id(1),id,confirmed) from dates$$;
create function pg_temp.freight_save(n integer default 900,fingerprint text default null) returns uuid language sql as $$select public.regional_freight_save(pg_temp.id(1),d.id,true,pg_temp.id(n),coalesce(fingerprint,f.report->>'fingerprint')) from dates d cross join freight f$$;
set local role authenticated;
insert into freight(report) select pg_temp.freight_preview();
update freight set id=pg_temp.freight_save();
create temporary table proposals(id uuid);
grant all on proposals to authenticated;
create function pg_temp.submit(n integer default 950) returns uuid language sql as $$select public.regional_transfer_submit(pg_temp.id(1),id,pg_temp.id(n),'Whole regional proposal') from freight$$;
insert into proposals select pg_temp.submit();

select pg_temp.login(16);
select public.regional_transfer_decide(pg_temp.id(1),(select id from proposals),pg_temp.id(963),'approved','Independent review');
select pg_temp.login(10);
create temporary table exports(id uuid);grant all on exports to authenticated;
insert into exports select public.regional_handoff_create(pg_temp.id(1),(select id from proposals));
create temporary table batches(id uuid); grant all on batches to authenticated,service_role;
grant select on exports to service_role;
insert into batches select public.regional_handoff_batch_create(pg_temp.id(1),array[(select id from exports)]);
reset role;

-- Reports are synthetic; the parent evidence chain above uses the real guarded RPCs.
insert into public.regional_handoff_acknowledgements(id,organization_id,required_location_ids,handoff_id,batch_id,client_event_id,api_key_id,recorded_at,external_system,external_reference,status,reason)
select pg_temp.id(8000+n),pg_temp.id(1),array[pg_temp.id(20),pg_temp.id(21),pg_temp.id(22)],
 case when n<>5 then (select id from exports) end,case when n=5 then (select id from batches) end,pg_temp.id(8100+n),pg_temp.id(8200+n),
 '2026-10-12 10:00:00Z'::timestamptz + case when n=1 then interval '-1 hour' else interval '0' end,
 case when n=3 then 'erp' when n=4 then ' ERP ' when n>6 then 'System-'||n else 'ERP' end,
 case when n=1 then 'old-reference' when n=2 then 'latest-reference' when n=6 then 'tie-loses' else 'reference-'||n end,
 case when n in (1,3,4,6) then 'rejected' else 'received' end,
 case when n in (1,3,4,6) then 'Mapping issue' end
from generate_series(1,32) n;
create temporary table original as select id,payload from public.regional_handoff_batches;
grant select on original to authenticated;
create temporary table audit_before as select count(*) n from public.audit_log;
create function pg_temp.work(filters jsonb default '{}',page integer default 1,size integer default 25) returns jsonb language sql as $$
 select public.regional_integration_workbench(pg_temp.id(1),filters,page,size)
$$;
select pg_temp.login(10);set local role authenticated;
select is(pg_temp.work()->>'total','30','latest exact labels plus separate batch; no propagation');
select is(jsonb_array_length(pg_temp.work()->'rows'),25,'default bounded page');
select is(pg_temp.work('{}',100000)->>'page','2','page clamps using same count');
select is(jsonb_array_length(pg_temp.work('{}',2)->'rows'),5,'last page');
select is(jsonb_array_length(pg_temp.work('{}',1,50)->'rows'),30,'fifty-row option');
select is(jsonb_array_length(pg_temp.work('{}',1,100)->'rows'),30,'hundred-row option');
select is(pg_temp.work('{"system":"ERP"}')->>'total','2','one result per exact package/system');
select is(pg_temp.work('{"system":"ERP","status":"rejected"}')->>'total','0','latest precedes status and stable UUID breaks timestamp tie');
select is(pg_temp.work('{"q":"old-reference"}')->>'total','0','search only latest');
select is(pg_temp.work('{"q":"tie-loses"}')->>'total','0','losing tie absent');
select is(pg_temp.work('{"q":"latest-reference"}')->>'total','1','latest reference searchable');
select is(pg_temp.work('{"system":"erp","status":"rejected"}')->>'total','1','case identity preserved');
select is(pg_temp.work('{"system":" ERP ","status":"rejected"}')->>'total','1','spaces preserved');
select is(pg_temp.work('{"system":"Missing","status":"no_report"}')->>'total','2','absent system includes packages with other reports');
select is(pg_temp.work('{"kind":"batch","system":"erp","status":"no_report"}')->>'total','1','handoff report never propagates to batch');
select is(pg_temp.work('{"kind":"handoff","system":"ERP"}')->>'total','1','kind filter');
select is(pg_temp.work('{"location":"L0","source":"L1","system":"ERP"}')->>'total','2','receiver and zero source find whole packages');
select is(pg_temp.work('{"source":"L0"}')->>'total','0','receiver is not a source');
select is(pg_temp.work('{"location":"L1"}')->>'total','0','source is not receiver');
select is(pg_temp.work(jsonb_build_object('region',(select input->>'region_id' from sourcing),'system','ERP'))->>'total','2','exact saved region');
select is(pg_temp.work(jsonb_build_object('region',pg_temp.id(999),'system','ERP'))->>'total','0','unknown region');
select is(pg_temp.work('{"q":"Sourcing region","system":"ERP"}')->>'total','2','saved region name search');
select is(pg_temp.work('{"q":"SAVED","kind":"batch","system":"ERP"}')->>'total','1','copied member item searchable');
select is(pg_temp.work('{"system":"ERP"}')#>'{rows,0,source_codes}','["L1","L2"]'::jsonb,'unique ordered source codes');
select is(pg_temp.work('{"system":"ERP"}')#>>'{rows,0,selection}','current','live context independent');
select throws_ok($$select pg_temp.work('{"branch":"L1"}')$$,'MQ422',null,'wrong-family filter rejected');
select throws_ok($$select pg_temp.work('{"region":"bad"}')$$,'MQ422',null,'region UUID required');
select throws_ok($$select pg_temp.work('{"system":" "}')$$,'MQ422',null,'blank label rejected');
select throws_ok($$select pg_temp.work('{"status":"accepted"}')$$,'MQ422',null,'no operational acceptance status');
select throws_ok($$select pg_temp.work('{"source":12}')$$,'MQ422',null,'filter types bounded');
select throws_ok($$select pg_temp.work('[]')$$,'MQ422',null,'filter object required');
select throws_ok($$select pg_temp.work('{}',0)$$,'MQ422',null,'page bounded');
select throws_ok($$select pg_temp.work('{}',1,200)$$,'MQ422',null,'size bounded');
select throws_ok($$select pg_temp.work(jsonb_build_object('system',E'ERP\n'))$$,'MQ422',null,'control characters rejected');
select throws_ok($$select public.regional_integration_workbench(pg_temp.id(2))$$,'MQ404',null,'foreign tenant denied');
reset role;
select is((select count(*) from public.audit_log),(select n from audit_before),'reads do not append audit writes');
set local role authenticated;
select pg_temp.login(11);select is(pg_temp.work('{"system":"ERP"}')->>'total','2','viewer reads');
select pg_temp.login(14);select is(pg_temp.work('{"system":"ERP"}')->>'total','2','planner reads');
select pg_temp.login(15);select is(pg_temp.work('{"system":"ERP"}')->>'total','2','admin reads');
select pg_temp.login(16);select is(pg_temp.work('{"system":"ERP"}')->>'total','2','approver reads');
select pg_temp.login(12);select is(pg_temp.work('{"source":"L2","system":"ERP"}')->>'total','0','source filter cannot bypass all-location access');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(22));
set local role authenticated;
select is(pg_temp.work('{"source":"L2","system":"ERP"}')->>'total','0','missing zero source still hides count and rows');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select is(pg_temp.work('{"system":"ERP"}')->>'total','2','every saved location restores access');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.work()$$,'MQ404',null,'foreign caller hidden');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select pg_temp.work()$$,'MQ401',null,'missing identity denied');
reset role;
select ok(not (select prosecdef from pg_proc where oid='public.regional_integration_workbench(uuid,jsonb,integer,integer)'::regprocedure),'invoker rights');
select ok(not has_function_privilege('anon','public.regional_integration_workbench(uuid,jsonb,integer,integer)','execute'),'anonymous cannot execute');
select ok(not has_function_privilege('service_role','public.regional_integration_workbench(uuid,jsonb,integer,integer)','execute'),'browser RPC not service granted');
-- Archive/delete the definition: both name and exact identity remain searchable.
update public.stock_regions set archived_at=now(),archived_by=pg_temp.id(10) where id=(select (input->>'region_id')::uuid from sourcing);
select pg_temp.login(10);set local role authenticated;
select is(pg_temp.work('{"q":"Sourcing region","system":"ERP"}')->>'total','2','archive keeps saved names');
reset role;
delete from public.stock_regions where id=(select (input->>'region_id')::uuid from sourcing);
set local role authenticated;
select is(pg_temp.work(jsonb_build_object('region',(select input->>'region_id' from sourcing),'system','ERP'))->>'total','2','deleted definition keeps saved identity');
reset role;
-- A later approval changes selection only, not reports or copied files.
insert into public.regional_transfer_proposals(id,organization_id,estimate_id,sourcing_id,required_location_ids,revision,request_id,submitted_by,reason,status,decided_by,decided_at,decision_reason,decision_request_id)
select pg_temp.id(9900),organization_id,estimate_id,sourcing_id,required_location_ids,revision+1,pg_temp.id(9901),submitted_by,'Later review','approved',decided_by,now(),'Later selection',pg_temp.id(9902)
from public.regional_transfer_proposals where id=(select id from proposals);
set local role authenticated;
select is(pg_temp.work('{"selection":"historical","system":"ERP","status":"received"}')->>'total','2','later approval changes live context independently');
reset role;
delete from public.regional_sourcing_scenarios where id=(select id from sourcing);
set local role authenticated;
select is(pg_temp.work('{"selection":"unavailable","q":"Sourcing region SAVED","system":"ERP"}')->>'total','1','retained batch searchable with unavailable source');
select is(pg_temp.work('{"selection":"unavailable","system":"ERP"}')#>>'{rows,0,status}','received','batch report survives source deletion');
select is(pg_temp.work('{"selection":"unavailable","system":"erp"}')#>>'{rows,0,status}','no_report','no source-report inheritance');
select is((select payload from public.regional_handoff_batches),(select payload from original),'original batch evidence unchanged');
select pg_temp.login(12);
select is(pg_temp.work('{"system":"ERP"}')->>'total','1','retained copied package still scoped');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12) and location_id=pg_temp.id(21);
set local role authenticated;
select is(pg_temp.work('{"source":"L2","system":"ERP"}')->>'total','0','revoked zero-source access hides retained package');
reset role;
select * from finish();
rollback;
