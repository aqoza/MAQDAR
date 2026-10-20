begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
  select ('e2210000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void
$$;
insert into auth.users(id,email) select pg_temp.id(n),'network-workbench-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values
  (pg_temp.id(1),'network-workbench-a','Network A'),(pg_temp.id(2),'network-workbench-b','Network B');
insert into public.memberships(organization_id,user_id,role) values
  (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'approver'),
  (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner'),
  (pg_temp.id(1),pg_temp.id(14),'viewer'),(pg_temp.id(1),pg_temp.id(15),'planner'),(pg_temp.id(1),pg_temp.id(16),'admin');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
  select pg_temp.id(n),pg_temp.id(case when n>=23 then 2 else 1 end),
    case n when 20 then 'WAREHOUSE' when 21 then 'BRANCH-A' when 22 then 'ZERO-BRANCH' else 'FOREIGN-'||n end,
    'Synthetic location',case when n in (20,23) then 'central' else 'branch' end,'SA','Asia/Riyadh'
  from generate_series(20,24) n;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20)),(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));

-- Bounded synthetic package projections; the browser test creates the full chain through guarded RPCs.
do $$declare n integer; org uuid; src uuid; locations uuid[]; report jsonb; payload jsonb;
begin
  for n in 1..53 loop
    org:=pg_temp.id(case when n=53 then 2 else 1 end);
    src:=pg_temp.id(case when n=53 then 23 else 20 end);
    locations:=case when n=53 then array[src,pg_temp.id(24)] when n=50 then array[src,pg_temp.id(21)]
      else array[src,pg_temp.id(21),pg_temp.id(22)] end;
    report:=jsonb_build_object('method','network-freight-v1','status','available',
      'source',jsonb_build_object('dispatch',jsonb_build_object('date','2026-10-12'),
        'source',jsonb_build_object('source_location_code',case when n=53 then 'FOREIGN-23' else 'WAREHOUSE' end,
          'source_policy',jsonb_build_object('item_code',case when n=2 then 'MODEL-BETA' else 'ITEM-'||n end,'unit','EA'))),
      'lines',case when n=53 then '[{"location_code":"FOREIGN-24","quantity":"1.000"}]'::jsonb
        when n=50 then '[{"location_code":"BRANCH-A","quantity":"1.000"}]'::jsonb
        else '[{"location_code":"BRANCH-A","quantity":"1.000"},{"location_code":"ZERO-BRANCH","quantity":"0.000"}]'::jsonb end);
    insert into public.network_allocation_scenarios(id,organization_id,source_location_id,required_location_ids,request_id,submitted_by,report)
      values(pg_temp.id(100+n),org,src,locations,pg_temp.id(1000+n),pg_temp.id(10),'{"method":"network-allocation-v1","status":"available"}');
    insert into public.network_date_scenarios(id,organization_id,allocation_id,source_location_id,required_location_ids,request_id,submitted_by,report)
      values(pg_temp.id(200+n),org,pg_temp.id(100+n),src,locations,pg_temp.id(2000+n),pg_temp.id(10),'{"method":"network-dates-v1","status":"available","lines":[]}');
    insert into public.network_freight_estimates(id,organization_id,scenario_id,source_location_id,required_location_ids,request_id,submitted_by,report)
      values(pg_temp.id(300+n),org,pg_temp.id(200+n),src,locations,pg_temp.id(3000+n),pg_temp.id(10),report);
    insert into public.network_transfer_proposals(id,organization_id,estimate_id,allocation_id,source_location_id,required_location_ids,revision,request_id,submitted_by,reason,
      status,decided_by,decided_at,decision_reason,decision_request_id)
      values(pg_temp.id(400+n),org,pg_temp.id(300+n),pg_temp.id(100+n),src,locations,1,pg_temp.id(4000+n),pg_temp.id(10),'Synthetic review',
        'approved',pg_temp.id(11),now(),'Independent review',pg_temp.id(5000+n));
    payload:=jsonb_build_object('schema_version','network-transfer-handoff-v1','purpose','planning_only','estimate',report);
    insert into public.network_transfer_handoffs(id,organization_id,proposal_id,source_location_id,required_location_ids,created_by,payload)
      values(pg_temp.id(500+n),org,pg_temp.id(400+n),src,locations,pg_temp.id(10),payload);
  end loop;
