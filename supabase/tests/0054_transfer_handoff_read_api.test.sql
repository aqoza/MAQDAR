begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a8300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
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
insert into proposals select pg_temp.submit();
select pg_temp.login(16);
select pg_temp.decide();
select pg_temp.login(10);
insert into exports(id,proposal_id) select pg_temp.handoff(),(select id from proposals);
update exports set payload=(select payload from public.transfer_handoffs h where h.id=exports.id);
reset role;
-- The first line used real application RPCs. Trusted clones isolate API pagination; the browser fixture uses three independent full evidence chains.
create function pg_temp.clone_line(n integer) returns uuid language plpgsql as $$
declare d uuid:=pg_temp.id(2000+n); p uuid:=pg_temp.id(3000+n); h uuid:=pg_temp.id(4000+n); payload jsonb;
begin
 insert into public.redistribution_drafts select (jsonb_populate_record(null::public.redistribution_drafts,
   (select to_jsonb(r) from public.redistribution_drafts r where id=(select id from captured))||jsonb_build_object('id',d,'request_id',d))).*;
 insert into public.transfer_proposals select (jsonb_populate_record(null::public.transfer_proposals,
   (select to_jsonb(r) from public.transfer_proposals r where id=(select id from proposals limit 1))||
   jsonb_build_object('id',p,'draft_id',d,'request_id',p,'decision_request_id',p))).*;
 payload:=(select e.payload from exports e);
 payload:=jsonb_set(payload,'{handoff_id}',to_jsonb(h));
 payload:=jsonb_set(payload,'{proposal,id}',to_jsonb(p));
 payload:=jsonb_set(payload,'{estimate,source,source,source_item_id}',to_jsonb(pg_temp.id(5000+n)));
 payload:=jsonb_set(payload,'{estimate,source,source,destination,policy,item_code}',to_jsonb('ITEM-'||n));
 insert into public.transfer_handoffs(id,organization_id,proposal_id,location_id,source_location_id,created_by,payload)
 values(h,pg_temp.id(1),p,pg_temp.id(20),pg_temp.id(21),pg_temp.id(10),payload);
 return h;
