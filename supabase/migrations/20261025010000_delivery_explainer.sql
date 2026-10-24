-- Step 28e: delivery explanations retain captured dates and shared AI authority.
-- Additive and forward-only; retain saved explanations on application rollback.
set lock_timeout='5s';
alter table public.policy_explanations
 add column delivery_scenario_id uuid,
 drop constraint policy_explanations_subject_kind_check,
 drop constraint explanation_subject,
 add constraint policy_explanations_subject_kind_check check(subject_kind in ('policy','forecast','replenishment','supplier','delivery')),
 add constraint explanation_subject check(
  (delivery_scenario_id is null and subject_kind='policy' and policy_id is not null and policy_run_id is not null and forecast_id is null and replenishment_draft_id is null and supplier_scenario_id is null and forecast_run_id is not null and item_id is not null)
  or (delivery_scenario_id is null and subject_kind='forecast' and policy_id is null and policy_run_id is null and forecast_id is not null and replenishment_draft_id is null and supplier_scenario_id is null and forecast_run_id is not null and item_id is not null)
  or (delivery_scenario_id is null and subject_kind='replenishment' and policy_id is null and policy_run_id is null and forecast_id is null and forecast_run_id is null and item_id is null and replenishment_draft_id is not null and supplier_scenario_id is null)
  or (delivery_scenario_id is null and subject_kind='supplier' and policy_id is null and policy_run_id is null and forecast_id is null and forecast_run_id is null and item_id is null and replenishment_draft_id is null and supplier_scenario_id is not null)
  or (subject_kind='delivery' and delivery_scenario_id is not null and supplier_scenario_id is null and replenishment_draft_id is null and policy_id is null and policy_run_id is null and forecast_id is null and forecast_run_id is null and item_id is null));

-- Reduce saved search evidence to bounded enums and counts; never expose notes or identifiers.
create function app.delivery_explainer_search(p_search jsonb,p_start date,p_finish date) returns jsonb
language plpgsql immutable set search_path='' as $$
declare d jsonb; i integer:=0; n integer; reason text; counts jsonb:='{"calendar_override":0,"country_override":0,"public_holiday":0,"weekend":0}';
begin
 if p_search->>'status' is distinct from 'resolved' or p_search->>'date' is distinct from p_finish::text or jsonb_typeof(p_search->'days') is distinct from 'array' then raise exception using errcode='MQ422',message='incomplete saved calendar search'; end if;
 n:=jsonb_array_length(p_search->'days');
 if n not between 1 and 90 or p_finish-p_start<>n-1 then raise exception using errcode='MQ422',message='inconsistent saved calendar search'; end if;
 for d in select value from jsonb_array_elements(p_search->'days') loop
  reason:=d->>'reason';
  if d->>'date' is distinct from (p_start+i)::text or d->'working' is distinct from to_jsonb(i=n-1) or reason is null then raise exception using errcode='MQ422',message='unknown saved working date'; end if;
  if i=n-1 then
   if reason not in ('calendar_override','country_override','weekly_pattern') then raise exception using errcode='MQ422',message='unknown selected working reason'; end if;
  else
   if not counts ? reason then raise exception using errcode='MQ422',message='unknown closure reason'; end if;
   counts:=jsonb_set(counts,array[reason],to_jsonb((counts->>reason)::integer+1));
  end if;
  i:=i+1;
 end loop;
 return jsonb_build_object('evaluated_days',n,'closed_days',n-1,'closed_reasons',counts,'selected_reason',reason);
end; $$;
revoke all on function app.delivery_explainer_search(jsonb,date,date) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;

