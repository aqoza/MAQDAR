begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
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
create function pg_temp.key(n integer,scopes text[] default array['excess_disposition_handoffs:read'],org integer default 1) returns uuid language sql as $$select public.create_api_key(pg_temp.id(org),'Test key '||n,scopes,30,pg_temp.hash(n),'maqdar_sk_test','test')$$;
select pg_temp.login(10,1);
set local role authenticated;
select lives_ok($$select pg_temp.key(40)$$,'owner can issue explicit handoff permission');
select lives_ok($$select pg_temp.key(41)$$,'expiry fixture');
select lives_ok($$select pg_temp.key(42)$$,'revocation fixture');
select lives_ok($$select pg_temp.key(43,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read','transfer_handoffs:acknowledge','event_purchase_handoffs:read','event_purchase_handoffs:acknowledge'])$$,'legacy scopes still accepted');
select throws_ok($$select pg_temp.key(45,array['excess_disposition_handoffs:write'])$$,'MQ422',null,'no handoff write scope');
select throws_ok($$select pg_temp.key(45,array['excess_disposition_handoffs:read',null])$$,'MQ422',null,'null scope refused');
select lives_ok($$select pg_temp.key(46,array['master_data:read','master_data:write','transactions:read','transactions:write','purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read','transfer_handoffs:acknowledge','event_purchase_handoffs:read','event_purchase_handoffs:acknowledge','excess_disposition_handoffs:read'])$$,'all eleven scopes accepted explicitly');
select throws_ok($$select pg_temp.key(45,array['excess_disposition_handoffs:execute'])$$,'MQ422',null,'disposition execution is not enabled');
select pg_temp.login(16,1);
select lives_ok($$select pg_temp.key(47)$$,'admin can issue disposition reader');
select pg_temp.login(14,1);
select throws_ok($$select pg_temp.key(45)$$,'MQ403',null,'planner cannot issue organization-wide keys');
select pg_temp.login(11,1);
select throws_ok($$select pg_temp.key(45)$$,'MQ403',null,'viewer cannot issue organization-wide keys');
select pg_temp.login(12,1);
select throws_ok($$select pg_temp.key(45)$$,'MQ403',null,'branch member cannot issue keys');
select pg_temp.login(15,1);
select throws_ok($$select pg_temp.key(45)$$,'MQ403',null,'approver cannot issue keys');
select pg_temp.login(13,2);
select lives_ok($$select pg_temp.key(44,array['excess_disposition_handoffs:read'],2)$$,'other tenant key fixture');
reset role;
update public.api_keys set expires_at=created_at+interval '1 second',created_at=now()-interval '2 days' where key_hash=pg_temp.hash(41);
update public.api_keys set expires_at=now()-interval '1 day' where key_hash=pg_temp.hash(41);
update public.api_keys set revoked_at=now() where key_hash=pg_temp.hash(42);
create temporary table pages(n integer,body jsonb);
grant all on lines,batches,pages to service_role;
-- Cookie/branch claims cannot narrow or replace the explicit key organization.
select pg_temp.login(12,1);
set local role service_role;
select throws_ok($$select * from app.excess_disposition_handoff_api_records$$,'42501',null,'projection is private even to service role');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(43),'excess-disposition-handoffs')$$,'MQ403',null,'existing scopes do not imply handoff read');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(41),'excess-disposition-handoffs')$$,'MQ401',null,'expired key refused');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(42),'excess-disposition-handoff-batches')$$,'MQ401',null,'revoked key refused');
select throws_ok($$select public.api_excess_disposition_handoff_get(pg_temp.hash(99),'excess-disposition-handoffs',pg_temp.id(1))$$,'MQ401',null,'unknown key refused');
select is(jsonb_array_length(public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs')->'data'),3,'explicit key reads whole organization despite unrelated branch claims');
insert into pages values(1,public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs',null,1,'2026-10-01T00:00:00Z'));
insert into pages values(2,public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs',(select body->>'next_cursor' from pages where n=1),1,'2026-10-01T00:00:00Z'));
insert into pages values(3,public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs',(select body->>'next_cursor' from pages where n=2),1,'2026-10-01T00:00:00Z'));
select is((select jsonb_array_length(body->'data') from pages where n=1),1,'bounded first page');
select is((select count(distinct body#>>'{data,0,id}') from pages),3::bigint,'timestamp ties traversed exactly once');
select is((select array_agg((body#>>'{data,0,id}')::uuid order by n) from pages),(select array_agg(id order by id) from lines),'UUID ascending tiebreak');
select is((select count(distinct body->>'as_of') from pages),1::bigint,'creation upper bound stable across pages');
select is((select body->>'next_cursor' from pages where n=3),null,'final page ends cursor');
select ok(not (select (body#>'{data,0}')?'payload' from pages where n=1),'lists omit full evidence');
select is(jsonb_array_length(public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs',null,100,'2026-10-01T00:00:01Z')->'data'),0,'created_since is inclusive creation filter');
select is(jsonb_array_length(public.api_excess_disposition_handoff_list(pg_temp.hash(44),'excess-disposition-handoffs')->'data'),0,'other organization list empty');
select throws_ok($$select public.api_excess_disposition_handoff_get(pg_temp.hash(44),'excess-disposition-handoffs',(select id from lines where n=0))$$,'MQ404',null,'cross-tenant detail indistinguishable from missing');
select throws_ok($$select public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoffs',pg_temp.id(999))$$,'MQ404',null,'missing detail');
select throws_ok($$select public.api_excess_disposition_handoff_get(pg_temp.hash(44),'excess-disposition-handoff-batches',(select id from batches))$$,'MQ404',null,'cross-tenant batch detail hidden');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(40),'items')$$,'MQ404',null,'resource allowlist');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs',null,101)$$,'MQ422',null,'SQL backstop limit');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs',null,1,'infinity')$$,'MQ422',null,'finite creation filter');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs','malformed')$$,'MQ422',null,'malformed cursor');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoff-batches',(select body->>'next_cursor' from pages where n=1),1,'2026-10-01T00:00:00Z')$$,'MQ422',null,'cursor cannot cross resource');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(44),'excess-disposition-handoffs',(select body->>'next_cursor' from pages where n=1),1,'2026-10-01T00:00:00Z')$$,'MQ422',null,'cursor cannot cross organization');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs',(select body->>'next_cursor' from pages where n=1),1,'2026-10-02T00:00:00Z')$$,'MQ422',null,'cursor requires original filter');
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoffs',id)#>'{data,payload}',original,'individual evidence unchanged') from lines;
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoff-batches',id)#>'{data,payload}',payload,'batch evidence unchanged') from batches;
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoff-batches',(select id from batches))#>>'{data,current,selection}','current','all selected batch');
reset role;
-- Immutable snapshots and separate units, never rounded or pooled.
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoff-batches',id)#>>'{data,summary,reference_value}','7.499250','exact value retains all saved digits') from batches;
select ok(not(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoff-batches',id)#>'{data,summary}' ? 'quantity'),'summary never pools quantities') from batches;
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoff-batches',id)#>'{data,summary,handoff_ids}',(select jsonb_agg(x order by x) from unnest(ids) x),'original member IDs retained') from batches;
select is(jsonb_typeof(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoff-batches',id)#>'{data,current,checked_at}'),'string','live status timestamp separate from evidence') from batches;
reset role;
-- New independent approval replaces one selection, without editing any saved handoff.
select pg_temp.login(14);
set local role authenticated;
create temporary table replacement as select public.excess_disposition_submit(pg_temp.id(1),(select assessment from fixture where n=1),pg_temp.id(101),'scrap','2',gen_random_uuid(),'Replacement') id;
select pg_temp.login(10);
select public.excess_disposition_decide(pg_temp.id(1),id,gen_random_uuid(),'approved','Independent replacement') from replacement;
reset role;
update public.stock_snapshots set unit_cost=2 where organization_id=pg_temp.id(1);
set local role service_role;
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoffs',(select id from lines where n=0))#>>'{data,current,selection}','historical','superseded handoff is historical');
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoff-batches',id)#>>'{data,current,selection}','historical','superseded member makes batch historical') from batches;
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoffs',id)#>'{data,payload}',original,'approval/stock edits preserve original payload') from lines;
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoff-batches',id)#>'{data,payload}',payload,'approval/stock edits preserve copied batch') from batches;
reset role;
update public.memberships set role='planner' where organization_id=pg_temp.id(1) and user_id=pg_temp.id(10);
set local role service_role;
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs')$$,'MQ401',null,'creator authority checked on every read');
reset role;
update public.memberships set role='owner' where organization_id=pg_temp.id(1) and user_id=pg_temp.id(10);
select ok((select last_used_at is not null from public.api_keys where key_hash=pg_temp.hash(40)),'existing usage bookkeeping retained');
select ok(not('excess_disposition_handoffs:read'=any((select scopes from public.api_keys where key_hash=pg_temp.hash(43))::text[])),'existing key permissions unchanged');
-- Source assessment cascade deletes its individual handoff, while the batch copy survives.
delete from public.excess_stock_assessments where id=(select assessment from fixture where n=2);
set local role service_role;
select throws_ok($$select public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoffs',(select id from lines where n=1))$$,'MQ404',null,'deleted single handoff has no invented live record');
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoff-batches',id)#>'{data,payload}',payload,'source deletion retains original batch evidence') from batches;
select is(public.api_excess_disposition_handoff_get(pg_temp.hash(40),'excess-disposition-handoff-batches',id)#>>'{data,current,selection}','unavailable','missing context takes priority over historical selection') from batches;
select is(public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoff-batches')#>>'{data,0,current,selection}','unavailable','source-unavailable batches remain listed');
select throws_ok($$select public.api_handoff_list(pg_temp.hash(40),'purchase-handoffs')$$,'MQ403',null,'disposition scope grants no ordinary purchasing access');
select throws_ok($$select public.api_transfer_handoff_list(pg_temp.hash(40),'transfer-handoffs')$$,'MQ403',null,'disposition scope grants no transfer access');
select throws_ok($$select public.api_event_purchase_handoff_list(pg_temp.hash(40),'event-purchase-handoffs')$$,'MQ403',null,'disposition scope grants no event access');
select throws_ok($$select public.api_handoff_acknowledge(pg_temp.hash(40),'purchase-handoffs',pg_temp.id(1),'{}')$$,'MQ403',null,'disposition scope grants no acknowledgement write');
select throws_ok($$select * from public.excess_disposition_handoffs$$,'42501',null,'API role has no direct source access');
select throws_ok($$select * from public.excess_disposition_handoff_batches$$,'42501',null,'API role has no direct batch access');
reset role;
select pg_temp.login(12);
set local role authenticated;
select is((select count(*) from public.excess_disposition_handoff_batches),0::bigint,'browser location restrictions unchanged');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs')$$,'42501',null,'member cannot invoke integration RPC');
select throws_ok($$select * from app.excess_disposition_handoff_api_records$$,'42501',null,'private projection denied to members');
reset role;
select ok(not has_function_privilege('anon','public.api_excess_disposition_handoff_get(bytea,text,uuid)','execute'),'anon RPC denied');
select ok(not has_function_privilege('maqdar_worker','public.api_excess_disposition_handoff_get(bytea,text,uuid)','execute'),'worker RPC denied');
select is((select count(*) from public.open_orders where organization_id=pg_temp.id(1)),0::bigint,'reads create no orders');
select is((select count(*) from public.stock_snapshots where organization_id=pg_temp.id(1)),52::bigint,'reads create no stock');
select is((select count(*) from public.excess_disposition_handoff_batches where organization_id=pg_temp.id(1)),1::bigint,'reads create no batches');
-- Creation upper bounds and default limits apply independently of live selection.
update public.excess_disposition_handoffs set created_at=statement_timestamp()+interval '1 hour' where id=(select id from lines where n=2);
set local role service_role;
select is(jsonb_array_length(public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs')->'data'),1,'future creations excluded');
select throws_ok($$select public.api_excess_disposition_handoff_list(pg_temp.hash(40),'excess-disposition-handoffs',null,0)$$,'MQ422',null,'zero limit refused');
select throws_ok($$select public.api_excess_disposition_handoff_get(pg_temp.hash(40),'purchase-handoffs',pg_temp.id(1))$$,'MQ404',null,'detail resource allowlist');
reset role;
select * from finish();
rollback;
