begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a8200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'transfer-dates-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'transfer-dates-a','Transfer Dates A'),(pg_temp.id(2),'transfer-dates-b','Transfer Dates B');
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
update captured set id=public.redistribution_save(pg_temp.id(1),draft_id,pg_temp.id(51),'calculated',null,'4.125',true,true,pg_temp.id(301),
  public.redistribution_preview(pg_temp.id(1),draft_id,pg_temp.id(51),'calculated',null,'4.125',true,true)->>'fingerprint');
reset role;
insert into public.work_calendars(id,organization_id,code,name_en,country_code,weekend_days,observe_public_holidays) values
 (pg_temp.id(500),pg_temp.id(1),'SOURCE','Synthetic source','SA',array[5,6]::smallint[],false),
 (pg_temp.id(501),pg_temp.id(1),'RECEIVER','Synthetic receiver','SA',array[5,6]::smallint[],false);
update public.locations set work_calendar_id=pg_temp.id(case when id=pg_temp.id(21) then 500 else 501 end) where organization_id=pg_temp.id(1);
insert into public.holiday_overrides(id,organization_id,work_calendar_id,starts_on,ends_on,kind,name_en) values
 (pg_temp.id(510),pg_temp.id(1),pg_temp.id(501),'2026-10-13','2026-10-13','closure','Receiving closure'),
 (pg_temp.id(511),pg_temp.id(1),pg_temp.id(501),'2026-10-15','2026-10-15','closure','Receiving closure');
create function pg_temp.preview(requested date default '2026-10-10',confirmed boolean default true)
returns jsonb language sql as $$select public.transfer_date_preview(pg_temp.id(1),(select id from captured),requested,confirmed)$$;
create function pg_temp.save(request integer default 600,fingerprint text default null,requested date default '2026-10-10',confirmed boolean default true)
returns uuid language sql as $$select public.transfer_date_save(pg_temp.id(1),(select id from captured),requested,confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.preview(requested,confirmed)->>'fingerprint'))$$;
create temporary table saved_dates(id uuid,report jsonb);
grant all on saved_dates to authenticated;
set local role authenticated;
insert into saved_dates(id,report) select pg_temp.save(),pg_temp.preview();
reset role;
update public.network_links set freight_basis='per_unit',freight_cost=1.234,currency='SAR',freight_unit='EA',freight_valid_from='2026-10-11' where id=pg_temp.id(90);
create function pg_temp.fp(confirmed boolean default true) returns jsonb language sql as $$select public.transfer_freight_preview(pg_temp.id(1),(select id from saved_dates),confirmed)$$;
create function pg_temp.fs(request integer default 900,fingerprint text default null,confirmed boolean default true) returns uuid language sql as $$select public.transfer_freight_save(pg_temp.id(1),(select id from saved_dates),confirmed,pg_temp.id(request),coalesce(fingerprint,pg_temp.fp(confirmed)->>'fingerprint'))$$;
create temporary table saved_freight(id uuid,report jsonb);
grant all on saved_freight to authenticated;
set local role authenticated;
insert into saved_freight select pg_temp.fs(),pg_temp.fp();
create function pg_temp.submit(request integer default 1000,reason text default ' Transfer rationale ',estimate uuid default null)
returns uuid language sql as $$select public.transfer_proposal_submit(pg_temp.id(1),coalesce(estimate,(select id from saved_freight)),pg_temp.id(request),reason)$$;
create temporary table proposals(id uuid);
grant all on proposals to authenticated;
create function pg_temp.decide(decision text default 'approved',request integer default 1100,reason text default ' Independent review ',proposal uuid default null)
returns uuid language sql as $$select public.transfer_proposal_decide(pg_temp.id(1),coalesce(proposal,(select id from proposals limit 1)),pg_temp.id(request),decision,reason)$$;
-- The fixture above exercises the real quantity, date, freight and review pipeline.
create function pg_temp.handoff(proposal uuid default null) returns uuid language sql as $$
  select public.transfer_handoff_create(pg_temp.id(1),coalesce(proposal,(select id from proposals order by id limit 1)))$$;
