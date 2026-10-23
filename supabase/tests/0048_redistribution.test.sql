begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a8000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'redistribution-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'redistribution-a','Redistribution A'),(pg_temp.id(2),'redistribution-b','Redistribution B');
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
create function pg_temp.preview(backorders text default '4.125',confirmed boolean default true,lane_confirmed boolean default true,basis text default 'calculated',override_id uuid default null,source_id uuid default pg_temp.id(51))
returns jsonb language sql as $$select public.redistribution_preview(pg_temp.id(1),(select draft_id from captured),source_id,basis,override_id,backorders,confirmed,lane_confirmed)$$;
create function pg_temp.save(request integer default 400,fingerprint text default null,backorders text default '4.125')
returns uuid language sql as $$select public.redistribution_save(pg_temp.id(1),(select draft_id from captured),pg_temp.id(51),'calculated',null,backorders,true,true,pg_temp.id(request),coalesce(fingerprint,pg_temp.preview(backorders)->>'fingerprint'))$$;
set local role authenticated;
select is(pg_temp.preview()->>'status','available','known matching units and exact cutoff are available');
select is((pg_temp.preview()->>'source_surplus')::numeric,8.750::numeric,'source surplus is hand-calculated exactly; future snapshot and source inbound excluded');
select is((pg_temp.preview()->'destination'->>'gap')::numeric,12::numeric,'destination retains its saved inbound and additional backorders');
select is((pg_temp.preview()->>'quantity')::numeric,8.750::numeric,'transfer bounded by source surplus');
select is((pg_temp.preview('0')->>'quantity')::numeric,12::numeric,'transfer bounded by destination gap');
select is((pg_temp.preview('999999999999999.999')->>'quantity')::numeric,0::numeric,'source deficit floors at zero without overflow');
select is((pg_temp.preview('4.125',true,true,'approved',pg_temp.id(61))->>'quantity')::numeric,7.750::numeric,'specific approved maximum applied');
select is((pg_temp.preview('4.125',true,true,'approved',pg_temp.id(62))->>'quantity')::numeric,6.750::numeric,'newer revision used only when selected');
select is(pg_temp.preview()->'destination'->'orders'->0->>'overdue','true','destination overdue warning retained');
select is(pg_temp.preview()->'destination'->'orders'->1->>'late','true','destination late warning retained');
select is(pg_temp.preview('0',false)->>'status','commitments_unconfirmed','source commitments require confirmation');
select is(pg_temp.preview('0',true,false)->>'status','lane_unconfirmed','lane applicability requires confirmation');
select is(pg_temp.preview('0',false)->>'quantity',null,'missing confirmation is not zero');
select throws_ok($$select pg_temp.preview(null)$$,'MQ422',null,'backorders cannot default to zero');
select throws_ok($$select pg_temp.preview('-1')$$,'MQ422',null,'negative backorders rejected');
select throws_ok($$select pg_temp.preview('1.0001')$$,'MQ422',null,'four decimal places rejected');
select throws_ok($$select pg_temp.preview('NaN')$$,'MQ422',null,'nonfinite value rejected');
select throws_ok($$select pg_temp.preview('0',null)$$,'MQ422',null,'null confirmation rejected');
select throws_ok($$select pg_temp.preview('0',true,true,'approved')$$,'MQ422',null,'approved revision must be explicit');
select throws_ok($$select pg_temp.preview('0',true,true,'calculated',pg_temp.id(61))$$,'MQ422',null,'calculated selection cannot carry an override');
select throws_ok($$select pg_temp.preview('0',true,true,'approved',pg_temp.id(999))$$,'MQ404',null,'unknown approved revision rejected');
select pg_temp.login(11);
select is(pg_temp.preview()->>'status','available','viewer can preview');
select throws_ok($$select pg_temp.save()$$,'MQ403',null,'viewer cannot save');
select pg_temp.login(16);
select throws_ok($$select pg_temp.save()$$,'MQ403',null,'approver cannot save');
select pg_temp.login(12);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'destination access alone cannot expose source');
select is((select count(*) from public.redistribution_source_options where organization_id=pg_temp.id(1)),0::bigint,'candidate picker does not expose hidden source');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12);
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'source access alone cannot expose destination');
select is((select count(*) from public.redistribution_source_options where organization_id=pg_temp.id(1)),0::bigint,'candidate picker requires destination access too');
select pg_temp.login(13,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'tenant isolation');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404',null,'active organization claim isolates preview');
select pg_temp.login(14);
update captured set report=pg_temp.preview(),id=pg_temp.save();
select is(pg_temp.save(),(select id from captured),'planner retry returns one saved record');
select is((select report from public.redistribution_drafts where id=(select id from captured)),(select report from captured),'saved evidence exactly matches preview');
select is((select count(*) from public.redistribution_draft_list where organization_id=pg_temp.id(1)),1::bigint,'one saved list row');
select throws_ok($$select pg_temp.save(400,null,'5')$$,'MQ409',null,'conflicting request content rejected');
select throws_ok($$update public.redistribution_drafts set report='{}'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.redistribution_drafts$$,'42501',null,'direct delete denied');
select throws_ok($$insert into public.redistribution_drafts default values$$,'42501',null,'direct insert denied');
select pg_temp.login(10);
select throws_ok($$select pg_temp.save()$$,'MQ409',null,'another author cannot replay request');
select pg_temp.login(11);
select is((select count(*) from public.redistribution_drafts where organization_id=pg_temp.id(1)),1::bigint,'viewer reads saved evidence');
select pg_temp.login(12);
select is((select count(*) from public.redistribution_drafts where organization_id=pg_temp.id(1)),0::bigint,'source-only member cannot read saved evidence');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12);
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*) from public.redistribution_draft_list where organization_id=pg_temp.id(1)),0::bigint,'destination-only member cannot count saved evidence');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
set local role authenticated;
select is((select count(*) from public.redistribution_drafts where organization_id=pg_temp.id(1)),1::bigint,'member assigned both locations reads saved evidence');
select is(pg_temp.preview()->>'status','available','member assigned both locations previews');
select is((select count(*) from public.redistribution_source_options where organization_id=pg_temp.id(1)),1::bigint,'both endpoints expose candidate');
select throws_ok($$select pg_temp.save(401)$$,'MQ403',null,'branch member remains read-only');
select pg_temp.login(13,2);
select is((select count(*) from public.redistribution_drafts where organization_id=pg_temp.id(1)),0::bigint,'cross-tenant saved rows hidden');
select pg_temp.login(10,2);
select is((select count(*) from public.redistribution_drafts where organization_id=pg_temp.id(1)),0::bigint,'active claim hides saved rows');
reset role;
select pg_temp.login(14);
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='redistribution_drafts'),1::bigint,'one save audit');
update public.stock_snapshots set quantity=36 where organization_id=pg_temp.id(1) and location_id=pg_temp.id(21) and snapshot_date='2026-10-10';
select throws_ok($$select pg_temp.save(401,(select report->>'fingerprint' from captured))$$,'MQ409',null,'changed stock invalidates new save');
select is(pg_temp.save(400,(select report->>'fingerprint' from captured)),(select id from captured),'retry after stock change retains original evidence');
update public.stock_snapshots set quantity=35.125 where organization_id=pg_temp.id(1) and location_id=pg_temp.id(21) and snapshot_date='2026-10-10';
update public.network_links set lead_time_days_p90=5 where id=pg_temp.id(90);
select throws_ok($$select pg_temp.save(401,(select report->>'fingerprint' from captured))$$,'MQ409',null,'changed lane invalidates new save');
select is(pg_temp.save(400,(select report->>'fingerprint' from captured)),(select id from captured),'retry after lane change retains original');
select is((select report from public.redistribution_drafts where id=(select id from captured)),(select report from captured),'saved evidence is immutable after feed changes');
update public.network_links set is_active=false where id=pg_temp.id(90);
select is(pg_temp.preview()->>'status','lane_inactive','inactive lane unavailable');
select throws_ok($$select pg_temp.save(401)$$,'MQ422',null,'unavailable quantity cannot be saved');
update public.network_links set is_active=true,from_location_id=pg_temp.id(20),to_location_id=pg_temp.id(21) where id=pg_temp.id(90);
select is(pg_temp.preview()->>'status','lane_missing','reverse lane does not authorize transfer');
update public.network_links set from_location_id=pg_temp.id(21),to_location_id=pg_temp.id(20) where id=pg_temp.id(90);
update public.stock_snapshots set snapshot_date='2026-10-09' where organization_id=pg_temp.id(1) and location_id=pg_temp.id(21) and snapshot_date='2026-10-10';
select is(pg_temp.preview()->>'status','stock_date_mismatch','one-day-old source stock is unavailable');
update public.stock_snapshots set snapshot_date='2026-10-10',unit_of_measure=null where organization_id=pg_temp.id(1) and location_id=pg_temp.id(21) and snapshot_date='2026-10-09';
select is(pg_temp.preview()->'source_policy'->>'status','stock_unit_unknown','unknown source stock units explained');
select is(pg_temp.preview()->>'quantity',null,'unknown source units are not zero');
update public.stock_snapshots set unit_of_measure='KG' where organization_id=pg_temp.id(1) and location_id=pg_temp.id(21) and snapshot_date='2026-10-10';
select is(pg_temp.preview()->>'status','source_unavailable','mismatched source stock units unavailable');
update public.stock_snapshots set unit_of_measure='EA' where organization_id=pg_temp.id(1) and location_id=pg_temp.id(21) and snapshot_date='2026-10-10';
update public.inventory_policies set unit='SET',evidence=jsonb_set(jsonb_set(evidence,'{forecast,source,unit_provenance,unit}','"SET"'),'{forecast,source,unit_provenance,units}','["SET"]') where id=pg_temp.id(51);
update public.stock_snapshots set unit_of_measure='SET' where organization_id=pg_temp.id(1) and location_id=pg_temp.id(21) and snapshot_date='2026-10-10';
select is(pg_temp.preview()->>'status','unit_mismatch','known source and destination units must match');
update public.inventory_policies set unit='EA',evidence=jsonb_set(jsonb_set(evidence,'{forecast,source,unit_provenance,unit}','"EA"'),'{forecast,source,unit_provenance,units}','["EA"]') where id=pg_temp.id(51);
update public.stock_snapshots set unit_of_measure='EA' where organization_id=pg_temp.id(1) and location_id=pg_temp.id(21) and snapshot_date='2026-10-10';
update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,to_date}','"2026-10-09"') where id=pg_temp.id(51);
select is(pg_temp.preview()->>'status','cutoff_mismatch','different policy cutoffs unavailable');
update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,to_date}','"2026-10-10"'),item_id=pg_temp.id(101) where id=pg_temp.id(51);
select is(pg_temp.preview()->>'status','item_mismatch','different item identity unavailable');
update public.inventory_policies set item_id=pg_temp.id(100),evidence=jsonb_set(evidence,'{forecast,method}','"regional-v1"') where id=pg_temp.id(51);
select is(pg_temp.preview()->>'status','prepared_group','source prepared group unavailable');
update public.inventory_policies set evidence=jsonb_set(evidence,'{forecast,method}','"baseline-v1"') where id=pg_temp.id(51);
select is(pg_temp.preview('0',true,true,'calculated',null,pg_temp.id(50))->>'status','same_location','self transfer unavailable');
select throws_ok($$select pg_temp.preview('0',true,true,'calculated',null,pg_temp.id(53))$$,'MQ404',null,'cross-tenant source denied even through definer context');
-- Saved destination quantities remain fixed when the current destination feed changes.
update public.stock_snapshots set quantity=999 where organization_id=pg_temp.id(1) and location_id=pg_temp.id(20);
select is((pg_temp.preview()->'destination'->>'gap')::numeric,12::numeric,'destination gap stays as saved');
update public.replenishment_drafts set report=jsonb_set(report,'{gap}','"0"') where id=(select draft_id from captured);
select is((pg_temp.preview()->>'quantity')::numeric,0::numeric,'zero saved destination gap yields zero transfer');
update public.replenishment_drafts set report=jsonb_set(report,'{status}','"orders_unconfirmed"') where id=(select draft_id from captured);
select is(pg_temp.preview()->>'status','destination_unavailable','unavailable destination blocked');
select is((select sum(quantity) from public.open_orders where organization_id=pg_temp.id(1)),1001::numeric,'draft creates no inbound');
select is((select count(*) from public.receipts where organization_id=pg_temp.id(1)),0::bigint,'draft creates no receipts');
select is((select count(*) from public.redistribution_drafts where organization_id=pg_temp.id(1)),1::bigint,'all failed saves created nothing');
set local role anon;
select throws_ok($$select pg_temp.preview()$$,'42501',null,'anonymous has no preview capability');
set local role service_role;
select throws_ok($$select pg_temp.preview()$$,'42501',null,'integration service has no preview capability');
reset role;
select ok(not has_function_privilege('zeespare_worker','public.redistribution_preview(uuid,uuid,uuid,text,uuid,text,boolean,boolean)','EXECUTE'),'worker has no preview capability');
select ok(not has_function_privilege('zeespare_worker','public.redistribution_save(uuid,uuid,uuid,text,uuid,text,boolean,boolean,uuid,text)','EXECUTE'),'worker has no save capability');
select * from finish();
rollback;
