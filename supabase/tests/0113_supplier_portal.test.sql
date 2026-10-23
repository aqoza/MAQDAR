begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('bc260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
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
select throws_ok($$select pg_temp.handoff()$$,'MQ409',null,'pending proposal cannot export');
select pg_temp.login(14,1);
select lives_ok($$select pg_temp.decide('approved')$$,'approve fixture independently');
select throws_ok($$select pg_temp.handoff()$$,'MQ403',null,'approver cannot create');
select pg_temp.login(10,1);
select throws_ok($$select public.purchase_handoff_create(pg_temp.id(1),null)$$,'MQ422',null,'source required');
select throws_ok($$select public.purchase_handoff_create(pg_temp.id(1),pg_temp.id(999))$$,'MQ404',null,'unknown source hidden');
reset role;
alter table fixture add handoff_id uuid;
alter table fixture add payload jsonb;
set local role authenticated;
update fixture set handoff_id=pg_temp.handoff();
update fixture set payload=(select payload from public.purchase_handoffs where id=fixture.handoff_id);

reset role;
insert into auth.users(id,email,email_confirmed_at) values
 (pg_temp.id(15),'supplier@test.local',now()),(pg_temp.id(16),'other@test.local',now()),
 (pg_temp.id(17),'unconfirmed@test.local',null),(pg_temp.id(18),'foreign@test.local',now());
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90) values
 (pg_temp.id(111),pg_temp.id(1),'OTHER','Other','SA','SAR',3,3),(pg_temp.id(112),pg_temp.id(2),'FOREIGN','Foreign','SA','SAR',3,3);
create temporary table portal(grant_id uuid,other_grant uuid,unconfirmed_grant uuid,publication_id uuid,preview jsonb);
grant all on portal to authenticated;
select pg_temp.login(10,1);set local role authenticated;
insert into portal(grant_id) select (public.supplier_portal_invite(pg_temp.id(1),pg_temp.id(110),' SUPPLIER@test.local ')->>'id')::uuid;
update portal set other_grant=(public.supplier_portal_invite(pg_temp.id(1),pg_temp.id(111),'other@test.local')->>'id')::uuid,
 unconfirmed_grant=(public.supplier_portal_invite(pg_temp.id(1),pg_temp.id(110),'unconfirmed@test.local')->>'id')::uuid;
