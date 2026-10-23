begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('98000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
create function pg_temp.compare(day date default '2026-10-10',basis text default 'calculated',override_id uuid default null) returns jsonb language sql as $$select public.policy_stock_comparison(pg_temp.id(1),pg_temp.id(50),day,basis,override_id)$$;
insert into auth.users(id,email) select pg_temp.id(n),'draft-'||n||'@test.local' from generate_series(10,14) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'draft-a','Draft A'),(pg_temp.id(2),'draft-b','Draft B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=2 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,2) n;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 values(pg_temp.id(100),pg_temp.id(1),'ITEM','Item','Test','SET',99,'SAR');
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure) values
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-10',12,2,1.125,'KWD','EA'),
 (pg_temp.id(1),pg_temp.id(100),pg_temp.id(20),'2026-10-11',999,0,1,'SAR','EA');
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(30+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(20+n),pg_temp.id(40+n),
 '2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}' from generate_series(0,2) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(50+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(30+n),pg_temp.id(20+n),pg_temp.id(200+n),pg_temp.id(100),'SAVED','EA','available',
 '{"protection":{"target":"20.000"}}',
 '{"options":{"lead_time":3,"review_interval":4},"forecast":{"to_date":"2026-10-10","method":"baseline-v1","source":{"unit_provenance":{"method":"source-units-v1","status":"consistent","unit":"EA","rows":1,"unknown_rows":0,"units":["EA"]}}}}' from generate_series(0,2) n;
insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id)
 select pg_temp.id(60+n),pg_temp.id(1),pg_temp.id(50),pg_temp.id(20),n,pg_temp.id(70+n),pg_temp.id(10),1,20+n,'Scenario',
 'approved',pg_temp.id(11),now(),'Approved scenario',pg_temp.id(80+n) from generate_series(1,2) n;
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90)
values(pg_temp.id(110),pg_temp.id(1),'SUP','Supplier','SA','SAR',3,3);
insert into public.open_orders(id,organization_id,order_code,line_code,item_id,location_id,supplier_id,expected_date,quantity,unit_cost,currency,status,unit_of_measure) values
 (pg_temp.id(120),pg_temp.id(1),'O1','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-09',3.250,1,'SAR','open','EA'),
 (pg_temp.id(121),pg_temp.id(1),'O2','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-18',2.750,1,'SAR','open','EA'),
 (pg_temp.id(122),pg_temp.id(1),'CLOSED','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-12',999,1,'SAR','closed',null),
 (pg_temp.id(123),pg_temp.id(1),'ZERO','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-12',0,1,'SAR','open',null),
 (pg_temp.id(124),pg_temp.id(1),'CANCELED','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-12',999,1,'SAR','canceled','KG');
insert into public.receipts(organization_id,receipt_code,line_code,item_id,location_id,supplier_id,receipt_date,quantity,unit_cost,currency)
values(pg_temp.id(1),'REC','1',pg_temp.id(100),pg_temp.id(20),pg_temp.id(110),'2026-10-10',100,1,'SAR');
create temporary table fixture(draft_id uuid,report jsonb,scenario_id uuid);
grant all on fixture to authenticated;
select pg_temp.login(10,1);
set local role authenticated;
insert into fixture(draft_id) select public.replenishment_save(pg_temp.id(1),pg_temp.id(50),pg_temp.id(300),'calculated',null,'4',true,
  public.replenishment_preview(pg_temp.id(1),pg_temp.id(50),'calculated',null,'4',true)->>'fingerprint');
insert into public.supplier_items(id,organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure)
values(pg_temp.id(130),pg_temp.id(1),pg_temp.id(110),pg_temp.id(100),3,10,6,1,'SAR','EA');
reset role;

set local role authenticated;
update fixture set scenario_id=public.supplier_scenario_save(pg_temp.id(1),draft_id,'SUP',true,pg_temp.id(400),
 public.supplier_scenario_preview(pg_temp.id(1),draft_id,'SUP',true)->>'fingerprint');
