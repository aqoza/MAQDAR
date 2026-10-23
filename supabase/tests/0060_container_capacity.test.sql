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
create temporary table capacity_batch(id uuid);
insert into capacity_batch select public.purchase_handoff_batch_create(pg_temp.id(1),array[(select handoff_id from fixture),pg_temp.line(1,'KG',5)]);
grant select on capacity_batch to authenticated;
create function pg_temp.cp(volume text default '10',payload text default '100',confirmed boolean default true) returns jsonb language sql as $$
select public.container_capacity_preview(pg_temp.id(1),(select id from capacity_batch),volume,payload,confirmed)$$;
create function pg_temp.cs(request integer default 6000,fingerprint text default null,volume text default '10',payload text default '100',confirmed boolean default true) returns uuid language sql as $$
select public.container_capacity_save(pg_temp.id(1),(select id from capacity_batch),volume,payload,confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.cp(volume,payload,confirmed)->>'fingerprint'))$$;
set local role authenticated;
select is(pg_temp.cp()->>'status','unavailable','legacy measurements remain unknown');
select is(pg_temp.cp()->'totals','null'::jsonb,'missing evidence never gives partial totals');
select throws_ok($$select pg_temp.cs()$$,'MQ422',null,'unavailable result cannot save');
update public.supplier_items set shipping_weight_kg=case when item_id=pg_temp.id(100) then 2.5 else 1.25 end,
 shipping_volume_m3=case when item_id=pg_temp.id(100) then 0.000001 else 0.2 end, shipping_valid_from='2026-10-10' where organization_id=pg_temp.id(1);
