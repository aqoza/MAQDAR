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

create temporary table lines(n integer,id uuid);
insert into lines values(0,(select handoff_id from fixture)),(1,pg_temp.line(1,'KG',5)),(2,pg_temp.line(2));
grant all on lines to authenticated;
create temporary table portal(batch uuid,other_batch uuid,preview jsonb,pub uuid,other_pub uuid,single_pub uuid,grant_id uuid,other_grant uuid);
grant all on portal to authenticated;
update public.memberships set role='owner' where organization_id=pg_temp.id(1) and user_id=pg_temp.id(10);
insert into auth.users(id,email,email_confirmed_at) values(pg_temp.id(15),'batch-supplier@test.local',now()),(pg_temp.id(16),'batch-other@test.local',now());
insert into public.suppliers(id,organization_id,code,name_en,country_code,currency,lead_time_days_p50,lead_time_days_p90)
values(pg_temp.id(111),pg_temp.id(1),'OTHER','Other','SA','SAR',3,3);
select pg_temp.login(10,1);set local role authenticated;
insert into portal(batch,other_batch) select
 public.purchase_handoff_batch_create(pg_temp.id(1),(select array_agg(id) from lines where n in(0,1))),
 public.purchase_handoff_batch_create(pg_temp.id(1),(select array_agg(id) from lines where n in(1,2)));
update portal set grant_id=(public.supplier_portal_invite(pg_temp.id(1),pg_temp.id(110),'batch-supplier@test.local')->>'id')::uuid,
 other_grant=(public.supplier_portal_invite(pg_temp.id(1),pg_temp.id(111),'batch-other@test.local')->>'id')::uuid;