end $$;
insert into public.network_handoff_batches(id,organization_id,source_location_id,required_location_ids,handoff_ids,created_by,payload)
select pg_temp.id(9000+n),pg_temp.id(1),pg_temp.id(20),array[pg_temp.id(20),pg_temp.id(21),pg_temp.id(22)],
  array[pg_temp.id(501),pg_temp.id(501+n)],pg_temp.id(10),
  jsonb_build_object('schema_version','network-handoff-batch-v1','purpose','planning_only',
    'summary',jsonb_build_object('source_code','WAREHOUSE','dispatch_date','2026-10-12','branch_row_count',4,'totals','[]'::jsonb),
    'lines',(select jsonb_agg(payload order by id) from public.network_transfer_handoffs where id in (pg_temp.id(501),pg_temp.id(501+n))))
from generate_series(1,2) n;

insert into public.network_handoff_acknowledgements(id,organization_id,required_location_ids,handoff_id,batch_id,client_event_id,api_key_id,recorded_at,external_system,external_reference,status,reason)
select pg_temp.id(8000+n),pg_temp.id(1),array[pg_temp.id(20),pg_temp.id(21),pg_temp.id(22)],
 case when n<5 then pg_temp.id(501) end,case when n=5 then pg_temp.id(9001) end,pg_temp.id(8100+n),pg_temp.id(8200+n),
 '2026-10-12 10:00:00Z'::timestamptz + case when n=1 then interval '-1 hour' else interval '0' end,
 case when n=3 then 'erp' when n=4 then ' ERP ' else 'ERP' end,
 case when n=1 then 'superseded-reference' when n=2 then 'latest-reference' else 'reference-'||n end,
 case when n in (1,3,4) then 'rejected' else 'received' end,
 case when n in (1,3,4) then 'Mapping issue' end
from generate_series(1,5) n;
-- Same server timestamp: ascending event UUID is a display tie-break, regardless of key identity.
insert into public.network_handoff_acknowledgements(id,organization_id,required_location_ids,handoff_id,client_event_id,api_key_id,recorded_at,external_system,external_reference,status,reason)
values(pg_temp.id(8010),pg_temp.id(1),array[pg_temp.id(20),pg_temp.id(21),pg_temp.id(22)],pg_temp.id(501),pg_temp.id(8110),pg_temp.id(8210),
 '2026-10-12 10:00:00Z','ERP','tie-loses','rejected','Tie-break only');

create temporary table original as select id,payload from public.network_handoff_batches;
grant select on original to authenticated;
create function pg_temp.work(filters jsonb default '{}',page integer default 1,size integer default 25) returns jsonb language sql as $$
  select public.network_integration_workbench(pg_temp.id(1),filters,page,size)