select is(pg_temp.cp()->>'status','available','matching supplied measurements qualify');
select is((pg_temp.cp()#>>'{totals,weight_kg}')::numeric,52.5::numeric,'mixed purchase units multiply separately to kg');
select is((pg_temp.cp()#>>'{totals,volume_m3}')::numeric,3.600012::numeric,'micro-volume precision retained without pack multiplication');
select is(pg_temp.cp()#>>'{totals,within_limits}','true','both limits respected');
select is(pg_temp.cp('3.6')#>>'{totals,within_limits}','false','tiny overage is not hidden by percentage rounding');
select is(pg_temp.cp('3.6')#>>'{totals,volume_utilization_pct}','100.00','utilization rounded for display only');
select is((pg_temp.cp('3.6')#>>'{totals,volume_over_m3}')::numeric,0.000012::numeric,'exact excess retained');
select is(pg_temp.cp('3.600012','52.5')#>>'{totals,within_limits}','true','equal capacity is within limits');
select is((pg_temp.cp('10','50')#>>'{totals,weight_over_kg}')::numeric,2.5::numeric,'weight-only overage shown');
select is(pg_temp.cp('10','100',false)->>'status','unavailable','confirmation required');
select throws_ok($$select pg_temp.cp('0')$$,'MQ422',null,'zero limit rejected');
select throws_ok($$select pg_temp.cp('-1')$$,'MQ422',null,'negative limit rejected');
select throws_ok($$select pg_temp.cp('NaN')$$,'MQ422',null,'nonfinite limit rejected');
select throws_ok($$select pg_temp.cp('1e3')$$,'MQ422',null,'exponent limit rejected');
select throws_ok($$select pg_temp.cp('0.0000001')$$,'MQ422',null,'excess decimal places rejected');
select throws_ok($$select pg_temp.cp('1000000000')$$,'MQ422',null,'limit bound rejected');
select lives_ok($$select pg_temp.cp('0.000001','999999999.999999')$$,'supported extremes accepted');
reset role;
create temporary table saved_capacity(id uuid,report jsonb);
grant all on saved_capacity to authenticated;
create temporary table untouched as select
 (select jsonb_agg(to_jsonb(s) order by id) from public.stock_snapshots s) stock,
 (select jsonb_agg(to_jsonb(o) order by id) from public.open_orders o) orders,
 (select jsonb_agg(to_jsonb(b) order by id) from public.purchase_handoff_batches b) batches;
set local role authenticated;
insert into saved_capacity select pg_temp.cs(),pg_temp.cp();
select is(pg_temp.cs(),(select id from saved_capacity),'identical retry returns original');
select is(pg_temp.cs(6000,(select report->>'fingerprint' from saved_capacity),'10.000','100.0'),(select id from saved_capacity),'equivalent decimal inputs preserve retry identity');
select throws_ok($$select pg_temp.cs(6000,null,'11')$$,'MQ409',null,'request reuse with different inputs conflicts');
select lives_ok($$select pg_temp.cs(6001,null,'3.6','50')$$,'over-capacity scenario can be saved for inspection');
select is((select count(*) from public.audit_log where table_name='container_capacity_scenarios' and organization_id=pg_temp.id(1)),2::bigint,'one audit per new save, none for retry');
select throws_ok($$insert into public.container_capacity_scenarios select * from public.container_capacity_scenarios$$,'42501',null,'direct inserts refused');
select throws_ok($$update public.container_capacity_scenarios set report='{}'$$,'42501',null,'direct updates refused');
select throws_ok($$delete from public.container_capacity_scenarios$$,'42501',null,'direct deletes refused');
update public.supplier_items set shipping_weight_kg=3 where id=pg_temp.id(130);
select throws_ok($$select pg_temp.cs(6002,(select report->>'fingerprint' from saved_capacity))$$,'MQ409',null,'changed measurements require refresh');
select is(pg_temp.cs(6000,(select report->>'fingerprint' from saved_capacity)),(select id from saved_capacity),'retry preserves old measurements');
update public.supplier_items set shipping_volume_m3=null where id=pg_temp.id(130);
select is(pg_temp.cp()->>'status','unavailable','one missing volume blocks complete totals');
select is(pg_temp.cp()->'totals','null'::jsonb,'no partial total');
update public.supplier_items set shipping_volume_m3=0.000001,unit_of_measure=null where id=pg_temp.id(130);
select ok(exists(select 1 from jsonb_array_elements(pg_temp.cp()->'lines') l where l->>'status'='unit_unknown'),'unknown unit never inherits catalog');
update public.supplier_items set unit_of_measure='SET' where id=pg_temp.id(130);
select ok(exists(select 1 from jsonb_array_elements(pg_temp.cp()->'lines') l where l->>'status'='unit_mismatch'),'different unit never converts');
update public.supplier_items set unit_of_measure='EA',shipping_valid_from=null where id=pg_temp.id(130);
select ok(exists(select 1 from jsonb_array_elements(pg_temp.cp()->'lines') l where l->>'status'='date_unknown'),'separate effective date required');
update public.supplier_items set shipping_valid_from='2026-10-11' where id=pg_temp.id(130);
select ok(exists(select 1 from jsonb_array_elements(pg_temp.cp()->'lines') l where l->>'status'='not_effective'),'date after order rejected');
update public.supplier_items set shipping_valid_from='2026-10-10' where id=pg_temp.id(130);
select throws_ok($$update public.supplier_items set shipping_weight_kg=0 where id=pg_temp.id(130)$$,'23514',null,'zero measurements not free capacity');
select throws_ok($$update public.supplier_items set shipping_volume_m3='NaN' where id=pg_temp.id(130)$$,'23514',null,'NaN not stored');
select pg_temp.login(11,1);
select is((select count(*) from public.container_capacity_scenarios),2::bigint,'viewer sees history');
select is(pg_temp.cp()->>'status','available','viewer can inspect preview');
select throws_ok($$select pg_temp.cs()$$,'MQ403',null,'viewer cannot save or retry');
select pg_temp.login(12,1);
select is((select count(*) from public.container_capacity_scenarios),0::bigint,'branch cannot see unassigned history');
select throws_ok($$select pg_temp.cp()$$,'MQ404',null,'branch cannot preview foreign receiving location');
select pg_temp.login(13,2);
select is((select count(*) from public.container_capacity_scenarios),0::bigint,'other tenant history hidden');
select throws_ok($$select pg_temp.cp()$$,'MQ404',null,'other tenant preview hidden');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.cs()$$,'MQ404',null,'active organization claim narrows writes');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1);
set local role authenticated;
select is((select count(*) from public.container_capacity_scenarios),2::bigint,'assigned branch can read history');
select is(pg_temp.cp()->>'status','available','assigned branch can preview');
reset role;
select pg_temp.login(10,1);
-- Supersede a selected proposal; historical scenarios and idempotent retries survive.
update public.supplier_items set shipping_weight_kg=2.5 where id=pg_temp.id(130);
update fixture set proposal_id=pg_temp.propose(901);
select pg_temp.login(14,1);
select pg_temp.decide('approved',951);
select pg_temp.login(10,1);
set local role authenticated;
select is(pg_temp.cp()->>'selected','false','new selection marks source historical');
select is(pg_temp.cp()->>'status','unavailable','historical line blocks new saves');
select throws_ok($$select pg_temp.cs(6003)$$,'MQ422',null,'cannot save historical batch');
select is(pg_temp.cs(6000,(select report->>'fingerprint' from saved_capacity)),(select id from saved_capacity),'historical retry returns original');
select is((select report from public.container_capacity_scenarios where id=(select id from saved_capacity)),(select report from saved_capacity),'history remains immutable');
reset role;
select is((select jsonb_agg(to_jsonb(s) order by id) from public.stock_snapshots s),(select stock from untouched),'no stock changed');
select is((select jsonb_agg(to_jsonb(o) order by id) from public.open_orders o),(select orders from untouched),'no inbound changed');
select is((select jsonb_agg(to_jsonb(b) order by id) from public.purchase_handoff_batches b),(select batches from untouched),'source batches unchanged');
set local role anon;
select throws_ok($$select pg_temp.cp()$$,'42501',null,'anonymous preview denied');
set local role service_role;
select throws_ok($$select pg_temp.cp()$$,'42501',null,'integration keys cannot access capacity RPC');
reset role;
insert into public.api_keys(organization_id,name,display_prefix,last4,key_hash,scopes,created_by,expires_at)
values(pg_temp.id(1),'Capacity','zeespare_sk_abcd','abcd',decode(repeat('ac',32),'hex'),array['master_data:read','master_data:write'],pg_temp.id(10),now()+interval '1 day');
create function pg_temp.upsert(record jsonb) returns jsonb language sql as $$select public.api_upsert(decode(repeat('ac',32),'hex'),'supplier_items',jsonb_build_object('records',jsonb_build_array(record)),gen_random_uuid())$$;
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","shipping_weight_kg":"0.123456","shipping_volume_m3":"0.000001","shipping_valid_from":"2026-10-10"}')->>'result','succeeded','API merges shipping-only inputs');
select is((select r->>'shipping_weight_kg' from jsonb_array_elements((public.api_list(decode(repeat('ac',32),'hex'),'supplier_items'))::jsonb->'data') r where r->>'item_code'='ITEM'),'0.123456','API returns exact measurement text');
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","shipping_volume_m3":"0.0000001"}')->>'result','invalid','API refuses excessive scale');
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","shipping_weight_kg":"0"}')->>'result','invalid','API refuses zero');
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","supplier_part_number":"same"}')->>'result','succeeded','unrelated API patch works');
reset role;
select is((select shipping_valid_from from public.supplier_items where id=pg_temp.id(130)),date '2026-10-10','unrelated patch preserves measurement provenance');
set local role service_role;
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","shipping_weight_kg":"2"}')->>'result','succeeded','measurement patch works');
reset role;
select is((select shipping_valid_from from public.supplier_items where id=pg_temp.id(130)),null,'changed measurement without date clears date');
set local role service_role;
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"ITEM","unit_of_measure":"KG"}')->>'result','succeeded','unit patch works');
reset role;
select is((select shipping_weight_kg from public.supplier_items where id=pg_temp.id(130)),null,'changed unit invalidates absent measurements');
select is((select shipping_volume_m3 from public.supplier_items where id=pg_temp.id(130)),null,'changed unit clears both dimensions');
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
values(pg_temp.id(9999),pg_temp.id(1),'NEW-MEASURED','New measured item','Test','EA',1,'SAR');
set local role service_role;
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"NEW-MEASURED","lead_time_days":3,"unit_price":"1","currency":"SAR","unit_of_measure":"EA","shipping_weight_kg":"2.123456","shipping_volume_m3":"0.000001","shipping_valid_from":"2026-10-10"}')->>'result','succeeded','API creates supplier item with shipping evidence');
select is((select r->>'shipping_volume_m3' from jsonb_array_elements((public.api_list(decode(repeat('ac',32),'hex'),'supplier_items'))::jsonb->'data') r where r->>'item_code'='NEW-MEASURED'),'0.000001','new supplier item retains six-decimal volume');
select is(pg_temp.upsert('{"supplier_code":"SUP","item_code":"NEW-MEASURED","shipping_volume_m3":null}')->>'result','succeeded','API explicitly clears measurements');
reset role;
select is((select shipping_volume_m3 from public.supplier_items where item_id=pg_temp.id(9999)),null,'explicit null clears measurement');
select is((select shipping_valid_from from public.supplier_items where item_id=pg_temp.id(9999)),null,'cleared measurement also invalidates omitted date');
select is(app.api_record_type_drift(),null,'new API output matches contract');
select * from finish();
rollback;