select pg_temp.login(15,1);
select throws_ok($$select public.supplier_portal_publications((select grant_id from portal))$$,'MQ404',null,'pending grant denied');
select public.supplier_portal_accept((select grant_id from portal));
select is(public.supplier_portal_publications((select grant_id from portal))->>'total','0','saved batch alone is not published');
select pg_temp.login(16,1);select public.supplier_portal_accept((select other_grant from portal));
select pg_temp.login(10,1);
update portal set preview=public.supplier_batch_publication_preview(pg_temp.id(1),batch);
select is((select jsonb_array_length(preview#>'{summary,lines}') from portal),2,'complete batch preview');
select is((select preview#>>'{summary,subtotal}' from portal),'30.15','exact rounded subtotal sum');
select is((select count(*) from jsonb_object_keys((select preview->'summary' from portal))),8::bigint,'batch allowlist only');
select is((select count(distinct value->>'unit') from portal,jsonb_array_elements(preview#>'{summary,lines}')),2::bigint,'separate units retained');
select is((select count(distinct value->>'receipt_date') from portal,jsonb_array_elements(preview#>'{summary,lines}')),2::bigint,'per-line receipts retained');
select ok((select bool_and((select count(*) from jsonb_object_keys(value))=12) from portal,jsonb_array_elements(preview#>'{summary,lines}')),'each line has exact single-summary allowlist');
reset role;
create function pg_temp.invalid_batch(path text[],replacement jsonb) returns text language plpgsql as $$
declare original jsonb; result text;
begin
 select payload into original from public.purchase_handoff_batches where id=(select batch from portal);
 update public.purchase_handoff_batches set payload=jsonb_set(payload,path,replacement) where id=(select batch from portal);
 begin perform public.supplier_batch_publication_preview(pg_temp.id(1),(select batch from portal)); result:='unexpected success';
 exception when others then result:=sqlstate; end;
 update public.purchase_handoff_batches set payload=original where id=(select batch from portal);
 return result;
end; $$;
select is(pg_temp.invalid_batch('{summary,supplier_id}',to_jsonb(pg_temp.id(111)::text)),'MQ409','copied supplier binding must match every member');
select is(pg_temp.invalid_batch('{summary,currency}','"KWD"'),'MQ409','copied currency header cannot drift');
select is(pg_temp.invalid_batch('{lines}',(select jsonb_build_array(payload->'lines'->0,payload->'lines'->0) from public.purchase_handoff_batches where id=(select batch from portal))),'MQ409','repeated payload cannot omit another required member');
set local role authenticated;
select throws_ok($$select public.supplier_batch_publication_publish(pg_temp.id(1),(select batch from portal),false,(select preview->>'fingerprint' from portal))$$,'MQ422',null,'explicit confirmation');
select throws_ok($$select public.supplier_batch_publication_publish(pg_temp.id(1),(select batch from portal),true,'stale')$$,'MQ409',null,'preview mismatch');
update public.supplier_items set unit_price=99 where item_id=pg_temp.id(10001);
select throws_ok($$select public.supplier_batch_publication_publish(pg_temp.id(1),(select batch from portal),true,(select preview->>'fingerprint' from portal))$$,'MQ409',null,'one changed member rejects whole publication');
select is((select count(*) from public.supplier_batch_publications),0::bigint,'no partial publication');
update public.supplier_items set unit_price=1.005 where item_id=pg_temp.id(10001);
update portal set pub=public.supplier_batch_publication_publish(pg_temp.id(1),batch,true,preview->>'fingerprint');
select is(public.supplier_batch_publication_publish(pg_temp.id(1),(select batch from portal),true,'old'),(select pub from portal),'stable retry');
select is((select count(*) from public.supplier_publications),0::bigint,'batch does not publish member handoffs');
update portal set other_pub=public.supplier_batch_publication_publish(pg_temp.id(1),other_batch,true,public.supplier_batch_publication_preview(pg_temp.id(1),other_batch)->>'fingerprint'),
 single_pub=public.supplier_publication_publish(pg_temp.id(1),(select id from lines where n=0),true,public.supplier_publication_preview(pg_temp.id(1),(select id from lines where n=0))->>'fingerprint');
select throws_ok($$update public.supplier_batch_publications set summary='{}'$$,'42501',null,'direct edits denied');
select throws_ok($$delete from public.supplier_batch_publications$$,'42501',null,'direct delete denied');
select pg_temp.login(15,1);
select is((select count(*) from public.supplier_batch_publications),0::bigint,'supplier has no raw table access');
select is((select count(*) from public.memberships),0::bigint,'no membership granted');
select is(public.supplier_portal_publications((select grant_id from portal))->>'total','3','explicit packages listed separately');
select is(public.supplier_portal_publications((select grant_id from portal),1,25,(select pub from portal))#>>'{rows,0,overlap_count}','2','individual and batch overlap identified');
select is(public.supplier_portal_publications((select grant_id from portal),1,25,(select pub from portal))#>'{rows,0,summary}',(select preview->'summary' from portal),'original exact summary');
select is((select count(*) from jsonb_object_keys(public.supplier_portal_publications((select grant_id from portal))#>'{rows,0}')),6::bigint,'external row allowlist');
select is(public.supplier_portal_publications((select grant_id from portal),100000)->>'page','1','page clamps');
select throws_ok($$select public.supplier_portal_publications((select grant_id from portal),1,200)$$,'MQ422',null,'bounded page');
select throws_ok($$select public.supplier_portal_publications((select other_grant from portal))$$,'MQ404',null,'other grant denied');
select pg_temp.login(16,1);
select is(public.supplier_portal_publications((select other_grant from portal),1,25,(select pub from portal))->>'total','0','other supplier guesses reveal nothing');
select pg_temp.login(11,1);
select throws_ok($$select public.supplier_batch_publication_publish(pg_temp.id(1),(select batch from portal),true,'old')$$,'MQ403',null,'viewer cannot retry');
select pg_temp.login(12,1);
select is((select count(*) from public.supplier_batch_publications),0::bigint,'unassigned branch hidden');
select pg_temp.login(13,2);
select is((select count(*) from public.supplier_batch_publications),0::bigint,'foreign tenant hidden');
select throws_ok($$select public.supplier_batch_publication_preview(pg_temp.id(2),(select batch from portal))$$,'MQ404',null,'foreign source hidden');
reset role;
select is((select count(*) from public.audit_log where table_name='supplier_batch_publications' and organization_id=pg_temp.id(1)),2::bigint,'one audit per creation');
update public.supplier_items set unit_price=2 where organization_id=pg_temp.id(1);
select pg_temp.login(10,1);set local role authenticated;
select is(public.supplier_batch_publication_publish(pg_temp.id(1),(select batch from portal),true,'old'),(select pub from portal),'later prices do not replace copy');
select public.supplier_batch_publication_withdraw(pg_temp.id(1),(select other_pub from portal));
select is(public.supplier_batch_publication_publish(pg_temp.id(1),(select other_batch from portal),true,'old'),(select other_pub from portal),'retry cannot undo withdrawal');
select pg_temp.login(15,1);
select is(public.supplier_portal_publications((select grant_id from portal))->>'total','2','withdrawal immediate');
select is(public.supplier_portal_publications((select grant_id from portal),1,25,(select pub from portal))#>>'{rows,0,overlap_count}','1','withdrawn overlaps hidden');
reset role;
delete from public.purchase_handoffs where id=(select id from lines where n=0);
select pg_temp.login(10,1);set local role authenticated;
select is(public.supplier_batch_publication_publish(pg_temp.id(1),(select batch from portal),true,'old'),(select pub from portal),'publication retry survives source deletion under current authority');
select pg_temp.login(15,1);
select is(public.supplier_portal_publications((select grant_id from portal),1,25,(select pub from portal))#>'{rows,0,summary}',(select preview->'summary' from portal),'batch copy survives handoff deletion');
select is(public.supplier_portal_publications((select grant_id from portal))->>'total','1','individual publication follows its parent');
select pg_temp.login(10,1);select public.supplier_portal_revoke(pg_temp.id(1),(select grant_id from portal));
select pg_temp.login(15,1);
select throws_ok($$select public.supplier_portal_publications((select grant_id from portal))$$,'MQ404',null,'revocation applies to feed');
reset role;
delete from public.purchase_handoff_batches where id=(select batch from portal);
select is((select count(*) from public.supplier_batch_publications where id=(select pub from portal)),0::bigint,'actual batch deletion cascades');
-- The maximum complete package is validated within the authenticated statement budget.
update public.supplier_items set unit_price=1.005 where organization_id=pg_temp.id(1);
insert into lines(n,id) select n,pg_temp.line(n) from generate_series(10,59) n;
alter table portal add max_batch uuid;
select pg_temp.login(10,1);set local role authenticated;
update portal set max_batch=public.purchase_handoff_batch_create(pg_temp.id(1),(select array_agg(id) from lines where n between 10 and 59));
set local statement_timeout='8s';
select lives_ok($$select public.supplier_batch_publication_publish(pg_temp.id(1),max_batch,true,
 public.supplier_batch_publication_preview(pg_temp.id(1),max_batch)->>'fingerprint') from portal$$,'50 complete lines publish within statement budget');
select is((select summary->>'subtotal' from public.supplier_batch_publications where cardinality(handoff_ids)=50),'904.50','50-line exact total retained');
reset statement_timeout;reset role;
delete from public.open_orders where supplier_id=pg_temp.id(110);
delete from public.receipts where supplier_id=pg_temp.id(110);
delete from public.suppliers where id=pg_temp.id(110);
select is((select count(*) from public.supplier_batch_publications where cardinality(handoff_ids)=50),1::bigint,'supplier deletion preserves copied publication with actual batch');
select is((select count(*) from public.supplier_portal_grants where supplier_id=pg_temp.id(110)),0::bigint,'deleted supplier has no access grants');
select * from finish();rollback;