$$;
select pg_temp.login(10);
set local role authenticated;
select is(pg_temp.work()->>'total','56','exact labels add rows; other tenant excluded');
select is(jsonb_array_length(pg_temp.work()->'rows'),25,'default bounded page');
select is(pg_temp.work('{}',100000)->>'page','3','out of range clamps from same count');
select is(jsonb_array_length(pg_temp.work('{}',3)->'rows'),6,'last page complete');
select is(jsonb_array_length(pg_temp.work('{}',1,50)->'rows'),50,'fifty row page');
select is(jsonb_array_length(pg_temp.work('{}',1,100)->'rows'),56,'hundred row page');
select is(pg_temp.work('{"system":"ERP"}')->>'total','54','one row per package for exact system');
select is(pg_temp.work('{"system":"ERP","status":"received"}')->>'total','2','latest receipt hides older rejection and tied later UUID');
select is(pg_temp.work('{"system":"ERP","status":"rejected"}')->>'total','0','status applied after latest');
select is(pg_temp.work('{"q":"superseded-reference"}')->>'total','0','search applied after latest');
select is(pg_temp.work('{"q":"tie-loses"}')->>'total','0','losing timestamp tie excluded');
select is(pg_temp.work('{"q":"latest-reference"}')->>'total','1','latest reference searchable');
select is(pg_temp.work('{"system":"ERP","status":"no_report"}')->>'total','52','no report does not inherit batch/member/overlap report');
select is(pg_temp.work('{"system":" ERP ","status":"rejected"}')->>'total','1','space label exact');
select is(pg_temp.work('{"system":"erp","status":"rejected"}')->>'total','1','case label exact');
select is(pg_temp.work('{"system":"Unknown","status":"no_report"}')->>'total','54','selected absent system includes packages with other reports');
select is(pg_temp.work('{"kind":"batch","status":"no_report"}')->>'total','1','overlap does not propagate');
select is(pg_temp.work('{"source":"WAREHOUSE","branch":"ZERO-BRANCH","system":"ERP"}')->>'total','53','zero branch filter includes whole packages');
select is(pg_temp.work('{"branch":"WAREHOUSE"}')->>'total','0','warehouse is not an included receiving branch');
select is(pg_temp.work('{"source":"Unknown"}')->>'total','0','exact warehouse filter');
select is(pg_temp.work('{"kind":"batch","q":"MODEL-BETA","system":"ERP"}')->>'total','1','copied member item search');
select is(pg_temp.work('{"kind":"batch","system":"ERP"}')#>'{rows,0,branch_codes}','["BRANCH-A","ZERO-BRANCH"]'::jsonb,'branch list unique and deterministic');
select is(pg_temp.work('{"kind":"batch","system":"ERP"}')#>>'{rows,0,branch_row_count}','4','zero and repeated branch rows remain evidence');
select is(pg_temp.work('{"selection":"historical"}')->>'total','0','current independent of reports');
select throws_ok($$select pg_temp.work('[]')$$,'MQ422',null,'filters object');
select throws_ok($$select pg_temp.work('{"supplier":"x"}')$$,'MQ422',null,'unrelated filters denied');
select throws_ok($$select pg_temp.work('{"branch":5}')$$,'MQ422',null,'filter types');
select throws_ok($$select pg_temp.work('{"status":"failed"}')$$,'MQ422',null,'no inferred delivery failure');
select throws_ok($$select pg_temp.work('{"selection":"selected"}')$$,'MQ422',null,'selection allowlist');
select throws_ok($$select pg_temp.work('{"kind":"orders"}')$$,'MQ422',null,'kind allowlist');
select throws_ok($$select pg_temp.work('{"system":" "}')$$,'MQ422',null,'blank system');
select throws_ok($$select pg_temp.work(jsonb_build_object('system',repeat('x',81)))$$,'MQ422',null,'system length');
select throws_ok($$select pg_temp.work(jsonb_build_object('q',repeat('x',101)))$$,'MQ422',null,'search length');
select throws_ok($$select pg_temp.work(jsonb_build_object('branch',E'a\nb'))$$,'MQ422',null,'control characters');
select throws_ok($$select pg_temp.work('{}',0)$$,'MQ422',null,'page lower bound');
select throws_ok($$select pg_temp.work('{}',100001)$$,'MQ422',null,'page upper bound');
select throws_ok($$select pg_temp.work('{}',1,26)$$,'MQ422',null,'page size allowlist');
select throws_ok($$select public.network_integration_workbench(pg_temp.id(2))$$,'MQ404',null,'other organization hidden');
select pg_temp.login(12);
select is(pg_temp.work()->>'total','1','partial access only reveals complete permitted package');
select is(pg_temp.work('{"branch":"BRANCH-A"}')->>'total','1','branch filter cannot relax all-location checks');
select is(pg_temp.work('{"branch":"ZERO-BRANCH"}')->>'total','0','hidden zero branch absent from rows and counts');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(22));
set local role authenticated;
select is(pg_temp.work()->>'total','56','all locations including zero reveals reports');
select pg_temp.login(14);
select is(pg_temp.work()->>'total','56','viewer can inspect');
select pg_temp.login(15);
select is(pg_temp.work()->>'total','56','planner can inspect');
select pg_temp.login(11);
select is(pg_temp.work()->>'total','56','approver can inspect');
select pg_temp.login(16);
select is(pg_temp.work()->>'total','56','admin can inspect');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.work()$$,'MQ404',null,'active organization claim narrows membership');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select pg_temp.work()$$,'MQ401',null,'anonymous identity refused');
reset role;
select ok(not p.prosecdef and p.provolatile='s','stable invoker function') from pg_proc p where p.oid='public.network_integration_workbench(uuid,jsonb,integer,integer)'::regprocedure;
select ok(has_function_privilege(r,'public.network_integration_workbench(uuid,jsonb,integer,integer)','EXECUTE')=(r='authenticated'),'reviewed workbench grant: '||r)
  from unnest(array['anon','authenticated','service_role','maqdar_worker','maqdar_simulation_worker']) r;
