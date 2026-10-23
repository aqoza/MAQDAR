begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a4000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'excess-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'excess-a','Excess A'),(pg_temp.id(2),'excess-b','Excess B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner'),(pg_temp.id(1),pg_temp.id(14),'planner'),(pg_temp.id(1),pg_temp.id(15),'approver'),(pg_temp.id(1),pg_temp.id(16),'admin');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=2 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,2) n;
insert into public.items(id,organization_id,code,name_en,product_group,unit_of_measure,unit_cost,currency)
 select pg_temp.id(100+n),pg_temp.id(1),'ITEM-'||n,'Item','Test','SET',999,'SAR' from generate_series(1,55) n;
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(200+n),pg_temp.id(case when n=56 then 2 else 1 end),pg_temp.id(case when n=56 then 22 when n=53 then 21 else 20 end),pg_temp.id(300+n),
 '2026-01-01','2026-10-10','policy','succeeded','{}',now(),'{}' from generate_series(1,56) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(1000+n),pg_temp.id(case when n=56 then 2 else 1 end),pg_temp.id(200+n),pg_temp.id(case when n=56 then 22 when n=53 then 21 else 20 end),pg_temp.id(400+n),
 pg_temp.id(case when n=52 then 101 else 100+n end),'ITEM-'||n,case when n=2 then 'KG' else 'EA' end,'available',
 '{"protection":{"target":"10.001"}}',
 jsonb_build_object('options',jsonb_build_object('lead_time',3,'review_interval',4),'forecast',jsonb_build_object('to_date',case when n=54 then '2026-10-09' else '2026-10-10' end,
 'method',case when n=55 then 'regional-v1' else 'baseline-v1' end,'source',jsonb_build_object('unit_provenance',
 jsonb_build_object('method','source-units-v1','status','consistent','unit',case when n=2 then 'KG' else 'EA' end,'rows',1,'unknown_rows',0,'units',jsonb_build_array(case when n=2 then 'KG' else 'EA' end)))))
 from generate_series(1,56) n;
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
 select pg_temp.id(1),pg_temp.id(100+n),pg_temp.id(20),case when n=3 then date '2026-10-03' else date '2026-10-10' end,
 case when n=4 then 1 else 30.001 end,2,case when n=3 then 0.333 else 1.125 end,case when n=2 then 'SAR' else 'KWD' end,case when n=2 then 'KG' else 'EA' end
 from generate_series(1,51) n;
insert into public.stock_snapshots(organization_id,item_id,location_id,snapshot_date,quantity,allocated_quantity,unit_cost,currency,unit_of_measure)
 values(pg_temp.id(1),pg_temp.id(101),pg_temp.id(20),'2026-10-11',999,0,999,'SAR','KG');
insert into public.policy_overrides(id,organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason,status,decided_by,decided_at,decision_reason,decision_request_id)
 select pg_temp.id(60+n),pg_temp.id(1),pg_temp.id(1001),pg_temp.id(20),n,pg_temp.id(70+n),pg_temp.id(14),1,10.001+2*n,'Explicit maximum',
 'approved',pg_temp.id(10),now(),'Approved independently',pg_temp.id(80+n) from generate_series(1,2) n;
create function pg_temp.choices(ns integer[] default array[1,2,3,4]) returns jsonb language sql as $$select jsonb_agg(jsonb_build_object('policy_id',pg_temp.id(1000+n),'maximum','calculated')) from unnest(ns) n$$;

update public.stock_snapshots set quantity=30.001,currency='KWD' where snapshot_date<='2026-10-10';
create temporary table fixture(n integer,assessment uuid,proposal uuid,handoff uuid);
create temporary table batches(ids uuid[],id uuid,payload jsonb);
grant all on fixture,batches to authenticated;
create function pg_temp.ids(ns integer[] default array[1,2]) returns uuid[] language sql as $$select array_agg(handoff order by n) from fixture where n=any(ns)$$;
create function pg_temp.preview(ns integer[] default array[1,2]) returns jsonb language sql as $$select public.excess_disposition_handoff_batch_preview(pg_temp.id(1),pg_temp.ids(ns))$$;
create function pg_temp.batch(ns integer[] default array[1,2]) returns uuid language sql as $$select public.excess_disposition_handoff_batch_create(pg_temp.id(1),pg_temp.ids(ns))$$;
select pg_temp.login(14);
set local role authenticated;
do $$declare a uuid; p uuid; h uuid; n integer; choices jsonb;
begin
 for n in 1..3 loop
  choices:=pg_temp.choices(array[n]);
  a:=public.excess_stock_save(pg_temp.id(1),choices,'Batch source',true,gen_random_uuid(),public.excess_stock_preview(pg_temp.id(1),choices)->>'fingerprint');
  p:=public.excess_disposition_submit(pg_temp.id(1),a,pg_temp.id(100+n),'scrap','3.333',gen_random_uuid(),'Batch disposition');
  perform pg_temp.login(10);
  perform public.excess_disposition_decide(pg_temp.id(1),p,gen_random_uuid(),'approved','Independent review');
  perform pg_temp.login(14);
  h:=public.excess_disposition_handoff_create(pg_temp.id(1),p);
  insert into fixture values(n,a,p,h);
 end loop;