reset role;
insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays)
values(pg_temp.id(500),pg_temp.id(1),'SEND','Sending','SA','{}'::smallint[],false),
 (pg_temp.id(501),pg_temp.id(1),'RECEIVE','Receiving','SA','{}'::smallint[],false);
update public.suppliers set work_calendar_id=pg_temp.id(500) where id=pg_temp.id(110);
update public.locations set work_calendar_id=pg_temp.id(501) where id=pg_temp.id(20);
alter table fixture add delivery_id uuid;

set local role authenticated;
update fixture set delivery_id=public.delivery_scenario_save(pg_temp.id(1),scenario_id,'2026-10-10',true,pg_temp.id(600),
 public.delivery_scenario_preview(pg_temp.id(1),scenario_id,'2026-10-10',true)->>'fingerprint');
reset role;
alter table fixture add estimate_id uuid;
create function pg_temp.preview(confirmed boolean default true) returns jsonb language sql as $$select public.purchase_cost_preview(pg_temp.id(1),(select delivery_id from fixture),confirmed)$$;
create function pg_temp.save(request integer default 800,fingerprint text default null,confirmed boolean default true) returns uuid language sql as $$select public.purchase_cost_save(pg_temp.id(1),(select delivery_id from fixture),confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.preview(confirmed)->>'fingerprint'))$$;
set local role authenticated;

update public.supplier_items set valid_from='2026-10-10',unit_price=1.005 where id=pg_temp.id(130);
update fixture set estimate_id=pg_temp.save(),report=pg_temp.preview();
reset role;
insert into public.memberships(organization_id,user_id,role) values(pg_temp.id(1),pg_temp.id(14),'approver');
alter table fixture add proposal_id uuid;
create function pg_temp.propose(request integer default 900,why text default 'Plan purchase') returns uuid language sql as $$select public.purchase_proposal_submit(pg_temp.id(1),(select estimate_id from fixture),pg_temp.id(request),why)$$;
create function pg_temp.decide(decision text,request integer default 950,why text default 'Reviewed') returns uuid language sql as $$select public.purchase_proposal_decide(pg_temp.id(1),(select proposal_id from fixture),pg_temp.id(request),decision,why)$$;
set local role authenticated;
update fixture set proposal_id=pg_temp.propose();
create function pg_temp.handoff() returns uuid language sql as $$select public.purchase_handoff_create(pg_temp.id(1),(select proposal_id from fixture))$$;

select pg_temp.login(14,1);
select pg_temp.decide('approved');
select pg_temp.login(10,1);
reset role;
alter table fixture add handoff_id uuid;
set local role authenticated;
update fixture set handoff_id=pg_temp.handoff();
reset role;

-- Build real, independently approved evidence chains with distinct items and optional differing units/lead times.
create function pg_temp.line(n integer,u text default 'EA',lead integer default 3,duplicate boolean default false) returns uuid language plpgsql as $$
declare item uuid:=case when duplicate then pg_temp.id(100) else pg_temp.id(10000+n) end;
  run uuid:=pg_temp.id(20000+n); policy uuid:=pg_temp.id(30000+n);
  draft uuid; scenario uuid; delivery uuid; estimate uuid; proposal uuid; report jsonb; evidence jsonb;
