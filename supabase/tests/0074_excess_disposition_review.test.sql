begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('a2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer default 1) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'excess-'||n||'@test.local' from generate_series(10,14) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'excess-a','Excess A'),(pg_temp.id(2),'excess-b','Excess B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),
 (pg_temp.id(1),pg_temp.id(12),'branch_user'),(pg_temp.id(2),pg_temp.id(13),'owner'),(pg_temp.id(1),pg_temp.id(14),'planner');
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
create temporary table fixture(assessment uuid,proposal uuid,later uuid);
grant all on fixture to authenticated;
create function pg_temp.submit(q text default '3.333',k text default 'supplier_return',req integer default 901,it integer default 101) returns uuid language sql as $$select public.excess_disposition_submit(pg_temp.id(1),(select assessment from fixture),pg_temp.id(it),k,q,pg_temp.id(req),' Planned disposition ')$$;
create function pg_temp.decide(d text default 'approved',req integer default 951) returns uuid language sql as $$select public.excess_disposition_decide(pg_temp.id(1),(select proposal from fixture),pg_temp.id(req),d,'Reviewed')$$;
create function pg_temp.evidence() returns jsonb language sql as $$select public.excess_disposition_preview(pg_temp.id(1),(select assessment from fixture),pg_temp.id(101))$$;
select pg_temp.login(14);
set local role authenticated;
insert into fixture(assessment) select public.excess_stock_save(pg_temp.id(1),pg_temp.choices(),'Assessment',true,pg_temp.id(900),public.excess_stock_preview(pg_temp.id(1),pg_temp.choices())->>'fingerprint');
select is(pg_temp.evidence()->>'matches','true','original chosen line evidence matches');
select throws_ok($$select pg_temp.submit('0')$$,'MQ422','positive disposition quantity required','zero rejected');
select throws_ok($$select pg_temp.submit('-1')$$,'MQ422','invalid disposition proposal','negative rejected');
select throws_ok($$select pg_temp.submit('1.0001')$$,'MQ422','invalid disposition proposal','no silent quantity rounding');
select throws_ok($$select pg_temp.submit('NaN')$$,'MQ422','invalid disposition proposal','nonfinite rejected');
select throws_ok($$select pg_temp.submit('1e1')$$,'MQ422','invalid disposition proposal','exponent rejected');
select throws_ok($$select pg_temp.submit('1000000000000000')$$,'MQ422','invalid disposition proposal','numeric bounds enforced');
select throws_ok($$select pg_temp.submit('18.001')$$,'MQ422','quantity exceeds saved assessment line','above saved quantity rejected');
select throws_ok($$select pg_temp.submit('1','scrap',901,104)$$,'MQ422','quantity exceeds saved assessment line','zero-excess source rejected');
select throws_ok($$select pg_temp.submit('1','transfer')$$,'MQ422','invalid disposition proposal','unsupported intent rejected');
select throws_ok($$select public.excess_disposition_submit(pg_temp.id(1),(select assessment from fixture),pg_temp.id(101),'scrap','1',pg_temp.id(901),' ')$$,'MQ422','invalid disposition proposal','reason required');
select throws_ok($$select public.excess_disposition_preview(pg_temp.id(1),(select assessment from fixture),pg_temp.id(105))$$,'MQ404','assessment line unavailable','unselected item rejected');
update fixture set proposal=pg_temp.submit();
select is((select quantity from public.excess_disposition_list),'3.333','exact saved quantity as text');
select is((select reference_value from public.excess_disposition_list)::numeric,3.749625::numeric,'reference value uses saved snapshot cost without currency rounding');
select is((select reason from public.excess_disposition_proposals),'Planned disposition','reason trimmed');
select is((select line from public.excess_disposition_proposals),pg_temp.evidence()->'line','selected evidence copied');
select is(pg_temp.submit('03.333'),(select proposal from fixture),'equivalent decimal retry returns original');
select throws_ok($$select pg_temp.submit('3.334')$$,'MQ409','proposal request conflicts','conflicting quantity retry rejected');
select throws_ok($$select pg_temp.submit('3.333','scrap')$$,'MQ409','proposal request conflicts','conflicting kind retry rejected');
select throws_ok($$select pg_temp.submit('3','scrap',902)$$,'MQ409','assessment line has a pending proposal','one pending across disposition kinds');
select throws_ok($$select pg_temp.decide()$$,'MQ403','independent reviewer required','planner cannot self approve');
select throws_ok($$update public.excess_disposition_proposals set quantity=1$$,'42501',null,'direct edits denied');
select throws_ok($$delete from public.excess_disposition_proposals$$,'42501',null,'direct delete denied');
select pg_temp.login(11);
select is((select count(*)::int from public.excess_disposition_list),1,'viewer reads scoped history');
select throws_ok($$select pg_temp.submit('1','scrap',903)$$,'MQ403','disposition requires an editor','viewer submit denied');
select throws_ok($$select pg_temp.decide('rejected')$$,'MQ403','independent reviewer required','viewer review denied');
select throws_ok($$select pg_temp.decide('withdrawn')$$,'MQ403','only the author may withdraw','non-author withdrawal denied');
select pg_temp.login(12);
select is((select count(*)::int from public.excess_disposition_list),0,'branch source hidden');
select throws_ok($$select pg_temp.evidence()$$,'MQ404','assessment line unavailable','branch preview denied');
select throws_ok($$select pg_temp.decide()$$,'MQ404','proposal unavailable','branch decision hidden');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
set local role authenticated;
select is((select count(*)::int from public.excess_disposition_list),1,'branch grant reveals only permitted history');
select lives_ok($$select pg_temp.evidence()$$,'branch can inspect evidence');
reset role;
delete from public.membership_locations where user_id=pg_temp.id(12);
set local role authenticated;
select is((select count(*)::int from public.excess_disposition_list),0,'removed branch grant hides history immediately');
select pg_temp.login(13,2);
select is((select count(*)::int from public.excess_disposition_proposals),0,'foreign tenant cannot read proposals');
select throws_ok($$select pg_temp.evidence()$$,'MQ404','assessment line unavailable','foreign preview denied');
select pg_temp.login(10,2);
select is((select count(*)::int from public.excess_disposition_proposals),0,'active claim narrows access');
select pg_temp.login(10);
select throws_ok($$select pg_temp.decide('approved',null)$$,'MQ422','invalid disposition decision','decision retry identity required');
reset role;
update public.stock_snapshots set quantity=31 where organization_id=pg_temp.id(1) and item_id=pg_temp.id(102);
set local role authenticated;
select is(pg_temp.evidence()->>'matches','true','other assessment line correction does not block selected line');
select is(pg_temp.decide(),(select proposal from fixture),'independent owner approves unchanged selected line');
select is((select selected from public.excess_disposition_list),true,'approval is selected for exact assessment/item');
select is(pg_temp.decide(),(select proposal from fixture),'decision retry stable');
select throws_ok($$select pg_temp.decide('rejected',952)$$,'MQ409','proposal already decided','terminal decision immutable');
select pg_temp.login(14);
update fixture set later=pg_temp.submit('18','scrap',904);
select is((select count(*)::int from public.excess_disposition_list where selected),1,'pending replacement leaves earlier selection');
select pg_temp.login(10);
select is(public.excess_disposition_decide(pg_temp.id(1),(select later from fixture),pg_temp.id(953),'approved','Replacement'),(select later from fixture),'full saved bound and scrap allowed');
select is((select id from public.excess_disposition_list where selected),(select later from fixture),'later approved revision replaces selection');
select is((select count(*)::int from public.excess_disposition_list where status='approved'),2,'earlier decisions retained');
select pg_temp.login(14);
update fixture set proposal=pg_temp.submit('1','supplier_return',905);
reset role;
update public.stock_snapshots set quantity=31 where organization_id=pg_temp.id(1) and item_id=pg_temp.id(101) and snapshot_date='2026-10-10';
set local role authenticated;
select is(pg_temp.evidence()->>'matches','false','selected snapshot correction detected');
select is(pg_temp.submit('1','supplier_return',905),(select proposal from fixture),'original submit retry survives source correction');
select pg_temp.login(10);
select throws_ok($$select pg_temp.decide('approved',954)$$,'MQ409','assessment evidence changed','stale approval blocked');
select lives_ok($$select pg_temp.decide('rejected',954)$$,'stale proposal can be rejected');
select pg_temp.login(14);
select throws_ok($$select pg_temp.submit('1','supplier_return',906)$$,'MQ409','assessment evidence changed','new proposal requires new assessment after correction');
reset role;
update public.stock_snapshots set quantity=30.001 where organization_id=pg_temp.id(1) and item_id=pg_temp.id(101) and snapshot_date='2026-10-10';
set local role authenticated;
update fixture set proposal=pg_temp.submit('1','scrap',907);
reset role;
delete from public.planning_runs where id=pg_temp.id(201);
update public.memberships set role='viewer' where user_id=pg_temp.id(14);
set local role authenticated;
select is(pg_temp.evidence()->>'matches','false','missing source policy detected without hiding saved evidence');
select is(pg_temp.decide('withdrawn',955),(select proposal from fixture),'author withdraws after demotion and source deletion');
select is((select count(*)::int from public.excess_disposition_list),4,'history survives source policy deletion');
select is((select id from public.excess_disposition_list where selected),(select later from fixture),'rejection and withdrawal preserve selected approval');
reset role;
select is((select count(*)::int from public.audit_log where organization_id=pg_temp.id(1) and table_name='excess_disposition_proposals'),8,'four submissions and four decisions, retries do not duplicate audits');
select is((select quantity from public.stock_snapshots where organization_id=pg_temp.id(1) and item_id=pg_temp.id(101) and snapshot_date='2026-10-10'),30.001::numeric,'review never moves or reserves stock');
set local role anon;
select throws_ok($$select pg_temp.evidence()$$,'42501',null,'anonymous preview denied');
reset role;
select * from finish();
rollback;