end; $$;
create temporary table lines(n integer,id uuid,original jsonb);
insert into lines values(0,(select id from exports),null),(1,pg_temp.clone_line(1),null),(2,pg_temp.clone_line(2),null);
update lines set original=h.payload from public.transfer_handoffs h where h.id=lines.id;
create temporary table batches(id uuid,payload jsonb);
insert into batches(id) select public.transfer_handoff_batch_create(pg_temp.id(1),array_agg(id order by id)) from lines where n in(0,1);
update batches set payload=b.payload from public.transfer_handoff_batches b where b.id=batches.id;
-- Force timestamp ties to exercise the UUID tiebreak and inclusive lower bound.
update public.transfer_handoffs set created_at='2026-10-01T00:00:00Z' where organization_id=pg_temp.id(1);
create function pg_temp.hash(n integer) returns bytea language sql immutable as $$select decode(lpad(n::text,64,'0'),'hex')$$;
create function pg_temp.key(n integer,scopes text[] default array['transfer_handoffs:read'],org integer default 1) returns uuid language sql as $$select public.create_api_key(pg_temp.id(org),'Test key '||n,scopes,30,pg_temp.hash(n),'maqdar_sk_test','test')$$;
select pg_temp.login(10,1);
set local role authenticated;
select lives_ok($$select pg_temp.key(40)$$,'owner can issue explicit handoff permission');
select lives_ok($$select pg_temp.key(41)$$,'expiry fixture');
select lives_ok($$select pg_temp.key(42)$$,'revocation fixture');
select lives_ok($$select pg_temp.key(43,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge'])$$,'legacy scopes still accepted');
select throws_ok($$select pg_temp.key(45,array['transfer_handoffs:write'])$$,'MQ422',null,'no handoff write scope');
select throws_ok($$select pg_temp.key(45,array['transfer_handoffs:read',null])$$,'MQ422',null,'null scope refused');
select lives_ok($$select pg_temp.key(46,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read'])$$,'all seven scopes accepted explicitly');
select throws_ok($$select pg_temp.key(45,array['transfer_handoffs:acknowledge'])$$,'MQ422',null,'transfer acknowledgements are not enabled');
select pg_temp.login(15,1);
select lives_ok($$select pg_temp.key(47)$$,'admin can issue transfer reader');
select pg_temp.login(14,1);
select throws_ok($$select pg_temp.key(45)$$,'MQ403',null,'planner cannot issue organization-wide keys');
select pg_temp.login(11,1);
select throws_ok($$select pg_temp.key(45)$$,'MQ403',null,'viewer cannot issue organization-wide keys');
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.key(45)$$,'MQ403',null,'branch member cannot issue keys');
select pg_temp.login(16,1);
select throws_ok($$select pg_temp.key(45)$$,'MQ403',null,'approver cannot issue keys');
select pg_temp.login(13,2);
select lives_ok($$select pg_temp.key(44,array['transfer_handoffs:read'],2)$$,'other tenant key fixture');
reset role;
update public.api_keys set expires_at=created_at+interval '1 second',created_at=now()-interval '2 days' where key_hash=pg_temp.hash(41);
update public.api_keys set expires_at=now()-interval '1 day' where key_hash=pg_temp.hash(41);
update public.api_keys set revoked_at=now() where key_hash=pg_temp.hash(42);
create temporary table pages(n integer,body jsonb);
grant all on lines,batches,pages,captured to service_role;
-- Cookie/branch claims cannot narrow or replace the explicit key organization.
select pg_temp.login(12,1);
set local role service_role;
select throws_ok($$select * from app.transfer_handoff_api_records$$,'42501',null,'projection is private even to service role');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(43),'transfer-handoffs')$$,'MQ403',null,'existing scopes do not imply handoff read');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(41),'transfer-handoffs')$$,'MQ401',null,'expired key refused');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(42),'transfer-handoff-batches')$$,'MQ401',null,'revoked key refused');
select throws_ok($$select public.api_transfer_handoff_get(pg_temp.hash(99),'transfer-handoffs',pg_temp.id(1))$$,'MQ401',null,'unknown key refused');
select is(jsonb_array_length(public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs')->'data'),3,'explicit key reads whole organization despite unrelated branch claims');
insert into pages values(1,public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs',null,1,'2026-10-01T00:00:00Z'));
insert into pages values(2,public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs',(select body->>'next_cursor' from pages where n=1),1,'2026-10-01T00:00:00Z'));
insert into pages values(3,public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs',(select body->>'next_cursor' from pages where n=2),1,'2026-10-01T00:00:00Z'));
select is((select jsonb_array_length(body->'data') from pages where n=1),1,'bounded first page');
select is((select count(distinct body#>>'{data,0,id}') from pages),3::bigint,'timestamp ties traversed exactly once');
select is((select array_agg((body#>>'{data,0,id}')::uuid order by n) from pages),(select array_agg(id order by id) from lines),'UUID ascending tiebreak');
select is((select count(distinct body->>'as_of') from pages),1::bigint,'creation upper bound stable across pages');
select is((select body->>'next_cursor' from pages where n=3),null,'final page ends cursor');
select ok(not (select (body#>'{data,0}')?'payload' from pages where n=1),'lists omit full evidence');
select is(jsonb_array_length(public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs',null,100,'2026-10-01T00:00:01Z')->'data'),0,'created_since is inclusive creation filter');
select is(jsonb_array_length(public.api_transfer_handoff_list(pg_temp.hash(44),'transfer-handoffs')->'data'),0,'other organization list empty');
select throws_ok($$select public.api_transfer_handoff_get(pg_temp.hash(44),'transfer-handoffs',(select id from lines where n=0))$$,'MQ404',null,'cross-tenant detail indistinguishable from missing');
select throws_ok($$select public.api_transfer_handoff_get(pg_temp.hash(40),'transfer-handoffs',pg_temp.id(999))$$,'MQ404',null,'missing detail');
select throws_ok($$select public.api_transfer_handoff_get(pg_temp.hash(44),'transfer-handoff-batches',(select id from batches))$$,'MQ404',null,'cross-tenant batch detail hidden');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(40),'items')$$,'MQ404',null,'resource allowlist');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs',null,101)$$,'MQ422',null,'SQL backstop limit');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs',null,1,'infinity')$$,'MQ422',null,'finite creation filter');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs','malformed')$$,'MQ422',null,'malformed cursor');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoff-batches',(select body->>'next_cursor' from pages where n=1),1,'2026-10-01T00:00:00Z')$$,'MQ422',null,'cursor cannot cross resource');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(44),'transfer-handoffs',(select body->>'next_cursor' from pages where n=1),1,'2026-10-01T00:00:00Z')$$,'MQ422',null,'cursor cannot cross organization');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs',(select body->>'next_cursor' from pages where n=1),1,'2026-10-02T00:00:00Z')$$,'MQ422',null,'cursor requires original filter');
select is(public.api_transfer_handoff_get(pg_temp.hash(40),'transfer-handoffs',id)#>'{data,payload}',original,'individual evidence unchanged') from lines;
select is(public.api_transfer_handoff_get(pg_temp.hash(40),'transfer-handoff-batches',id)#>'{data,payload}',payload,'batch evidence unchanged') from batches;
select is(public.api_transfer_handoff_get(pg_temp.hash(40),'transfer-handoff-batches',(select id from batches))#>>'{data,current,selected}','true','all selected batch');
reset role;
-- A later approval makes the old package historical. Reads still return original evidence.
select pg_temp.login(10,1);
set local role authenticated;
update proposals set id=pg_temp.submit(1001);
select pg_temp.login(16,1);
select pg_temp.decide('approved',1101);
reset role;
update public.network_links set freight_cost=2 where organization_id=pg_temp.id(1);
set local role service_role;
select is(public.api_transfer_handoff_get(pg_temp.hash(40),'transfer-handoffs',(select id from lines where n=0))#>>'{data,current,selected}','false','live historical status outside evidence');
select is(public.api_transfer_handoff_get(pg_temp.hash(40),'transfer-handoff-batches',(select id from batches))#>>'{data,current,selected}','false','one historical line makes batch historical');
select is(public.api_transfer_handoff_get(pg_temp.hash(40),'transfer-handoffs',id)#>'{data,payload}',original,'later approval/freight edit preserves single payload') from lines;
select is(public.api_transfer_handoff_get(pg_temp.hash(40),'transfer-handoff-batches',id)#>'{data,payload}',payload,'later approval/freight edit preserves batch payload') from batches;
reset role;
update public.memberships set role='planner' where organization_id=pg_temp.id(1) and user_id=pg_temp.id(10);
set local role service_role;
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs')$$,'MQ401',null,'creator role checked on every request');
reset role;
select is((select scopes from public.api_keys where key_hash=pg_temp.hash(43)),array['master_data:read','master_data:write','purchase_handoffs:acknowledge','purchase_handoffs:read','transactions:read','transactions:write'],'legacy key unchanged');
select ok((select last_used_at is not null from public.api_keys where key_hash=pg_temp.hash(40)),'usage metadata updated');
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),3::bigint,'reads create no inbound orders');
select is((select count(*) from public.transfer_handoffs where organization_id=pg_temp.id(1)),3::bigint,'reads create no handoffs');
-- Restore authority to check snapshot bounds and retained batches after source deletion.
update public.memberships set role='owner' where organization_id=pg_temp.id(1) and user_id=pg_temp.id(10);
update public.transfer_handoffs set created_at=statement_timestamp()+interval '1 hour' where id=(select id from lines where n=2);
set local role service_role;
select is(jsonb_array_length(public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs')->'data'),2,'creation upper bound excludes future records');
reset role;
delete from public.transfer_handoffs where id=(select id from lines where n=0);
set local role service_role;
select is(public.api_transfer_handoff_get(pg_temp.hash(40),'transfer-handoff-batches',id)#>'{data,payload}',payload,'batch retains payload after member deletion') from batches;
select is(public.api_transfer_handoff_get(pg_temp.hash(40),'transfer-handoff-batches',(select id from batches))#>>'{data,current,selected}','false','deleted member cannot be selected');
reset role;

-- Scope separation and direct privileges are enforced in SQL, not only the HTTP router.
set local role service_role;
select throws_ok($$select public.api_handoff_list(pg_temp.hash(40),'purchase-handoffs')$$,'MQ403',null,'transfer scope does not imply purchase scope');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(40),'purchase-handoffs')$$,'MQ404',null,'transfer RPC rejects purchase resource');
select throws_ok($$select * from public.transfer_handoffs$$,'42501',null,'service has no direct handoff table privilege');
reset role;
select pg_temp.login(10,1);
set local role authenticated;
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs')$$,'42501',null,'browser role cannot call API RPC');
select throws_ok($$select * from app.transfer_handoff_api_records$$,'42501',null,'private projection denied to members');
select pg_temp.login(12,1);
select is((select count(*) from public.transfer_handoff_batches),0::bigint,'one-endpoint browser member still cannot read batch');
reset role;
select ok(not has_function_privilege('anon','public.api_transfer_handoff_get(bytea,text,uuid)','execute'),'anon RPC denied');
select ok(not has_function_privilege('maqdar_worker','public.api_transfer_handoff_get(bytea,text,uuid)','execute'),'worker RPC denied');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),3::bigint,'reads leave stock unchanged');
select is((select count(*) from public.transfer_handoff_batches where organization_id=pg_temp.id(1)),1::bigint,'reads create no batches');
select * from finish();
rollback;