begin
  if not duplicate then
    insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
      values(item,pg_temp.id(1),'ITEM-'||n,'Item','Test',u,1,'SAR');
    insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
      values(pg_temp.id(1),item,pg_temp.id(20),'2026-10-10',12,2,1,'SAR',u);
    insert into public.supplier_items(organization_id,supplier_id,item_id,lead_time_days,min_order_quantity,pack_size,unit_price,currency,unit_of_measure,valid_from)
      values(pg_temp.id(1),pg_temp.id(110),item,lead,10,6,1.005,'SAR',u,'2026-10-10');
  end if;
  insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
    values(run,pg_temp.id(1),pg_temp.id(20),gen_random_uuid(),'2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}');
  select p.evidence into evidence from public.inventory_policies p where id=pg_temp.id(50);
  evidence:=jsonb_set(evidence,'{options,lead_time}',to_jsonb(lead));
  evidence:=jsonb_set(evidence,'{forecast,source,unit_provenance}',jsonb_build_object('method','source-units-v1','status','consistent','unit',u,'rows',1,'unknown_rows',0,'units',jsonb_build_array(u)));
  insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
    values(policy,pg_temp.id(1),run,pg_temp.id(20),gen_random_uuid(),item,case when duplicate then 'ITEM' else 'ITEM-'||n end,u,'available','{"protection":{"target":"20.000"}}',evidence);
  perform pg_temp.login(10,1);
  report:=public.replenishment_preview(pg_temp.id(1),policy,'calculated',null,'4',true);
  draft:=public.replenishment_save(pg_temp.id(1),policy,gen_random_uuid(),'calculated',null,'4',true,report->>'fingerprint');
  report:=public.supplier_scenario_preview(pg_temp.id(1),draft,'SUP',true);
  scenario:=public.supplier_scenario_save(pg_temp.id(1),draft,'SUP',true,gen_random_uuid(),report->>'fingerprint');
  report:=public.delivery_scenario_preview(pg_temp.id(1),scenario,'2026-10-10',true);
  delivery:=public.delivery_scenario_save(pg_temp.id(1),scenario,'2026-10-10',true,gen_random_uuid(),report->>'fingerprint');
  report:=public.purchase_cost_preview(pg_temp.id(1),delivery,true);
  estimate:=public.purchase_cost_save(pg_temp.id(1),delivery,true,gen_random_uuid(),report->>'fingerprint');
  proposal:=public.purchase_proposal_submit(pg_temp.id(1),estimate,gen_random_uuid(),'Reason');
  perform pg_temp.login(14,1);
  perform public.purchase_proposal_decide(pg_temp.id(1),proposal,gen_random_uuid(),'approved','Independent review');
  perform pg_temp.login(10,1);
  return public.purchase_handoff_create(pg_temp.id(1),proposal);