end; $$;
insert into batches(ids,id) values(pg_temp.ids(),pg_temp.batch());
reset role;
update batches set payload=b.payload from public.excess_disposition_handoff_batches b where b.id=batches.id;
create temporary table lines as select f.n-1 n,h.id,h.payload original from fixture f join public.excess_disposition_handoffs h on h.id=f.handoff;
update public.excess_disposition_handoffs set created_at='2026-10-01T00:00:00Z' where organization_id=pg_temp.id(1);
create function pg_temp.hash(n integer) returns bytea language sql immutable as $$select decode(lpad(n::text,64,'0'),'hex')$$;
create function pg_temp.key(n integer,scopes text[] default array['excess_disposition_handoffs:read'],org integer default 1) returns uuid language sql as $$select public.create_api_key(pg_temp.id(org),'Test key '||n,scopes,30,pg_temp.hash(n),'zeespare_sk_test','test')$$;
select pg_temp.login(10,1);
set local role authenticated;

select lives_ok($$select pg_temp.key(40,array['excess_disposition_handoffs:read','excess_disposition_handoffs:acknowledge'])$$,'owner can issue explicit acknowledgement scope');
select pg_temp.key(41);
select pg_temp.key(53,array['event_purchase_handoffs:read','event_purchase_handoffs:acknowledge']);
select pg_temp.key(54,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read','transfer_handoffs:acknowledge','event_purchase_handoffs:read','event_purchase_handoffs:acknowledge','excess_disposition_handoffs:read']);
select pg_temp.key(42,array['excess_disposition_handoffs:acknowledge']);
select pg_temp.key(43,array['excess_disposition_handoffs:acknowledge']);
select pg_temp.key(45,array['excess_disposition_handoffs:acknowledge']);
select pg_temp.key(52,array['transfer_handoffs:read','transfer_handoffs:acknowledge']);
select pg_temp.key(48,array['purchase_handoffs:read','purchase_handoffs:acknowledge']);
select lives_ok($$select pg_temp.key(49,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read','transfer_handoffs:acknowledge','event_purchase_handoffs:read','event_purchase_handoffs:acknowledge','excess_disposition_handoffs:read','excess_disposition_handoffs:acknowledge'])$$,'all twelve scopes accepted explicitly');
select pg_temp.login(16,1);
select lives_ok($$select pg_temp.key(50,array['excess_disposition_handoffs:acknowledge'])$$,'admin can issue acknowledgement keys');
select pg_temp.login(14,1);
select throws_ok($$select pg_temp.key(51,array['excess_disposition_handoffs:acknowledge'])$$,'MQ403',null,'planner cannot issue acknowledgement keys');
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.key(51,array['excess_disposition_handoffs:acknowledge'])$$,'MQ403',null,'branch member cannot issue acknowledgement keys');
select pg_temp.login(11,1);
select throws_ok($$select pg_temp.key(46,array['excess_disposition_handoffs:acknowledge'])$$,'MQ403',null,'viewer cannot issue acknowledgement keys');
select pg_temp.login(15,1);
select throws_ok($$select pg_temp.key(46,array['excess_disposition_handoffs:acknowledge'])$$,'MQ403',null,'approver cannot issue acknowledgement keys');
select pg_temp.login(13,2);
select pg_temp.key(44,array['excess_disposition_handoffs:read','excess_disposition_handoffs:acknowledge'],2);
reset role;
update public.api_keys set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where key_hash=pg_temp.hash(43);
update public.api_keys set revoked_at=now() where key_hash=pg_temp.hash(45);
create function pg_temp.body(n integer,status text default 'received',reason text default null) returns jsonb language sql as $$
select jsonb_build_object('client_event_id',pg_temp.id(n),'external_system','ERP test','external_reference','000123','status',status,'reason',reason)$$;
create function pg_temp.ack(n integer,key_no integer default 40,body jsonb default null) returns jsonb language sql as $$
select public.api_excess_disposition_handoff_acknowledge(pg_temp.hash(key_no),'excess-disposition-handoffs',(select id from lines where n=0),coalesce(body,pg_temp.body(n)))$$;
create temporary table events(n integer,body jsonb);
grant all on events to service_role;
grant select on lines,batches to service_role;
set local role service_role;
select throws_ok($$select pg_temp.ack(2000,53)$$,'MQ403',null,'event permissions grant no disposition writes');
select throws_ok($$select pg_temp.ack(2000,54)$$,'MQ403',null,'all eleven existing scopes grant no acknowledgement writes');
select throws_ok($$select pg_temp.ack(2000,52)$$,'MQ403',null,'transfer acknowledgement scope does not grant disposition writes');
select throws_ok($$select pg_temp.ack(2000,48)$$,'MQ403',null,'purchase acknowledgement permission does not grant disposition writes');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(48),'excess-disposition-handoffs',(select id from lines where n=0))$$,'MQ403',null,'purchase permission does not grant disposition history');
select throws_ok($$select pg_temp.ack(2000,41)$$,'MQ403',null,'read permission does not grant writes');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(42),'excess-disposition-handoffs',(select id from lines where n=0))$$,'MQ403',null,'acknowledge permission does not grant reads');
select throws_ok($$select pg_temp.ack(2000,43)$$,'MQ401',null,'expired key denied');
select throws_ok($$select pg_temp.ack(2000,45)$$,'MQ401',null,'revoked key denied');
select throws_ok($$select pg_temp.ack(2000,99)$$,'MQ401',null,'unknown key denied');
select throws_ok($$select pg_temp.ack(2000,44)$$,'MQ404',null,'cross-tenant writes hidden');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledge(pg_temp.hash(40),'excess-disposition-handoffs',pg_temp.id(999),pg_temp.body(2000))$$,'MQ404',null,'missing package hidden');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledge(pg_temp.hash(40),'items',(select id from lines where n=0),pg_temp.body(2000))$$,'MQ404',null,'resource allowlist');
select throws_ok($$select pg_temp.ack(2000,40,'[]')$$,'MQ422',null,'object body required');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000)||'{"unknown":1}')$$,'MQ422',null,'unknown fields refused');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000)||'{"external_system":null}')$$,'MQ422',null,'null text refused');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000)||'{"external_reference":" "}')$$,'MQ422',null,'blank reference refused');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000)||jsonb_build_object('external_reference',repeat('x',201)))$$,'MQ422',null,'reference bounded');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000)||'{"status":"accepted"}')$$,'MQ422',null,'unapproved status refused');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000,'rejected'))$$,'MQ422',null,'rejection requires a reason');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000,'rejected',' '))$$,'MQ422',null,'rejection reason nonblank');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000,'rejected',E'bad\nreason'))$$,'MQ422',null,'control characters refused');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000)||'{"client_event_id":"bad"}')$$,'MQ422',null,'invalid UUID refused');
insert into events values(1,pg_temp.ack(2000));
select ok(not ((select body->'data' from events where n=1) ?| array['organization_id','location_id','source_location_id','handoff_id','batch_id']),'API event excludes internal tenant/endpoint columns');
select is((select body->>'replayed' from events where n=1),'false','first event created');
select is((select body#>>'{data,external_reference}' from events where n=1),'000123','reference preserves leading zeros');
insert into events values(2,pg_temp.ack(2000,42,pg_temp.body(2000)-'reason'));
select is((select body->>'replayed' from events where n=2),'true','retry works after key rotation and null omission');
select is((select body->'data' from events where n=2),(select body->'data' from events where n=1),'retry retains identity, original key and recording time');
select throws_ok($$select pg_temp.ack(2000,40,pg_temp.body(2000,'rejected','Unknown item'))$$,'MQ409',null,'changed report conflicts');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledge(pg_temp.hash(40),'excess-disposition-handoff-batches',(select id from batches),pg_temp.body(2000))$$,'MQ409',null,'event identity is organization-wide across targets');
insert into events values(3,pg_temp.ack(2001,40,pg_temp.body(2001,'rejected','Unknown item')));
select is(public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(40),'excess-disposition-handoffs',(select id from lines where n=0),(select (body#>>'{data,id}')::uuid from events where n=1))->'data',(select body->'data' from events where n=1),'read original event');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(40),'excess-disposition-handoffs',(select id from lines where n=1),(select (body#>>'{data,id}')::uuid from events where n=1))$$,'MQ404',null,'event must belong to parent');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(44),'excess-disposition-handoffs',(select id from lines where n=0))$$,'MQ404',null,'cross-tenant history denied');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(40),'excess-disposition-handoffs',(select id from lines where n=0),null,null,101)$$,'MQ422',null,'bounded list backstop');
reset role;
select is((select count(*) from public.excess_disposition_handoff_acknowledgements where organization_id=pg_temp.id(1)),2::bigint,'retries and failures add no extra event');
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='excess_disposition_handoff_acknowledgements'),2::bigint,'one audit entry per new event');
update public.excess_disposition_handoff_acknowledgements set recorded_at=statement_timestamp()-interval '1 hour' where organization_id=pg_temp.id(1);
create temporary table pages(n integer,body jsonb);
grant all on pages to service_role;
set local role service_role;
insert into pages values(1,public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(40),'excess-disposition-handoffs',(select id from lines where n=0),null,null,1));
insert into pages values(2,public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(40),'excess-disposition-handoffs',(select id from lines where n=0),null,(select body->>'next_cursor' from pages where n=1),1));
select is((select count(distinct body#>>'{data,0,id}') from pages),2::bigint,'timestamp ties traverse distinct events');
select is((select body->>'next_cursor' from pages where n=2),null,'last page ends');
select is((select count(distinct body->>'as_of') from pages),1::bigint,'paging time bound retained');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(40),'excess-disposition-handoffs',(select id from lines where n=1),null,(select body->>'next_cursor' from pages where n=1),1)$$,'MQ422',null,'cursor binds parent');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(40),'excess-disposition-handoff-batches',(select id from batches),null,(select body->>'next_cursor' from pages where n=1),1)$$,'MQ422',null,'cursor binds resource');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(40),'excess-disposition-handoffs',(select id from lines where n=0),null,'bad',1)$$,'MQ422',null,'malformed cursor refused');
select is(jsonb_array_length(public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(40),'excess-disposition-handoff-batches',(select id from batches))->'data'),0,'individual reports do not propagate to batch');
select lives_ok($$select public.api_excess_disposition_handoff_acknowledge(pg_temp.hash(40),'excess-disposition-handoff-batches',(select id from batches),pg_temp.body(2002))$$,'batch report accepted');
select is(jsonb_array_length(public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(40),'excess-disposition-handoffs',(select id from lines where n=1))->'data'),0,'batch report does not propagate to its other member');
select throws_ok($$update public.excess_disposition_handoff_acknowledgements set reason='changed'$$,'42501',null,'service role cannot directly change events');
reset role;
select pg_temp.login(11,1);
set local role authenticated;
select is((select count(*) from public.excess_disposition_handoff_acknowledgements),3::bigint,'viewer reads own organization history');
select throws_ok($$delete from public.excess_disposition_handoff_acknowledgements$$,'42501',null,'members cannot delete history');
select throws_ok($$select pg_temp.ack(2003)$$,'42501',null,'members cannot call service RPC');
select pg_temp.login(12,1);
select is((select count(*) from public.excess_disposition_handoff_acknowledgements),0::bigint,'unrelated-location member cannot read disposition history');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*) from public.excess_disposition_handoff_acknowledgements),3::bigint,'receiving-location member reads disposition history');
reset role;
delete from public.membership_locations where organization_id=pg_temp.id(1) and user_id=pg_temp.id(12) and location_id=pg_temp.id(20);
set local role authenticated;
select is((select count(*) from public.excess_disposition_handoff_acknowledgements),0::bigint,'removed receiving-location access hides disposition history');
select pg_temp.login(13,2);
select is((select count(*) from public.excess_disposition_handoff_acknowledgements),0::bigint,'other tenant cannot read member history');
reset role;
select pg_temp.login(10,1);
set local role authenticated;
update fixture set proposal=public.excess_disposition_submit(pg_temp.id(1),assessment,pg_temp.id(101),'scrap','2',gen_random_uuid(),'Replacement selection') where n=1;
select pg_temp.login(15,1);
select public.excess_disposition_decide(pg_temp.id(1),proposal,gen_random_uuid(),'approved','Independent review') from fixture where n=1;
reset role;
update public.stock_snapshots set unit_cost=2 where organization_id=pg_temp.id(1);
set local role service_role;
select lives_ok($$select pg_temp.ack(2003)$$,'historical package accepts later reports despite changed stock evidence');
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoffs',id)#>'{data,payload}',original,'individual saved evidence unchanged') from lines;
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoff-batches',id)#>'{data,payload}',payload,'batch saved evidence unchanged') from batches;
reset role;
update public.memberships set role='planner' where organization_id=pg_temp.id(1) and user_id=pg_temp.id(10);
set local role service_role;
select throws_ok($$select pg_temp.ack(2000)$$,'MQ401',null,'creator authority checked even for identical retry');
reset role;
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),0::bigint,'reports add no inbound orders');
select is((select count(*) from public.receipts where organization_id=pg_temp.id(1)),0::bigint,'reports create no receipts');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),52::bigint,'reports add no stock snapshots');
-- Restore authority for exact package history and deletion lifecycle checks.
update public.memberships set role='owner' where organization_id=pg_temp.id(1) and user_id=pg_temp.id(10);
set local role service_role;
select throws_ok($$select public.api_handoff_acknowledge(pg_temp.hash(40),'purchase-handoffs',pg_temp.id(999),'{}')$$,'MQ403',null,'disposition scopes cannot write ordinary purchase reports');
select throws_ok($$select public.api_transfer_handoff_acknowledge(pg_temp.hash(40),'transfer-handoffs',pg_temp.id(999),'{}')$$,'MQ403',null,'disposition scopes cannot write transfer reports');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(40),'excess-disposition-handoff-batches',(select id from batches),(select (body#>>'{data,id}')::uuid from events where n=1))$$,'MQ404',null,'report detail binds exact parent');
select throws_ok($$select public.api_excess_disposition_handoff_acknowledge(pg_temp.hash(40),'excess-disposition-handoff-batches',(select id from batches),pg_temp.body(2000))$$,'MQ409',null,'client identity cannot be reused for a different package');
reset role;
select ok(not has_function_privilege('anon','public.api_excess_disposition_handoff_acknowledge(bytea,text,uuid,jsonb)','execute'),'anonymous cannot invoke write RPC');
select ok(not has_function_privilege('zeespare_worker','public.api_excess_disposition_handoff_acknowledge(bytea,text,uuid,jsonb)','execute'),'worker cannot invoke write RPC');
select is((select count(*) from public.excess_disposition_handoff_acknowledgements where organization_id=pg_temp.id(1)),4::bigint,'exactly four original reports');
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='excess_disposition_handoff_acknowledgements' and operation='INSERT'),4::bigint,'one audit insertion per original report');
delete from public.api_keys where key_hash=pg_temp.hash(40);
select is((select count(*) from public.excess_disposition_handoff_acknowledgements where organization_id=pg_temp.id(1)),4::bigint,'key deletion retains attributed history');
delete from public.excess_stock_assessments where id=(select assessment from fixture where n=1);
select is((select count(*) from public.excess_disposition_handoff_acknowledgements where organization_id=pg_temp.id(1)),1::bigint,'parent deletion cascades only individual history');
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='excess_disposition_handoff_acknowledgements' and operation='DELETE'),3::bigint,'parent cascade is audited');
set local role service_role;
select is(jsonb_array_length(public.api_excess_disposition_handoff_acknowledgements(pg_temp.hash(41),'excess-disposition-handoff-batches',(select id from batches))->'data'),1,'copied batch history survives deletion of its source assessment');
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(41),'excess-disposition-handoff-batches',id)#>'{data,payload}',payload,'retained batch payload remains original') from batches;
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(41),'excess-disposition-handoff-batches',id)#>>'{data,current,selection}','unavailable','retained batch live context is unavailable') from batches;
select lives_ok($$select public.api_excess_disposition_handoff_acknowledge(pg_temp.hash(42),'excess-disposition-handoff-batches',(select id from batches),pg_temp.body(2004))$$,'retained batch accepts new reports');
select is(public.api_excess_disposition_handoff_acknowledge(pg_temp.hash(42),'excess-disposition-handoff-batches',(select id from batches),pg_temp.body(2004))->>'replayed','true','retained batch retry is stable');
select throws_ok($$select pg_temp.ack(2005,42)$$,'MQ404',null,'deleted single cannot receive reports');
reset role;
delete from public.excess_disposition_handoff_batches where id=(select id from batches);
select is((select count(*) from public.excess_disposition_handoff_acknowledgements where organization_id=pg_temp.id(1)),0::bigint,'batch deletion cascades its own history');
select is((select count(*) from public.audit_log where organization_id=pg_temp.id(1) and table_name='excess_disposition_handoff_acknowledgements' and operation='DELETE'),5::bigint,'actual parent cascades audit all five events');
select * from finish();
rollback;