select is((select count(*) from public.network_handoff_acknowledgements where organization_id=pg_temp.id(1)),6::bigint,'reads do not write reports');
select ok(not exists(select 1 from original o join public.network_handoff_batches b using(id) where b.payload<>o.payload),'reads preserve copied evidence');
-- Later selection leaves reports independent; deleting source context retains searchable copied batches.
insert into public.network_transfer_proposals(id,organization_id,estimate_id,allocation_id,source_location_id,required_location_ids,revision,request_id,submitted_by,reason,
  status,decided_by,decided_at,decision_reason,decision_request_id)
select pg_temp.id(600),organization_id,estimate_id,allocation_id,source_location_id,required_location_ids,2,pg_temp.id(6000),submitted_by,'Later selection',
  'approved',decided_by,now(),'Later independent review',pg_temp.id(6001) from public.network_transfer_proposals where id=pg_temp.id(401);
select pg_temp.login(10);
set local role authenticated;
select is(pg_temp.work('{"system":"ERP","selection":"historical"}')->>'total','3','single and both overlapping batches become historical');
select is(pg_temp.work('{"system":"ERP","selection":"historical","status":"received"}')->>'total','2','reports independent of selection');
reset role;
delete from public.network_allocation_scenarios where id=pg_temp.id(101);
set local role authenticated;
select is(pg_temp.work('{"selection":"unavailable"}')->>'total','2','copied batches survive without live source context');
select is(pg_temp.work('{"q":"ITEM-1","branch":"ZERO-BRANCH","selection":"unavailable","status":"received"}')->>'total','1','retained copied item/branch search and report');
select is(pg_temp.work('{"selection":"unavailable","system":"Unknown","status":"no_report"}')->>'total','2','unavailable is independent of absent reports');
select is(pg_temp.work('{"kind":"handoff","q":"latest-reference"}')->>'total','0','deleted single no longer searchable');
select ok(not exists(select 1 from original o join public.network_handoff_batches b using(id) where b.payload<>o.payload),'original copied files retained');
select pg_temp.login(12);
select is(pg_temp.work('{"selection":"unavailable"}')->>'total','2','all-location member can inspect retained batches');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12) and location_id=pg_temp.id(22);
set local role authenticated;
select is(pg_temp.work('{"selection":"unavailable","branch":"BRANCH-A"}')->>'total','0','retained batches still require missing zero branch');
reset role;
select * from finish();
rollback;