create temporary table exports(id uuid,proposal_id uuid,payload jsonb);
grant all on exports to authenticated;
select throws_ok($$select public.transfer_handoff_create(pg_temp.id(1),null)$$,'MQ422',null,'source identity required');
insert into proposals select pg_temp.submit();
select throws_ok($$select pg_temp.handoff()$$,'MQ409',null,'pending proposal cannot be exported');
select pg_temp.login(16);
select pg_temp.decide();
select throws_ok($$select pg_temp.handoff()$$,'MQ403',null,'approver cannot create handoffs');
select pg_temp.login(11);
select throws_ok($$select pg_temp.handoff()$$,'MQ403',null,'viewer cannot create handoffs');
select pg_temp.login(14);
insert into exports(id,proposal_id) select pg_temp.handoff(),(select id from proposals);
update exports set payload=(select payload from public.transfer_handoffs h where h.id=exports.id);
select is(pg_temp.handoff(),(select id from exports),'proposal is the stable retry identity');
select is((select payload->>'schema_version' from exports),'transfer-handoff-v1','versioned snapshot');
select is((select payload->>'purpose' from exports),'planning_only','planning purpose explicit');
select is((select payload->'estimate' from exports),(select report from saved_freight),'full saved evidence copied without recalculation');
select is((select payload#>>'{proposal,redistribution_id}' from exports),(select id::text from captured),'redistribution reference retained');
select is((select payload#>>'{proposal,approved_by}' from exports),pg_temp.id(16)::text,'independent approval retained');
select is((select selected from public.transfer_handoff_list),true,'first selected handoff');
select is((select source_code from public.transfer_handoff_list),'L1','source identity in history');
select is((select quantity from public.transfer_handoff_list),'8.750','exact quantity stays text');
select throws_ok($$insert into public.transfer_handoffs default values$$,'42501',null,'direct insert denied');
select throws_ok($$update public.transfer_handoffs set payload='{}'$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.transfer_handoffs$$,'42501',null,'direct delete denied');
select pg_temp.login(11);
select is((select count(*) from public.transfer_handoffs),1::bigint,'viewer can read saved export');
select pg_temp.login(12);
select is((select count(*) from public.transfer_handoffs),0::bigint,'destination-only cannot read export');
select is((select count(*) from public.transfer_handoff_list),0::bigint,'destination-only count hidden');
reset role;
update public.membership_locations set location_id=pg_temp.id(21) where user_id=pg_temp.id(12);
set local role authenticated;
select is((select count(*) from public.transfer_handoffs),0::bigint,'source-only cannot read export');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*) from public.transfer_handoff_list),1::bigint,'both endpoints required for read');
select throws_ok($$select pg_temp.handoff()$$,'MQ403',null,'branch member cannot save even with both endpoints');
select pg_temp.login(13,2);
select is((select count(*) from public.transfer_handoffs),0::bigint,'cross-tenant export hidden');
select throws_ok($$select public.transfer_handoff_create(pg_temp.id(2),(select id from proposals))$$,'MQ404',null,'cross-tenant RPC hidden');
select pg_temp.login(10,2);
select is((select count(*) from public.transfer_handoff_list),0::bigint,'active claim narrows history');
select throws_ok($$select pg_temp.handoff()$$,'MQ403',null,'active claim narrows saving');
select pg_temp.login(10);
insert into proposals select pg_temp.submit(1001,'Second selection');
select pg_temp.login(15);
select pg_temp.decide('approved',1101,'New approval',(select id from proposals where id<>(select proposal_id from exports)));
select is((select selected from public.transfer_handoff_list),false,'later approval makes prior export historical');
select is(pg_temp.handoff((select proposal_id from exports)),(select id from exports),'historical retry returns original');
reset role;
-- Trusted fixture mutations test fail-closed legacy timing evidence before the price gate.
update public.transfer_freight_estimates set report=jsonb_set(report,'{source,source,quantity}','"0"') where id=(select id from saved_freight);
set local role authenticated;
select throws_ok($$select pg_temp.handoff((select id from proposals where id<>(select proposal_id from exports)))$$,'MQ422',null,'zero quantity cannot be exported');
reset role;
update public.transfer_freight_estimates set report=jsonb_set((select report from saved_freight),'{status}','"no_transfer_needed"') where id=(select id from saved_freight);
set local role authenticated;
select throws_ok($$select pg_temp.handoff((select id from proposals where id<>(select proposal_id from exports)))$$,'MQ422',null,'unavailable estimate cannot be exported');
reset role;
update public.transfer_freight_estimates set report=(select report from saved_freight) where id=(select id from saved_freight);
update public.transfer_freight_estimates set report=jsonb_set(report,'{source,receipts,p50,timing_review_required}','true') where id=(select id from saved_freight);
set local role authenticated;
select throws_ok($$select pg_temp.handoff((select id from proposals where id<>(select proposal_id from exports)))$$,'MQ422',null,'typical timing warning blocks new export');
reset role;
update public.transfer_freight_estimates set report=jsonb_set((select report from saved_freight),'{source,receipts,p90,timing_review_required}','null') where id=(select id from saved_freight);
set local role authenticated;
select throws_ok($$select pg_temp.handoff((select id from proposals where id<>(select proposal_id from exports)))$$,'MQ422',null,'null slow timing flag blocks export');
reset role;
update public.transfer_freight_estimates set report=(select report from saved_freight) #- '{source,receipts,p90,timing_review_required}' where id=(select id from saved_freight);
set local role authenticated;
select throws_ok($$select pg_temp.handoff((select id from proposals where id<>(select proposal_id from exports)))$$,'MQ422',null,'missing slow timing flag blocks export');
reset role;
update public.transfer_freight_estimates set report=(select report from saved_freight) where id=(select id from saved_freight);
update public.network_links set freight_cost=9 where id=pg_temp.id(90);
set local role authenticated;
select throws_ok($$select pg_temp.handoff((select id from proposals where id<>(select proposal_id from exports)))$$,'MQ409',null,'changed rate blocks new export');
select is(pg_temp.handoff((select proposal_id from exports)),(select id from exports),'changed rate cannot replace original export');
select is((select payload from public.transfer_handoffs),(select payload from exports),'original snapshot survives all later changes');
select pg_temp.login(10);
update saved_freight set id=pg_temp.fs(901),report=pg_temp.fp();
insert into proposals select pg_temp.submit(1002,'New freight evidence');
select pg_temp.login(16);
select pg_temp.decide('approved',1102,'Reviewed current freight',(select id from public.transfer_proposals where revision=3));
select pg_temp.login(10);
select throws_ok($$select pg_temp.handoff((select id from public.transfer_proposals where revision=2))$$,'MQ409',null,'unexported historical approval cannot create a handoff');
select lives_ok($$select pg_temp.handoff((select id from public.transfer_proposals where revision=3))$$,'new selected proposal gets its own export');
reset role;
update public.memberships set role='viewer' where user_id=pg_temp.id(14);
set local role authenticated;
select pg_temp.login(14);
select throws_ok($$select pg_temp.handoff((select proposal_id from exports))$$,'MQ403',null,'retry checks current editor role');
reset role;
select is((select count(*) from public.audit_log where table_name='transfer_handoffs' and organization_id=pg_temp.id(1)),2::bigint,'exactly one audit per export');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),3::bigint,'exports create no stock');
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),3::bigint,'exports create no inbound');
select is((select count(*) from public.receipts where organization_id=pg_temp.id(1)),0::bigint,'exports create no receipts');
set local role anon;
select throws_ok($$select * from public.transfer_handoffs$$,'42501',null,'anonymous table denied');
select throws_ok($$select pg_temp.handoff()$$,'42501',null,'anonymous RPC denied');
reset role;
set local role service_role;
select throws_ok($$select * from public.transfer_handoffs$$,'42501',null,'service table denied');
select throws_ok($$select pg_temp.handoff()$$,'42501',null,'service RPC denied');
reset role;
select ok(not has_table_privilege('maqdar_worker','public.transfer_handoffs','select'),'worker table denied');
select ok(not has_function_privilege('maqdar_worker','public.transfer_handoff_create(uuid,uuid)','execute'),'worker RPC denied');
select * from finish();
rollback;