select throws_ok($$select public.supplier_portal_invite(pg_temp.id(1),pg_temp.id(110),'supplier@test.local')$$,'MQ429',null,'resend cooldown');
select throws_ok($$select public.supplier_portal_invite(pg_temp.id(1),pg_temp.id(112),'x@test.local')$$,'MQ404',null,'foreign supplier hidden');
select throws_ok($$select public.supplier_portal_invite(pg_temp.id(1),pg_temp.id(110),E'x\ny@test.local')$$,'MQ422',null,'email controls denied');
select pg_temp.login(11,1);
select throws_ok($$select public.supplier_portal_invite(pg_temp.id(1),pg_temp.id(110),'x@test.local')$$,'MQ403',null,'viewer cannot invite');
select is((select count(*) from public.supplier_portal_grants),0::bigint,'viewer cannot inspect recipient emails');
select pg_temp.login(15,1);
select is(jsonb_array_length(public.my_supplier_portals()),1,'verified address sees only own pending grant');
select is(public.my_supplier_portals()#>>'{0,accepted}','false','pending is not access');
select throws_ok($$select public.supplier_portal_packages((select grant_id from portal))$$,'MQ404',null,'acceptance required');
select lives_ok($$select public.supplier_portal_accept((select grant_id from portal))$$,'verified intended supplier accepts');
select lives_ok($$select public.supplier_portal_accept((select grant_id from portal))$$,'accept retry stable');
select is(public.my_supplier_portals()#>>'{0,accepted}','true','accepted identity bound');
select is((select count(*) from public.memberships),0::bigint,'no staff membership created');
select is((select count(*) from public.purchase_handoffs),0::bigint,'no raw handoff access');
select is((select count(*) from public.stock_snapshots),0::bigint,'no stock access');
select is((select count(*) from public.supplier_portal_grants),0::bigint,'no raw recipient directory');
select is((select count(*) from public.supplier_publications),0::bigint,'no internal publication access');
select throws_ok($$select public.supplier_publication_preview(pg_temp.id(1),(select handoff_id from fixture))$$,'MQ403',null,'supplier cannot preview internal evidence');
select pg_temp.login(16,1);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(16),'role','authenticated','org_id',pg_temp.id(1),'email','supplier@test.local')::text,true);
select throws_ok($$select public.supplier_portal_accept((select grant_id from portal))$$,'MQ404',null,'forged token email cannot claim another account grant');
select lives_ok($$select public.supplier_portal_accept((select other_grant from portal))$$,'other supplier accepts own grant');
select pg_temp.login(17,1);
select is(public.my_supplier_portals(),'[]'::jsonb,'unconfirmed email sees no invitation');
select throws_ok($$select public.supplier_portal_accept((select unconfirmed_grant from portal))$$,'MQ404',null,'unconfirmed account cannot accept');
select pg_temp.login(10,1);
update portal set preview=public.supplier_publication_preview(pg_temp.id(1),(select handoff_id from fixture));
select is((select preview#>>'{summary,purpose}' from portal),'planning_only','clear planning purpose');
select is((select count(*) from jsonb_object_keys((select preview->'summary' from portal))),12::bigint,'exact supplier allowlist');
select ok(not((select preview->'summary' from portal)?|array['estimate','forecast','stock','proposal','evidence','created_by']),'internal evidence excluded');
select throws_ok($$select public.supplier_publication_publish(pg_temp.id(1),(select handoff_id from fixture),false,(select preview->>'fingerprint' from portal))$$,'MQ422',null,'explicit sharing confirmation');
select throws_ok($$select public.supplier_publication_publish(pg_temp.id(1),(select handoff_id from fixture),true,'stale')$$,'MQ409',null,'changed preview denied');
update public.supplier_items set unit_price=999 where id=pg_temp.id(130);
select throws_ok($$select public.supplier_publication_preview(pg_temp.id(1),(select handoff_id from fixture))$$,'MQ409',null,'changed price denied');
update public.supplier_items set unit_price=1.005 where id=pg_temp.id(130);
update portal set publication_id=public.supplier_publication_publish(pg_temp.id(1),(select handoff_id from fixture),true,preview->>'fingerprint');
select is(public.supplier_publication_publish(pg_temp.id(1),(select handoff_id from fixture),true,'old'),(select publication_id from portal),'publish retry stable');
select throws_ok($$update public.supplier_publications set summary='{}'$$,'42501',null,'direct edits denied');
select throws_ok($$delete from public.supplier_publications$$,'42501',null,'direct deletion denied');
select pg_temp.login(15,1);
select is(public.supplier_portal_packages((select grant_id from portal))->>'total','1','supplier sees explicitly published summary');
select is(public.supplier_portal_packages((select grant_id from portal))#>'{rows,0,summary}',(select preview->'summary' from portal),'shared exact values unchanged');
select is((select count(*) from jsonb_object_keys(public.supplier_portal_packages((select grant_id from portal))#>'{rows,0}')),3::bigint,'external rows expose only reference timestamp summary');
select is(public.supplier_portal_packages((select grant_id from portal),100000)->>'page','1','bounded page clamps');
select throws_ok($$select public.supplier_portal_packages((select grant_id from portal),1,200)$$,'MQ422',null,'page size bounded');
select throws_ok($$select public.supplier_portal_packages((select other_grant from portal))$$,'MQ404',null,'other supplier portal denied');
select pg_temp.login(16,1);
select is(public.supplier_portal_packages((select other_grant from portal))->>'total','0','same organization different supplier sees none');
select is(public.supplier_portal_packages((select other_grant from portal),1,25,(select publication_id from portal))->>'total','0','guessed publication reveals nothing');
select pg_temp.login(12,1);
select is((select count(*) from public.supplier_publications),0::bigint,'branch scope hides internal publication');
select pg_temp.login(13,2);
select is((select count(*) from public.supplier_publications),0::bigint,'foreign tenant hides publication');
select throws_ok($$select public.supplier_publication_withdraw(pg_temp.id(1),(select publication_id from portal))$$,'MQ403',null,'foreign withdraw denied');
select pg_temp.login(10,1);
select lives_ok($$select public.supplier_publication_withdraw(pg_temp.id(1),(select publication_id from portal))$$,'editor withdraws');
select is(public.supplier_publication_publish(pg_temp.id(1),(select handoff_id from fixture),true,'old'),(select publication_id from portal),'retry never republishes withdrawn summary');
select pg_temp.login(15,1);
select is(public.supplier_portal_packages((select grant_id from portal))->>'total','0','withdrawal removes future supplier reads');
select pg_temp.login(10,1);
select lives_ok($$select public.supplier_portal_revoke(pg_temp.id(1),(select grant_id from portal))$$,'owner revokes');
select lives_ok($$select public.supplier_portal_revoke(pg_temp.id(1),(select grant_id from portal))$$,'revocation retry stable');
select pg_temp.login(15,1);
select is(public.my_supplier_portals(),'[]'::jsonb,'revocation removes discovery');
select throws_ok($$select public.supplier_portal_packages((select grant_id from portal))$$,'MQ404',null,'revocation affects subsequent read');
select throws_ok($$select public.supplier_portal_accept((select grant_id from portal))$$,'MQ404',null,'revoked accept retry denied');
reset role;
select is((select count(*) from public.supplier_publications where organization_id=pg_temp.id(1)),1::bigint,'withdrawn internal history retained');
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='supplier_publications'),2::bigint,'one publish and one withdrawal audit');
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),5::bigint,'no operational orders added');
select is((select count(*) from public.memberships where user_id=pg_temp.id(15)),0::bigint,'lifecycle never adds staff membership');
update public.supplier_portal_grants set expires_at=now()-interval '1 day' where id=(select unconfirmed_grant from portal);
update auth.users set email_confirmed_at=now() where id=pg_temp.id(17);
set local role authenticated;select pg_temp.login(17,1);
select throws_ok($$select public.supplier_portal_accept((select unconfirmed_grant from portal))$$,'MQ404',null,'expired invitation denied');
reset role;
delete from public.purchase_handoffs where id=(select handoff_id from fixture);
select is((select count(*) from public.supplier_publications where organization_id=pg_temp.id(1)),0::bigint,'source deletion cascades publication');
select * from finish();rollback;
