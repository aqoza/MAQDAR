-- Step 28b: forecast explanations share existing opt-in, quotas and immutable lifecycle.
-- Roll back by removing the forecast entry point; retain captured history.
set lock_timeout='5s';
alter table public.policy_explanations
 add column subject_kind text not null default 'policy' check(subject_kind in ('policy','forecast')),
 add column forecast_id uuid,
 alter column policy_id drop not null,
 alter column policy_run_id drop not null,
 add constraint explanation_subject check(
  (subject_kind='policy' and policy_id is not null and policy_run_id is not null and forecast_id is null)
  or (subject_kind='forecast' and policy_id is null and policy_run_id is null and forecast_id is not null));
create index policy_explanations_forecast on public.policy_explanations(organization_id,forecast_id,created_at desc) where subject_kind='forecast';

create function public.forecast_explainer_preview(p_organization_id uuid,p_forecast_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f public.forecast_results; r public.planning_runs; report jsonb; o jsonb; unit_value text; method_value text;
begin
 if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
  raise exception using errcode='MQ404',message='forecast unavailable'; end if;
 select * into f from public.forecast_results where organization_id=p_organization_id and id=p_forecast_id;
 if f.id is null or (not(p_organization_id=any(array(select app.unscoped_organizations()))) and not(f.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='forecast unavailable'; end if;
 select * into r from public.planning_runs where organization_id=p_organization_id and id=f.run_id;
 method_value:=coalesce(r.options->>'method','baseline-v1');
 unit_value:=f.evidence#>>'{source,unit_provenance,unit}';
 if r.status is distinct from 'succeeded' or r.kind is distinct from 'forecast' or f.status<>'selected'
  or method_value not in ('baseline-v1','expanded-v1','driver-v1','multi-driver-v1') or f.evidence#>'{source,preparation}' is not null
  or f.evidence#>>'{source,unit_provenance,status}' is distinct from 'consistent' or unit_value is null or unit_value not in ('EA','SET','L','KG') then
  raise exception using errcode='MQ422',message='choose a selected individual-item forecast with known demand units'; end if;
 o:=f.evidence->'output';
 -- Project every nested field explicitly. Never include transactions, driver datasets, names, IDs or prices.
 report:=jsonb_build_object('method','forecast-explainer-v1','unit',unit_value,
  'forecast_context',jsonb_build_object('method',method_value,'from_date',r.from_date,'cutoff',r.to_date,'horizon_days',(r.options->>'horizon')::integer,'selected_model',f.model),
  'model_comparison',jsonb_build_object(
   'scores',coalesce((select jsonb_agg(jsonb_build_object('model',v->>'model','rmse',v->>'rmse','mae',v->>'mae','bias',v->>'bias') order by n) from jsonb_array_elements(o->'scores') with ordinality a(v,n)),'[]'::jsonb),
   'unavailable_models',coalesce((select jsonb_agg(jsonb_build_object('model',v->>'model','reason',v->>'reason') order by n) from jsonb_array_elements(o->'unavailable_models') with ordinality a(v,n)),'[]'::jsonb)),
  'backtest_windows',jsonb_build_object('windows',coalesce((select jsonb_agg(jsonb_build_object('train_from',v->>'train_from','train_to',v->>'train_to','test_from',v->>'test_from','test_to',v->>'test_to') order by n) from jsonb_array_elements(o->'folds') with ordinality a(v,n)),'[]'::jsonb)),
  'uncertainty',jsonb_build_object('status',coalesce(o#>>'{uncertainty,status}','not_recorded'),'residual_count',o#>'{uncertainty,residual_count}'),
  'held_out_coverage',jsonb_build_object('status',coalesce(o#>>'{evaluation,status}','not_recorded'),'model',o#>>'{evaluation,model}',
   'train_to',o#>>'{evaluation,train_to}','test_from',o#>>'{evaluation,test_from}','test_to',o#>>'{evaluation,test_to}',
   'count',o#>'{evaluation,count}','calibration',o#>'{evaluation,calibration}','coverage80',o#>>'{evaluation,coverage80}','coverage95',o#>>'{evaluation,coverage95}'),
  'forecast_limits',jsonb_build_object('driver_conditioned',method_value in ('driver-v1','multi-driver-v1'),
   'interpretation','Historical model-selection scores and separate held-out interval coverage are not realized future performance. Sold demand is not latent demand. Residual bootstrap assumptions are not guarantees. Driver comparisons depend on source-declared availability and exclude driver-value uncertainty; no causal inference. No policy or purchase recommendation.'));
 if octet_length(report::text)>12000 then raise exception using errcode='MQ422',message='forecast summary exceeds limit'; end if;
 return jsonb_build_object('evidence',report,'fingerprint',encode(extensions.digest(report::text,'sha256'),'hex'),
  'forecast_id',f.id,'forecast_run_id',f.run_id,'item_id',f.item_id,'location_id',f.location_id);
end; $$;
revoke all on function public.forecast_explainer_preview(uuid,uuid) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.forecast_explainer_preview(uuid,uuid) to authenticated;

create function public.forecast_explainer_request(p_organization_id uuid,p_forecast_id uuid,p_request_id uuid,p_question text,p_locale text,p_fingerprint text,p_confirmed boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare prior public.policy_explanations; preview jsonb; result uuid; now_at timestamptz:=clock_timestamp(); day_start timestamptz;
begin
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 if p_request_id is null or p_question is null or length(btrim(p_question)) not between 1 and 2000 or octet_length(p_question)>8000
  or translate(p_question,E'\n\r\t','') ~ '[[:cntrl:]]' or p_locale is null or p_locale not in ('en','ar') or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_confirmed is distinct from true then
  raise exception using errcode='MQ422',message='invalid or unconfirmed question'; end if;
 perform pg_advisory_xact_lock(hashtextextended('zeespare.policy-explainer:'||p_organization_id::text,0));
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 select * into prior from public.policy_explanations where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if prior.requested_by=auth.uid() and prior.forecast_id=p_forecast_id and prior.question=btrim(p_question) and prior.locale=p_locale and prior.fingerprint=p_fingerprint then return prior.id; end if;
  raise exception using errcode='MQ409',message='request identity conflicts'; end if;
 if not coalesce((select enabled from public.policy_explainer_settings where organization_id=p_organization_id),false) then
  raise exception using errcode='MQ403',message='policy explainer is disabled'; end if;
 preview:=public.forecast_explainer_preview(p_organization_id,p_forecast_id);
 if preview->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='refresh evidence preview'; end if;
 now_at:=clock_timestamp(); day_start:=date_trunc('day',now_at at time zone 'UTC') at time zone 'UTC';
 -- Attempts count even when the provider fails. Serialization makes quotas strict across processes.
 if (select count(*) from public.policy_explanations where organization_id=p_organization_id and created_at>=day_start)>=100
  or (select count(*) from public.policy_explanations where organization_id=p_organization_id and requested_by=auth.uid() and created_at>=day_start)>=20
  or exists(select 1 from public.policy_explanations where organization_id=p_organization_id and requested_by=auth.uid() and created_at>now_at-interval '1 minute')
  or (select count(*) from public.policy_explanations where organization_id=p_organization_id and status in ('pending','running') and created_at>now_at-interval '3 minutes')>=2 then
  raise exception using errcode='MQ429',message='explanation request limit reached'; end if;
 insert into public.policy_explanations(organization_id,location_id,subject_kind,forecast_id,forecast_run_id,item_id,request_id,requested_by,question,locale,evidence,fingerprint,prompt_version)
 values(p_organization_id,(preview->>'location_id')::uuid,'forecast',p_forecast_id,(preview->>'forecast_run_id')::uuid,(preview->>'item_id')::uuid,p_request_id,auth.uid(),btrim(p_question),p_locale,preview->'evidence',p_fingerprint,'forecast-explainer-v1') returning id into result;
 return result;
end; $$;
revoke all on function public.forecast_explainer_request(uuid,uuid,uuid,text,text,text,boolean) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.forecast_explainer_request(uuid,uuid,uuid,text,text,text,boolean) to authenticated;

create or replace function public.policy_explainer_complete(p_id uuid,p_actor uuid,p_answer jsonb,p_response_model text,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.policy_explanations; paragraph jsonb; allowed_references text[];
begin
 p_response_model:=nullif(p_response_model,''); p_error:=nullif(p_error,'');
 select * into r from public.policy_explanations where id=p_id and requested_by=p_actor;
 if not found then raise exception using errcode='MQ404',message='explanation unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('zeespare.policy-explainer:'||r.organization_id::text,0));
 select * into r from public.policy_explanations where id=p_id and requested_by=p_actor for update;
 if not found then raise exception using errcode='MQ404',message='explanation unavailable'; end if;
 perform app.policy_explainer_authorize(r.organization_id,p_actor,r.location_id);
 if r.status in ('succeeded','failed') then
  if r.answer is not distinct from p_answer and r.response_model is not distinct from p_response_model and r.error_code is not distinct from p_error then return; end if;
  raise exception using errcode='MQ409',message='terminal explanation is immutable'; end if;
 if not coalesce((select enabled from public.policy_explainer_settings where organization_id=r.organization_id),false) then raise exception using errcode='MQ403',message='policy explainer is disabled'; end if;
 if r.status<>'running' or r.dispatched_at<clock_timestamp()-interval '2 minutes' then raise exception using errcode='MQ409',message='explanation expired'; end if;
 if p_error is not null then
  if p_error not in ('provider_error','provider_timeout','invalid_response') or p_answer is not null or p_response_model is not null then raise exception using errcode='MQ422',message='invalid failure'; end if;
 else
  if p_response_model is null or p_response_model !~ '^[a-z0-9.-]{1,80}$' or jsonb_typeof(p_answer) is distinct from 'object' or octet_length(p_answer::text)>24000
   or p_answer-'paragraphs'<>'{}'::jsonb or jsonb_typeof(p_answer->'paragraphs') is distinct from 'array' then raise exception using errcode='MQ422',message='invalid answer'; end if;
  if jsonb_array_length(p_answer->'paragraphs') not between 1 and 8 then raise exception using errcode='MQ422',message='invalid paragraphs'; end if;
  allowed_references:=case when r.subject_kind='policy' then array['policy_inputs','lead_threshold','review_threshold','forecast','evidence_limits'] else array['forecast_context','model_comparison','backtest_windows','uncertainty','held_out_coverage','forecast_limits'] end;
  for paragraph in select value from jsonb_array_elements(p_answer->'paragraphs') loop
   if jsonb_typeof(paragraph) is distinct from 'object' or paragraph-array['text','references']<>'{}'::jsonb
    or jsonb_typeof(paragraph->'text') is distinct from 'string' or length(btrim(paragraph->>'text')) not between 1 and 2000
    or jsonb_typeof(paragraph->'references') is distinct from 'array' then raise exception using errcode='MQ422',message='invalid paragraph'; end if;
   if jsonb_array_length(paragraph->'references') not between 1 and 5 or exists(select 1 from jsonb_array_elements(paragraph->'references') v where jsonb_typeof(v) is distinct from 'string' or not(v#>>'{}'=any(allowed_references))) then
    raise exception using errcode='MQ422',message='unknown evidence reference'; end if;
  end loop;
 end if;
 update public.policy_explanations set status=case when p_error is null then 'succeeded' else 'failed' end,answer=p_answer,response_model=p_response_model,error_code=p_error,finished_at=clock_timestamp() where id=r.id;
end; $$;
revoke all on function public.policy_explainer_complete(uuid,uuid,jsonb,text,text) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.policy_explainer_complete(uuid,uuid,jsonb,text,text) to service_role;
