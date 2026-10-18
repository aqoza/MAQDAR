begin;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('99100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer,org integer) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','org_id',pg_temp.id(org))::text,true)::void$$;
insert into auth.users(id,email) select pg_temp.id(n),'event-'||n||'@test.local' from generate_series(10,16) n;
insert into public.organizations(id,slug,name) values(pg_temp.id(1),'event-policy-a','Events A'),(pg_temp.id(2),'event-policy-b','Events B');
insert into public.memberships(organization_id,user_id,role) values
 (pg_temp.id(1),pg_temp.id(10),'owner'),(pg_temp.id(1),pg_temp.id(11),'viewer'),(pg_temp.id(1),pg_temp.id(12),'branch_user'),
 (pg_temp.id(2),pg_temp.id(13),'owner'),(pg_temp.id(1),pg_temp.id(14),'planner'),(pg_temp.id(1),pg_temp.id(15),'approver'),(pg_temp.id(1),pg_temp.id(16),'admin');
insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone)
 select pg_temp.id(20+n),pg_temp.id(case when n=2 then 2 else 1 end),'L'||n,'Location','branch','SA','Asia/Riyadh' from generate_series(0,2) n;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(21));
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(30+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(20+n),pg_temp.id(40+n),
 '2026-01-01','2026-10-10','forecast','succeeded','{"method":"expanded-v1"}',now(),'{}' from generate_series(0,2) n;
insert into public.forecast_results(id,organization_id,run_id,location_id,item_id,item_code,item_name,status,model,summary,evidence)
 select pg_temp.id(50+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(30+n),pg_temp.id(20+n),pg_temp.id(60+n),'ITEM','Saved item','selected','mean',
 '{"total":"3.003","scores":[]}',
 '{"source":{"start_day":"2026-01-01","end_day":"2026-10-10","introduced_on":null,"discontinued_on":null,"demand":[],"unit_provenance":{"method":"source-units-v1","status":"consistent","unit":"EA","rows":1,"unknown_rows":0,"units":["EA"]}},"output":{"status":"selected","model":"mean","total":"3.003","scores":[],"folds":[],"forecast":[{"date":"2026-10-11","quantity":"1.001"},{"date":"2026-10-12","quantity":"2.002"}],"uncertainty":{"status":"available","bands":[{"lower80":"0","upper80":"2","lower95":"0","upper95":"3"},{"lower80":"0","upper80":"3","lower95":"0","upper95":"4"}]}}}' from generate_series(0,2) n;
insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,finished_at,result)
 select pg_temp.id(100+n),pg_temp.id(case when n=2 then 2 else 1 end),pg_temp.id(20+n),pg_temp.id(110+n),
 '2026-01-01','2026-10-10','policy','succeeded',jsonb_build_object('method','policy-v1','forecast_id',pg_temp.id(50+n),'lead_time',1,'review_interval',1,'service_level','0.95'),now(),'{}' from generate_series(0,2) n;
insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,unit,status,summary,evidence)
 select pg_temp.id(120+n),f.organization_id,pg_temp.id(100+n),f.location_id,f.id,f.item_id,f.item_code,'EA','available',o.output-'calibration',
 jsonb_build_object('method','policy-v1','options',r.options,'forecast',jsonb_build_object('id',f.id,'run_id',f.run_id,'item_id',f.item_id,'unit','EA','method','expanded-v1','to_date','2026-10-10','horizon',2,'source',f.evidence->'source','output',f.evidence->'output'),'output',o.output)
 from generate_series(0,2) n join public.forecast_results f on f.id=pg_temp.id(50+n) join public.planning_runs r on r.id=pg_temp.id(100+n)
 cross join lateral(select '{"status":"available","lead_time":{"days":1,"forecast":"1.001","quantile":"2.001","target":"2.001","safety_stock":"1.000"},"protection":{"days":2,"forecast":"3.003","quantile":"4.003","target":"4.003","safety_stock":"1.000"},"samples":5000,"seed":"baseline-seed","residual_count":20,"positive_days":10,"calibration":[]}'::jsonb output) o;
create temporary table fixture(event uuid,report jsonb,saved uuid,e jsonb,p jsonb);
grant all on fixture to authenticated;
select pg_temp.login(10,1);
set local role authenticated;
insert into fixture(event) select public.planned_event_save(pg_temp.id(1),pg_temp.id(50),'campaign','Launch','Incremental demand','EA',
 '[{"date":"2026-10-11","quantity":"0.009"},{"date":"2026-10-12","quantity":"2.250"}]',true,pg_temp.id(80),
 public.planned_event_preview(pg_temp.id(1),pg_temp.id(50),'campaign','Launch','Incremental demand','EA','[{"date":"2026-10-11","quantity":"0.009"},{"date":"2026-10-12","quantity":"2.250"}]',true)->>'fingerprint');