end; $$;
create temporary table lines(n integer,id uuid,original jsonb);
insert into lines values(0,(select handoff_id from fixture),null),(1,pg_temp.line(1,'KG',5),null),(2,pg_temp.line(2),null),(3,pg_temp.line(3,'EA',3,true),null);
update lines set original=h.payload from public.purchase_handoffs h where h.id=lines.id;
grant select,update on lines to authenticated;
create function pg_temp.ids(ns integer[] default array[0,1]) returns uuid[] language sql as $$select array_agg(id order by n) from lines where n=any(ns)$$;
create function pg_temp.batch(ns integer[] default array[0,1]) returns uuid language sql as $$select public.purchase_handoff_batch_create(pg_temp.id(1),pg_temp.ids(ns))$$;
create temporary table batches(id uuid,payload jsonb);
grant all on batches to authenticated;
set local role authenticated;
select is((public.purchase_handoff_batch_preview(pg_temp.id(1),pg_temp.ids())#>>'{summary,subtotal}')::numeric,30.15::numeric,'sum saved rounded costs across differing units');
insert into batches(id) select pg_temp.batch();
update batches set payload=(select payload from public.purchase_handoff_batches where id=batches.id);
select is(public.purchase_handoff_batch_create(pg_temp.id(1),array[(select id from lines where n=1),(select id from lines where n=0)]),(select id from batches),'set identity ignores input order');
select is((select handoff_ids from public.purchase_handoff_batches),(select array_agg(id order by id) from lines where n in(0,1)),'stored IDs canonical');
select is((select payload->'lines' from batches),(select jsonb_agg(original order by id) from lines where n in(0,1)),'complete exact source payloads preserved');
select is((select count(distinct value#>>'{estimate,source,receipt_date}') from batches,jsonb_array_elements(payload->'lines')),2::bigint,'different receipt dates retained');
select is((select count(distinct value#>>'{estimate,source,unit}') from batches,jsonb_array_elements(payload->'lines')),2::bigint,'different units retained without pooling quantities');
select throws_ok($$select public.purchase_handoff_batch_create(pg_temp.id(1),null)$$,'MQ422',null,'null selection');
select throws_ok($$select public.purchase_handoff_batch_create(pg_temp.id(1),'{}')$$,'MQ422',null,'empty selection');
select throws_ok($$select public.purchase_handoff_batch_create(pg_temp.id(1),array[null::uuid])$$,'MQ422',null,'null member');
select throws_ok($$select public.purchase_handoff_batch_create(pg_temp.id(1),array[[pg_temp.id(9)]])$$,'MQ422',null,'multidimensional selection');
select throws_ok($$select public.purchase_handoff_batch_create(pg_temp.id(1),array[(select id from lines where n=0),(select id from lines where n=0)])$$,'MQ422',null,'repeated handoff');
select throws_ok($$select public.purchase_handoff_batch_create(pg_temp.id(1),array_fill(pg_temp.id(9),array[51]))$$,'MQ422',null,'51 exceeds bound');
select throws_ok($$select public.purchase_handoff_batch_create(pg_temp.id(1),array[pg_temp.id(999)])$$,'MQ404',null,'unknown handoff');
select throws_ok($$select pg_temp.batch(array[0,3])$$,'MQ422',null,'same item from different drafts refused');
select throws_ok($$insert into public.purchase_handoff_batches select * from public.purchase_handoff_batches$$,'42501',null,'direct insertion denied');
select throws_ok($$update public.purchase_handoff_batches set payload='{}'$$,'42501',null,'direct edit denied');
select throws_ok($$delete from public.purchase_handoff_batches$$,'42501',null,'direct deletion denied');
select lives_ok($$select pg_temp.batch(array[1,2])$$,'overlapping batch allowed');
select is((select overlap_count from public.purchase_handoff_batch_list where id=(select id from batches)),1::bigint,'overlap visible on original');
select is((select batch_count from public.purchase_handoff_batch_candidates where id=(select id from lines where n=1)),2::bigint,'line use count visible');
select pg_temp.login(11,1);
select is((select count(*) from public.purchase_handoff_batches),2::bigint,'viewer reads batches');
select throws_ok($$select pg_temp.batch()$$,'MQ403',null,'viewer cannot save or replay');
select throws_ok($$select public.purchase_handoff_batch_preview(pg_temp.id(1),pg_temp.ids())$$,'MQ403',null,'viewer cannot preview new selection');
select pg_temp.login(12,1);
select is((select count(*) from public.purchase_handoff_batches),0::bigint,'branch hides other location');
select is((select count(*) from public.purchase_handoff_batch_list),0::bigint,'branch list scoped');
select is((select count(*) from public.purchase_handoff_batch_candidates),0::bigint,'branch candidates scoped');
select pg_temp.login(13,2);
select is((select count(*) from public.purchase_handoff_batches),0::bigint,'other tenant hidden');
select throws_ok($$select public.purchase_handoff_batch_create(pg_temp.id(2),pg_temp.ids())$$,'MQ404',null,'foreign IDs inaccessible');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1);
set local role authenticated;
select is((select count(*) from public.purchase_handoff_batch_list),2::bigint,'assigned branch sees batch context');
reset role;
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='purchase_handoff_batches'),2::bigint,'one audit per batch including retries');
select pg_temp.login(10,1);

-- Fail-closed saved evidence validation, without changing an original exported batch.
create function pg_temp.invalid(path text[],value jsonb,expected text) returns text language plpgsql as $$
declare result text;
begin
  update public.purchase_handoffs set payload=jsonb_set(payload,path,value) where id=(select id from lines where n=2);
  begin perform pg_temp.batch(array[0,2]); result:='unexpected success';
  exception when others then result:=sqlstate; end;
  update public.purchase_handoffs h set payload=l.original from lines l where h.id=l.id and l.n=2;
  return result;
end; $$;
select is(pg_temp.invalid('{estimate,source,order_date}','"2026-10-11"','MQ422'),'MQ422','mixed order dates');
select is(pg_temp.invalid('{estimate,source,supplier_id}',to_jsonb(pg_temp.id(999)::text),'MQ422'),'MQ422','mixed supplier identities');
select is(pg_temp.invalid('{estimate,location_id}',to_jsonb(pg_temp.id(21)::text),'MQ422'),'MQ422','mixed receiving locations');
select is(pg_temp.invalid('{estimate,price,currency}','"KWD"','MQ422'),'MQ422','mixed currencies');
select is(pg_temp.invalid('{estimate,price,minor_units}','3','MQ422'),'MQ422','mixed currency precision');
select is(pg_temp.invalid('{estimate,source,policy_recalculation_required}','true','MQ422'),'MQ422','policy warning');
select is(pg_temp.invalid('{estimate,source,policy_recalculation_required}','null','MQ422'),'MQ422','unknown policy compatibility');
select is(pg_temp.invalid('{estimate,source,unit}','null','MQ422'),'MQ422','missing unit');
select is((select count(*) from public.purchase_handoff_batches where organization_id=pg_temp.id(1)),2::bigint,'failed validation leaves no partial batches');

update public.supplier_items set unit_price=2 where item_id=pg_temp.id(10002);
set local role authenticated;
select throws_ok($$select pg_temp.batch(array[0,2])$$,'MQ409',null,'changed price blocks entire new set');
select is(pg_temp.batch(array[1,2]),(select id from public.purchase_handoff_batches where id<>(select id from batches)),'existing set retry keeps history despite changed price');
reset role;
-- A later approved revision changes context, not exports.
set local role authenticated;
update fixture set proposal_id=pg_temp.propose(902);
select pg_temp.login(14,1);
select pg_temp.decide('approved',952);
select pg_temp.login(10,1);
select throws_ok($$select pg_temp.batch(array[0,2])$$,'MQ409',null,'historical approval blocks new set');
select is(pg_temp.batch(),(select id from batches),'historical exact set retry');
select ok(not (select selected from public.purchase_handoff_batch_list where id=(select id from batches)),'historical context explicit');
select is((select payload from public.purchase_handoff_batches where id=(select id from batches)),(select payload from batches),'saved content unchanged');
reset role;
-- No transaction rows are introduced by the feature.
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),5::bigint,'no inbound written');
select is((select count(*) from public.receipts where organization_id=pg_temp.id(1)),1::bigint,'no receipts written');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),4::bigint,'no stock written after fixtures');
select ok(not has_table_privilege('anon','public.purchase_handoff_batches','SELECT'),'anonymous cannot read');
select ok(not has_table_privilege('service_role','public.purchase_handoff_batches','SELECT'),'service role cannot read');
select ok(not has_table_privilege('zeespare_worker','public.purchase_handoff_batches','SELECT'),'worker cannot read');
select ok(not has_function_privilege('anon','public.purchase_handoff_batch_create(uuid,uuid[])','EXECUTE'),'anonymous cannot create');
select ok(not has_function_privilege('service_role','public.purchase_handoff_batch_create(uuid,uuid[])','EXECUTE'),'service cannot create');
select ok(not has_function_privilege('zeespare_worker','public.purchase_handoff_batch_create(uuid,uuid[])','EXECUTE'),'worker cannot create');
-- The full 50-line batch must fit the authenticated statement budget. Fixture setup is privileged/local.
insert into lines(n,id) select n,pg_temp.line(n) from generate_series(10,59) n;
set local role authenticated;
set local statement_timeout='8s';
select lives_ok($$select public.purchase_handoff_batch_create(pg_temp.id(1),(select array_agg(id) from lines where n between 10 and 59))$$,'50 real lines save within statement budget');
select is((select (payload#>>'{summary,subtotal}')::numeric from public.purchase_handoff_batches where cardinality(handoff_ids)=50),904.50::numeric,'50-line sum exact');
reset statement_timeout;
reset role;
select * from finish();
rollback;
