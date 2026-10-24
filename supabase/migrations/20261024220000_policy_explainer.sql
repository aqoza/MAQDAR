-- Step 28: opt-in policy explanations. No planning or operational mutations.
-- Disable the setting / remove UI to roll back; retain saved evidence.
set lock_timeout='5s';
create table public.policy_explainer_settings (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 enabled boolean not null default false,
 updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid not null
);
create table public.policy_explanations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 location_id uuid not null,
 policy_id uuid not null,
 policy_run_id uuid not null,
 forecast_run_id uuid not null,
 item_id uuid not null,
 request_id uuid not null,
 requested_by uuid not null,
 question text not null check(length(question) between 1 and 2000),
 locale text not null check(locale in ('en','ar')),
 evidence jsonb not null,
 fingerprint text not null,
 prompt_version text not null default 'policy-explainer-v1',
 api_version text not null default '2026-10-21',
 status text not null default 'pending' check(status in ('pending','running','succeeded','failed')),
 requested_model text,
 response_model text,
 answer jsonb,
 error_code text check(error_code in ('provider_error','provider_timeout','invalid_response')),
 created_at timestamptz not null default clock_timestamp(),
 dispatched_at timestamptz,
 finished_at timestamptz,
 unique(organization_id,request_id),
 foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
 check((status='succeeded')=(answer is not null)),
 check((status in ('succeeded','failed'))=(finished_at is not null)),
 check((status='failed')=(error_code is not null))
);
create index policy_explanations_history on public.policy_explanations(organization_id,created_at desc,id);
create index policy_explanations_location on public.policy_explanations(organization_id,location_id);
create index policy_explanations_policy on public.policy_explanations(organization_id,policy_id,created_at desc);
create index policy_explanations_actor_quota on public.policy_explanations(organization_id,requested_by,created_at desc);
alter table public.policy_explainer_settings enable row level security;
alter table public.policy_explanations enable row level security;
revoke all on public.policy_explainer_settings,public.policy_explanations from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant select on public.policy_explainer_settings,public.policy_explanations to authenticated;
create policy "members read" on public.policy_explainer_settings for select to authenticated using(organization_id=any(array(select app.member_organizations())));
create policy "members read" on public.policy_explanations for select to authenticated using(organization_id=any(array(select app.member_organizations())));
create policy "location scope" on public.policy_explanations as restrictive for select to authenticated using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.policy_explainer_settings for each row execute function app.audit_business_row();
create trigger audit_business_row after insert or update or delete on public.policy_explanations for each row execute function app.audit_business_row();
comment on table public.policy_explanations is 'Captured AI explanations, never policy changes. Immutable terminal results; failures/retries never resend. Source deletion retains evidence; organization/location deletion cascades. No credentials, prices or raw transactions in the generated evidence summary. User questions are explicitly confirmed before sending.';