create function pg_temp.preview(policy integer default 120,reason text default 'Fixed event comparison') returns jsonb language sql as $$
 select public.event_policy_preview(pg_temp.id(1),(select event from fixture),pg_temp.id(policy),reason)$$;
create function pg_temp.save(request integer default 130,fp text default null) returns uuid language sql as $$
 select public.event_policy_save(pg_temp.id(1),(select event from fixture),pg_temp.id(120),'Fixed event comparison',pg_temp.id(request),coalesce(fp,(select report->>'fingerprint' from fixture)))$$;
update fixture set report=pg_temp.preview(),e=(select report from public.planned_event_scenarios where id=fixture.event),p=(select evidence from public.inventory_policies where id=pg_temp.id(120));
select is((select report->>'status' from fixture),'available','matching saved sources available');
select is((select report#>>'{periods,lead_time,addition}' from fixture),'0.009','only first-day additions in lead period');
select is((select report#>>'{periods,lead_time,adjusted,target}' from fixture),'2.01','exact decimal reorder reference');
select is((select report#>>'{periods,protection,addition}' from fixture),'2.259','protection includes final boundary day');
select is((select report#>>'{periods,protection,adjusted,target}' from fixture),'6.262','exact periodic maximum');
select is((select report#>>'{periods,protection,adjusted,forecast}' from fixture),'5.262','event-adjusted demand');
select is((select report#>>'{periods,protection,adjusted,safety_stock}' from fixture),'1.000','baseline safety stock unchanged');
select is((select report#>'{policy,evidence}' from fixture),(select p from fixture),'entire policy evidence retained');
select is((select report->'event' from fixture),(select e from fixture),'entire event evidence retained');
select is(pg_temp.preview(121)->>'status','source_mismatch','different forecast/location unavailable');
select throws_ok($$select pg_temp.preview(122)$$,'MQ404','event policy source unavailable','cross-tenant policy denied');
select throws_ok($$select pg_temp.preview(120,' ')$$,'MQ422','event policy reason required','reason required');
select throws_ok($$select pg_temp.preview(120,E'\n\t')$$,'MQ422','event policy reason required','whitespace-only reason refused through RPC');
select throws_ok($$select pg_temp.save(130,repeat('a',64))$$,'MQ409','event policy evidence changed; refresh preview','forged fingerprint rejected');
update fixture set saved=pg_temp.save();
select is(pg_temp.save(),(select saved from fixture),'retry returns original comparison');
select throws_ok($$select pg_temp.save(130,repeat('b',64))$$,'MQ409','event policy request conflicts','conflicting retry rejected');
select is((select count(*)::integer from public.event_policy_scenarios),1,'one saved comparison');
select is((select count(*)::integer from public.inventory_policies where organization_id=pg_temp.id(1)),2,'no new calculated policy');
select is((select evidence from public.inventory_policies where id=pg_temp.id(120)),(select p from fixture),'calculated policy unchanged');
select is((select count(*)::integer from public.policy_overrides where organization_id=pg_temp.id(1)),0,'no override created');
select is((select count(*)::integer from public.replenishment_drafts where organization_id=pg_temp.id(1)),0,'no replenishment created');
select is((select count(*)::integer from public.open_orders where organization_id=pg_temp.id(1)),0,'no inbound created');
select throws_ok($$update public.event_policy_scenarios set report='{}'$$,'42501',null,'direct update denied');
select throws_ok($$insert into public.event_policy_scenarios default values$$,'42501',null,'direct insert denied');
select throws_ok($$delete from public.event_policy_scenarios$$,'42501',null,'direct delete denied');
select pg_temp.login(11,1);
select is((select count(*)::integer from public.event_policy_scenarios),1,'viewer reads saved history');
select lives_ok($$select pg_temp.preview()$$,'viewer can inspect preview');
select throws_ok($$select pg_temp.save()$$,'MQ403','event policy save forbidden','viewer cannot save or retry');
select pg_temp.login(15,1);
select throws_ok($$select pg_temp.save()$$,'MQ403','event policy save forbidden','approver cannot save');
select pg_temp.login(12,1);
select is((select count(*)::integer from public.event_policy_scenarios),0,'branch history scoped');
select throws_ok($$select pg_temp.preview()$$,'MQ404','event policy source unavailable','definer preserves branch scope');
select pg_temp.login(13,2);
select is((select count(*)::integer from public.event_policy_scenarios),0,'foreign tenant reads no history');
select throws_ok($$select pg_temp.save()$$,'MQ403','event policy save forbidden','foreign tenant cannot replay');
select pg_temp.login(10,2);
select throws_ok($$select pg_temp.preview()$$,'MQ404','event policy source unavailable','stale active-org claim narrows access');
reset role;
insert into public.membership_locations values(pg_temp.id(1),pg_temp.id(12),pg_temp.id(20));
select pg_temp.login(12,1);set local role authenticated;
select is((select count(*)::integer from public.event_policy_scenarios),1,'authorized branch reads history');
select lives_ok($$select pg_temp.preview()$$,'authorized branch inspects preview');
reset role;
-- Independent numerical oracles and malformed-evidence checks for the private calculator.
create function pg_temp.calc(e jsonb default null,p jsonb default null) returns jsonb language sql as $$
 select app.event_policy_calculate(coalesce(e,(select e from fixture)),coalesce(p,(select p from fixture)))$$;
select is(pg_temp.calc(jsonb_set((select e from fixture),'{input,additions}','[{"date":"2026-10-11","quantity":"999999999999999.999"}]'))#>>'{periods,lead_time,adjusted,target}', '1000000000000002','full decimal quantity range survives threshold addition');
select is(pg_temp.calc(jsonb_set((select e from fixture),'{input,additions}','[{"date":"2026-10-11","quantity":"0"}]'))#>>'{periods,protection,adjusted,target}','4.003','zero scenario exactly preserves baseline');
create temporary table short as select jsonb_set(jsonb_set((select p from fixture),'{options,lead_time}','0'),'{output,lead_time}','{"days":0,"forecast":"0.000","quantile":"0.000","target":"0.000","safety_stock":"0.000"}') p;
update short set p=jsonb_set(p,'{output,protection}','{"days":1,"forecast":"1.001","quantile":"2.001","target":"2.001","safety_stock":"1.000"}');
select is(pg_temp.calc(null,(select p from short))#>>'{periods,lead_time,adjusted,target}','0','zero lead period stays zero');
select is(pg_temp.calc(null,(select p from short))#>>'{periods,protection,adjusted,target}','2.01','one-day protection excludes later event');
select is(pg_temp.calc(null,(select p from short))->>'outside_addition','2.25','excluded later additions remain visible');
select is(pg_temp.calc(jsonb_set((select e from fixture),'{source,evidence,source,discontinued_on}','"2026-10-11"'),jsonb_set((select p from short),'{forecast,source,discontinued_on}','"2026-10-11"'))->>'status','lifecycle_conflict','lifecycle applies beyond the protection period too');
select is(pg_temp.calc(jsonb_set(jsonb_set((select e from fixture),'{source,evidence,source,discontinued_on}','"2026-10-11"'),'{input,additions}','[{"date":"2026-10-12","quantity":"0"}]'),jsonb_set((select p from fixture),'{forecast,source,discontinued_on}','"2026-10-11"'))->>'status','available','zero additions outside lifecycle are harmless');
create temporary table zero_day as select jsonb_set((select e from fixture),'{source,evidence,output,forecast,0,quantity}','"0"') e,
 jsonb_set((select p from fixture),'{forecast,output,forecast,0,quantity}','"0"') p;
update zero_day set p=jsonb_set(jsonb_set(p,'{output,lead_time}','{"days":1,"forecast":"0.000","quantile":"1.000","target":"1.000","safety_stock":"1.000"}'),'{output,protection}','{"days":2,"forecast":"2.002","quantile":"3.002","target":"3.002","safety_stock":"1.000"}');
select is(pg_temp.calc((select e from zero_day),(select p from zero_day))#>>'{periods,lead_time,adjusted,target}','1.009','positive event on eligible zero-baseline day retained');
select is(pg_temp.calc(null,jsonb_set((select p from fixture),'{options,review_interval}','2'))->>'status','evidence_invalid','protection must fit saved horizon');
select is(pg_temp.calc(null,jsonb_set((select p from fixture),'{forecast,unit}','"SET"'))->>'status','source_mismatch','known units must match');
select is(pg_temp.calc(null,jsonb_set((select p from fixture),'{forecast,to_date}','"2026-10-09"'))->>'status','source_mismatch','cutoff must match');
select is(pg_temp.calc(jsonb_set((select e from fixture),'{input,additions}','[{"date":"2026-10-13","quantity":"1"}]'))->>'status','evidence_invalid','dates outside horizon unavailable');
select is(pg_temp.calc(jsonb_set((select e from fixture),'{input,additions}','[{"date":"2026-10-11","quantity":"-1"}]'))->>'status','evidence_invalid','negative corrupted addition unavailable');
select is(pg_temp.calc(jsonb_set((select e from fixture),'{input,additions}','[{"date":"2026-10-11","quantity":"1"},{"date":"2026-10-11","quantity":"2"}]'))->>'status','evidence_invalid','duplicate dates cannot double count');
select is(pg_temp.calc(null,jsonb_set((select p from fixture),'{output,protection,safety_stock}','"9.000"'))->>'status','evidence_invalid','inconsistent safety stock unavailable');
-- Lifecycle uses the shared saved source, never the current item catalog.
select is(pg_temp.calc(jsonb_set((select e from fixture),'{source,evidence,source,introduced_on}','"2026-10-12"'),jsonb_set((select p from fixture),'{forecast,source,introduced_on}','"2026-10-12"'))->>'status','lifecycle_conflict','positive event before introduction refused');
select is(pg_temp.calc(jsonb_set((select e from fixture),'{source,evidence,source,discontinued_on}','"2026-10-11"'),jsonb_set((select p from fixture),'{forecast,source,discontinued_on}','"2026-10-11"'))->>'status','lifecycle_conflict','positive event after discontinuation refused');
select is(pg_temp.calc(jsonb_set((select e from fixture),'{source,evidence,source,discontinued_on}','"2026-10-12"'),jsonb_set((select p from fixture),'{forecast,source,discontinued_on}','"2026-10-12"'))->>'status','available','discontinuation boundary is inclusive');
select is(pg_temp.calc(jsonb_set((select e from fixture),'{source,evidence,source,introduced_on}','"2026-10-11"'),jsonb_set((select p from fixture),'{forecast,source,introduced_on}','"2026-10-11"'))->>'status','available','introduction boundary is inclusive');
select is(pg_temp.calc((select e #- '{source,evidence,source,introduced_on}' from fixture),(select p #- '{forecast,source,introduced_on}' from fixture))->>'status','evidence_invalid','missing lifecycle field is not silently unbounded');
select is(pg_temp.calc(jsonb_set((select e from fixture),'{source,evidence,source,introduced_on}','"bad"'),jsonb_set((select p from fixture),'{forecast,source,introduced_on}','"bad"'))->>'status','evidence_invalid','malformed lifecycle date handled explicitly');
select is(pg_temp.calc(jsonb_set((select e from fixture),'{source,evidence,source,introduced_on}','"-infinity"'),jsonb_set((select p from fixture),'{forecast,source,introduced_on}','"-infinity"'))->>'status','evidence_invalid','special PostgreSQL dates are not lifecycle evidence');
update public.inventory_policies set status='no_positive_history' where id=pg_temp.id(120);
select pg_temp.login(10,1);set local role authenticated;
select is(pg_temp.preview()->>'status','policy_unavailable','unavailable baseline has no invented thresholds');
select is(pg_temp.save(),(select saved from fixture),'historical retry survives later source changes');
select is((select report from public.event_policy_scenarios),(select report from fixture),'stored comparison never recomputed');
select throws_ok($$select pg_temp.save(131)$$,'MQ409','event policy evidence changed; refresh preview','changed source invalidates new save');
reset role;
update public.inventory_policies set status='available' where id=pg_temp.id(120);
select pg_temp.login(14,1);set local role authenticated;
select lives_ok($$select pg_temp.save(132)$$,'planner can save');
select pg_temp.login(16,1);
select lives_ok($$select pg_temp.save(133)$$,'admin can save');
select throws_ok($$select pg_temp.save(130)$$,'MQ409','event policy request conflicts','another author cannot replay owner request');
reset role;
select is((select count(*)::integer from public.audit_log where organization_id=pg_temp.id(1) and table_name='event_policy_scenarios'),3,'one audit per new save');
set local role anon;
select throws_ok($$select * from public.event_policy_scenarios$$,'42501',null,'anonymous cannot read');
select throws_ok($$select pg_temp.preview()$$,'42501',null,'anonymous cannot preview');
reset role;
select * from finish();
rollback;