create function public.delivery_explainer_preview(p_organization_id uuid,p_scenario_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.delivery_scenarios; r jsonb; report jsonb; unit_value text; quantity text; lead_days integer; cutoff date; requested date; ordered date; nominal date; received date; reference_day date; schedule jsonb:='null'; adjustments jsonb:='null';
begin
 if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then raise exception using errcode='MQ404',message='scenario unavailable'; end if;
 select * into s from public.delivery_scenarios where organization_id=p_organization_id and id=p_scenario_id;
 if s.id is null or (not(p_organization_id=any(array(select app.unscoped_organizations()))) and not(s.location_id=any(array(select app.scoped_locations())))) then raise exception using errcode='MQ404',message='scenario unavailable'; end if;
 r:=s.report; unit_value:=r#>>'{source,unit}'; quantity:=r#>>'{source,quantity}';
 if r->>'method' is distinct from 'delivery-dates-v1' or coalesce(r->>'status','') not in ('available','no_order_needed')
  or coalesce(unit_value,'') not in ('EA','SET','L','KG') or quantity is null or length(quantity)>100 or quantity !~ '^[0-9]+(\.[0-9]+)?$'
  or jsonb_typeof(r#>'{source,lead_time}') is distinct from 'number' or coalesce(r#>>'{source,lead_time}','') !~ '^[0-9]+$'
  or coalesce(r#>>'{source,cutoff}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(r->>'requested_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='MQ422',message='choose a complete saved individual-item delivery scenario'; end if;
 lead_days:=(r#>>'{source,lead_time}')::integer; cutoff:=(r#>>'{source,cutoff}')::date; requested:=(r->>'requested_date')::date;
 if lead_days not between 0 and 3650 or requested<cutoff then raise exception using errcode='MQ422',message='invalid saved delivery context'; end if;
 if r->>'status'='no_order_needed' then
  if quantity::numeric<>0 or r->'order_date' is distinct from 'null'::jsonb or r->'nominal_receipt' is distinct from 'null'::jsonb or r->'receipt_date' is distinct from 'null'::jsonb or r->'elapsed_days' is distinct from 'null'::jsonb or r->'policy_recalculation_required' is distinct from 'null'::jsonb or r->'order_search' is distinct from 'null'::jsonb or r->'receipt_search' is distinct from 'null'::jsonb then raise exception using errcode='MQ422',message='inconsistent no-order evidence'; end if;
 else
  if quantity::numeric<=0 or r->'calendars_confirmed' is distinct from 'true'::jsonb or r->'blocked_stage' is distinct from 'null'::jsonb then raise exception using errcode='MQ422',message='incomplete scheduled evidence'; end if;
  if exists(select 1 from unnest(array['order_date','nominal_receipt','receipt_date','expected_receipt']) k where coalesce(r->>k,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then raise exception using errcode='MQ422',message='missing saved dates'; end if;
  ordered:=(r->>'order_date')::date; nominal:=(r->>'nominal_receipt')::date; received:=(r->>'receipt_date')::date; reference_day:=(r->>'expected_receipt')::date;
  if ordered<requested or nominal<>ordered+lead_days or received<nominal or reference_day<>cutoff+lead_days or r->'elapsed_days' is distinct from to_jsonb(received-cutoff) or r->'policy_recalculation_required' is distinct from to_jsonb(received>reference_day) then raise exception using errcode='MQ422',message='inconsistent saved schedule'; end if;
  schedule:=jsonb_build_object('order_date',ordered,'nominal_receipt',nominal,'receipt_date',received,'policy_reference_date',reference_day,'elapsed_days',received-cutoff,'policy_recalculation_required',r->'policy_recalculation_required');
  adjustments:=jsonb_build_object('calendars_confirmed',true,'supplier',app.delivery_explainer_search(r->'order_search',requested,ordered),'receiver',app.delivery_explainer_search(r->'receipt_search',nominal,received));
 end if;
 report:=jsonb_build_object('method','delivery-explainer-v1','outcome',r->>'status','unit',unit_value,
  'delivery_context',jsonb_build_object('cutoff',cutoff,'quantity',quantity,'lead_time_days',lead_days,'requested_date',requested),
  'schedule',schedule,'calendar_adjustments',adjustments,
  'delivery_limits',jsonb_build_object('interpretation','Captured indicative dates, not supplier promises. Calendar applicability is a planner attestation. Reason counts summarize evaluated closed dates; they do not identify each date. An explicit working override may resolve a date outside general holiday coverage. No-order outcomes evaluate no schedule and carry no timing verdict. Saved quantities and commitments remain fixed; no current calendar lookup, policy recalculation or order execution.'));
 if octet_length(report::text)>8000 then raise exception using errcode='MQ422',message='scenario summary exceeds limit'; end if;
 return jsonb_build_object('evidence',report,'fingerprint',encode(extensions.digest(report::text,'sha256'),'hex'),'scenario_id',s.id,'location_id',s.location_id);
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
 raise exception using errcode='MQ422',message='invalid saved delivery evidence';
end; $$;
revoke all on function public.delivery_explainer_preview(uuid,uuid) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.delivery_explainer_preview(uuid,uuid) to authenticated;

create function public.delivery_explainer_request(p_organization_id uuid,p_scenario_id uuid,p_request_id uuid,p_question text,p_locale text,p_fingerprint text,p_confirmed boolean) returns uuid
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
  if prior.requested_by=auth.uid() and prior.delivery_scenario_id=p_scenario_id and prior.question=btrim(p_question) and prior.locale=p_locale and prior.fingerprint=p_fingerprint then return prior.id; end if;
  raise exception using errcode='MQ409',message='request identity conflicts'; end if;
 if not coalesce((select enabled from public.policy_explainer_settings where organization_id=p_organization_id),false) then
  raise exception using errcode='MQ403',message='policy explainer is disabled'; end if;
 preview:=public.delivery_explainer_preview(p_organization_id,p_scenario_id);
 if preview->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='refresh evidence preview'; end if;
 now_at:=clock_timestamp(); day_start:=date_trunc('day',now_at at time zone 'UTC') at time zone 'UTC';
 -- Attempts count even when the provider fails. Serialization makes quotas strict across processes.
 if (select count(*) from public.policy_explanations where organization_id=p_organization_id and created_at>=day_start)>=100
  or (select count(*) from public.policy_explanations where organization_id=p_organization_id and requested_by=auth.uid() and created_at>=day_start)>=20
  or exists(select 1 from public.policy_explanations where organization_id=p_organization_id and requested_by=auth.uid() and created_at>now_at-interval '1 minute')
  or (select count(*) from public.policy_explanations where organization_id=p_organization_id and status in ('pending','running') and created_at>now_at-interval '3 minutes')>=2 then
  raise exception using errcode='MQ429',message='explanation request limit reached'; end if;
 insert into public.policy_explanations(organization_id,location_id,subject_kind,delivery_scenario_id,request_id,requested_by,question,locale,evidence,fingerprint,prompt_version)
 values(p_organization_id,(preview->>'location_id')::uuid,'delivery',p_scenario_id,p_request_id,auth.uid(),btrim(p_question),p_locale,preview->'evidence',p_fingerprint,'delivery-explainer-v1') returning id into result;
 return result;
end; $$;
revoke all on function public.delivery_explainer_request(uuid,uuid,uuid,text,text,text,boolean) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.delivery_explainer_request(uuid,uuid,uuid,text,text,text,boolean) to authenticated;

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
  allowed_references:=case when r.subject_kind='policy' then array['policy_inputs','lead_threshold','review_threshold','forecast','evidence_limits'] when r.subject_kind='delivery' then array['delivery_context','schedule','calendar_adjustments','delivery_limits'] when r.subject_kind='supplier' then array['scenario_context','rounding_calculation','lead_time_evidence','scenario_limits'] when r.subject_kind='replenishment' then array['draft_context','gap_calculation','supply_timing','draft_limits'] else array['forecast_context','model_comparison','backtest_windows','uncertainty','held_out_coverage','forecast_limits'] end;
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