create function public.policy_explainer_configure(p_organization_id uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform app.require_role(p_organization_id,array['owner','admin']);
 if p_enabled is null then raise exception using errcode='MQ422',message='enabled is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('zeespare.policy-explainer:'||p_organization_id::text,0));
 perform app.require_role(p_organization_id,array['owner','admin']);
 insert into public.policy_explainer_settings(organization_id,enabled,updated_by) values(p_organization_id,p_enabled,auth.uid())
 on conflict(organization_id) do update set enabled=excluded.enabled,updated_at=clock_timestamp(),updated_by=excluded.updated_by;
end; $$;
revoke all on function public.policy_explainer_configure(uuid,boolean) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.policy_explainer_configure(uuid,boolean) to authenticated;

create function public.policy_explainer_preview(p_organization_id uuid,p_policy_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.inventory_policies; report jsonb; result jsonb;
begin
 if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
  raise exception using errcode='MQ404',message='policy unavailable'; end if;
 select * into p from public.inventory_policies where organization_id=p_organization_id and id=p_policy_id;
 if p.id is null or (not(p_organization_id=any(array(select app.unscoped_organizations()))) and not(p.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='policy unavailable'; end if;
 if p.status<>'available' or p.unit is null or p.unit='' or p.evidence#>>'{forecast,method}' not in ('baseline-v1','expanded-v1')
  or p.evidence#>>'{forecast,method}' is null or p.evidence#>'{output,lead_time}' is null or p.evidence#>'{output,protection}' is null then
  raise exception using errcode='MQ422',message='choose an available individual-item policy with a known unit'; end if;
 -- Explicit projection: never copy source evidence wholesale. No IDs or catalog descriptions go to the provider.
 report:=jsonb_build_object('method','policy-explainer-v1','unit',p.unit,'cutoff',p.evidence#>>'{forecast,to_date}',
  'policy_inputs',jsonb_build_object('lead_time_days',p.evidence#>'{options,lead_time}','review_interval_days',p.evidence#>'{options,review_interval}','cycle_service_target',p.evidence#>>'{options,service_level}'),
  'lead_threshold',jsonb_build_object('days',p.evidence#>'{output,lead_time,days}','forecast',p.evidence#>>'{output,lead_time,forecast}','quantile',p.evidence#>>'{output,lead_time,quantile}','target',p.evidence#>>'{output,lead_time,target}','safety_stock',p.evidence#>>'{output,lead_time,safety_stock}'),
  'review_threshold',jsonb_build_object('days',p.evidence#>'{output,protection,days}','forecast',p.evidence#>>'{output,protection,forecast}','quantile',p.evidence#>>'{output,protection,quantile}','target',p.evidence#>>'{output,protection,target}','safety_stock',p.evidence#>>'{output,protection,safety_stock}'),
  'forecast',jsonb_build_object('method',p.evidence#>>'{forecast,method}','model',p.evidence#>>'{forecast,output,model}','horizon_days',p.evidence#>'{forecast,horizon}'),
  'evidence_limits',jsonb_build_object('residual_count',p.evidence#>'{output,residual_count}','positive_days',p.evidence#>'{output,positive_days}','bootstrap_samples',p.evidence#>'{output,samples}',
   'interpretation','Calculated policy only; no approved overrides or live stock. Cycle service is not fill rate. Fixed calendar-day lead time; empirical residual assumptions are not supply guarantees. No current purchase recommendation.'));
 if octet_length(report::text)>12000 then raise exception using errcode='MQ422',message='policy summary exceeds limit'; end if;
 result:=jsonb_build_object('evidence',report,'fingerprint',encode(extensions.digest(report::text,'sha256'),'hex'),
  'policy_id',p.id,'policy_run_id',p.run_id,'forecast_run_id',p.evidence#>>'{forecast,run_id}','item_id',p.item_id,'location_id',p.location_id);
 return result;
end; $$;
revoke all on function public.policy_explainer_preview(uuid,uuid) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.policy_explainer_preview(uuid,uuid) to authenticated;

create function public.policy_explainer_request(p_organization_id uuid,p_policy_id uuid,p_request_id uuid,p_question text,p_locale text,p_fingerprint text,p_confirmed boolean) returns uuid
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
  if prior.requested_by=auth.uid() and prior.policy_id=p_policy_id and prior.question=btrim(p_question) and prior.locale=p_locale and prior.fingerprint=p_fingerprint then return prior.id; end if;
  raise exception using errcode='MQ409',message='request identity conflicts'; end if;
 if not coalesce((select enabled from public.policy_explainer_settings where organization_id=p_organization_id),false) then
  raise exception using errcode='MQ403',message='policy explainer is disabled'; end if;
 preview:=public.policy_explainer_preview(p_organization_id,p_policy_id);
 if preview->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='refresh evidence preview'; end if;
 now_at:=clock_timestamp(); day_start:=date_trunc('day',now_at at time zone 'UTC') at time zone 'UTC';
 -- Attempts count even when the provider fails. Serialization makes quotas strict across processes.
 if (select count(*) from public.policy_explanations where organization_id=p_organization_id and created_at>=day_start)>=100
  or (select count(*) from public.policy_explanations where organization_id=p_organization_id and requested_by=auth.uid() and created_at>=day_start)>=20
  or exists(select 1 from public.policy_explanations where organization_id=p_organization_id and requested_by=auth.uid() and created_at>now_at-interval '1 minute')
  or (select count(*) from public.policy_explanations where organization_id=p_organization_id and status in ('pending','running') and created_at>now_at-interval '3 minutes')>=2 then
  raise exception using errcode='MQ429',message='explanation request limit reached'; end if;
 insert into public.policy_explanations(organization_id,location_id,policy_id,policy_run_id,forecast_run_id,item_id,request_id,requested_by,question,locale,evidence,fingerprint)
 values(p_organization_id,(preview->>'location_id')::uuid,p_policy_id,(preview->>'policy_run_id')::uuid,(preview->>'forecast_run_id')::uuid,(preview->>'item_id')::uuid,p_request_id,auth.uid(),btrim(p_question),p_locale,preview->'evidence',p_fingerprint) returning id into result;
 return result;
end; $$;
revoke all on function public.policy_explainer_request(uuid,uuid,uuid,text,text,text,boolean) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.policy_explainer_request(uuid,uuid,uuid,text,text,text,boolean) to authenticated;

-- Private authority check for the server's actor, never exposed as an arbitrary-user reader.
create function app.policy_explainer_authorize(p_organization_id uuid,p_actor uuid,p_location uuid) returns void
language plpgsql set search_path='' as $$
begin
 if p_actor is null or not exists(select 1 from public.memberships where organization_id=p_organization_id and user_id=p_actor and role in ('owner','admin','planner'))
  or not exists(select 1 from public.locations where organization_id=p_organization_id and id=p_location) then
  raise exception using errcode='MQ403',message='explanation authority unavailable'; end if;
end; $$;
revoke all on function app.policy_explainer_authorize(uuid,uuid,uuid) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;

create function public.policy_explainer_dispatch(p_id uuid,p_actor uuid,p_model text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.policy_explanations;
begin
 select * into r from public.policy_explanations where id=p_id and requested_by=p_actor;
 if not found then raise exception using errcode='MQ404',message='explanation unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('zeespare.policy-explainer:'||r.organization_id::text,0));
 select * into r from public.policy_explanations where id=p_id and requested_by=p_actor for update;
 if not found then raise exception using errcode='MQ404',message='explanation unavailable'; end if;
 perform app.policy_explainer_authorize(r.organization_id,p_actor,r.location_id);
 if r.status<>'pending' or r.created_at<clock_timestamp()-interval '2 minutes' then return jsonb_build_object('dispatch',false); end if;
 if not coalesce((select enabled from public.policy_explainer_settings where organization_id=r.organization_id),false) then raise exception using errcode='MQ403',message='policy explainer is disabled'; end if;
 if p_model is null or p_model !~ '^[a-z0-9.-]{1,80}$' then raise exception using errcode='MQ422',message='invalid model'; end if;
 update public.policy_explanations set status='running',requested_model=p_model,dispatched_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('dispatch',true,'question',r.question,'locale',r.locale,'evidence',r.evidence,'prompt_version',r.prompt_version);
end; $$;
revoke all on function public.policy_explainer_dispatch(uuid,uuid,text) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.policy_explainer_dispatch(uuid,uuid,text) to service_role;

create function public.policy_explainer_complete(p_id uuid,p_actor uuid,p_answer jsonb,p_response_model text,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.policy_explanations; paragraph jsonb;
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
  for paragraph in select value from jsonb_array_elements(p_answer->'paragraphs') loop
   if jsonb_typeof(paragraph) is distinct from 'object' or paragraph-array['text','references']<>'{}'::jsonb
    or jsonb_typeof(paragraph->'text') is distinct from 'string' or length(btrim(paragraph->>'text')) not between 1 and 2000
    or jsonb_typeof(paragraph->'references') is distinct from 'array' then raise exception using errcode='MQ422',message='invalid paragraph'; end if;
   if jsonb_array_length(paragraph->'references') not between 1 and 5 or exists(select 1 from jsonb_array_elements(paragraph->'references') v where jsonb_typeof(v) is distinct from 'string' or v#>>'{}' not in ('policy_inputs','lead_threshold','review_threshold','forecast','evidence_limits')) then
    raise exception using errcode='MQ422',message='unknown evidence reference'; end if;
  end loop;
 end if;
 update public.policy_explanations set status=case when p_error is null then 'succeeded' else 'failed' end,answer=p_answer,response_model=p_response_model,error_code=p_error,finished_at=clock_timestamp() where id=r.id;
end; $$;
revoke all on function public.policy_explainer_complete(uuid,uuid,jsonb,text,text) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.policy_explainer_complete(uuid,uuid,jsonb,text,text) to service_role;
