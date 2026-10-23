-- Retire the internal name MAQDAR: capability roles, advisory-lock keys, custom settings, cron jobs
-- and the API key prefix become ZeeSpare. One transaction, so old and new lock keys never mix.
-- Roll back by deploying the previous web/worker build and restoring this migration's predecessor
-- function bodies; renamed roles keep their OIDs, grants and login memberships.
set lock_timeout = '10s';

-- Capability roles. Grants, default privileges and login memberships follow the OID.
alter role maqdar_worker rename to zeespare_worker;
alter role maqdar_simulation_worker rename to zeespare_simulation_worker;

-- Cron jobs keep their schedules and commands.
select cron.unschedule(jobid) from cron.job
where jobname in ('maqdar-demand-partitions', 'maqdar-import-housekeeping');
select cron.schedule('zeespare-demand-partitions', '15 2 * * *', 'select app.maintain_demand_partitions()');
select cron.schedule('zeespare-import-housekeeping', '*/5 * * * *', 'select app.import_housekeeping()');

-- API keys: hard switch to zeespare_sk_. Existing maqdar_sk_ keys can no longer authenticate, so
-- they are revoked explicitly; their display prefixes stay valid for history only.
update public.api_keys set revoked_at = now() where revoked_at is null;
alter table public.api_keys drop constraint api_keys_display_prefix_check;
alter table public.api_keys add constraint api_keys_display_prefix_check
  check (display_prefix ~ '^(zeespare|maqdar)_sk_[0-9A-Za-z]{4}$');

comment on table ingest.contract_entities is
  'Import format v1 entities in load order (generated from engine/src/zeespare_engine/importformat.py). Written only by migrations.';
comment on column public.api_keys.key_hash is
  'SHA-256 of the full key (zeespare_sk_ + 43 base62 characters + a 6-character base62 CRC32), computed in the Worker. Not granted to any API role.';

-- Functions whose bodies named MAQDAR (lock keys, settings, role literals, key prefix).
-- create or replace keeps owner, privileges, security and search_path.
CREATE OR REPLACE FUNCTION app.guard_location_parent_cycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_location uuid := new.parent_location_id;
  v_steps integer := 0;
begin
  if new.parent_location_id is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.locations:' || new.organization_id::text, 0));
  while v_location is not null loop
    if v_location = new.id or v_steps >= 1000000 then
      raise exception using errcode = 'MQ422', message = 'this parent would create a cycle',
        hint = 'parent_location_id';
    end if;
    select l.parent_location_id into v_location
    from public.locations l
    where l.organization_id = new.organization_id and l.id = v_location;
    v_steps := v_steps + 1;
  end loop;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION app.guard_supersession_cycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item uuid := new.successor_item_id;
  v_steps integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('zeespare.supersessions:' || new.organization_id::text, 0));
  while v_item is not null loop
    if v_item = new.predecessor_item_id or v_steps >= 1000000 then
      raise exception using errcode = 'MQ422', message = 'this supersession would create a cycle',
        hint = 'successor_item_code';
    end if;
    select s.successor_item_id into v_item
    from public.item_supersessions s
    where s.organization_id = new.organization_id and s.predecessor_item_id = v_item;
    v_steps := v_steps + 1;
  end loop;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION app.import_analyze_demand_months(p_first date, p_last date)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_partition regclass;
  v_done text[] := '{}';
  v_skip boolean := coalesce(current_setting('zeespare.import_analyze', true), '') = 'skip_locked';
begin
  if p_first is null or p_last is null then
    return v_done;
  end if;
  for v_partition in
    select c.oid::regclass
    from pg_catalog.pg_inherits i
    join pg_catalog.pg_class c on c.oid = i.inhrelid
    cross join lateral regexp_match(
      pg_catalog.pg_get_expr(c.relpartbound, c.oid),
      'FROM \(''([0-9]{4}-[0-9]{2}-[0-9]{2})''\) TO \(''([0-9]{4}-[0-9]{2}-[0-9]{2})''\)') as m
    where i.inhparent = 'public.demand_history'::regclass
      and m[1]::date <= p_last and m[2]::date > p_first
      and pg_catalog.pg_relation_size(c.oid) > 0
      and (c.reltuples < 0
           or pg_catalog.pg_relation_size(c.oid) / current_setting('block_size')::integer > c.relpages * 1.2 + 8)
    order by 1
  loop
    execute format('analyze %s%s', case when v_skip then '(skip_locked) ' else '' end, v_partition);
    v_done := v_done || v_partition::text;
  end loop;
  return v_done;
end;
$function$
;

CREATE OR REPLACE FUNCTION app.import_housekeeping()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('zeespare.housekeeping',0)) then return 0; end if;
  n:=app.import_sweep(20000);
  delete from ingest.api_writes where ctid in(select ctid from ingest.api_writes where created_at<=now()-interval '24 hours' limit 20000);
  delete from ingest.import_creations where ctid in(select ctid from ingest.import_creations where created_at<=now()-interval '24 hours' limit 20000);
  -- Preserve counts and summaries; only row-level error details expire after 30 days.
  delete from public.import_errors where ctid in (
    select e.ctid from public.import_errors e join public.import_batches b on b.id=e.batch_id
    where b.status in ('succeeded','canceled','expired') and b.finished_at<now()-interval '30 days' limit 20000
  );
  return n;
end; $function$
;

CREATE OR REPLACE FUNCTION app.import_prepare_stats(p_batch_id uuid, p_entities text[])
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_entity text;
  v_reltuples real;
  v_relpages integer;
  v_pages bigint;
  v_modified bigint;
  v_inserted bigint;
  v_counts jsonb;
  v_done text[] := '{}';
  v_skip boolean := coalesce(current_setting('zeespare.import_analyze', true), '') = 'skip_locked';
begin
  select b.counts into v_counts from public.import_batches b where b.id = p_batch_id;
  for v_entity in
    select distinct x from unnest(p_entities) as x
    where x in ('work_calendars', 'holiday_overrides', 'locations', 'network_links', 'brands', 'items', 'item_supersessions',
                'item_interchanges', 'suppliers', 'supplier_items', 'fx_rates', 'stock_snapshots', 'open_orders', 'receipts')
    order by 1
  loop
    select c.reltuples, c.relpages, coalesce(s.n_mod_since_analyze, 0),
           pg_catalog.pg_relation_size(c.oid) / current_setting('block_size')::integer
      into v_reltuples, v_relpages, v_modified, v_pages
    from pg_catalog.pg_class c
    left join pg_catalog.pg_stat_user_tables s on s.relid = c.oid
    where c.oid = pg_catalog.to_regclass('public.' || v_entity);
    v_inserted := coalesce((v_counts -> v_entity ->> 'inserted')::bigint, 0);
    if (v_reltuples <= 0 and v_pages > 0)
       or v_pages > v_relpages * 1.2 + 8
       or v_modified > 0.1 * greatest(v_reltuples, 0)
       or v_inserted > 0.1 * greatest(v_reltuples, 0) then
      if v_skip then
        case v_entity
          when 'work_calendars' then analyze (skip_locked) public.work_calendars;
          when 'holiday_overrides' then analyze (skip_locked) public.holiday_overrides;
          when 'locations' then analyze (skip_locked) public.locations;
          when 'network_links' then analyze (skip_locked) public.network_links;
          when 'brands' then analyze (skip_locked) public.brands;
          when 'items' then analyze (skip_locked) public.items;
          when 'item_supersessions' then analyze (skip_locked) public.item_supersessions;
          when 'item_interchanges' then analyze (skip_locked) public.item_interchanges;
          when 'suppliers' then analyze (skip_locked) public.suppliers;
          when 'supplier_items' then analyze (skip_locked) public.supplier_items;
          when 'stock_snapshots' then analyze (skip_locked) public.stock_snapshots;
when 'open_orders' then analyze (skip_locked) public.open_orders;
when 'receipts' then analyze (skip_locked) public.receipts;
        when 'fx_rates' then analyze (skip_locked) public.fx_rates;
        end case;
      else
        case v_entity
          when 'work_calendars' then analyze public.work_calendars;
          when 'holiday_overrides' then analyze public.holiday_overrides;
          when 'locations' then analyze public.locations;
          when 'network_links' then analyze public.network_links;
          when 'brands' then analyze public.brands;
          when 'items' then analyze public.items;
          when 'item_supersessions' then analyze public.item_supersessions;
          when 'item_interchanges' then analyze public.item_interchanges;
          when 'suppliers' then analyze public.suppliers;
          when 'supplier_items' then analyze public.supplier_items;
          when 'stock_snapshots' then analyze public.stock_snapshots;
when 'open_orders' then analyze public.open_orders;
when 'receipts' then analyze public.receipts;
        when 'fx_rates' then analyze public.fx_rates;
        end case;
      end if;
      v_done := v_done || ('public.' || v_entity);
    end if;
  end loop;
  return v_done;
end;
$function$
;

CREATE OR REPLACE FUNCTION app.lock_memberships(org uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select pg_advisory_xact_lock(hashtextextended('zeespare.memberships:' || org::text, 0));
$function$
;

CREATE OR REPLACE FUNCTION app.maintain_demand_partitions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
begin
  if not pg_try_advisory_xact_lock(hashtextextended('zeespare.partitions',0)) then return 0; end if;
  return app.ensure_demand_history_partitions(date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '3 months')::date);
end; $function$
;

CREATE OR REPLACE FUNCTION app.planning_claim_scoped(p_organization_id uuid)
 RETURNS TABLE(run_id uuid, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m record; r public.planning_runs; new_token uuid;
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('zeespare.simulation.routing',0));
 for n in 1..10 loop
  select q.*,p.id as resolved_run into m from pgmq.q_planning q
   left join public.planning_runs p on p.id=case
    when q.message->>'run_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then (q.message->>'run_id')::uuid end
   where q.vt<=clock_timestamp() and
    ((p_organization_id is not null and p.organization_id=p_organization_id and p.kind='simulation')
     or (p_organization_id is null and not exists(select 1 from planning.simulation_worker_scopes s
      where s.organization_id=p.organization_id and p.kind='simulation')))
   order by q.msg_id limit 1 for update of q skip locked;
  if not found then return; end if;
  update pgmq.q_planning set vt=clock_timestamp()+interval '120 seconds',read_ct=read_ct+1
   where msg_id=m.msg_id returning vt into m.vt;
  select * into r from public.planning_runs where id=m.resolved_run for update skip locked;
  if not found then
   if m.resolved_run is not null then continue; end if;
   perform pgmq.archive('planning',m.msg_id); continue;
  end if;
  if r.status not in ('queued','running') then perform pgmq.archive('planning',m.msg_id); continue; end if;
  if r.attempts>=3 then
   update public.planning_runs set status='failed',error_code='attempts_exhausted',finished_at=clock_timestamp() where id=r.id;
   perform pgmq.archive('planning',m.msg_id);
   delete from planning.leases where planning.leases.run_id=r.id;
   continue;
  end if;
  if r.kind='policy' or (r.kind='forecast' and r.options->>'method' in ('expanded-v1','regional-v1','driver-v1','multi-driver-v1')) then
   select vt into m.vt from pgmq.set_vt('planning',m.msg_id,900);
  end if;
  new_token:=gen_random_uuid();
  update planning.leases set token=new_token,expires_at=m.vt where planning.leases.run_id=r.id and message_id=m.msg_id;
  if not found then raise exception 'planning transport mismatch'; end if;
  update public.planning_runs set status='running',attempts=attempts+1,started_at=clock_timestamp(),error_code=null where id=r.id;
  return query select r.id,new_token;
  return;
 end loop;
end; $function$
;

CREATE OR REPLACE FUNCTION app.planning_enqueue_kind(p_organization_id uuid, p_location_code text, p_from date, p_to date, p_request_id uuid, p_kind text, p_options jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.planning_runs; location uuid; run uuid; msg bigint;
begin
  if p_organization_id is null or not (p_organization_id = any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='planning requires an editor';
  end if;
  if p_request_id is null or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_to<p_from or p_to-p_from>1095 then raise exception using errcode='MQ422',message='invalid planning window'; end if;
  select id into location from public.locations where organization_id=p_organization_id and code=p_location_code and is_active;
  if location is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.planning:'||p_organization_id::text,0));
  select * into r from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if r.location_id<>location or r.from_date<>p_from or r.to_date<>p_to or r.kind<>p_kind or r.options<>p_options then
      raise exception using errcode='MQ409',message='request id already used with different parameters';
    end if;
    return r.id;
  end if;
  if exists(select 1 from public.planning_runs where organization_id=p_organization_id and status in ('queued','running')) then
    raise exception using errcode='MQ409',message='a planning run is already active';
  end if;
  if (select count(*) from public.planning_runs where organization_id=p_organization_id and created_at>now()-interval '24 hours')>=20 then
    raise exception using errcode='MQ429',message='planning run limit reached';
  end if;
  insert into public.planning_runs(organization_id,location_id,request_id,from_date,to_date,created_by,kind,options)
  values(p_organization_id,location,p_request_id,p_from,p_to,auth.uid(),p_kind,p_options) returning id into run;
  select pgmq.send('planning',jsonb_build_object('run_id',run)) into msg;
  insert into planning.leases(run_id,message_id) values(run,msg);
  return run;
end; $function$
;

CREATE OR REPLACE FUNCTION app.refuse_delete_with_demand()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
begin
  if coalesce(current_setting('zeespare.demand_guard', true), '') = 'off' then
    return null;
  end if;
  -- Import steps hold zeespare.import:<org> exclusively while they write demand; wait for the
  -- running step (at most a few seconds) so the probe below sees the demand it commits.
  for v_org in select distinct o.organization_id from deleted_rows o order by 1 loop
    perform pg_advisory_xact_lock_shared(hashtextextended('zeespare.import:' || v_org::text, 0));
  end loop;
  if not exists (
    select 1 from public.demand_history d
    where d.organization_id in (select distinct o.organization_id from deleted_rows o)
  ) then
    return null;
  end if;
  if tg_table_name = 'items' then
    perform 1 from deleted_rows o
      join public.demand_history d on d.organization_id = o.organization_id and d.item_id = o.id
      limit 1;
  else
    perform 1 from deleted_rows o
      join public.demand_history d on d.organization_id = o.organization_id and d.location_id = o.id
      limit 1;
  end if;
  if found then
    raise exception using errcode = 'MQ409',
      message = format('%s with demand history cannot be deleted; mark it inactive instead', tg_table_name);
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION app.simulation_runtime_organization(p_require_enabled boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare organization uuid;
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('zeespare.simulation.routing',0));
 select s.organization_id into organization from planning.simulation_worker_scopes s
 join pg_roles r on r.oid=s.login_oid and r.rolname=s.login_name
 where r.rolname=session_user and (s.enabled or not p_require_enabled) and r.rolcanlogin
  and not r.rolinherit and not r.rolsuper and not r.rolcreatedb and not r.rolcreaterole and not r.rolbypassrls
  and not exists(select 1 from pg_auth_members m where m.member=r.oid and m.roleid<>'zeespare_simulation_worker'::regrole)
  and pg_has_role(r.oid,'zeespare_simulation_worker','MEMBER') and not pg_has_role(r.oid,'zeespare_worker','MEMBER');
 if organization is null then raise exception using errcode='42501',message='simulation runtime is not enabled'; end if;
 return organization;
end; $function$
;

CREATE OR REPLACE FUNCTION app.simulation_scope_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform pg_advisory_xact_lock(hashtextextended('zeespare.simulation.routing',0));
 if tg_op='INSERT' or tg_op='DELETE' or
   (old.login_oid,old.login_name,old.organization_id) is distinct from (new.login_oid,new.login_name,new.organization_id) then
  if exists(select 1 from public.planning_runs where kind='simulation' and status in ('queued','running')
   and (organization_id=case when tg_op<>'INSERT' then old.organization_id end
    or organization_id=case when tg_op<>'DELETE' then new.organization_id end)) then
   raise exception using errcode='MQ409',message='simulation routing requires an idle organization';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 if not exists(select 1 from pg_roles where oid=new.login_oid and rolname=new.login_name
  and rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb and not rolcreaterole and not rolbypassrls
  and not exists(select 1 from pg_auth_members m where m.member=pg_roles.oid and m.roleid<>'zeespare_simulation_worker'::regrole)
  and pg_has_role(oid,'zeespare_simulation_worker','MEMBER') and not pg_has_role(oid,'zeespare_worker','MEMBER')) then
  raise exception using errcode='42501',message='dedicated simulation login required';
 end if;
 return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.api_event_purchase_handoff_acknowledge(p_key_hash bytea, p_resource text, p_id uuid, p_body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid; key_id uuid; location uuid; event_id uuid;
  saved public.event_purchase_handoff_acknowledgements; reason_value text;
begin
  select a.organization_id,a.api_key_id into org,key_id from app.api_authorize_check(p_key_hash,'event_purchase_handoffs:acknowledge') a;
  if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>8192 then
    raise exception using errcode='MQ422',message='invalid acknowledgement',hint='acknowledgement';
  end if;
  if exists(select 1 from jsonb_object_keys(p_body) k where k not in ('client_event_id','external_system','external_reference','status','reason'))
    or jsonb_typeof(p_body->'client_event_id') is distinct from 'string'
    or jsonb_typeof(p_body->'external_system') is distinct from 'string'
    or jsonb_typeof(p_body->'external_reference') is distinct from 'string'
    or jsonb_typeof(p_body->'status') is distinct from 'string'
    or ((p_body ? 'reason') and jsonb_typeof(p_body->'reason') not in ('string','null')) then
    raise exception using errcode='MQ422',message='invalid acknowledgement fields',hint='acknowledgement';
  end if;
  begin
    event_id:=(p_body->>'client_event_id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='MQ422',message='invalid event UUID',hint='acknowledgement';
  end;
  reason_value:=p_body->>'reason';
  if char_length(p_body->>'external_system') not between 1 and 80 or (p_body->>'external_system') ~ '[[:cntrl:]]'
    or (p_body->>'external_system') !~ '[^[:space:]]'
    or char_length(p_body->>'external_reference') not between 1 and 200 or (p_body->>'external_reference') ~ '[[:cntrl:]]'
    or (p_body->>'external_reference') !~ '[^[:space:]]'
    or (p_body->>'status') not in ('received','rejected')
    or ((p_body->>'status')='rejected' and reason_value is null)
    or (reason_value is not null and (char_length(reason_value) not between 1 and 1000 or reason_value ~ '[[:cntrl:]]' or reason_value !~ '[^[:space:]]')) then
    raise exception using errcode='MQ422',message='invalid acknowledgement values',hint='acknowledgement';
  end if;
  -- Serialize this identity only. Key rotation can safely retry the same organization's event.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.event-purchase-handoff-ack:'||org::text||':'||event_id::text,0));
  perform app.api_authorize(p_key_hash,'event_purchase_handoffs:acknowledge');
  select a.location_id into location from app.event_purchase_handoff_ack_locations(org,p_resource,p_id) a;
  select * into saved from public.event_purchase_handoff_acknowledgements
    where organization_id=org and client_event_id=event_id;
  if found then
    if (p_resource='event-purchase-handoffs' and saved.handoff_id is not distinct from p_id
        or p_resource='event-purchase-handoff-batches' and saved.batch_id is not distinct from p_id)
      and saved.external_system=p_body->>'external_system'
      and saved.external_reference=p_body->>'external_reference'
      and saved.status=p_body->>'status' and saved.reason is not distinct from reason_value then
      return jsonb_build_object('data',app.event_purchase_handoff_ack_json(saved),'replayed',true);
    end if;
    raise exception using errcode='MQ409',message='event ID reused with different content',hint='acknowledgement_conflict';
  end if;
  insert into public.event_purchase_handoff_acknowledgements(organization_id,location_id,handoff_id,batch_id,
    client_event_id,api_key_id,external_system,external_reference,status,reason)
  values(org,location,case when p_resource='event-purchase-handoffs' then p_id end,
    case when p_resource='event-purchase-handoff-batches' then p_id end,event_id,key_id,
    p_body->>'external_system',p_body->>'external_reference',p_body->>'status',reason_value)
  returning * into saved;
  return jsonb_build_object('data',app.event_purchase_handoff_ack_json(saved),'replayed',false);
exception when foreign_key_violation then
  raise exception using errcode='MQ404',message='package unavailable',hint='resource';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.api_excess_disposition_handoff_acknowledge(p_key_hash bytea, p_resource text, p_id uuid, p_body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid; key_id uuid; location uuid; event_id uuid;
  saved public.excess_disposition_handoff_acknowledgements; reason_value text;
begin
  select a.organization_id,a.api_key_id into org,key_id from app.api_authorize_check(p_key_hash,'excess_disposition_handoffs:acknowledge') a;
  if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>8192 then
    raise exception using errcode='MQ422',message='invalid acknowledgement',hint='acknowledgement';
  end if;
  if exists(select 1 from jsonb_object_keys(p_body) k where k not in ('client_event_id','external_system','external_reference','status','reason'))
    or jsonb_typeof(p_body->'client_event_id') is distinct from 'string'
    or jsonb_typeof(p_body->'external_system') is distinct from 'string'
    or jsonb_typeof(p_body->'external_reference') is distinct from 'string'
    or jsonb_typeof(p_body->'status') is distinct from 'string'
    or ((p_body ? 'reason') and jsonb_typeof(p_body->'reason') not in ('string','null')) then
    raise exception using errcode='MQ422',message='invalid acknowledgement fields',hint='acknowledgement';
  end if;
  begin
    event_id:=(p_body->>'client_event_id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='MQ422',message='invalid event UUID',hint='acknowledgement';
  end;
  reason_value:=p_body->>'reason';
  if char_length(p_body->>'external_system') not between 1 and 80 or (p_body->>'external_system') ~ '[[:cntrl:]]'
    or (p_body->>'external_system') !~ '[^[:space:]]'
    or char_length(p_body->>'external_reference') not between 1 and 200 or (p_body->>'external_reference') ~ '[[:cntrl:]]'
    or (p_body->>'external_reference') !~ '[^[:space:]]'
    or (p_body->>'status') not in ('received','rejected')
    or ((p_body->>'status')='rejected' and reason_value is null)
    or (reason_value is not null and (char_length(reason_value) not between 1 and 1000 or reason_value ~ '[[:cntrl:]]' or reason_value !~ '[^[:space:]]')) then
    raise exception using errcode='MQ422',message='invalid acknowledgement values',hint='acknowledgement';
  end if;
  -- Serialize this identity only. Key rotation can safely retry the same organization's event.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.excess-disposition-handoff-ack:'||org::text||':'||event_id::text,0));
  perform app.api_authorize(p_key_hash,'excess_disposition_handoffs:acknowledge');
  select a.location_id into location from app.excess_disposition_handoff_ack_locations(org,p_resource,p_id) a;
  select * into saved from public.excess_disposition_handoff_acknowledgements
    where organization_id=org and client_event_id=event_id;
  if found then
    if (p_resource='excess-disposition-handoffs' and saved.handoff_id is not distinct from p_id
        or p_resource='excess-disposition-handoff-batches' and saved.batch_id is not distinct from p_id)
      and saved.external_system=p_body->>'external_system'
      and saved.external_reference=p_body->>'external_reference'
      and saved.status=p_body->>'status' and saved.reason is not distinct from reason_value then
      return jsonb_build_object('data',app.excess_disposition_handoff_ack_json(saved),'replayed',true);
    end if;
    raise exception using errcode='MQ409',message='event ID reused with different content',hint='acknowledgement_conflict';
  end if;
  insert into public.excess_disposition_handoff_acknowledgements(organization_id,location_id,handoff_id,batch_id,
    client_event_id,api_key_id,external_system,external_reference,status,reason)
  values(org,location,case when p_resource='excess-disposition-handoffs' then p_id end,
    case when p_resource='excess-disposition-handoff-batches' then p_id end,event_id,key_id,
    p_body->>'external_system',p_body->>'external_reference',p_body->>'status',reason_value)
  returning * into saved;
  return jsonb_build_object('data',app.excess_disposition_handoff_ack_json(saved),'replayed',false);
exception when foreign_key_violation then
  raise exception using errcode='MQ404',message='package unavailable',hint='resource';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.api_handoff_acknowledge(p_key_hash bytea, p_resource text, p_id uuid, p_body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid; key_id uuid; location uuid; event_id uuid;
  saved public.purchase_handoff_acknowledgements; reason_value text;
begin
  select a.organization_id,a.api_key_id into org,key_id from app.api_authorize_check(p_key_hash,'purchase_handoffs:acknowledge') a;
  if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>8192 then
    raise exception using errcode='MQ422',message='invalid acknowledgement',hint='acknowledgement';
  end if;
  if exists(select 1 from jsonb_object_keys(p_body) k where k not in ('client_event_id','external_system','external_reference','status','reason'))
    or jsonb_typeof(p_body->'client_event_id') is distinct from 'string'
    or jsonb_typeof(p_body->'external_system') is distinct from 'string'
    or jsonb_typeof(p_body->'external_reference') is distinct from 'string'
    or jsonb_typeof(p_body->'status') is distinct from 'string'
    or ((p_body ? 'reason') and jsonb_typeof(p_body->'reason') not in ('string','null')) then
    raise exception using errcode='MQ422',message='invalid acknowledgement fields',hint='acknowledgement';
  end if;
  begin
    event_id:=(p_body->>'client_event_id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='MQ422',message='invalid event UUID',hint='acknowledgement';
  end;
  reason_value:=p_body->>'reason';
  if char_length(p_body->>'external_system') not between 1 and 80 or (p_body->>'external_system') ~ '[[:cntrl:]]'
    or (p_body->>'external_system') !~ '[^[:space:]]'
    or char_length(p_body->>'external_reference') not between 1 and 200 or (p_body->>'external_reference') ~ '[[:cntrl:]]'
    or (p_body->>'external_reference') !~ '[^[:space:]]'
    or (p_body->>'status') not in ('received','rejected')
    or ((p_body->>'status')='rejected' and reason_value is null)
    or (reason_value is not null and (char_length(reason_value) not between 1 and 1000 or reason_value ~ '[[:cntrl:]]' or reason_value !~ '[^[:space:]]')) then
    raise exception using errcode='MQ422',message='invalid acknowledgement values',hint='acknowledgement';
  end if;
  -- Serialize this identity only. Key rotation can safely retry the same organization's event.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.handoff-ack:'||org::text||':'||event_id::text,0));
  perform app.api_authorize(p_key_hash,'purchase_handoffs:acknowledge');
  location:=app.handoff_ack_location(org,p_resource,p_id);
  select * into saved from public.purchase_handoff_acknowledgements
    where organization_id=org and client_event_id=event_id;
  if found then
    if (p_resource='purchase-handoffs' and saved.handoff_id is not distinct from p_id
        or p_resource='purchase-handoff-batches' and saved.batch_id is not distinct from p_id)
      and saved.external_system=p_body->>'external_system'
      and saved.external_reference=p_body->>'external_reference'
      and saved.status=p_body->>'status' and saved.reason is not distinct from reason_value then
      return jsonb_build_object('data',app.handoff_ack_json(saved),'replayed',true);
    end if;
    raise exception using errcode='MQ409',message='event ID reused with different content',hint='acknowledgement_conflict';
  end if;
  insert into public.purchase_handoff_acknowledgements(organization_id,location_id,handoff_id,batch_id,
    client_event_id,api_key_id,external_system,external_reference,status,reason)
  values(org,location,case when p_resource='purchase-handoffs' then p_id end,
    case when p_resource='purchase-handoff-batches' then p_id end,event_id,key_id,
    p_body->>'external_system',p_body->>'external_reference',p_body->>'status',reason_value)
  returning * into saved;
  return jsonb_build_object('data',app.handoff_ack_json(saved),'replayed',false);
exception when foreign_key_violation then
  raise exception using errcode='MQ404',message='package unavailable',hint='resource';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.api_network_handoff_acknowledge(p_key_hash bytea, p_resource text, p_id uuid, p_body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid; key_id uuid; locations uuid[]; event_id uuid;
  saved public.network_handoff_acknowledgements; reason_value text;
begin
  select a.organization_id,a.api_key_id into org,key_id from app.api_authorize_check(p_key_hash,'network_handoffs:acknowledge') a;
  if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>8192 then
    raise exception using errcode='MQ422',message='invalid acknowledgement',hint='acknowledgement';
  end if;
  if exists(select 1 from jsonb_object_keys(p_body) k where k not in ('client_event_id','external_system','external_reference','status','reason'))
    or jsonb_typeof(p_body->'client_event_id') is distinct from 'string'
    or jsonb_typeof(p_body->'external_system') is distinct from 'string'
    or jsonb_typeof(p_body->'external_reference') is distinct from 'string'
    or jsonb_typeof(p_body->'status') is distinct from 'string'
    or ((p_body ? 'reason') and jsonb_typeof(p_body->'reason') not in ('string','null')) then
    raise exception using errcode='MQ422',message='invalid acknowledgement fields',hint='acknowledgement';
  end if;
  begin
    event_id:=(p_body->>'client_event_id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='MQ422',message='invalid event UUID',hint='acknowledgement';
  end;
  reason_value:=p_body->>'reason';
  if char_length(p_body->>'external_system') not between 1 and 80 or (p_body->>'external_system') ~ '[[:cntrl:]]'
    or (p_body->>'external_system') !~ '[^[:space:]]'
    or char_length(p_body->>'external_reference') not between 1 and 200 or (p_body->>'external_reference') ~ '[[:cntrl:]]'
    or (p_body->>'external_reference') !~ '[^[:space:]]'
    or (p_body->>'status') not in ('received','rejected')
    or ((p_body->>'status')='rejected' and reason_value is null)
    or (reason_value is not null and (char_length(reason_value) not between 1 and 1000 or reason_value ~ '[[:cntrl:]]' or reason_value !~ '[^[:space:]]')) then
    raise exception using errcode='MQ422',message='invalid acknowledgement values',hint='acknowledgement';
  end if;
  -- Serialize this identity only. Key rotation can safely retry the same organization's event.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.network-handoff-ack:'||org::text||':'||event_id::text,0));
  -- Lock the actual parent, including retained copied batches, against deletion.
  if p_resource='network-handoffs' then
    select h.required_location_ids into locations from public.network_transfer_handoffs h
      where h.organization_id=org and h.id=p_id for key share;
  elsif p_resource='network-handoff-batches' then
    select b.required_location_ids into locations from public.network_handoff_batches b
      where b.organization_id=org and b.id=p_id for key share;
  else
    raise exception using errcode='MQ404',message='package unavailable',hint='resource';
  end if;
  -- Both the event and parent locks can wait: recheck authority before any retry/write.
  perform app.api_authorize(p_key_hash,'network_handoffs:acknowledge');
  if locations is null then raise exception using errcode='MQ404',message='package unavailable',hint='resource'; end if;
  select * into saved from public.network_handoff_acknowledgements
    where organization_id=org and client_event_id=event_id;
  if found then
    if (p_resource='network-handoffs' and saved.handoff_id is not distinct from p_id
        or p_resource='network-handoff-batches' and saved.batch_id is not distinct from p_id)
      and saved.external_system=p_body->>'external_system'
      and saved.external_reference=p_body->>'external_reference'
      and saved.status=p_body->>'status' and saved.reason is not distinct from reason_value then
      return jsonb_build_object('data',app.network_handoff_ack_json(saved),'replayed',true);
    end if;
    raise exception using errcode='MQ409',message='event ID reused with different content',hint='acknowledgement_conflict';
  end if;
  insert into public.network_handoff_acknowledgements(organization_id,required_location_ids,handoff_id,batch_id,
    client_event_id,api_key_id,external_system,external_reference,status,reason)
  values(org,locations,case when p_resource='network-handoffs' then p_id end,
    case when p_resource='network-handoff-batches' then p_id end,event_id,key_id,
    p_body->>'external_system',p_body->>'external_reference',p_body->>'status',reason_value)
  returning * into saved;
  return jsonb_build_object('data',app.network_handoff_ack_json(saved),'replayed',false);
exception when foreign_key_violation then
  raise exception using errcode='MQ404',message='package unavailable',hint='resource';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.api_regional_handoff_acknowledge(p_key_hash bytea, p_resource text, p_id uuid, p_body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid; key_id uuid; locations uuid[]; event_id uuid;
  saved public.regional_handoff_acknowledgements; reason_value text;
begin
  select a.organization_id,a.api_key_id into org,key_id from app.api_authorize_check(p_key_hash,'regional_handoffs:acknowledge') a;
  if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>8192 then
    raise exception using errcode='MQ422',message='invalid acknowledgement',hint='acknowledgement';
  end if;
  if exists(select 1 from jsonb_object_keys(p_body) k where k not in ('client_event_id','external_system','external_reference','status','reason'))
    or jsonb_typeof(p_body->'client_event_id') is distinct from 'string'
    or jsonb_typeof(p_body->'external_system') is distinct from 'string'
    or jsonb_typeof(p_body->'external_reference') is distinct from 'string'
    or jsonb_typeof(p_body->'status') is distinct from 'string'
    or ((p_body ? 'reason') and jsonb_typeof(p_body->'reason') not in ('string','null')) then
    raise exception using errcode='MQ422',message='invalid acknowledgement fields',hint='acknowledgement';
  end if;
  begin
    event_id:=(p_body->>'client_event_id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='MQ422',message='invalid event UUID',hint='acknowledgement';
  end;
  reason_value:=p_body->>'reason';
  if char_length(p_body->>'external_system') not between 1 and 80 or (p_body->>'external_system') ~ '[[:cntrl:]]'
    or (p_body->>'external_system') !~ '[^[:space:]]'
    or char_length(p_body->>'external_reference') not between 1 and 200 or (p_body->>'external_reference') ~ '[[:cntrl:]]'
    or (p_body->>'external_reference') !~ '[^[:space:]]'
    or (p_body->>'status') not in ('received','rejected')
    or ((p_body->>'status')='rejected' and reason_value is null)
    or (reason_value is not null and (char_length(reason_value) not between 1 and 1000 or reason_value ~ '[[:cntrl:]]' or reason_value !~ '[^[:space:]]')) then
    raise exception using errcode='MQ422',message='invalid acknowledgement values',hint='acknowledgement';
  end if;
  -- Serialize this identity only. Key rotation can safely retry the same organization's event.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.regional-handoff-ack:'||org::text||':'||event_id::text,0));
  -- Lock the actual parent, including retained copied batches, against deletion.
  if p_resource='regional-handoffs' then
    select h.required_location_ids into locations from public.regional_transfer_handoffs h
      where h.organization_id=org and h.id=p_id for key share;
  elsif p_resource='regional-handoff-batches' then
    select b.required_location_ids into locations from public.regional_handoff_batches b
      where b.organization_id=org and b.id=p_id for key share;
  else
    raise exception using errcode='MQ404',message='package unavailable',hint='resource';
  end if;
  -- Both the event and parent locks can wait: recheck authority before any retry/write.
  perform app.api_authorize(p_key_hash,'regional_handoffs:acknowledge');
  if locations is null then raise exception using errcode='MQ404',message='package unavailable',hint='resource'; end if;
  select * into saved from public.regional_handoff_acknowledgements
    where organization_id=org and client_event_id=event_id;
  if found then
    if (p_resource='regional-handoffs' and saved.handoff_id is not distinct from p_id
        or p_resource='regional-handoff-batches' and saved.batch_id is not distinct from p_id)
      and saved.external_system=p_body->>'external_system'
      and saved.external_reference=p_body->>'external_reference'
      and saved.status=p_body->>'status' and saved.reason is not distinct from reason_value then
      return jsonb_build_object('data',app.regional_handoff_ack_json(saved),'replayed',true);
    end if;
    raise exception using errcode='MQ409',message='event ID reused with different content',hint='acknowledgement_conflict';
  end if;
  insert into public.regional_handoff_acknowledgements(organization_id,required_location_ids,handoff_id,batch_id,
    client_event_id,api_key_id,external_system,external_reference,status,reason)
  values(org,locations,case when p_resource='regional-handoffs' then p_id end,
    case when p_resource='regional-handoff-batches' then p_id end,event_id,key_id,
    p_body->>'external_system',p_body->>'external_reference',p_body->>'status',reason_value)
  returning * into saved;
  return jsonb_build_object('data',app.regional_handoff_ack_json(saved),'replayed',false);
exception when foreign_key_violation then
  raise exception using errcode='MQ404',message='package unavailable',hint='resource';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.api_transfer_handoff_acknowledge(p_key_hash bytea, p_resource text, p_id uuid, p_body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org uuid; key_id uuid; location uuid; source_location uuid; event_id uuid;
  saved public.transfer_handoff_acknowledgements; reason_value text;
begin
  select a.organization_id,a.api_key_id into org,key_id from app.api_authorize_check(p_key_hash,'transfer_handoffs:acknowledge') a;
  if jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>8192 then
    raise exception using errcode='MQ422',message='invalid acknowledgement',hint='acknowledgement';
  end if;
  if exists(select 1 from jsonb_object_keys(p_body) k where k not in ('client_event_id','external_system','external_reference','status','reason'))
    or jsonb_typeof(p_body->'client_event_id') is distinct from 'string'
    or jsonb_typeof(p_body->'external_system') is distinct from 'string'
    or jsonb_typeof(p_body->'external_reference') is distinct from 'string'
    or jsonb_typeof(p_body->'status') is distinct from 'string'
    or ((p_body ? 'reason') and jsonb_typeof(p_body->'reason') not in ('string','null')) then
    raise exception using errcode='MQ422',message='invalid acknowledgement fields',hint='acknowledgement';
  end if;
  begin
    event_id:=(p_body->>'client_event_id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode='MQ422',message='invalid event UUID',hint='acknowledgement';
  end;
  reason_value:=p_body->>'reason';
  if char_length(p_body->>'external_system') not between 1 and 80 or (p_body->>'external_system') ~ '[[:cntrl:]]'
    or (p_body->>'external_system') !~ '[^[:space:]]'
    or char_length(p_body->>'external_reference') not between 1 and 200 or (p_body->>'external_reference') ~ '[[:cntrl:]]'
    or (p_body->>'external_reference') !~ '[^[:space:]]'
    or (p_body->>'status') not in ('received','rejected')
    or ((p_body->>'status')='rejected' and reason_value is null)
    or (reason_value is not null and (char_length(reason_value) not between 1 and 1000 or reason_value ~ '[[:cntrl:]]' or reason_value !~ '[^[:space:]]')) then
    raise exception using errcode='MQ422',message='invalid acknowledgement values',hint='acknowledgement';
  end if;
  -- Serialize this identity only. Key rotation can safely retry the same organization's event.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.transfer-handoff-ack:'||org::text||':'||event_id::text,0));
  perform app.api_authorize(p_key_hash,'transfer_handoffs:acknowledge');
  select a.location_id,a.source_location_id into location,source_location from app.transfer_handoff_ack_locations(org,p_resource,p_id) a;
  select * into saved from public.transfer_handoff_acknowledgements
    where organization_id=org and client_event_id=event_id;
  if found then
    if (p_resource='transfer-handoffs' and saved.handoff_id is not distinct from p_id
        or p_resource='transfer-handoff-batches' and saved.batch_id is not distinct from p_id)
      and saved.external_system=p_body->>'external_system'
      and saved.external_reference=p_body->>'external_reference'
      and saved.status=p_body->>'status' and saved.reason is not distinct from reason_value then
      return jsonb_build_object('data',app.transfer_handoff_ack_json(saved),'replayed',true);
    end if;
    raise exception using errcode='MQ409',message='event ID reused with different content',hint='acknowledgement_conflict';
  end if;
  insert into public.transfer_handoff_acknowledgements(organization_id,location_id,source_location_id,handoff_id,batch_id,
    client_event_id,api_key_id,external_system,external_reference,status,reason)
  values(org,location,source_location,case when p_resource='transfer-handoffs' then p_id end,
    case when p_resource='transfer-handoff-batches' then p_id end,event_id,key_id,
    p_body->>'external_system',p_body->>'external_reference',p_body->>'status',reason_value)
  returning * into saved;
  return jsonb_build_object('data',app.transfer_handoff_ack_json(saved),'replayed',false);
exception when foreign_key_violation then
  raise exception using errcode='MQ404',message='package unavailable',hint='resource';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.api_upsert(p_key_hash bytea, p_entity text, p_body jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
  v_key uuid;
  v_columns text[];
  v_n integer;
  v_batch uuid := gen_random_uuid();
  v_file_no constant smallint := 1;
  v_sha bytea;
  v_errors integer;
  v_commit jsonb;
  v_counts jsonb;
  v_result jsonb;
  v_constraint text;
  v_analyze text;
begin
  if p_entity is null or not exists (select 1 from ingest.contract_entities e where e.entity = p_entity) then
    raise exception using errcode = 'MQ404', message = 'no such resource', hint = 'resource';
  end if;
  select a.organization_id, a.api_key_id into v_org, v_key
  from app.api_authorize(p_key_hash, case when p_entity in ('demand_history','stock_snapshots','open_orders','receipts') then 'transactions:write' else 'master_data:write' end) as a;
  if p_request_id is null then
    raise exception using errcode = 'MQ422', message = 'a request id is required', hint = 'request_id';
  end if;

  v_columns := app.api_check_fields(p_entity, p_body);
  v_n := jsonb_array_length(p_body -> 'records');

  -- The 5a import lock: one writer per organization, refused at once rather than waited for. It is
  -- taken here, outside the block below, because a lock taken in a rolled-back subtransaction is
  -- released with it.
  if not pg_try_advisory_xact_lock(hashtextextended('zeespare.import:' || v_org::text, 0)) then
    raise exception using errcode = 'MQ409', message = 'another import is writing to this organization; try again shortly',
      hint = 'import_in_progress';
  end if;
  perform app.import_sweep(0);
  delete from ingest.api_writes w
  where w.organization_id = v_org and w.created_at <= now() - interval '24 hours';
  if (select count(*) from (select 1 from ingest.api_writes w
                            where w.organization_id = v_org and w.created_at > now() - interval '24 hours'
                            limit 5000) as x) >= 5000 then
    raise exception using errcode = 'MQ429', message = 'too many recorded API writes in the last 24 hours (at most 5,000)',
      hint = 'api_writes_per_day';
  end if;

  -- ANALYZE (SKIP_LOCKED) in the 5a statistics helpers for this write only. A function SET clause
  -- cannot name a custom setting unless the owner is a superuser (postgres is not, locally or
  -- hosted), so it is set for the transaction here and restored below; an error rolls it back.
  v_analyze := current_setting('zeespare.import_analyze', true);
  perform set_config('zeespare.import_analyze', 'skip_locked', true);

  -- Everything below is undone when the write fails or changes nothing (MQ499 is internal: raised
  -- and caught here only). v_result survives the rollback.
  begin
    v_sha := sha256(convert_to(p_body::text, 'UTF8'));
    begin
      insert into public.import_batches (id, organization_id, source, status, commit_mode, created_by, api_key_id, api_request_id,
                                         files_sha256, file_count, rows_total, validated_at, commit_started_at, last_step_at,
                                         expires_at)
      values (v_batch, v_org, 'api', 'committing', 'atomic', null, v_key, p_request_id,
              v_sha, 1, v_n, now(), now(), now(), null);
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'import_batches_one_committing' then
        raise exception using errcode = 'MQ409', message = 'another import of this organization is committing',
          hint = 'another_commit';
      end if;
      raise;
    end;
    insert into public.import_files (organization_id, batch_id, file_no, entity, original_name, content_type, extension,
                                     size_bytes, sha256, storage_path, columns, rows_total)
    values (v_org, v_batch, v_file_no, p_entity, 'POST /api/v1/' || replace(p_entity, '_', '-') || ':upsert', 'application/json',
            'json', octet_length(p_body::text), v_sha, v_org::text || '/' || v_batch::text || '/1.json', v_columns, v_n);

    -- import_stage_chunk's order: stage, statistics of the entity and its lookups, cells,
    -- references and row rules; then import_seal_file's set rules.
    perform app.api_stage_records(v_batch, p_body -> 'records');
    perform app.import_prepare_stats(v_batch, array(
      select p_entity
      union
      select c.lookup_entity from ingest.contract_columns c where c.entity = p_entity and c.lookup_entity is not null));
    perform app.import_check_cells(v_batch, v_file_no, 1, v_n);
    perform app.import_check_refs(v_batch, v_file_no, 1, v_n, 'stage');
    perform app.import_flush_errors(v_batch, v_file_no);
    perform app.import_check_sets(v_batch, v_file_no);
    perform app.import_flush_errors(v_batch, v_file_no);
    update public.import_files f set status = 'sealed', sealed_at = now()
    where f.organization_id = v_org and f.batch_id = v_batch and f.file_no = v_file_no;

    select b.error_count into v_errors from public.import_batches b where b.id = v_batch;
    if v_errors > 0 then
      v_result := app.api_error_result(v_batch, 'invalid');
      raise exception using errcode = 'MQ499', message = 'api write rolled back';
    end if;

    v_commit := app.import_commit_atomic(v_batch);
    if v_commit ->> 'failure_code' is not null then
      v_result := app.api_error_result(v_batch, 'conflict');
      raise exception using errcode = 'MQ499', message = 'api write rolled back';
    end if;

    select b.counts -> p_entity into v_counts from public.import_batches b where b.id = v_batch;
    if coalesce((v_counts ->> 'inserted')::bigint, 0) + coalesce((v_counts ->> 'updated')::bigint, 0)
       + coalesce((v_counts ->> 'deleted')::bigint, 0) + coalesce((v_counts ->> 'parents_set')::bigint, 0)
       + coalesce((v_counts ->> 'preferred_cleared')::bigint, 0) = 0 then
      v_result := app.api_success_result(v_batch, false);
      raise exception using errcode = 'MQ499', message = 'api write rolled back';
    end if;
    -- In the same transaction as the data; failures and no-ops never reach this insert.
    insert into ingest.api_writes (organization_id, batch_id) values (v_org, v_batch);
    v_result := app.api_success_result(v_batch, true);
  exception when sqlstate 'MQ499' then
    null;
  end;
  perform set_config('zeespare.import_analyze', coalesce(v_analyze, ''), true);
  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.container_capacity_save(p_organization_id uuid, p_batch_id uuid, p_volume text, p_payload text, p_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.container_capacity_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='capacity saving requires an editor';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    or p_confirmed is distinct from true or p_volume is null or p_payload is null
    or p_volume !~ '^[0-9]{1,9}(\.[0-9]{1,6})?$' or p_payload !~ '^[0-9]{1,9}(\.[0-9]{1,6})?$'
    or p_volume::numeric<=0 or p_payload::numeric<=0 then
    raise exception using errcode='MQ422',message='invalid capacity save';
  end if;
  -- Shares proposal-selection serialization. Preview uses a new statement snapshot after waiting.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.purchase-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='capacity saving requires an editor';
  end if;
  select * into previous from public.container_capacity_scenarios s
    where s.organization_id=p_organization_id and s.request_id=p_request_id
      and (s.organization_id=any(array(select app.unscoped_organizations())) or s.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.batch_id=p_batch_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint
      and (previous.report->>'volume_limit_m3')::numeric=p_volume::numeric
      and (previous.report->>'payload_limit_kg')::numeric=p_payload::numeric then return previous.id; end if;
    raise exception using errcode='MQ409',message='capacity request conflicts';
  end if;
  report:=public.container_capacity_preview(p_organization_id,p_batch_id,p_volume,p_payload,p_confirmed);
  if report->>'fingerprint'<>p_fingerprint then
    raise exception using errcode='MQ409',message='capacity evidence changed; refresh preview';
  end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='capacity evidence unavailable'; end if;
  insert into public.container_capacity_scenarios(organization_id,batch_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_batch_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report)
    returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.create_api_key(p_organization_id uuid, p_name text, p_scopes text[], p_expires_in_days integer, p_key_hash bytea, p_display_prefix text, p_last4 text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := app.require_user();
  v_role text;
  v_name text := btrim(p_name);
  v_scopes text[];
  v_id uuid;
  v_constraint text;
begin
  v_role := app.membership_role(p_organization_id);
  if p_organization_id is null or v_role is null or not (v_role = any (array['owner', 'admin'])) then
    raise exception using errcode = 'MQ403', message = 'only owners and admins manage API keys', hint = 'role';
  end if;
  -- A stale tab: the token's active organization is another one.
  if not (p_organization_id = any (array(select app.admin_organizations()))) then
    raise exception using errcode = 'MQ404', message = 'no such organization', hint = 'organization_id';
  end if;

  if v_name is null or char_length(v_name) not between 1 and 80 or v_name ~ '[[:cntrl:]]' then
    raise exception using errcode = 'MQ422', message = 'a key name has 1 to 80 characters and no control characters', hint = 'name';
  end if;
  if p_scopes is null or cardinality(p_scopes) = 0
     or exists (select 1 from unnest(p_scopes) as s
                where s is null or s not in ('master_data:read', 'master_data:write', 'transactions:read', 'transactions:write', 'purchase_handoffs:read', 'purchase_handoffs:acknowledge', 'transfer_handoffs:read', 'transfer_handoffs:acknowledge', 'event_purchase_handoffs:read', 'event_purchase_handoffs:acknowledge', 'excess_disposition_handoffs:read', 'excess_disposition_handoffs:acknowledge', 'network_handoffs:read', 'network_handoffs:acknowledge', 'regional_handoffs:read', 'regional_handoffs:acknowledge')) then
    raise exception using errcode = 'MQ422', message = 'scopes are one or more of master_data:read, master_data:write, transactions:read, transactions:write, purchase_handoffs:read, purchase_handoffs:acknowledge, transfer_handoffs:read, transfer_handoffs:acknowledge, event_purchase_handoffs:read, event_purchase_handoffs:acknowledge, excess_disposition_handoffs:read, excess_disposition_handoffs:acknowledge, network_handoffs:read, network_handoffs:acknowledge, regional_handoffs:read, regional_handoffs:acknowledge',
      hint = 'scopes';
  end if;
  v_scopes := array(select distinct s from unnest(p_scopes) as s order by s);
  if p_expires_in_days is null or p_expires_in_days not between 1 and 366 then
    raise exception using errcode = 'MQ422', message = 'a key expires in 1 to 366 days', hint = 'expires_in_days';
  end if;
  if p_key_hash is null or octet_length(p_key_hash) <> 32 then
    raise exception using errcode = 'MQ422', message = 'key_hash is a SHA-256 digest (32 bytes)', hint = 'key_hash';
  end if;
  if p_display_prefix is null or p_display_prefix !~ '^zeespare_sk_[0-9A-Za-z]{4}$' then
    raise exception using errcode = 'MQ422', message = 'display_prefix is zeespare_sk_ and four base62 characters', hint = 'display_prefix';
  end if;
  if p_last4 is null or p_last4 !~ '^[0-9A-Za-z]{4}$' then
    raise exception using errcode = 'MQ422', message = 'last4 is four base62 characters', hint = 'last4';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('zeespare.api_keys:' || p_organization_id::text, 0));
  if (select count(*) from public.api_keys k
      where k.organization_id = p_organization_id and k.revoked_at is null and k.expires_at > now()) >= 20 then
    raise exception using errcode = 'MQ409', message = 'an organization has at most 20 active API keys; revoke one first',
      hint = 'api_keys';
  end if;

  begin
    insert into public.api_keys (organization_id, name, display_prefix, last4, key_hash, scopes, created_by, expires_at)
    values (p_organization_id, v_name, p_display_prefix, p_last4, p_key_hash, v_scopes, v_user,
            now() + make_interval(days => p_expires_in_days))
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'api_keys_key_hash_key' then
      raise exception using errcode = 'MQ409', message = 'this key already exists; generate another', hint = 'key_hash';
    end if;
    raise;
  end;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_organization(p_slug text, p_name text, p_base_currency character DEFAULT 'SAR'::bpchar, p_home_country character DEFAULT 'SA'::bpchar, p_arabic_enabled boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := app.require_user();
  v_org uuid;
begin
  -- Serialise per user so parallel requests cannot all pass the count below.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.create_organization:' || v_user::text, 0));
  if (select count(*) from public.organizations o
      where o.created_by = v_user and o.created_at > now() - interval '24 hours') >= 5 then
    raise exception using errcode = 'MQ429', message = 'too many organizations created in the last 24 hours';
  end if;
  insert into public.organizations (slug, name, base_currency, home_country, arabic_enabled, created_by)
  values (lower(trim(p_slug)), trim(p_name), upper(p_base_currency), upper(p_home_country), coalesce(p_arabic_enabled, false), v_user)
  returning id into v_org;
  insert into public.memberships (organization_id, user_id, role) values (v_org, v_user, 'owner');
  insert into public.user_settings (user_id, active_organization_id)
  values (v_user, v_org)
  on conflict (user_id) do update set active_organization_id = excluded.active_organization_id;
  return v_org;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delivery_scenario_save(p_organization_id uuid, p_supplier_scenario_id uuid, p_requested_date date, p_calendars_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.delivery_scenarios; report jsonb; result uuid;
begin
  if p_organization_id is null or auth.uid() is null
    or not(p_organization_id = any(array(select app.editable_organizations()))) then
    raise exception using errcode = 'MQ403', message = 'delivery scenario requires an editor';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'MQ422', message = 'invalid delivery scenario request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.delivery-scenario:' || p_organization_id::text, 0));
  if not(p_organization_id = any(array(select app.editable_organizations()))) then
    raise exception using errcode = 'MQ403', message = 'delivery scenario requires an editor';
  end if;
  select * into previous from public.delivery_scenarios where organization_id = p_organization_id and request_id = p_request_id
    and (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));
  if found then
    if previous.supplier_scenario_id = p_supplier_scenario_id and previous.submitted_by = auth.uid()
      and previous.report->>'fingerprint' = p_fingerprint and (previous.report->>'requested_date')::date = p_requested_date
      and (previous.report->>'calendars_confirmed')::boolean = p_calendars_confirmed then return previous.id; end if;
    raise exception using errcode = 'MQ409', message = 'delivery scenario request conflicts';
  end if;
  report := public.delivery_scenario_preview(p_organization_id, p_supplier_scenario_id, p_requested_date, p_calendars_confirmed);
  if report->>'fingerprint' <> p_fingerprint then
    raise exception using errcode = 'MQ409', message = 'calendar inputs changed; refresh preview';
  end if;
  insert into public.delivery_scenarios(organization_id,supplier_scenario_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_supplier_scenario_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report)
    returning id into result;
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.event_delivery_save(p_organization_id uuid, p_scenario_id uuid, p_requested_date date, p_calendars_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.event_delivery_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event delivery save forbidden';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_requested_date is null or not isfinite(p_requested_date) or p_requested_date not between date '1900-01-01' and date '2100-12-31'
    or p_calendars_confirmed is null then raise exception using errcode='MQ422',message='invalid event delivery save'; end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.event-delivery:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then raise exception using errcode='MQ403',message='event delivery save forbidden'; end if;
  select * into previous from public.event_delivery_scenarios x where x.organization_id=p_organization_id and x.request_id=p_request_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.submitted_by=auth.uid() and previous.supplier_scenario_id=p_scenario_id
      and previous.report#>>'{input,requested_date}'=p_requested_date::text
      and previous.report#>'{input,calendars_confirmed}'=to_jsonb(p_calendars_confirmed)
      and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='event delivery request conflicts';
  end if;
  report:=public.event_delivery_preview(p_organization_id,p_scenario_id,p_requested_date,p_calendars_confirmed);
  if report->>'fingerprint' is distinct from p_fingerprint then raise exception using errcode='MQ409',message='event delivery evidence changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_order_needed') then raise exception using errcode='MQ422',message='event delivery unavailable'; end if;
  insert into public.event_delivery_scenarios(organization_id,supplier_scenario_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_scenario_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.event_policy_save(p_organization_id uuid, p_event_id uuid, p_policy_id uuid, p_reason text, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.event_policy_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event policy save forbidden';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_reason is null or p_reason!~'[^[:space:]]' or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid event policy save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.event-policy:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event policy save forbidden';
  end if;
  select * into previous from public.event_policy_scenarios s where s.organization_id=p_organization_id and s.request_id=p_request_id
    and (s.organization_id=any(array(select app.unscoped_organizations())) or s.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.submitted_by=auth.uid() and previous.event_id=p_event_id and previous.policy_id=p_policy_id
      and previous.report#>>'{input,reason}'=btrim(p_reason) and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='event policy request conflicts';
  end if;
  report:=public.event_policy_preview(p_organization_id,p_event_id,p_policy_id,p_reason);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='event policy evidence changed; refresh preview'; end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='event policy unavailable'; end if;
  insert into public.event_policy_scenarios(organization_id,event_id,policy_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_event_id,p_policy_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.event_purchase_cost_save(p_organization_id uuid, p_delivery_id uuid, p_price_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.event_purchase_cost_estimates; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event cost save forbidden';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' or p_price_confirmed is null then
    raise exception using errcode='MQ422',message='invalid event cost save'; end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.event-cost:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then raise exception using errcode='MQ403',message='event cost save forbidden'; end if;
  select * into previous from public.event_purchase_cost_estimates x where x.organization_id=p_organization_id and x.request_id=p_request_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.submitted_by=auth.uid() and previous.delivery_id=p_delivery_id
      and previous.report#>'{input,price_confirmed}'=to_jsonb(p_price_confirmed)
      and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='event cost request conflicts';
  end if;
  report:=public.event_purchase_cost_preview(p_organization_id,p_delivery_id,p_price_confirmed);
  if report->>'fingerprint' is distinct from p_fingerprint then raise exception using errcode='MQ409',message='event cost evidence changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_order_needed') then raise exception using errcode='MQ422',message='event cost unavailable'; end if;
  insert into public.event_purchase_cost_estimates(organization_id,delivery_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_delivery_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.event_purchase_handoff_batch_create(p_organization_id uuid, p_handoff_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare report jsonb; ids uuid[]; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb;
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='batch requires an editor';
  end if;
  -- Serializes set retries and proposal selection changes. Preview rechecks authority after waiting.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.event-purchase-review:'||p_organization_id::text,0));
  report:=public.event_purchase_handoff_batch_preview(p_organization_id,p_handoff_ids);
  if report->>'existing_batch_id' is not null then return (report->>'existing_batch_id')::uuid; end if;
  select array_agg(id order by id) into ids from unnest(p_handoff_ids) id;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','event-purchase-handoff-batch-v1','purpose','planning_only','selected_quantity_basis','full_event_adjusted',
    'notice','As-of planning package of full event-adjusted selections. Baselines and increases are comparison evidence. Overlapping packages may contain the same lines. Not an order, reservation or inbound quantity.',
    'batch_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'summary',report->'summary','lines',report->'lines');
  insert into public.event_purchase_handoff_batches(id,organization_id,location_id,handoff_ids,created_by,created_at,payload)
    values(result,p_organization_id,(report#>>'{summary,location_id}')::uuid,ids,auth.uid(),captured,snapshot);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.event_purchase_handoff_create(p_organization_id uuid, p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.event_purchase_proposals; estimate public.event_purchase_cost_estimates;
  draft public.event_replenishment_drafts; scenario public.event_policy_scenarios; policy public.inventory_policies;
  supplier_scenario uuid;
  existing uuid; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb; current_price jsonb;
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='handoff requires an editor';
  end if;
  if p_proposal_id is null then raise exception using errcode='MQ422',message='proposal required'; end if;
  -- Shared with submit/decide: a new selection cannot race the handoff selection check.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.event-purchase-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='handoff requires an editor';
  end if;
  select * into proposal from public.event_purchase_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  select id into existing from public.event_purchase_handoffs where organization_id=p_organization_id and proposal_id=p_proposal_id;
  -- Existing exports are historical evidence. Replays still require live authority/scope,
  -- but do not reinterpret or replace the captured approval after price/selection changes.
  if found then return existing; end if;
  if proposal.status<>'approved' or exists(select 1 from public.event_purchase_proposals
      where organization_id=p_organization_id and draft_id=proposal.draft_id and status='approved' and revision>proposal.revision) then
    raise exception using errcode='MQ409',message='selected approval required',hint='handoff_selection_changed';
  end if;
  select * into estimate from public.event_purchase_cost_estimates where organization_id=p_organization_id and id=proposal.estimate_id and location_id=proposal.location_id;
  if not found or estimate.report->>'status' is distinct from 'available' or coalesce((estimate.report#>>'{adjusted,quantity}')::numeric,0)<=0 then
    raise exception using errcode='MQ422',message='available positive estimate required';
  end if;
  if estimate.report#>'{source,policy_recalculation_required}' is distinct from 'false'::jsonb then
    raise exception using errcode='MQ422',message='policy recalculation required',hint='event_purchase_policy_required';
  end if;
  if estimate.report#>'{source,event_before_receipt}' is distinct from '[]'::jsonb then
    raise exception using errcode='MQ422',message='event timing review required',hint='event_purchase_timing_required';
  end if;
  current_price:=public.event_purchase_cost_preview(p_organization_id,estimate.delivery_id,true);
  if current_price->>'status' is distinct from 'available' or current_price->>'fingerprint' is distinct from estimate.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='price evidence changed',hint='event_purchase_price_changed';
  end if;
  select s.id into supplier_scenario from public.event_delivery_scenarios d
    join public.event_supplier_scenarios s on s.organization_id=d.organization_id and s.id=d.supplier_scenario_id and s.location_id=d.location_id
    where d.organization_id=p_organization_id and d.id=estimate.delivery_id and d.location_id=proposal.location_id and s.draft_id=proposal.draft_id;
  if not found then raise exception using errcode='MQ422',message='source lineage unavailable'; end if;
  select * into draft from public.event_replenishment_drafts where organization_id=p_organization_id and id=proposal.draft_id and location_id=proposal.location_id;
  if not found then raise exception using errcode='MQ422',message='draft unavailable'; end if;
  select * into scenario from public.event_policy_scenarios where organization_id=p_organization_id and id=draft.scenario_id and location_id=proposal.location_id;
  if not found then raise exception using errcode='MQ422',message='event policy unavailable'; end if;
  select * into policy from public.inventory_policies where organization_id=p_organization_id and id=scenario.policy_id and location_id=proposal.location_id;
  if not found then raise exception using errcode='MQ422',message='policy unavailable'; end if;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','event-purchase-handoff-v1','purpose','planning_only','selected_quantity_basis','full_event_adjusted',
    'notice','As-of planning evidence only. Not an order, supplier acceptance or inbound quantity.',
    'handoff_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'proposal',jsonb_build_object('id',proposal.id,'revision',proposal.revision,'estimate_id',estimate.id,'draft_id',draft.id,
      'submitted_by',proposal.submitted_by,'submitted_at',proposal.created_at,'reason',proposal.reason,
      'approved_by',proposal.decided_by,'approved_at',proposal.decided_at,'approval_reason',proposal.decision_reason),
    'evidence',jsonb_build_object('event_id',scenario.event_id,'event_policy_id',scenario.id,'delivery_id',estimate.delivery_id,
      'supplier_scenario_id',supplier_scenario,'policy_id',policy.id,'forecast_id',policy.forecast_id,'draft_fingerprint',draft.report->>'fingerprint'),
    'estimate',estimate.report);
  insert into public.event_purchase_handoffs(id,organization_id,proposal_id,location_id,created_by,created_at,payload)
    values(result,p_organization_id,proposal.id,proposal.location_id,auth.uid(),captured,snapshot);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.event_purchase_proposal_decide(p_organization_id uuid, p_proposal_id uuid, p_request_id uuid, p_decision text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.event_purchase_proposals; source public.event_purchase_cost_estimates; current_price jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='purchase decision requires membership';
  end if;
  if p_request_id is null or p_decision is null or p_decision not in ('approved','rejected','withdrawn') or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid purchase decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.event-purchase-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='purchase decision requires membership';
  end if;
  select * into proposal from public.event_purchase_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations()))) for update;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  if p_decision='withdrawn' then
    if proposal.submitted_by<>auth.uid() then raise exception using errcode='MQ403',message='only the author may withdraw'; end if;
  elsif proposal.submitted_by=auth.uid() or not(p_organization_id=any(array(select app.approving_organizations()))) then
    raise exception using errcode='MQ403',message='independent reviewer required';
  end if;
  if proposal.status<>'pending' then
    if proposal.decision_request_id=p_request_id and proposal.decided_by=auth.uid() and proposal.status=p_decision and proposal.decision_reason=why then return proposal.id; end if;
    raise exception using errcode='MQ409',message='proposal already decided';
  end if;
  if exists(select 1 from public.event_purchase_proposals where organization_id=p_organization_id and decision_request_id=p_request_id) then
    raise exception using errcode='MQ409',message='decision request conflicts';
  end if;
  if p_decision='approved' then
    select * into source from public.event_purchase_cost_estimates where organization_id=p_organization_id and id=proposal.estimate_id;
    if source.report#>'{source,policy_recalculation_required}' is distinct from 'false'::jsonb then
      raise exception using errcode='MQ422',message='policy recalculation required',hint='event_purchase_policy_required';
    end if;
    if source.report#>'{source,event_before_receipt}' is distinct from '[]'::jsonb then
      raise exception using errcode='MQ422',message='event timing review required',hint='event_purchase_timing_required';
    end if;
    current_price:=public.event_purchase_cost_preview(p_organization_id,source.delivery_id,true);
    if current_price->>'status' is distinct from 'available' or current_price->>'fingerprint' is distinct from source.report->>'fingerprint' then
      raise exception using errcode='MQ409',message='price evidence changed',hint='event_purchase_price_changed';
    end if;
  end if;
  update public.event_purchase_proposals set status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp(),decision_reason=why,decision_request_id=p_request_id where id=proposal.id;
  return proposal.id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.event_purchase_proposal_submit(p_organization_id uuid, p_estimate_id uuid, p_request_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source public.event_purchase_cost_estimates; previous public.event_purchase_proposals; result uuid; sequence integer; original_draft uuid; current_price jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='purchase proposal requires an editor';
  end if;
  if p_request_id is null or p_estimate_id is null or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid purchase proposal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.event-purchase-review:'||p_organization_id::text,0));
  -- A waiter must use current membership and location access, including on replay.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='purchase proposal requires an editor';
  end if;
  select * into source from public.event_purchase_cost_estimates where organization_id=p_organization_id and id=p_estimate_id
    and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='estimate unavailable'; end if;
  select * into previous from public.event_purchase_proposals where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if previous.estimate_id=p_estimate_id and previous.submitted_by=auth.uid() and previous.reason=why then return previous.id; end if;
    raise exception using errcode='MQ409',message='proposal request conflicts';
  end if;
  if source.report->>'status' is distinct from 'available' or coalesce((source.report#>>'{adjusted,quantity}')::numeric,0)<=0 then
    raise exception using errcode='MQ422',message='choose an available positive estimate';
  end if;
  -- Derive lineage from saved rows, never from a client-supplied draft/location.
  select s.draft_id into original_draft from public.event_delivery_scenarios d
    join public.event_supplier_scenarios s on s.organization_id=d.organization_id and s.id=d.supplier_scenario_id and s.location_id=d.location_id
    join public.event_replenishment_drafts r on r.organization_id=s.organization_id and r.id=s.draft_id and r.location_id=s.location_id
    where d.organization_id=p_organization_id and d.id=source.delivery_id and d.location_id=source.location_id;
  if original_draft is null then raise exception using errcode='MQ422',message='source lineage unavailable'; end if;
  current_price:=public.event_purchase_cost_preview(p_organization_id,source.delivery_id,true);
  if current_price->>'status' is distinct from 'available' or current_price->>'fingerprint' is distinct from source.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='price evidence changed',hint='event_purchase_price_changed';
  end if;
  if exists(select 1 from public.event_purchase_proposals where draft_id=original_draft and status='pending') then
    raise exception using errcode='MQ409',message='draft has a pending proposal',hint='event_purchase_pending';
  end if;
  select coalesce(max(revision),0)+1 into sequence from public.event_purchase_proposals where draft_id=original_draft;
  insert into public.event_purchase_proposals(organization_id,estimate_id,draft_id,location_id,revision,request_id,submitted_by,reason)
    values(p_organization_id,source.id,original_draft,source.location_id,sequence,p_request_id,auth.uid(),why) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.event_replenishment_save(p_organization_id uuid, p_scenario_id uuid, p_backorders text, p_orders_confirmed boolean, p_event_uncommitted boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.event_replenishment_drafts; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event replenishment save forbidden';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_backorders is null or p_backorders!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or p_orders_confirmed is null or p_event_uncommitted is null then
    raise exception using errcode='MQ422',message='invalid event replenishment save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.event-replenishment:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event replenishment save forbidden';
  end if;
  select * into previous from public.event_replenishment_drafts x where x.organization_id=p_organization_id and x.request_id=p_request_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.submitted_by=auth.uid() and previous.scenario_id=p_scenario_id
      and (previous.report#>>'{input,backorders}')::numeric=p_backorders::numeric
      and previous.report#>'{input,orders_confirmed}'=to_jsonb(p_orders_confirmed)
      and previous.report#>'{input,event_uncommitted}'=to_jsonb(p_event_uncommitted)
      and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='event replenishment request conflicts';
  end if;
  report:=public.event_replenishment_preview(p_organization_id,p_scenario_id,p_backorders,p_orders_confirmed,p_event_uncommitted);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='event replenishment evidence changed; refresh preview'; end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='event replenishment unavailable'; end if;
  insert into public.event_replenishment_drafts(organization_id,scenario_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_scenario_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.event_supplier_save(p_organization_id uuid, p_draft_id uuid, p_supplier_code text, p_terms_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.event_supplier_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event supplier save forbidden';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_supplier_code is null or p_supplier_code!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' or p_terms_confirmed is null then
    raise exception using errcode='MQ422',message='invalid event supplier save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.event-supplier:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event supplier save forbidden';
  end if;
  select * into previous from public.event_supplier_scenarios x where x.organization_id=p_organization_id and x.request_id=p_request_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.submitted_by=auth.uid() and previous.draft_id=p_draft_id
      and previous.report#>>'{input,supplier_code}'=p_supplier_code
      and previous.report#>'{input,terms_confirmed}'=to_jsonb(p_terms_confirmed)
      and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='event supplier request conflicts';
  end if;
  report:=public.event_supplier_preview(p_organization_id,p_draft_id,p_supplier_code,p_terms_confirmed);
  if report->>'fingerprint' is distinct from p_fingerprint then raise exception using errcode='MQ409',message='event supplier evidence changed; refresh preview'; end if;
  if report->>'status' is distinct from 'available' then raise exception using errcode='MQ422',message='event supplier comparison unavailable'; end if;
  insert into public.event_supplier_scenarios(organization_id,draft_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_draft_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.excess_disposition_decide(p_organization_id uuid, p_proposal_id uuid, p_request_id uuid, p_decision text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.excess_disposition_proposals; evidence jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='disposition decision requires membership';
  end if;
  if p_request_id is null or p_decision is null or p_decision not in ('approved','rejected','withdrawn')
    or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid disposition decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.excess-disposition:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='disposition decision requires membership';
  end if;
  select * into proposal from public.excess_disposition_proposals p where p.organization_id=p_organization_id and p.id=p_proposal_id
    and (p.organization_id=any(array(select app.unscoped_organizations())) or p.location_id=any(array(select app.scoped_locations()))) for update;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  if p_decision='withdrawn' then
    if proposal.submitted_by<>auth.uid() then raise exception using errcode='MQ403',message='only the author may withdraw'; end if;
  elsif proposal.submitted_by=auth.uid() or not(p_organization_id=any(array(select app.approving_organizations()))) then
    raise exception using errcode='MQ403',message='independent reviewer required';
  end if;
  if proposal.status<>'pending' then
    if proposal.decision_request_id=p_request_id and proposal.decided_by=auth.uid()
      and proposal.status=p_decision and proposal.decision_reason=why then return proposal.id; end if;
    raise exception using errcode='MQ409',message='proposal already decided';
  end if;
  if exists(select 1 from public.excess_disposition_proposals where organization_id=p_organization_id and decision_request_id=p_request_id) then
    raise exception using errcode='MQ409',message='decision request conflicts';
  end if;
  if p_decision='approved' then
    evidence:=public.excess_disposition_preview(p_organization_id,proposal.assessment_id,proposal.item_id);
    if evidence->'matches' is distinct from 'true'::jsonb or evidence->'line' is distinct from proposal.line then
      raise exception using errcode='MQ409',message='assessment evidence changed',hint='excess_disposition_changed';
    end if;
  end if;
  update public.excess_disposition_proposals set status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp(),
    decision_reason=why,decision_request_id=p_request_id where id=proposal.id;
  return proposal.id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.excess_disposition_handoff_batch_create(p_organization_id uuid, p_handoff_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare report jsonb; ids uuid[]; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='batch requires an editor';
  end if;
  -- Shared with disposition decisions and single handoffs; preview rechecks live authority.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.excess-disposition:'||p_organization_id::text,0));
  report:=public.excess_disposition_handoff_batch_preview(p_organization_id,p_handoff_ids);
  if report->>'existing_batch_id' is not null then return (report->>'existing_batch_id')::uuid; end if;
  select array_agg(id order by id) into ids from unnest(p_handoff_ids) id;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','excess-disposition-handoff-batch-v1','purpose','planning_only',
    'notice','As-of disposition planning package only. Reference inventory value is neither recovery proceeds nor an accounting write-off. Overlap is allowed; no reservation, supplier return, scrap execution or stock movement is created.',
    'batch_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'summary',report->'summary','lines',report->'lines');
  insert into public.excess_disposition_handoff_batches(id,organization_id,location_id,handoff_ids,created_by,created_at,payload)
    values(result,p_organization_id,(report#>>'{summary,location_id}')::uuid,ids,auth.uid(),captured,snapshot);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.excess_disposition_handoff_create(p_organization_id uuid, p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.excess_disposition_proposals; assessment public.excess_stock_assessments;
  evidence jsonb; comparison jsonb; existing uuid; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='handoff requires an editor';
  end if;
  if p_proposal_id is null then raise exception using errcode='MQ422',message='proposal required'; end if;
  -- Serialize with submit/decide so a replacement approval cannot race selection.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.excess-disposition:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='handoff requires an editor';
  end if;
  select * into proposal from public.excess_disposition_proposals p
    where p.organization_id=p_organization_id and p.id=p_proposal_id
      and (p.organization_id=any(array(select app.unscoped_organizations())) or p.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  select id into existing from public.excess_disposition_handoffs
    where organization_id=p_organization_id and proposal_id=p_proposal_id;
  -- Retries require live authority and scope, but preserve original historical evidence.
  if found then return existing; end if;
  if proposal.status<>'approved' or exists(select 1 from public.excess_disposition_proposals newer
      where newer.organization_id=p_organization_id and newer.assessment_id=proposal.assessment_id
        and newer.item_id=proposal.item_id and newer.status='approved' and newer.revision>proposal.revision) then
    raise exception using errcode='MQ409',message='selected approval required',hint='handoff_selection_changed';
  end if;
  evidence:=public.excess_disposition_preview(p_organization_id,proposal.assessment_id,proposal.item_id);
  if evidence->'matches' is distinct from 'true'::jsonb or evidence->'line' is distinct from proposal.line then
    raise exception using errcode='MQ409',message='assessment evidence changed',hint='excess_disposition_changed';
  end if;
  select * into assessment from public.excess_stock_assessments
    where organization_id=p_organization_id and id=proposal.assessment_id and location_id=proposal.location_id;
  if not found then raise exception using errcode='MQ404',message='assessment unavailable'; end if;
  comparison:=proposal.line->'comparison';
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','excess-disposition-handoff-v1','purpose','planning_only',
    'notice','As-of disposition planning evidence only. Not a supplier return, scrap execution, stock reservation or accounting write-off. Reference value is not recovery proceeds.',
    'handoff_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'proposal',jsonb_build_object('id',proposal.id,'revision',proposal.revision,'submitted_by',proposal.submitted_by,
      'submitted_at',proposal.created_at,'reason',proposal.reason,'approved_by',proposal.decided_by,
      'approved_at',proposal.decided_at,'approval_reason',proposal.decision_reason),
    'assessment',jsonb_build_object('id',assessment.id,'submitted_by',assessment.submitted_by,'created_at',assessment.created_at,
      'reason',assessment.reason,'as_of_confirmed',assessment.confirmed,'fingerprint',assessment.report->>'fingerprint'),
    'disposition',jsonb_build_object('kind',proposal.kind,'item_id',proposal.item_id,'item_code',comparison->>'item_code',
      'location_id',proposal.location_id,'location_code',comparison->>'location_code','cutoff',assessment.cutoff,
      'quantity',proposal.quantity::text,'unit',comparison->>'unit','reference_value',proposal.reference_value::text,
      'currency',comparison#>>'{snapshot,currency}'),
    'line',proposal.line);
  insert into public.excess_disposition_handoffs(id,organization_id,proposal_id,location_id,created_by,created_at,payload)
    values(result,p_organization_id,proposal.id,proposal.location_id,auth.uid(),captured,snapshot);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.excess_disposition_submit(p_organization_id uuid, p_assessment_id uuid, p_item_id uuid, p_kind text, p_quantity text, p_request_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source jsonb; saved_line jsonb; previous public.excess_disposition_proposals; result uuid; sequence integer; amount numeric;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='disposition requires an editor';
  end if;
  if p_assessment_id is null or p_item_id is null or p_request_id is null or p_kind is null
    or p_kind not in ('supplier_return','scrap') or p_quantity is null or p_quantity !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid disposition proposal';
  end if;
  amount:=p_quantity::numeric;
  if amount<=0 then raise exception using errcode='MQ422',message='positive disposition quantity required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.excess-disposition:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='disposition requires an editor';
  end if;
  select * into previous from public.excess_disposition_proposals p
    where p.organization_id=p_organization_id and p.request_id=p_request_id;
  if found then
    if not(previous.organization_id=any(array(select app.unscoped_organizations())) or previous.location_id=any(array(select app.scoped_locations()))) then
      raise exception using errcode='MQ404',message='proposal unavailable';
    end if;
    if previous.assessment_id=p_assessment_id and previous.item_id=p_item_id and previous.kind=p_kind
      and previous.quantity=amount and previous.submitted_by=auth.uid() and previous.reason=why then return previous.id; end if;
    raise exception using errcode='MQ409',message='proposal request conflicts';
  end if;
  source:=public.excess_disposition_preview(p_organization_id,p_assessment_id,p_item_id);
  saved_line:=source->'line';
  if saved_line#>>'{comparison,status}' is distinct from 'available'
    or coalesce((saved_line#>>'{comparison,quantity_above}')::numeric,0)<=0
    or amount>(saved_line#>>'{comparison,quantity_above}')::numeric then
    raise exception using errcode='MQ422',message='quantity exceeds saved assessment line',hint='excess_disposition_quantity';
  end if;
  if source->'matches' is distinct from 'true'::jsonb then
    raise exception using errcode='MQ409',message='assessment evidence changed',hint='excess_disposition_changed';
  end if;
  if exists(select 1 from public.excess_disposition_proposals where assessment_id=p_assessment_id and item_id=p_item_id and status='pending') then
    raise exception using errcode='MQ409',message='assessment line has a pending proposal',hint='excess_disposition_pending';
  end if;
  select coalesce(max(revision),0)+1 into sequence from public.excess_disposition_proposals where assessment_id=p_assessment_id and item_id=p_item_id;
  insert into public.excess_disposition_proposals(organization_id,assessment_id,item_id,location_id,kind,quantity,reference_value,line,revision,request_id,submitted_by,reason)
    values(p_organization_id,p_assessment_id,p_item_id,(source->>'location_id')::uuid,p_kind,amount,
      amount*(saved_line#>>'{comparison,snapshot,unit_cost}')::numeric,saved_line,sequence,p_request_id,auth.uid(),why)
    returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.excess_stock_save(p_organization_id uuid, p_selections jsonb, p_reason text, p_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.excess_stock_assessments; selections jsonb; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='assessment saving requires an editor';
  end if;
  selections:=app.excess_stock_selection(p_selections);
  if p_confirmed is distinct from true or p_request_id is null or p_fingerprint is null
    or p_fingerprint !~ '^[a-f0-9]{64}$' or p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='assessment reason and confirmation required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.excess-stock:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='assessment saving requires an editor';
  end if;
  select * into previous from public.excess_stock_assessments a
    where a.organization_id=p_organization_id and a.request_id=p_request_id;
  if found then
    if not(previous.organization_id=any(array(select app.unscoped_organizations()))
      or previous.location_id=any(array(select app.scoped_locations()))) then
      raise exception using errcode='MQ404',message='assessment unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.reason=btrim(p_reason)
      and previous.report->'selections'=selections and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='assessment request conflicts';
  end if;
  report:=public.excess_stock_preview(p_organization_id,selections);
  if report->>'fingerprint' is distinct from p_fingerprint then
    raise exception using errcode='MQ409',message='assessment evidence changed; refresh preview';
  end if;
  if report->>'status' is distinct from 'available' then
    raise exception using errcode='MQ422',message='every assessment line must be comparable';
  end if;
  insert into public.excess_stock_assessments(organization_id,location_id,cutoff,request_id,submitted_by,reason,confirmed,report)
    values(p_organization_id,(report->>'location_id')::uuid,(report->>'cutoff')::date,p_request_id,auth.uid(),btrim(p_reason),true,report)
    returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.external_driver_save(p_organization_id uuid, p_input jsonb, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare input jsonb; report jsonb; previous public.external_driver_datasets; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='driver save forbidden';
  end if;
  input := app.external_driver_input(p_input);
  if input->'confirmed' <> 'true'::jsonb or p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422', message='invalid driver save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.external-driver:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='driver save forbidden';
  end if;
  select * into previous from public.external_driver_datasets x where x.organization_id=p_organization_id and x.request_id=p_request_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409', message='driver request conflicts';
  end if;
  report := public.external_driver_preview(p_organization_id, input);
  if report->>'fingerprint' <> p_fingerprint then raise exception using errcode='MQ409', message='driver evidence changed; refresh preview'; end if;
  insert into public.external_driver_datasets(organization_id,location_id,item_id,item_code,location_code,driver_name,request_id,submitted_by,report)
    values(p_organization_id,(report#>>'{source,location_id}')::uuid,(report#>>'{source,item_id}')::uuid,
      input->>'item_code',input->>'location_code',input->>'driver_name',p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.forecast_driver_enqueue(p_organization_id uuid, p_forecast_id uuid, p_dataset_id uuid, p_request_id uuid, p_confirmed boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.forecast_results; d public.external_driver_datasets; source_run public.planning_runs;
 existing public.planning_runs; location_code text; run uuid; options jsonb; input jsonb; horizon integer;
begin
 if p_organization_id is null or not (p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='driver forecasting requires an editor'; end if;
 if p_confirmed is distinct from true or p_request_id is null or p_forecast_id is null or p_dataset_id is null then
  raise exception using errcode='MQ422',message='driver applicability confirmation required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('zeespare.planning:'||p_organization_id::text,0));
 if not (p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='driver forecasting requires an editor'; end if;
 select * into existing from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if not (p_organization_id=any(array(select app.unscoped_organizations())))
   and not (existing.location_id=any(array(select app.scoped_locations()))) then
   raise exception using errcode='MQ404',message='source unavailable'; end if;
  if existing.kind<>'forecast' or existing.options->>'method' is distinct from 'driver-v1'
   or existing.options->>'source_forecast_id' is distinct from p_forecast_id::text
   or existing.options->>'dataset_id' is distinct from p_dataset_id::text or existing.created_by is distinct from auth.uid() then
   raise exception using errcode='MQ409',message='conflicting request'; end if;
  return existing.id;
 end if;
 select * into f from public.forecast_results where organization_id=p_organization_id and id=p_forecast_id;
 select * into d from public.external_driver_datasets where organization_id=p_organization_id and id=p_dataset_id;
 if f.id is null or d.id is null or f.location_id<>d.location_id
  or (not (p_organization_id=any(array(select app.unscoped_organizations())))
   and not (f.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='source unavailable'; end if;
 select * into source_run from public.planning_runs where organization_id=p_organization_id and id=f.run_id;
 horizon:=(source_run.options->>'horizon')::integer;
 if f.status<>'selected' or source_run.status is distinct from 'succeeded' or source_run.kind is distinct from 'forecast'
  or coalesce(source_run.options->>'method','') not in ('baseline-v1','expanded-v1')
  or source_run.options->>'history_complete' is distinct from 'true'
  or f.item_id is distinct from d.item_id or f.evidence->'source' ? 'preparation'
  or f.evidence#>>'{source,unit_provenance,status}' is distinct from 'consistent'
  or coalesce(f.evidence#>>'{source,unit_provenance,unit}','') not in ('EA','SET','L','KG')
  or source_run.from_date is distinct from (d.report#>>'{input,history_from}')::date
  or source_run.to_date is distinct from (d.report#>>'{input,cutoff}')::date
  or horizon is null or horizon not between 1 and 90
  or source_run.to_date+horizon is distinct from (d.report#>>'{input,forecast_to}')::date
  or (f.evidence#>>'{source,end_day}')::date is distinct from source_run.to_date
  or source_run.to_date-(f.evidence#>>'{source,start_day}')::date+1<56+3*horizon then
  raise exception using errcode='MQ422',message='choose matching individual forecast and driver evidence'; end if;
 select code into location_code from public.locations where organization_id=p_organization_id and id=f.location_id and is_active;
 if location_code is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
 options:=jsonb_build_object('method','driver-v1','horizon',horizon,'source_forecast_id',f.id,'dataset_id',d.id,
  'history_complete',true,'applicability_confirmed',true);
 run:=app.planning_enqueue_kind(p_organization_id,location_code,source_run.from_date,source_run.to_date,p_request_id,'forecast',options);
 input:=jsonb_build_object('kind','forecast','method','driver-v1','computed_at',clock_timestamp(),
  'from_date',source_run.from_date,'to_date',source_run.to_date,'options',options,
  'items',jsonb_build_array(f.evidence->'source'),
  'driver',jsonb_build_object('id',d.id,'imported_at',d.created_at,'report',d.report),
  'original_forecast',jsonb_build_object('id',f.id,'run_id',f.run_id,'method',source_run.options->>'method','summary',f.summary));
 if octet_length(input::text)>20000000 then raise exception using errcode='MQ422',message='captured evidence too large'; end if;
 insert into planning.forecast_inputs(run_id,payload) values(run,input);
 return run;
end; $function$
;

CREATE OR REPLACE FUNCTION public.forecast_multi_driver_enqueue(p_organization_id uuid, p_forecast_id uuid, p_dataset_ids uuid[], p_request_id uuid, p_confirmed boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f public.forecast_results; d public.external_driver_datasets; source_run public.planning_runs;
 existing public.planning_runs; location_code text; run uuid; options jsonb; input jsonb; horizon integer;
 ids uuid[]; dataset_id uuid; drivers jsonb:='[]';
begin
 if p_organization_id is null or not (p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='driver forecasting requires an editor'; end if;
 if p_confirmed is distinct from true or p_request_id is null or p_forecast_id is null
  or coalesce(array_ndims(p_dataset_ids),0)<>1 or cardinality(p_dataset_ids) not between 2 and 5 then
  raise exception using errcode='MQ422',message='confirm two to five distinct applicable driver datasets'; end if;
 if array_position(p_dataset_ids,null) is not null then
  raise exception using errcode='MQ422',message='null driver dataset'; end if;
 select array_agg(distinct id order by id) into ids from unnest(p_dataset_ids) id;
 if cardinality(ids)<>cardinality(p_dataset_ids) then
  raise exception using errcode='MQ422',message='duplicate driver dataset'; end if;
 perform pg_advisory_xact_lock(hashtextextended('zeespare.planning:'||p_organization_id::text,0));
 if not (p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='driver forecasting requires an editor'; end if;
 select * into existing from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if not (p_organization_id=any(array(select app.unscoped_organizations())))
   and not (existing.location_id=any(array(select app.scoped_locations()))) then
   raise exception using errcode='MQ404',message='source unavailable'; end if;
  if existing.kind<>'forecast' or existing.options->>'method' is distinct from 'multi-driver-v1'
   or existing.options->>'source_forecast_id' is distinct from p_forecast_id::text
   or existing.options->'dataset_ids' is distinct from to_jsonb(ids) or existing.created_by is distinct from auth.uid() then
   raise exception using errcode='MQ409',message='conflicting request'; end if;
  return existing.id;
 end if;
 select * into f from public.forecast_results where organization_id=p_organization_id and id=p_forecast_id;
 if f.id is null or (not (p_organization_id=any(array(select app.unscoped_organizations())))
   and not (f.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='source unavailable'; end if;
 select * into source_run from public.planning_runs where organization_id=p_organization_id and id=f.run_id;
 horizon:=(source_run.options->>'horizon')::integer;
 if f.status<>'selected' or source_run.status is distinct from 'succeeded' or source_run.kind is distinct from 'forecast'
  or coalesce(source_run.options->>'method','') not in ('baseline-v1','expanded-v1')
  or source_run.options->>'history_complete' is distinct from 'true' or f.evidence->'source' ? 'preparation'
  or f.evidence#>>'{source,unit_provenance,status}' is distinct from 'consistent'
  or coalesce(f.evidence#>>'{source,unit_provenance,unit}','') not in ('EA','SET','L','KG')
  or horizon is null or horizon not between 1 and 90
  or (f.evidence#>>'{source,end_day}')::date is distinct from source_run.to_date
  or source_run.to_date-(f.evidence#>>'{source,start_day}')::date+1<56+3*horizon then
  raise exception using errcode='MQ422',message='choose a completed individual forecast with known demand units'; end if;
 foreach dataset_id in array ids loop
  select * into d from public.external_driver_datasets where organization_id=p_organization_id and id=dataset_id;
  if d.id is null or d.location_id is distinct from f.location_id then
   raise exception using errcode='MQ404',message='source unavailable'; end if;
  if d.item_id is distinct from f.item_id
   or source_run.from_date is distinct from (d.report#>>'{input,history_from}')::date
   or source_run.to_date is distinct from (d.report#>>'{input,cutoff}')::date
   or source_run.to_date+horizon is distinct from (d.report#>>'{input,forecast_to}')::date then
   raise exception using errcode='MQ422',message='choose matching item and driver windows'; end if;
  drivers:=drivers||jsonb_build_array(jsonb_build_object('id',d.id,'imported_at',d.created_at,'report',d.report));
 end loop;
 select code into location_code from public.locations where organization_id=p_organization_id and id=f.location_id and is_active;
 if location_code is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
 options:=jsonb_build_object('method','multi-driver-v1','horizon',horizon,'source_forecast_id',f.id,'dataset_ids',to_jsonb(ids),
  'history_complete',true,'applicability_confirmed',true,'distinct_drivers_confirmed',true);
 run:=app.planning_enqueue_kind(p_organization_id,location_code,source_run.from_date,source_run.to_date,p_request_id,'forecast',options);
 input:=jsonb_build_object('kind','forecast','method','multi-driver-v1','computed_at',clock_timestamp(),
  'from_date',source_run.from_date,'to_date',source_run.to_date,'options',options,
  'items',jsonb_build_array(f.evidence->'source'),'drivers',drivers,
  'original_forecast',jsonb_build_object('id',f.id,'run_id',f.run_id,'method',source_run.options->>'method','summary',f.summary));
 if octet_length(input::text)>20000000 then raise exception using errcode='MQ422',message='captured evidence too large'; end if;
 insert into planning.forecast_inputs(run_id,payload) values(run,input);
 return run;
end; $function$
;

CREATE OR REPLACE FUNCTION public.import_commit_step(p_batch_id uuid, p_max_rows integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch public.import_batches;
  v_started timestamptz := clock_timestamp();
  v_mode text;
  v_unit jsonb;
  v_units integer := 0;
begin
  v_batch := app.import_batch_for_editor(p_batch_id, false);
  if p_max_rows is not null and p_max_rows < 1 then
    raise exception using errcode = 'MQ422', message = 'max_rows is at least 1', hint = 'max_rows';
  end if;
  if v_batch.status = 'succeeded' then
    return app.import_batch_state(p_batch_id) || jsonb_build_object('done', true, 'units', 0);
  end if;
  if v_batch.status not in ('validated', 'committing') then
    raise exception using errcode = 'MQ409', message = format('the import is %s', v_batch.status), hint = 'status';
  end if;

  -- Not this batch: an idle commit of its own simply continues (the step refreshes last_step_at).
  perform app.import_sweep(0, p_batch_id);
  if not pg_try_advisory_xact_lock(hashtextextended('zeespare.import:' || v_batch.organization_id::text, 0)) then
    raise exception using errcode = 'MQ409', message = 'another import is writing to this organization; try again shortly',
      hint = 'import_in_progress';
  end if;
  select * into v_batch from public.import_batches b where b.id = p_batch_id for update;

  if v_batch.status = 'succeeded' then
    return app.import_batch_state(p_batch_id) || jsonb_build_object('done', true, 'units', 0);
  elsif v_batch.status = 'validated' then
    if v_batch.error_count > 0 then
      raise exception using errcode = 'MQ409', message = 'fix the errors first', hint = 'errors';
    end if;
    if v_batch.validated_at is null or v_batch.validated_at < now() - interval '24 hours' then
      raise exception using errcode = 'MQ409', message = 'the validation is older than 24 hours; import the files again',
        hint = 'validation_expired';
    end if;
    v_mode := case when v_batch.rows_staged <= 5000 then 'atomic' else 'stepped' end;
    -- Staging emptied by crash recovery, a failover or a restore: nothing is written, the import
    -- ends as expired with failure_code staging_lost (returned, not raised, so the state persists).
    if not app.import_staging_intact(p_batch_id, v_mode = 'atomic') then
      update public.import_batches b
      set status = 'expired', failure_code = 'staging_lost',
          failure_detail = 'staging_lost: the checked rows are no longer on the server; import the files again',
          finished_at = now(), expires_at = null
      where b.id = p_batch_id;
      return app.import_batch_state(p_batch_id) || jsonb_build_object('done', true, 'units', 0);
    end if;
    begin
      update public.import_batches b
      set status = 'committing', commit_mode = v_mode, commit_started_at = now(), last_step_at = clock_timestamp(),
          expires_at = null, progress = jsonb_build_object('phase', 'prepare', 'steps', 0)
      where b.id = p_batch_id;
    exception when unique_violation then
      raise exception using errcode = 'MQ409', message = 'another import of this organization is committing',
        hint = 'another_commit';
    end;
    if v_mode = 'atomic' then
      v_unit := app.import_commit_atomic(p_batch_id);
      return app.import_batch_state(p_batch_id)
        || jsonb_build_object('done', true, 'units', 1, 'unit', v_unit ->> 'unit', 'ms', (v_unit ->> 'ms')::integer);
    end if;
  elsif v_batch.status <> 'committing' or v_batch.commit_mode is distinct from 'stepped' then
    raise exception using errcode = 'MQ409', message = format('the import is %s', v_batch.status), hint = 'status';
  end if;

  loop
    v_unit := app.import_commit_unit(p_batch_id, p_max_rows);
    v_units := v_units + 1;
    exit when v_unit ->> 'status' <> 'committing' or clock_timestamp() - v_started > interval '250 milliseconds';
  end loop;
  return app.import_batch_state(p_batch_id)
    || jsonb_build_object('done', v_unit ->> 'status' <> 'committing', 'units', v_units, 'unit', v_unit ->> 'unit',
                          'ms', (v_unit ->> 'ms')::integer);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.import_create_batch(p_batch_id uuid, p_organization_id uuid, p_files jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := app.require_user();
  v_hash bytea;
  v_existing public.import_batches;
  v_f jsonb;
  v_ord bigint;
  v_contract ingest.contract_entities;
  v_file_no smallint;
  v_file_nos smallint[] := '{}';
  v_entities text[] := '{}';
  v_entity text;
  v_text text;
  v_extension text;
  v_size bigint;
  v_rows integer;
  v_rows_sum integer := 0;
  v_cols text[];
  v_unknown text;
  v_header text[];
  v_mapping jsonb;
  v_parse jsonb;
  v_group jsonb;
begin
  perform app.require_import_editor(p_organization_id);
  if p_batch_id is null then
    raise exception using errcode = 'MQ422', message = 'an import id is required', hint = 'batch_id';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) not between 1 and 60
     or octet_length(p_files::text) > 262144 then
    raise exception using errcode = 'MQ422', message = 'an import has 1 to 60 files', hint = 'files';
  end if;
  v_hash := sha256(convert_to(p_files::text, 'UTF8'));

  perform pg_advisory_xact_lock(hashtextextended('zeespare.imports:' || p_organization_id::text, 0));

  -- Ids are global (client-generated v4 UUIDs), so an id already used by another organization is
  -- refused like any other unusable id (MQ409 batch_id). That confirms only that the id exists,
  -- never its organization or content, and only to someone who already knows the unguessable id:
  -- accepted, unlike the RPCs on an existing import, which answer MQ404 batch_id to non-members.
  select * into v_existing from public.import_batches b where b.id = p_batch_id;
  if v_existing.id is not null then
    if v_existing.organization_id = p_organization_id and v_existing.created_by = v_user
       and v_existing.files_sha256 = v_hash then
      return app.import_batch_state(v_existing.id) || jsonb_build_object('files', (
        select coalesce(jsonb_agg(jsonb_build_object('file_no', f.file_no, 'entity', f.entity, 'storage_path', f.storage_path)
                                  order by f.file_no), '[]'::jsonb)
        from public.import_files f
        where f.organization_id = v_existing.organization_id and f.batch_id = v_existing.id));
    end if;
    raise exception using errcode = 'MQ409', message = 'this import id is already in use', hint = 'batch_id';
  end if;

  if (select count(*) from public.import_batches b
      where b.organization_id = p_organization_id
        and b.status in ('staging', 'validated', 'invalid', 'committing', 'failed')) >= 3 then
    raise exception using errcode = 'MQ409', message = 'finish, cancel or delete an open import first (at most 3 open imports)',
      hint = 'open_batches';
  end if;
  -- The ledger, not import_batches: deleting imports must not reset the cap.
  delete from ingest.import_creations c
  where c.organization_id = p_organization_id and c.created_at <= now() - interval '24 hours';
  if (select count(*) from ingest.import_creations c
      where c.organization_id = p_organization_id and c.created_at > now() - interval '24 hours') >= 50 then
    raise exception using errcode = 'MQ429', message = 'too many imports in the last 24 hours (at most 50)', hint = 'batches_per_day';
  end if;

  insert into public.import_batches (id, organization_id, source, status, created_by, files_sha256, file_count, expires_at)
  values (p_batch_id, p_organization_id, 'wizard', 'staging', v_user, v_hash, jsonb_array_length(p_files),
          now() + interval '24 hours');
  insert into ingest.import_creations (organization_id, batch_id) values (p_organization_id, p_batch_id);

  for v_f, v_ord in select e.value, e.ordinality from jsonb_array_elements(p_files) with ordinality as e loop
    if jsonb_typeof(v_f) <> 'object' then
      raise exception using errcode = 'MQ422', message = format('file %s is not an object', v_ord), hint = 'files';
    end if;

    v_text := v_f ->> 'file_no';
    if coalesce(jsonb_typeof(v_f -> 'file_no'), '') <> 'number' or v_text !~ '^[0-9]{1,2}$'
       or v_text::integer not between 1 and 60 then
      raise exception using errcode = 'MQ422', message = format('file %s: file_no is 1 to 60', v_ord), hint = 'file_no';
    end if;
    v_file_no := v_text::smallint;
    if v_file_no = any (v_file_nos) then
      raise exception using errcode = 'MQ422', message = format('file number %s appears twice', v_file_no), hint = 'file_no';
    end if;
    v_file_nos := v_file_nos || v_file_no;

    v_entity := v_f ->> 'entity';
    select * into v_contract from ingest.contract_entities e where e.entity = v_entity;
    if v_contract.entity is null then
      raise exception using errcode = 'MQ422', message = format('file %s: unknown entity', v_file_no), hint = 'mapping';
    end if;
    if not v_contract.monthly_parts and v_entity = any (v_entities) then
      raise exception using errcode = 'MQ422', message = format('%s appears in more than one file', v_entity), hint = 'files';
    end if;
    v_entities := v_entities || v_entity;

    if coalesce(jsonb_typeof(v_f -> 'original_name'), '') <> 'string'
       or char_length(v_f ->> 'original_name') not between 1 and 255 then
      raise exception using errcode = 'MQ422', message = format('file %s: original_name has 1 to 255 characters', v_file_no),
        hint = 'original_name';
    end if;
    v_extension := v_f ->> 'extension';
    if v_extension is null or v_extension not in ('csv', 'tsv', 'txt', 'xlsx') then
      raise exception using errcode = 'MQ422', message = format('file %s: extension is csv, tsv, txt or xlsx', v_file_no),
        hint = 'extension';
    end if;
    if coalesce(jsonb_typeof(v_f -> 'content_type'), 'null') not in ('null', 'string')
       or char_length(coalesce(v_f ->> 'content_type', '')) > 255 then
      raise exception using errcode = 'MQ422', message = format('file %s: content_type is invalid', v_file_no),
        hint = 'content_type';
    end if;
    v_text := v_f ->> 'size_bytes';
    if coalesce(jsonb_typeof(v_f -> 'size_bytes'), '') <> 'number' or v_text !~ '^[0-9]{1,8}$'
       or v_text::bigint > 50000000 then
      raise exception using errcode = 'MQ422', message = format('file %s: at most 50,000,000 bytes per file', v_file_no),
        hint = 'size_bytes';
    end if;
    v_size := v_text::bigint;
    if coalesce(v_f ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then
      raise exception using errcode = 'MQ422', message = format('file %s: sha256 is 64 lower-case hex digits', v_file_no),
        hint = 'sha256';
    end if;
    v_text := v_f ->> 'rows_total';
    if coalesce(jsonb_typeof(v_f -> 'rows_total'), '') <> 'number' or v_text !~ '^[0-9]{1,7}$'
       or v_text::integer > 1000000 then
      raise exception using errcode = 'MQ422', message = format('file %s: rows_total is 0 to 1,000,000', v_file_no),
        hint = 'rows_total';
    end if;
    v_rows := v_text::integer;
    v_rows_sum := v_rows_sum + v_rows;
    if v_rows_sum > 1000000 then
      raise exception using errcode = 'MQ422', message = 'an import has at most 1,000,000 rows', hint = 'rows_total';
    end if;

    if coalesce(jsonb_typeof(v_f -> 'columns'), '') <> 'array' or jsonb_array_length(v_f -> 'columns') not between 1 and 64
       or exists (select 1 from jsonb_array_elements(v_f -> 'columns') as x where jsonb_typeof(x) <> 'string') then
      raise exception using errcode = 'MQ422', message = format('file %s: columns is a list of contract column names', v_file_no),
        hint = 'mapping';
    end if;
    v_cols := array(select x from jsonb_array_elements_text(v_f -> 'columns') as x);
    if cardinality(v_cols) <> (select count(distinct x) from unnest(v_cols) as x) then
      raise exception using errcode = 'MQ422', message = format('file %s: a column is mapped twice', v_file_no), hint = 'mapping';
    end if;
    select string_agg(x, ', ') into v_unknown
    from unnest(v_cols) as x
    where not exists (select 1 from ingest.contract_columns c where c.entity = v_entity and c.name = x);
    if v_unknown is not null then
      raise exception using errcode = 'MQ422', message = format('file %s: %s is not a column of %s', v_file_no, left(v_unknown, 200), v_entity),
        hint = 'mapping';
    end if;
    if not (v_contract.natural_key <@ v_cols) then
      raise exception using errcode = 'MQ422',
        message = format('file %s: map every key column (%s)', v_file_no, array_to_string(v_contract.natural_key, ', ')),
        hint = 'mapping';
    end if;
    select g into v_group
    from jsonb_array_elements(v_contract.column_groups) as g
    where (select count(*) from jsonb_array_elements_text(g) as x where x = any (v_cols)) not in (0, jsonb_array_length(g))
    limit 1;
    if v_group is not null then
      raise exception using errcode = 'MQ422',
        message = format('file %s: the columns %s are mapped together or not at all', v_file_no,
                         (select string_agg(x, ', ') from jsonb_array_elements_text(v_group) as x)),
        hint = 'mapping';
    end if;
    if v_entity = 'demand_history' and not (v_cols && array['quantity', 'lost_sales_quantity']) then
      raise exception using errcode = 'MQ422', message = format('file %s: map quantity, lost_sales_quantity or both', v_file_no),
        hint = 'mapping';
    end if;
    v_cols := array(select c.name from ingest.contract_columns c where c.entity = v_entity and c.name = any (v_cols) order by c.position);

    if coalesce(jsonb_typeof(v_f -> 'header'), 'null') = 'null' then
      v_header := '{}';
    elsif jsonb_typeof(v_f -> 'header') <> 'array' or jsonb_array_length(v_f -> 'header') > 64
          or exists (select 1 from jsonb_array_elements(v_f -> 'header') as x
                     where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 500) then
      raise exception using errcode = 'MQ422', message = format('file %s: header is at most 64 texts of 500 characters', v_file_no),
        hint = 'header';
    else
      v_header := array(select x from jsonb_array_elements_text(v_f -> 'header') as x);
    end if;
    v_mapping := coalesce(nullif(v_f -> 'mapping', 'null'::jsonb), '{}'::jsonb);
    if jsonb_typeof(v_mapping) <> 'object' or octet_length(v_mapping::text) > 32768
       or (select count(*) from jsonb_object_keys(v_mapping)) > 64 then
      raise exception using errcode = 'MQ422', message = format('file %s: mapping is an object of at most 64 columns', v_file_no),
        hint = 'mapping';
    end if;
    v_parse := coalesce(nullif(v_f -> 'parse', 'null'::jsonb), '{}'::jsonb);
    if jsonb_typeof(v_parse) <> 'object' or octet_length(v_parse::text) > 4096 then
      raise exception using errcode = 'MQ422', message = format('file %s: parse is an object of at most 4 KB', v_file_no),
        hint = 'parse';
    end if;

    insert into public.import_files (organization_id, batch_id, file_no, entity, original_name, content_type, extension,
                                     size_bytes, sha256, storage_path, header, columns, mapping, parse, rows_total)
    values (p_organization_id, p_batch_id, v_file_no, v_entity, v_f ->> 'original_name', v_f ->> 'content_type', v_extension,
            v_size, decode(v_f ->> 'sha256', 'hex'),
            p_organization_id::text || '/' || p_batch_id::text || '/' || v_file_no::text || '.' || v_extension,
            v_header, v_cols, v_mapping, v_parse, v_rows);
  end loop;

  update public.import_batches b set rows_total = v_rows_sum where b.id = p_batch_id;
  perform app.import_sweep(20000);

  return app.import_batch_state(p_batch_id) || jsonb_build_object('files', (
    select coalesce(jsonb_agg(jsonb_build_object('file_no', f.file_no, 'entity', f.entity, 'storage_path', f.storage_path)
                              order by f.file_no), '[]'::jsonb)
    from public.import_files f
    where f.organization_id = p_organization_id and f.batch_id = p_batch_id));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.import_resume(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch public.import_batches;
begin
  v_batch := app.import_batch_for_editor(p_batch_id, false);
  if v_batch.status <> 'failed' or v_batch.commit_mode is distinct from 'stepped' then
    raise exception using errcode = 'MQ409', message = 'only a failed stepped commit can resume', hint = 'status';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('zeespare.import:' || v_batch.organization_id::text, 0)) then
    raise exception using errcode = 'MQ409', message = 'another import is writing to this organization; try again shortly',
      hint = 'import_in_progress';
  end if;
  select * into v_batch from public.import_batches b where b.id = p_batch_id for update;
  if v_batch.status <> 'failed' then
    raise exception using errcode = 'MQ409', message = 'only a failed stepped commit can resume', hint = 'status';
  end if;
  begin
    update public.import_batches b
    set status = 'committing', failure_code = null, failure_detail = null, last_step_at = clock_timestamp(), expires_at = null,
        error_count = 0
    where b.id = p_batch_id;
  exception when unique_violation then
    raise exception using errcode = 'MQ409', message = 'another import of this organization is committing',
      hint = 'another_commit';
  end;
  -- A commit only starts without errors, so every error-level detail and count now comes from
  -- the failed attempt. It no longer holds once the cause is fixed (the next units record it again
  -- if not), and a succeeded import must not show it. Warnings from staging stay.
  delete from public.import_errors e
  where e.organization_id = v_batch.organization_id and e.batch_id = p_batch_id and e.level = 'error';
  update public.import_files f
  set error_count = 0,
      errors_stored = (select count(*)::integer
                       from public.import_errors e
                       where e.organization_id = f.organization_id and e.batch_id = f.batch_id and e.file_no = f.file_no),
      error_counts = (select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb)
                      from jsonb_each(f.error_counts) as o
                      where o.key = any (array['zero_row_new_key', 'source_missing']))
  where f.organization_id = v_batch.organization_id and f.batch_id = p_batch_id and f.error_count > 0;
  return app.import_batch_state(p_batch_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.installed_base_demand_save(p_organization_id uuid, p_input jsonb, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare input jsonb; report jsonb; previous public.installed_base_demand_scenarios; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='demand scenario save forbidden';
  end if;
  input := app.installed_base_demand_input(p_input);
  if input->'confirmed' <> 'true'::jsonb or p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422', message='invalid demand scenario save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.installed-base-demand:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='demand scenario save forbidden';
  end if;
  select * into previous from public.installed_base_demand_scenarios x where x.organization_id=p_organization_id and x.request_id=p_request_id;
  if found then
    if not(previous.organization_id=any(array(select app.unscoped_organizations())) or previous.location_id=any(array(select app.scoped_locations()))) then
      raise exception using errcode='MQ404', message='demand scenario unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409', message='demand scenario request conflicts';
  end if;
  -- Protect the source only for the initial capture. Existing retries use their saved copy.
  perform 1 from public.installed_base_datasets x where x.organization_id=p_organization_id and x.id=(input->>'dataset_id')::uuid
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations()))) for share;
  if not found then raise exception using errcode='MQ404', message='population source unavailable'; end if;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='demand scenario save forbidden';
  end if;
  report := public.installed_base_demand_preview(p_organization_id,input);
  if report->>'fingerprint' <> p_fingerprint then raise exception using errcode='MQ409', message='demand scenario evidence changed; refresh preview'; end if;
  insert into public.installed_base_demand_scenarios(organization_id,location_id,item_id,dataset_id,item_code,location_code,scenario_name,cutoff,request_id,submitted_by,report)
    values(p_organization_id,(report#>>'{source,population,source,location_id}')::uuid,(report#>>'{source,population,source,item_id}')::uuid,
      (input->>'dataset_id')::uuid,report#>>'{source,population,input,item_code}',report#>>'{source,population,input,location_code}',
      input->>'scenario_name',(input->>'cutoff')::date,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.installed_base_evaluation_save(p_organization_id uuid, p_input jsonb, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare input jsonb; report jsonb; previous public.installed_base_evaluations; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='evaluation save forbidden';
  end if;
  input:=app.installed_base_evaluation_input(p_input);
  if p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid evaluation save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.installed-base-evaluation:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='evaluation save forbidden';
  end if;
  select * into previous from public.installed_base_evaluations e where e.organization_id=p_organization_id and e.request_id=p_request_id;
  if found then
    if not(previous.organization_id=any(array(select app.unscoped_organizations())) or previous.location_id=any(array(select app.scoped_locations()))) then
      raise exception using errcode='MQ404',message='evaluation unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='evaluation request conflicts';
  end if;
  perform 1 from public.installed_base_demand_scenarios s where s.organization_id=p_organization_id and s.id=(input->>'scenario_id')::uuid
    and (s.organization_id=any(array(select app.unscoped_organizations())) or s.location_id=any(array(select app.scoped_locations()))) for share;
  if not found then raise exception using errcode='MQ404',message='demand scenario unavailable'; end if;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='evaluation save forbidden';
  end if;
  report:=public.installed_base_evaluation_preview(p_organization_id,input);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='evaluation evidence changed; refresh preview'; end if;
  insert into public.installed_base_evaluations(organization_id,location_id,item_id,scenario_id,item_code,location_code,evaluation_name,cutoff,request_id,submitted_by,report)
    values(p_organization_id,(report#>>'{source,scenario,source,population,source,location_id}')::uuid,
      (report#>>'{source,scenario,source,population,source,item_id}')::uuid,(input->>'scenario_id')::uuid,
      report#>>'{source,scenario,source,population,input,item_code}',report#>>'{source,scenario,source,population,input,location_code}',
      input->>'evaluation_name',(report#>>'{source,scenario,input,cutoff}')::date,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.installed_base_save(p_organization_id uuid, p_input jsonb, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare input jsonb; report jsonb; previous public.installed_base_datasets; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='population save forbidden';
  end if;
  input := app.installed_base_input(p_input);
  if input->'confirmed' <> 'true'::jsonb or input->'non_overlapping' <> 'true'::jsonb
    or p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422', message='invalid population save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.installed-base:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403', message='population save forbidden';
  end if;
  select * into previous from public.installed_base_datasets x where x.organization_id=p_organization_id and x.request_id=p_request_id;
  if found then
    if not(previous.organization_id=any(array(select app.unscoped_organizations())) or previous.location_id=any(array(select app.scoped_locations()))) then
      raise exception using errcode='MQ404', message='population source unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409', message='population request conflicts';
  end if;
  report := public.installed_base_preview(p_organization_id,input);
  if report->>'fingerprint' <> p_fingerprint then raise exception using errcode='MQ409', message='population evidence changed; refresh preview'; end if;
  insert into public.installed_base_datasets(organization_id,location_id,item_id,item_code,location_code,dataset_name,as_of,request_id,submitted_by,report)
    values(p_organization_id,(report#>>'{source,location_id}')::uuid,(report#>>'{source,item_id}')::uuid,
      input->>'item_code',input->>'location_code',input->>'dataset_name',(input->>'as_of')::date,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.network_allocation_save(p_organization_id uuid, p_draft_ids uuid[], p_source_policy_id uuid, p_basis text, p_override_id uuid DEFAULT NULL::uuid, p_backorders text DEFAULT NULL::text, p_commitments_confirmed boolean DEFAULT NULL::boolean, p_lanes_confirmed boolean DEFAULT NULL::boolean, p_request_id uuid DEFAULT NULL::uuid, p_fingerprint text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.network_allocation_scenarios; report jsonb; result uuid; required_ids uuid[];
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='allocation requires an editor';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_commitments_confirmed is distinct from true or p_lanes_confirmed is distinct from true
    or p_draft_ids is null or cardinality(p_draft_ids) not between 1 and 20
    or array_ndims(p_draft_ids)<>1 or array_position(p_draft_ids,null) is not null
    or (select count(distinct x) from unnest(p_draft_ids) x)<>cardinality(p_draft_ids)
    or p_backorders is null or p_backorders!~'^[0-9]{1,15}(\.[0-9]{1,3})?$' then
    raise exception using errcode='MQ422',message='invalid allocation request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.network-allocation:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='allocation requires an editor';
  end if;
  select * into previous from public.network_allocation_scenarios where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='allocation unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->>'fingerprint'=p_fingerprint
      and previous.report->>'source_policy_id'=p_source_policy_id::text and previous.report->>'basis'=p_basis
      and (previous.report->>'override_id')::uuid is not distinct from p_override_id
      and (previous.report->>'backorders')::numeric=p_backorders::numeric
      and (select array_agg((v->>'draft_id')::uuid order by (v->>'draft_id')::uuid) from jsonb_array_elements(previous.report->'lines') v)
        =(select array_agg(x order by x) from unnest(p_draft_ids) x) then return previous.id; end if;
    raise exception using errcode='MQ409',message='allocation request conflicts';
  end if;
  report:=public.network_allocation_preview(p_organization_id,p_draft_ids,p_source_policy_id,p_basis,
    p_override_id,p_backorders,p_commitments_confirmed,p_lanes_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='allocation unavailable'; end if;
  select array_agg(x order by x) into required_ids from (
    select (report->>'source_location_id')::uuid x union
    select (v->>'location_id')::uuid from jsonb_array_elements(report->'lines') v
  ) required;
  -- Prevent a location deletion racing the insert and leaving a dangling required-location array.
  perform 1 from public.locations where organization_id=p_organization_id and id=any(required_ids) order by id for key share;
  if (select count(*) from public.locations where organization_id=p_organization_id and id=any(required_ids))<>cardinality(required_ids) then
    raise exception using errcode='MQ409',message='locations changed; refresh preview';
  end if;
  insert into public.network_allocation_scenarios(organization_id,source_location_id,required_location_ids,request_id,submitted_by,report)
    values(p_organization_id,(report->>'source_location_id')::uuid,required_ids,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.network_date_save(p_organization_id uuid, p_allocation_id uuid, p_requested_date date, p_calendars_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.network_date_scenarios; source public.network_allocation_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network dates require an editor';
  end if;
  if p_allocation_id is null or p_requested_date is null or not isfinite(p_requested_date)
    or p_requested_date not between date '1900-01-01' and date '2100-12-31'
    or p_calendars_confirmed is null or p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid network date request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.network-dates:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network dates require an editor';
  end if;
  select * into previous from public.network_date_scenarios where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='network dates unavailable';
    end if;
    if previous.allocation_id=p_allocation_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint
      and (previous.report->>'requested_date')::date=p_requested_date
      and (previous.report->>'calendars_confirmed')::boolean=p_calendars_confirmed then return previous.id; end if;
    raise exception using errcode='MQ409',message='network date request conflicts';
  end if;
  select * into source from public.network_allocation_scenarios
    where organization_id=p_organization_id and id=p_allocation_id
      and (organization_id=any(array(select app.unscoped_organizations()))
        or required_location_ids <@ array(select app.scoped_locations())) for key share;
  if not found then raise exception using errcode='MQ404',message='allocation unavailable'; end if;
  -- Parent deletion can also make this transaction wait after its advisory lock.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network dates require an editor';
  end if;
  report:=public.network_date_preview(p_organization_id,p_allocation_id,p_requested_date,p_calendars_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_transfer_needed') then
    raise exception using errcode='MQ422',message='resolve unavailable network dates before saving';
  end if;
  insert into public.network_date_scenarios(organization_id,allocation_id,source_location_id,required_location_ids,request_id,submitted_by,report)
    values(p_organization_id,source.id,source.source_location_id,source.required_location_ids,p_request_id,auth.uid(),report)
    returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.network_freight_save(p_organization_id uuid, p_scenario_id uuid, p_terms_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.network_freight_estimates; source public.network_date_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network freight requires an editor';
  end if;
  if p_scenario_id is null or p_terms_confirmed is null or p_request_id is null or p_fingerprint is null
    or p_fingerprint!~'^[a-f0-9]{64}$' then raise exception using errcode='MQ422',message='invalid network freight request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.network-freight:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network freight requires an editor';
  end if;
  select * into previous from public.network_freight_estimates where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='network freight unavailable';
    end if;
    if previous.scenario_id=p_scenario_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint
      and (previous.report->>'terms_confirmed')::boolean=p_terms_confirmed then return previous.id; end if;
    raise exception using errcode='MQ409',message='network freight request conflicts';
  end if;
  select * into source from public.network_date_scenarios where organization_id=p_organization_id and id=p_scenario_id
    and (organization_id=any(array(select app.unscoped_organizations()))
      or required_location_ids <@ array(select app.scoped_locations())) for key share;
  if not found then raise exception using errcode='MQ404',message='network dates unavailable'; end if;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network freight requires an editor';
  end if;
  report:=public.network_freight_preview(p_organization_id,p_scenario_id,p_terms_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_transfer_needed') then
    raise exception using errcode='MQ422',message='resolve unavailable network freight before saving';
  end if;
  insert into public.network_freight_estimates(organization_id,scenario_id,source_location_id,required_location_ids,request_id,submitted_by,report)
    values(p_organization_id,source.id,source.source_location_id,source.required_location_ids,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.network_handoff_batch_create(p_organization_id uuid, p_handoff_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare report jsonb; ids uuid[]; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network batch requires an editor';
  end if;
  if p_handoff_ids is null or cardinality(p_handoff_ids) not between 1 and 50
    or array_ndims(p_handoff_ids)<>1 or array_position(p_handoff_ids,null) is not null then
    raise exception using errcode='MQ422',message='select 1 to 50 distinct handoffs',hint='batch_selection_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.network-review:'||p_organization_id::text,0));
  -- Protect original parents and participating locations against deletion during first save.
  perform l.id from public.locations l where l.organization_id=p_organization_id and l.id in(
    select unnest(h.required_location_ids) from public.network_transfer_handoffs h
      where h.organization_id=p_organization_id and h.id=any(p_handoff_ids)
  ) order by l.id for key share;
  perform h.id from public.network_transfer_handoffs h
    where h.organization_id=p_organization_id and h.id=any(p_handoff_ids) order by h.id for key share;
  -- A new statement after every wait checks current authority, visibility and evidence.
  report:=public.network_handoff_batch_preview(p_organization_id,p_handoff_ids);
  if report->>'existing_batch_id' is not null then return (report->>'existing_batch_id')::uuid; end if;
  select array_agg(id order by id) into ids from unnest(p_handoff_ids) id;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','network-handoff-batch-v1','purpose','planning_only',
    'notice','As-of whole-network planning package. Overlap is allowed. Each branch retains its original freight charge. No consolidation, reservation, transfer order or inbound update.',
    'batch_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'summary',report->'summary','lines',report->'lines');
  insert into public.network_handoff_batches(id,organization_id,source_location_id,required_location_ids,handoff_ids,created_by,created_at,payload)
    values(result,p_organization_id,(report#>>'{summary,source_location_id}')::uuid,
      array(select value::uuid from jsonb_array_elements_text(report->'required_location_ids')),ids,auth.uid(),captured,snapshot);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.network_handoff_create(p_organization_id uuid, p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.network_transfer_proposals; estimate public.network_freight_estimates;
  existing uuid; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb; current_freight jsonb;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network handoff requires an editor';
  end if;
  if p_proposal_id is null then raise exception using errcode='MQ422',message='proposal required'; end if;
  -- Share review's lock: a new selected approval cannot race a first export.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.network-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network handoff requires an editor';
  end if;
  select * into proposal from public.network_transfer_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations()))
      or required_location_ids <@ array(select app.scoped_locations())) for key share;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  -- Row-lock waits, including parent deletion, must not retain obsolete authority.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network handoff requires an editor';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(proposal.required_location_ids <@ array(select app.scoped_locations())) then
    raise exception using errcode='MQ404',message='proposal unavailable';
  end if;
  select id into existing from public.network_transfer_handoffs where organization_id=p_organization_id and proposal_id=p_proposal_id;
  -- Only authority is live on a retry. Never regenerate an existing snapshot.
  if found then return existing; end if;
  if proposal.status<>'approved' or exists(select 1 from public.network_transfer_proposals
    where organization_id=p_organization_id and allocation_id=proposal.allocation_id
      and status='approved' and revision>proposal.revision) then
    raise exception using errcode='MQ409',message='selected approval required',hint='network_selection_changed';
  end if;
  select * into estimate from public.network_freight_estimates where organization_id=p_organization_id and id=proposal.estimate_id
    and source_location_id=proposal.source_location_id and required_location_ids=proposal.required_location_ids;
  if not found or app.network_review_timing_clear(estimate.report) is distinct from true then
    raise exception using errcode='MQ422',message='network timing review required',hint='network_timing_required';
  end if;
  current_freight:=public.network_freight_preview(p_organization_id,estimate.scenario_id,true);
  if current_freight->>'status' is distinct from 'available'
    or current_freight->>'fingerprint' is distinct from estimate.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='freight evidence changed',hint='network_freight_changed';
  end if;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','network-transfer-handoff-v1','purpose','planning_only',
    'notice','As-of whole-network planning evidence. Zero branches need no transfer. No stock reservation, transfer order, inbound update or arrival guarantee.',
    'handoff_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'proposal',jsonb_build_object('id',proposal.id,'revision',proposal.revision,'estimate_id',estimate.id,'allocation_id',proposal.allocation_id,
      'submitted_by',proposal.submitted_by,'submitted_at',proposal.created_at,'reason',proposal.reason,
      'approved_by',proposal.decided_by,'approved_at',proposal.decided_at,'approval_reason',proposal.decision_reason),
    'estimate',estimate.report);
  insert into public.network_transfer_handoffs(id,organization_id,proposal_id,source_location_id,required_location_ids,created_by,created_at,payload)
    values(result,p_organization_id,proposal.id,proposal.source_location_id,proposal.required_location_ids,auth.uid(),captured,snapshot);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.network_transfer_decide(p_organization_id uuid, p_proposal_id uuid, p_request_id uuid, p_decision text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.network_transfer_proposals; source public.network_freight_estimates; current_freight jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='network decision requires membership';
  end if;
  if p_proposal_id is null or p_request_id is null or p_decision is null
    or p_decision not in ('approved','rejected','withdrawn') or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid network decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.network-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='network decision requires membership';
  end if;
  select * into proposal from public.network_transfer_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations()))
      or required_location_ids <@ array(select app.scoped_locations())) for update;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='network decision requires membership';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(proposal.required_location_ids <@ array(select app.scoped_locations())) then
    raise exception using errcode='MQ404',message='proposal unavailable';
  end if;
  if p_decision='withdrawn' then
    if proposal.submitted_by<>auth.uid() then raise exception using errcode='MQ403',message='only the author may withdraw'; end if;
  elsif proposal.submitted_by=auth.uid() or not(p_organization_id=any(array(select app.approving_organizations()))) then
    raise exception using errcode='MQ403',message='independent reviewer required';
  end if;
  if proposal.status<>'pending' then
    if proposal.decision_request_id=p_request_id and proposal.decided_by=auth.uid()
      and proposal.status=p_decision and proposal.decision_reason=why then return proposal.id; end if;
    raise exception using errcode='MQ409',message='proposal already decided';
  end if;
  if exists(select 1 from public.network_transfer_proposals where organization_id=p_organization_id and decision_request_id=p_request_id) then
    raise exception using errcode='MQ409',message='decision request conflicts';
  end if;
  if p_decision='approved' then
    select * into source from public.network_freight_estimates where organization_id=p_organization_id and id=proposal.estimate_id;
    if app.network_review_timing_clear(source.report) is distinct from true then
      raise exception using errcode='MQ422',message='network timing review required',hint='network_timing_required';
    end if;
    current_freight:=public.network_freight_preview(p_organization_id,source.scenario_id,true);
    if current_freight->>'status' is distinct from 'available'
      or current_freight->>'fingerprint' is distinct from source.report->>'fingerprint' then
      raise exception using errcode='MQ409',message='freight evidence changed',hint='network_freight_changed';
    end if;
  end if;
  update public.network_transfer_proposals set status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp(),
    decision_reason=why,decision_request_id=p_request_id where id=proposal.id;
  return proposal.id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.network_transfer_submit(p_organization_id uuid, p_estimate_id uuid, p_request_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source public.network_freight_estimates; previous public.network_transfer_proposals;
  result uuid; sequence integer; original_allocation uuid; current_freight jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network proposal requires an editor';
  end if;
  if p_request_id is null or p_estimate_id is null or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid network proposal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.network-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network proposal requires an editor';
  end if;
  select * into source from public.network_freight_estimates where organization_id=p_organization_id and id=p_estimate_id
    and (organization_id=any(array(select app.unscoped_organizations()))
      or required_location_ids <@ array(select app.scoped_locations())) for key share;
  if not found then raise exception using errcode='MQ404',message='estimate unavailable'; end if;
  -- Parent waits must not retain obsolete role or location authority.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='network proposal requires an editor';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(source.required_location_ids <@ array(select app.scoped_locations())) then
    raise exception using errcode='MQ404',message='estimate unavailable';
  end if;
  select * into previous from public.network_transfer_proposals where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if previous.estimate_id=p_estimate_id and previous.submitted_by=auth.uid() and previous.reason=why then return previous.id; end if;
    raise exception using errcode='MQ409',message='proposal request conflicts';
  end if;
  if source.report->>'status' is distinct from 'available' or not exists(
    select 1 from jsonb_array_elements(source.report->'lines') f where (f->>'quantity')::numeric>0
  ) then raise exception using errcode='MQ422',message='choose a complete positive estimate'; end if;
  -- Derive the selection identity from the saved chain, never client locations or allocation IDs.
  select d.allocation_id into original_allocation from public.network_date_scenarios d
    join public.network_allocation_scenarios a on a.organization_id=d.organization_id and a.id=d.allocation_id
    where d.organization_id=p_organization_id and d.id=source.scenario_id
      and d.source_location_id=source.source_location_id and a.source_location_id=source.source_location_id
      and d.required_location_ids=source.required_location_ids and a.required_location_ids=source.required_location_ids;
  if original_allocation is null then raise exception using errcode='MQ422',message='source lineage unavailable'; end if;
  current_freight:=public.network_freight_preview(p_organization_id,source.scenario_id,true);
  if current_freight->>'status' is distinct from 'available'
    or current_freight->>'fingerprint' is distinct from source.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='freight evidence changed',hint='network_freight_changed';
  end if;
  if exists(select 1 from public.network_transfer_proposals where allocation_id=original_allocation and status='pending') then
    raise exception using errcode='MQ409',message='allocation has a pending proposal',hint='network_pending';
  end if;
  select coalesce(max(revision),0)+1 into sequence from public.network_transfer_proposals where allocation_id=original_allocation;
  insert into public.network_transfer_proposals(organization_id,estimate_id,allocation_id,source_location_id,
    required_location_ids,revision,request_id,submitted_by,reason)
    values(p_organization_id,source.id,original_allocation,source.source_location_id,source.required_location_ids,
      sequence,p_request_id,auth.uid(),why) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.planned_event_save(p_organization_id uuid, p_forecast_id uuid, p_type text, p_name text, p_reason text, p_unit text, p_additions jsonb, p_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.planned_event_scenarios; input jsonb; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event save forbidden';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_confirmed is distinct from true then
    raise exception using errcode='MQ422',message='invalid event save';
  end if;
  input:=app.planned_event_input(p_type,p_name,p_reason,p_unit,p_additions,p_confirmed);
  perform pg_advisory_xact_lock(hashtextextended('zeespare.planned-event:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event save forbidden';
  end if;
  select * into previous from public.planned_event_scenarios s where s.organization_id=p_organization_id and s.request_id=p_request_id
    and (s.organization_id=any(array(select app.unscoped_organizations())) or s.location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.forecast_id=p_forecast_id and previous.submitted_by=auth.uid()
      and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='event request conflicts';
  end if;
  report:=public.planned_event_preview(p_organization_id,p_forecast_id,p_type,p_name,p_reason,p_unit,p_additions,p_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='event evidence changed; refresh preview'; end if;
  insert into public.planned_event_scenarios(organization_id,forecast_id,location_id,request_id,submitted_by,event_type,name,report)
    values(p_organization_id,p_forecast_id,(report#>>'{source,location_id}')::uuid,p_request_id,auth.uid(),p_type,btrim(p_name),report)
    returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.policy_override_decide(p_organization_id uuid, p_override_id uuid, p_request_id uuid, p_decision text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.policy_overrides; why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='policy decision requires membership';
  end if;
  if p_request_id is null or p_decision is null or p_decision not in ('approved','rejected','withdrawn')
    or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid policy decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.policy-review:'||p_organization_id::text,0));
  -- Live branch access also applies to an author whose role has changed.
  select * into proposal from public.policy_overrides where organization_id=p_organization_id and id=p_override_id
    and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations()))) for update;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  if p_decision='withdrawn' then
    if proposal.submitted_by<>auth.uid() then raise exception using errcode='MQ403',message='only the author may withdraw'; end if;
  elsif proposal.submitted_by=auth.uid() or not(p_organization_id=any(array(select app.approving_organizations()))) then
    raise exception using errcode='MQ403',message='independent reviewer required';
  end if;
  if proposal.status<>'pending' then
    if proposal.decision_request_id=p_request_id and proposal.decided_by=auth.uid() and proposal.status=p_decision
      and proposal.decision_reason=why then return proposal.policy_id; end if;
    raise exception using errcode='MQ409',message='proposal already decided';
  end if;
  if exists(select 1 from public.policy_overrides where organization_id=p_organization_id and decision_request_id=p_request_id) then
    raise exception using errcode='MQ409',message='decision request conflicts';
  end if;
  update public.policy_overrides set status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp(),decision_reason=why,decision_request_id=p_request_id where id=proposal.id;
  return proposal.policy_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.policy_override_submit(p_organization_id uuid, p_policy_id uuid, p_request_id uuid, p_reorder_point text, p_order_up_to text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source public.inventory_policies; previous public.policy_overrides; result uuid; sequence integer; low numeric; high numeric; why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='policy proposal requires an editor';
  end if;
  if p_request_id is null or p_reorder_point is null or p_reorder_point!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or p_order_up_to is null or p_order_up_to!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid policy proposal';
  end if;
  low:=p_reorder_point::numeric; high:=p_order_up_to::numeric;
  if low>high then raise exception using errcode='MQ422',message='reorder reference exceeds maximum'; end if;
  -- Serialize a source's proposals and decisions. Request-key reuse across sources is also serialized.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.policy-review:'||p_organization_id::text,0));
  select * into previous from public.policy_overrides where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if previous.policy_id=p_policy_id and previous.submitted_by=auth.uid() and previous.reorder_point=low
      and previous.order_up_to=high and previous.reason=why then return previous.id; end if;
    raise exception using errcode='MQ409',message='proposal request conflicts';
  end if;
  select * into source from public.inventory_policies where organization_id=p_organization_id and id=p_policy_id for update;
  if not found or source.status<>'available' then raise exception using errcode='MQ422',message='choose an available policy'; end if;
  if exists(select 1 from public.policy_overrides where policy_id=source.id and status='pending') then
    raise exception using errcode='MQ409',message='policy has a pending proposal';
  end if;
  select coalesce(max(revision),0)+1 into sequence from public.policy_overrides where policy_id=source.id;
  insert into public.policy_overrides(organization_id,policy_id,location_id,revision,request_id,submitted_by,reorder_point,order_up_to,reason)
  values(p_organization_id,source.id,source.location_id,sequence,p_request_id,auth.uid(),low,high,why) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.purchase_cost_save(p_organization_id uuid, p_delivery_id uuid, p_price_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.purchase_cost_estimates; report jsonb; result uuid;
begin
  if p_organization_id is null or auth.uid() is null
    or not(p_organization_id = any(array(select app.editable_organizations()))) then
    raise exception using errcode = 'MQ403', message = 'purchase cost estimate requires an editor';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_price_confirmed is null then
    raise exception using errcode = 'MQ422', message = 'invalid purchase cost request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.purchase-cost:' || p_organization_id::text, 0));
  if not(p_organization_id = any(array(select app.editable_organizations()))) then
    raise exception using errcode = 'MQ403', message = 'purchase cost estimate requires an editor';
  end if;
  select * into previous from public.purchase_cost_estimates where organization_id = p_organization_id and request_id = p_request_id
    and (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));
  if found then
    if previous.delivery_id = p_delivery_id and previous.submitted_by = auth.uid()
      and previous.report->>'fingerprint' = p_fingerprint
      and (previous.report->>'price_confirmed')::boolean = p_price_confirmed then return previous.id; end if;
    raise exception using errcode = 'MQ409', message = 'purchase cost request conflicts';
  end if;
  report := public.purchase_cost_preview(p_organization_id, p_delivery_id, p_price_confirmed);
  if report->>'fingerprint' <> p_fingerprint then
    raise exception using errcode = 'MQ409', message = 'price inputs changed; refresh preview';
  end if;
  insert into public.purchase_cost_estimates(organization_id,delivery_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_delivery_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report)
    returning id into result;
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purchase_handoff_batch_create(p_organization_id uuid, p_handoff_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare report jsonb; ids uuid[]; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb;
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='batch requires an editor';
  end if;
  -- Serializes set retries and proposal selection changes. Preview rechecks authority after waiting.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.purchase-review:'||p_organization_id::text,0));
  report:=public.purchase_handoff_batch_preview(p_organization_id,p_handoff_ids);
  if report->>'existing_batch_id' is not null then return (report->>'existing_batch_id')::uuid; end if;
  select array_agg(id order by id) into ids from unnest(p_handoff_ids) id;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','purchase-handoff-batch-v1','purpose','planning_only',
    'notice','As-of planning package only. Overlapping packages may contain the same lines. Not an order, reservation or inbound quantity.',
    'batch_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'summary',report->'summary','lines',report->'lines');
  insert into public.purchase_handoff_batches(id,organization_id,location_id,handoff_ids,created_by,created_at,payload)
    values(result,p_organization_id,(report#>>'{summary,location_id}')::uuid,ids,auth.uid(),captured,snapshot);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.purchase_handoff_create(p_organization_id uuid, p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.purchase_proposals; estimate public.purchase_cost_estimates;
  draft public.replenishment_drafts; policy public.inventory_policies;
  existing uuid; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb; current_price jsonb;
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='handoff requires an editor';
  end if;
  if p_proposal_id is null then raise exception using errcode='MQ422',message='proposal required'; end if;
  -- Shared with submit/decide: a new selection cannot race the handoff selection check.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.purchase-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='handoff requires an editor';
  end if;
  select * into proposal from public.purchase_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  select id into existing from public.purchase_handoffs where organization_id=p_organization_id and proposal_id=p_proposal_id;
  -- Existing exports are historical evidence. Replays still require live authority/scope,
  -- but do not reinterpret or replace the captured approval after price/selection changes.
  if found then return existing; end if;
  if proposal.status<>'approved' or exists(select 1 from public.purchase_proposals
      where organization_id=p_organization_id and draft_id=proposal.draft_id and status='approved' and revision>proposal.revision) then
    raise exception using errcode='MQ409',message='selected approval required',hint='handoff_selection_changed';
  end if;
  select * into estimate from public.purchase_cost_estimates where organization_id=p_organization_id and id=proposal.estimate_id and location_id=proposal.location_id;
  if not found or estimate.report->>'status' is distinct from 'available' or coalesce((estimate.report#>>'{source,quantity}')::numeric,0)<=0 then
    raise exception using errcode='MQ422',message='available positive estimate required';
  end if;
  if estimate.report#>'{source,policy_recalculation_required}' is distinct from 'false'::jsonb then
    raise exception using errcode='MQ422',message='policy recalculation required',hint='purchase_policy_required';
  end if;
  current_price:=public.purchase_cost_preview(p_organization_id,estimate.delivery_id,true);
  if current_price->>'status' is distinct from 'available' or current_price->>'fingerprint' is distinct from estimate.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='price evidence changed',hint='purchase_price_changed';
  end if;
  select * into draft from public.replenishment_drafts where organization_id=p_organization_id and id=proposal.draft_id and location_id=proposal.location_id;
  if not found then raise exception using errcode='MQ422',message='draft unavailable'; end if;
  select * into policy from public.inventory_policies where organization_id=p_organization_id and id=draft.policy_id and location_id=proposal.location_id;
  if not found then raise exception using errcode='MQ422',message='policy unavailable'; end if;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','purchase-handoff-v1','purpose','planning_only',
    'notice','As-of planning evidence only. Not an order, supplier acceptance or inbound quantity.',
    'handoff_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'proposal',jsonb_build_object('id',proposal.id,'revision',proposal.revision,'estimate_id',estimate.id,'draft_id',draft.id,
      'submitted_by',proposal.submitted_by,'submitted_at',proposal.created_at,'reason',proposal.reason,
      'approved_by',proposal.decided_by,'approved_at',proposal.decided_at,'approval_reason',proposal.decision_reason),
    'evidence',jsonb_build_object('policy_id',policy.id,'forecast_id',policy.forecast_id,'draft_fingerprint',draft.report->>'fingerprint'),
    'estimate',estimate.report);
  insert into public.purchase_handoffs(id,organization_id,proposal_id,location_id,created_by,created_at,payload)
    values(result,p_organization_id,proposal.id,proposal.location_id,auth.uid(),captured,snapshot);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.purchase_proposal_decide(p_organization_id uuid, p_proposal_id uuid, p_request_id uuid, p_decision text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.purchase_proposals; source public.purchase_cost_estimates; current_price jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='purchase decision requires membership';
  end if;
  if p_request_id is null or p_decision is null or p_decision not in ('approved','rejected','withdrawn') or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid purchase decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.purchase-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='purchase decision requires membership';
  end if;
  select * into proposal from public.purchase_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations()))) for update;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  if p_decision='withdrawn' then
    if proposal.submitted_by<>auth.uid() then raise exception using errcode='MQ403',message='only the author may withdraw'; end if;
  elsif proposal.submitted_by=auth.uid() or not(p_organization_id=any(array(select app.approving_organizations()))) then
    raise exception using errcode='MQ403',message='independent reviewer required';
  end if;
  if proposal.status<>'pending' then
    if proposal.decision_request_id=p_request_id and proposal.decided_by=auth.uid() and proposal.status=p_decision and proposal.decision_reason=why then return proposal.id; end if;
    raise exception using errcode='MQ409',message='proposal already decided';
  end if;
  if exists(select 1 from public.purchase_proposals where organization_id=p_organization_id and decision_request_id=p_request_id) then
    raise exception using errcode='MQ409',message='decision request conflicts';
  end if;
  if p_decision='approved' then
    select * into source from public.purchase_cost_estimates where organization_id=p_organization_id and id=proposal.estimate_id;
    if source.report#>'{source,policy_recalculation_required}' is distinct from 'false'::jsonb then
      raise exception using errcode='MQ422',message='policy recalculation required',hint='purchase_policy_required';
    end if;
    current_price:=public.purchase_cost_preview(p_organization_id,source.delivery_id,true);
    if current_price->>'status' is distinct from 'available' or current_price->>'fingerprint' is distinct from source.report->>'fingerprint' then
      raise exception using errcode='MQ409',message='price evidence changed',hint='purchase_price_changed';
    end if;
  end if;
  update public.purchase_proposals set status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp(),decision_reason=why,decision_request_id=p_request_id where id=proposal.id;
  return proposal.id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.purchase_proposal_submit(p_organization_id uuid, p_estimate_id uuid, p_request_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source public.purchase_cost_estimates; previous public.purchase_proposals; result uuid; sequence integer; original_draft uuid; current_price jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='purchase proposal requires an editor';
  end if;
  if p_request_id is null or p_estimate_id is null or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid purchase proposal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.purchase-review:'||p_organization_id::text,0));
  -- A waiter must use current membership and location access, including on replay.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='purchase proposal requires an editor';
  end if;
  select * into source from public.purchase_cost_estimates where organization_id=p_organization_id and id=p_estimate_id
    and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='estimate unavailable'; end if;
  select * into previous from public.purchase_proposals where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if previous.estimate_id=p_estimate_id and previous.submitted_by=auth.uid() and previous.reason=why then return previous.id; end if;
    raise exception using errcode='MQ409',message='proposal request conflicts';
  end if;
  if source.report->>'status' is distinct from 'available' or coalesce((source.report#>>'{source,quantity}')::numeric,0)<=0 then
    raise exception using errcode='MQ422',message='choose an available positive estimate';
  end if;
  -- Derive lineage from saved rows, never from a client-supplied draft/location.
  select s.draft_id into original_draft from public.delivery_scenarios d
    join public.supplier_scenarios s on s.organization_id=d.organization_id and s.id=d.supplier_scenario_id and s.location_id=d.location_id
    join public.replenishment_drafts r on r.organization_id=s.organization_id and r.id=s.draft_id and r.location_id=s.location_id
    where d.organization_id=p_organization_id and d.id=source.delivery_id and d.location_id=source.location_id;
  if original_draft is null then raise exception using errcode='MQ422',message='source lineage unavailable'; end if;
  current_price:=public.purchase_cost_preview(p_organization_id,source.delivery_id,true);
  if current_price->>'status' is distinct from 'available' or current_price->>'fingerprint' is distinct from source.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='price evidence changed',hint='purchase_price_changed';
  end if;
  if exists(select 1 from public.purchase_proposals where draft_id=original_draft and status='pending') then
    raise exception using errcode='MQ409',message='draft has a pending proposal',hint='purchase_pending';
  end if;
  select coalesce(max(revision),0)+1 into sequence from public.purchase_proposals where draft_id=original_draft;
  insert into public.purchase_proposals(organization_id,estimate_id,draft_id,location_id,revision,request_id,submitted_by,reason)
    values(p_organization_id,source.id,original_draft,source.location_id,sequence,p_request_id,auth.uid(),why) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.redistribution_save(p_organization_id uuid, p_draft_id uuid, p_source_policy_id uuid, p_basis text, p_override_id uuid DEFAULT NULL::uuid, p_backorders text DEFAULT NULL::text, p_commitments_confirmed boolean DEFAULT NULL::boolean, p_lane_confirmed boolean DEFAULT NULL::boolean, p_request_id uuid DEFAULT NULL::uuid, p_fingerprint text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.redistribution_drafts; report jsonb; result uuid;
begin
  if p_organization_id is null or auth.uid() is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='draft requires an editor';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_backorders is null or p_backorders!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or p_commitments_confirmed is distinct from true or p_lane_confirmed is distinct from true
    or p_draft_id is null or p_source_policy_id is null
    or p_basis is null or p_basis not in ('calculated','approved')
    or (p_basis='calculated' and p_override_id is not null) or (p_basis='approved' and p_override_id is null) then
    raise exception using errcode='MQ422',message='invalid redistribution request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.redistribution:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='draft requires an editor';
  end if;
  select * into previous from public.redistribution_drafts where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and (not(previous.location_id=any(array(select app.scoped_locations())))
        or not(previous.source_location_id=any(array(select app.scoped_locations())))) then
      raise exception using errcode='MQ404',message='draft unavailable';
    end if;
    if previous.draft_id=p_draft_id and previous.source_policy_id=p_source_policy_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint and previous.report->>'basis'=p_basis
      and (previous.report->>'override_id')::uuid is not distinct from p_override_id
      and (previous.report->>'backorders')::numeric=p_backorders::numeric then return previous.id; end if;
    raise exception using errcode='MQ409',message='redistribution request conflicts';
  end if;
  report:=public.redistribution_preview(p_organization_id,p_draft_id,p_source_policy_id,p_basis,p_override_id,p_backorders,p_commitments_confirmed,p_lane_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='choose an available redistribution preview'; end if;
  insert into public.redistribution_drafts(organization_id,draft_id,location_id,source_policy_id,source_location_id,request_id,submitted_by,report)
    values(p_organization_id,p_draft_id,(report->>'location_id')::uuid,p_source_policy_id,(report->>'source_location_id')::uuid,p_request_id,auth.uid(),report)
    returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.regional_date_save(p_organization_id uuid, p_sourcing_id uuid, p_requested_date date, p_calendars_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.regional_date_scenarios; source public.regional_sourcing_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional dates require an editor';
  end if;
  if p_sourcing_id is null or p_requested_date is null or not isfinite(p_requested_date)
    or p_requested_date not between date '1900-01-01' and date '2100-12-31'
    or p_calendars_confirmed is null or p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid regional date request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.regional-dates:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional dates require an editor';
  end if;
  select * into previous from public.regional_date_scenarios where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='regional dates unavailable';
    end if;
    if previous.sourcing_id=p_sourcing_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint
      and (previous.report->>'requested_date')::date=p_requested_date
      and (previous.report->>'calendars_confirmed')::boolean=p_calendars_confirmed then return previous.id; end if;
    raise exception using errcode='MQ409',message='regional date request conflicts';
  end if;
  select * into source from public.regional_sourcing_scenarios
    where organization_id=p_organization_id and id=p_sourcing_id
      and (organization_id=any(array(select app.unscoped_organizations()))
        or required_location_ids <@ array(select app.scoped_locations()));
  if not found then raise exception using errcode='MQ404',message='regional sourcing unavailable'; end if;
  -- Match regional sourcing/region archive lock order, then protect the saved parent.
  perform 1 from public.locations where organization_id=p_organization_id and id=any(source.required_location_ids) order by id for share;
  perform 1 from public.stock_regions where organization_id=p_organization_id and id=(source.report->'region'->>'id')::uuid for share;
  perform 1 from public.regional_sourcing_scenarios where organization_id=p_organization_id and id=p_sourcing_id for key share;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional dates require an editor';
  end if;
  report:=public.regional_date_preview(p_organization_id,p_sourcing_id,p_requested_date,p_calendars_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_transfer_needed') then
    raise exception using errcode='MQ422',message='resolve unavailable regional dates before saving';
  end if;
  insert into public.regional_date_scenarios(organization_id,sourcing_id,required_location_ids,request_id,submitted_by,report)
    values(p_organization_id,source.id,source.required_location_ids,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.regional_freight_save(p_organization_id uuid, p_scenario_id uuid, p_terms_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.regional_freight_estimates; source public.regional_date_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional freight requires an editor';
  end if;
  if p_scenario_id is null or p_terms_confirmed is null or p_request_id is null or p_fingerprint is null
    or p_fingerprint!~'^[a-f0-9]{64}$' then raise exception using errcode='MQ422',message='invalid regional freight request'; end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.regional-freight:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional freight requires an editor';
  end if;
  select * into previous from public.regional_freight_estimates where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='regional freight unavailable';
    end if;
    if previous.scenario_id=p_scenario_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint
      and (previous.report->>'terms_confirmed')::boolean=p_terms_confirmed then return previous.id; end if;
    raise exception using errcode='MQ409',message='regional freight request conflicts';
  end if;
  select * into source from public.regional_date_scenarios where organization_id=p_organization_id and id=p_scenario_id
    and (organization_id=any(array(select app.unscoped_organizations()))
      or required_location_ids <@ array(select app.scoped_locations()));
  if not found then raise exception using errcode='MQ404',message='regional dates unavailable'; end if;
  -- Same lock order as region archive; serialize a new estimate with archive and location deletion.
  perform 1 from public.locations where organization_id=p_organization_id and id=any(source.required_location_ids) order by id for share;
  perform 1 from public.stock_regions where organization_id=p_organization_id and id=(source.report->'source'->'region'->>'id')::uuid for share;
  perform 1 from public.regional_date_scenarios where organization_id=p_organization_id and id=p_scenario_id for key share;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional freight requires an editor';
  end if;
  report:=public.regional_freight_preview(p_organization_id,p_scenario_id,p_terms_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_transfer_needed') then
    raise exception using errcode='MQ422',message='resolve unavailable regional freight before saving';
  end if;
  insert into public.regional_freight_estimates(organization_id,scenario_id,required_location_ids,request_id,submitted_by,report)
    values(p_organization_id,source.id,source.required_location_ids,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.regional_handoff_batch_create(p_organization_id uuid, p_handoff_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare report jsonb; ids uuid[]; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb;
begin
  if auth.uid() is null or p_organization_id is null
    or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional batch requires an editor';
  end if;
  if p_handoff_ids is null or cardinality(p_handoff_ids) not between 1 and 50
    or array_ndims(p_handoff_ids)<>1 or array_position(p_handoff_ids,null) is not null then
    raise exception using errcode='MQ422',message='select 1 to 50 distinct handoffs',hint='batch_selection_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.regional-review:'||p_organization_id::text,0));
  -- Skip live evidence locks on retries, while still locking visible original parents.
  -- First saves use the review/handoff lock order; concurrent archive/rate changes
  -- must commit before the final fresh-statement preview can validate evidence.
  select array_agg(distinct id order by id) into ids from unnest(p_handoff_ids) id;
  if not exists(select 1 from public.regional_handoff_batches where organization_id=p_organization_id and handoff_ids=ids) then
    perform l.id from public.locations l where l.organization_id=p_organization_id and l.id in(
      select unnest(h.required_location_ids) from public.regional_transfer_handoffs h
        where h.organization_id=p_organization_id and h.id=any(ids)
    ) order by l.id for share;
    perform r.id from public.stock_regions r where r.organization_id=p_organization_id and r.id in(
      select (h.payload#>>'{estimate,source,source,region,id}')::uuid from public.regional_transfer_handoffs h
        where h.organization_id=p_organization_id and h.id=any(ids)
    ) order by r.id for share;
    perform n.id from public.network_links n where n.organization_id=p_organization_id and n.id in(
      select (v#>>'{lane,id}')::uuid from public.regional_transfer_handoffs h
      cross join lateral jsonb_array_elements(h.payload#>'{estimate,source,lines}') v
        where h.organization_id=p_organization_id and h.id=any(ids)
    ) order by n.id for share;
    perform i.id from public.items i join public.inventory_policies p on p.organization_id=i.organization_id and p.item_id=i.id
      where i.organization_id=p_organization_id and p.id in(
        select (h.payload#>>'{estimate,source,source,destination,policy,policy_id}')::uuid from public.regional_transfer_handoffs h
          where h.organization_id=p_organization_id and h.id=any(ids)
      ) order by i.id for key share of i;
    perform p.id from public.inventory_policies p where p.organization_id=p_organization_id and p.id in(
      select (h.payload#>>'{estimate,source,source,destination,policy,policy_id}')::uuid from public.regional_transfer_handoffs h
        where h.organization_id=p_organization_id and h.id=any(ids)
    ) order by p.id for share;
    perform d.id from public.replenishment_drafts d where d.organization_id=p_organization_id and d.id in(
      select (h.payload#>>'{estimate,source,source,input,draft_id}')::uuid from public.regional_transfer_handoffs h
        where h.organization_id=p_organization_id and h.id=any(ids)
    ) order by d.id for share;
  end if;
  perform h.id from public.regional_transfer_handoffs h
    where h.organization_id=p_organization_id and h.id=any(ids) order by h.id for key share;
  -- A new statement after every wait checks current authority, visibility and evidence.
  report:=public.regional_handoff_batch_preview(p_organization_id,p_handoff_ids);
  if report->>'existing_batch_id' is not null then return (report->>'existing_batch_id')::uuid; end if;
  select array_agg(id order by id) into ids from unnest(p_handoff_ids) id;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','regional-handoff-batch-v1','purpose','planning_only',
    'notice','As-of whole-regional planning package. Overlap is allowed. Each source retains its original freight charge. No consolidation, reservation, transfer order or inbound update.',
    'batch_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'summary',report->'summary','lines',report->'lines','item_identities',report->'item_identities');
  insert into public.regional_handoff_batches(id,organization_id,destination_location_id,required_location_ids,handoff_ids,created_by,created_at,payload)
    values(result,p_organization_id,(report#>>'{summary,destination_location_id}')::uuid,
      array(select value::uuid from jsonb_array_elements_text(report->'required_location_ids')),ids,auth.uid(),captured,snapshot);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.regional_handoff_create(p_organization_id uuid, p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.regional_transfer_proposals; estimate public.regional_freight_estimates;
  existing uuid; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb; current_freight jsonb;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional handoff requires an editor';
  end if;
  if p_proposal_id is null then raise exception using errcode='MQ422',message='proposal required'; end if;
  -- Share review's lock: a new selected approval cannot race a first export.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.regional-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional handoff requires an editor';
  end if;
  select * into proposal from public.regional_transfer_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations()))
      or required_location_ids <@ array(select app.scoped_locations())) ;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  -- Row-lock waits, including parent deletion, must not retain obsolete authority.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional handoff requires an editor';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(proposal.required_location_ids <@ array(select app.scoped_locations())) then
    raise exception using errcode='MQ404',message='proposal unavailable';
  end if;
  select id into existing from public.regional_transfer_handoffs where organization_id=p_organization_id and proposal_id=p_proposal_id;
  -- Only authority is live on a retry. Never regenerate an existing snapshot.
  if found then
    perform 1 from public.regional_transfer_proposals where organization_id=p_organization_id and id=p_proposal_id for key share;
    if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
    if not(p_organization_id=any(array(select app.editable_organizations()))) then
      raise exception using errcode='MQ403',message='regional handoff requires an editor';
    end if;
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(proposal.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='proposal unavailable';
    end if;
    return existing;
  end if;
  if proposal.status<>'approved' or exists(select 1 from public.regional_transfer_proposals
    where organization_id=p_organization_id and sourcing_id=proposal.sourcing_id
      and status='approved' and revision>proposal.revision) then
    raise exception using errcode='MQ409',message='selected approval required',hint='regional_selection_changed';
  end if;
  select * into estimate from public.regional_freight_estimates where organization_id=p_organization_id and id=proposal.estimate_id
    and required_location_ids=proposal.required_location_ids;
  if not found or app.regional_review_timing_clear(estimate.report) is distinct from true then
    raise exception using errcode='MQ422',message='regional timing review required',hint='regional_timing_required';
  end if;
  -- Match review's lock order and serialize first creation with archive/rate changes.
  perform 1 from public.locations where organization_id=p_organization_id and id=any(proposal.required_location_ids) order by id for share;
  perform 1 from public.stock_regions where organization_id=p_organization_id and id=(estimate.report#>>'{source,source,region,id}')::uuid for share;
  perform 1 from public.network_links where organization_id=p_organization_id and id in
    (select (v#>>'{terms,id}')::uuid from jsonb_array_elements(estimate.report->'lines') v) order by id for share;
  perform 1 from public.regional_freight_estimates where organization_id=p_organization_id and id=estimate.id for key share;
  perform 1 from public.regional_transfer_proposals where organization_id=p_organization_id and id=proposal.id for key share;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional handoff requires an editor';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(proposal.required_location_ids <@ array(select app.scoped_locations())) then
    raise exception using errcode='MQ404',message='proposal unavailable';
  end if;
  current_freight:=public.regional_freight_preview(p_organization_id,estimate.scenario_id,true);
  if current_freight->>'status' is distinct from 'available'
    or current_freight->>'fingerprint' is distinct from estimate.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='freight evidence changed',hint='regional_freight_changed';
  end if;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','regional-transfer-handoff-v1','purpose','planning_only',
    'notice','As-of whole-regional planning evidence. Zero sources need no transfer. No stock reservation, transfer order, inbound update or arrival guarantee.',
    'handoff_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'proposal',jsonb_build_object('id',proposal.id,'revision',proposal.revision,'estimate_id',estimate.id,'sourcing_id',proposal.sourcing_id,
      'submitted_by',proposal.submitted_by,'submitted_at',proposal.created_at,'reason',proposal.reason,
      'approved_by',proposal.decided_by,'approved_at',proposal.decided_at,'approval_reason',proposal.decision_reason),
    'estimate',estimate.report);
  insert into public.regional_transfer_handoffs(id,organization_id,proposal_id,destination_location_id,required_location_ids,created_by,created_at,payload)
    values(result,p_organization_id,proposal.id,(estimate.report#>>'{source,source,destination_location_id}')::uuid,proposal.required_location_ids,auth.uid(),captured,snapshot);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.regional_sourcing_save(p_organization_id uuid, p_input jsonb, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare input jsonb; report jsonb; previous public.regional_sourcing_scenarios; required_ids uuid[]; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='sourcing requires an editor';
  end if;
  input:=app.regional_sourcing_input(p_input);
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid sourcing save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.regional-sourcing:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='sourcing requires an editor';
  end if;
  select * into previous from public.regional_sourcing_scenarios where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='sourcing unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='sourcing request conflicts';
  end if;
  report:=public.regional_sourcing_preview(p_organization_id,input);
  select array_agg((v->>'id')::uuid order by (v->>'id')::uuid) into required_ids from jsonb_array_elements(report->'locations') v;
  -- Match the existing assessment lock order: item, locations, region. Region
  -- SHARE serializes new saves with archive; location SHARE prevents stale identities.
  perform 1 from public.items where organization_id=p_organization_id and id in
    (select p.item_id from public.inventory_policies p where p.organization_id=p_organization_id
      and p.id in (select (v->>'policy_id')::uuid from jsonb_array_elements(input->'sources') v)) order by id for share;
  perform 1 from public.locations where organization_id=p_organization_id and id=any(required_ids) order by id for share;
  perform 1 from public.stock_regions where organization_id=p_organization_id and id=(input->>'region_id')::uuid for share;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='sourcing requires an editor';
  end if;
  report:=public.regional_sourcing_preview(p_organization_id,input);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='sourcing evidence changed'; end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='sourcing unavailable'; end if;
  insert into public.regional_sourcing_scenarios(organization_id,required_location_ids,request_id,submitted_by,report)
    values(p_organization_id,required_ids,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.regional_stock_save(p_organization_id uuid, p_input jsonb, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare input jsonb; report jsonb; previous public.regional_stock_assessments; required_ids uuid[]; locked_item uuid; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='assessment requires an editor';
  end if;
  input:=app.regional_stock_input(p_input);
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid assessment save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.regional-stock:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='assessment requires an editor';
  end if;
  select * into previous from public.regional_stock_assessments where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='assessment unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='assessment request conflicts';
  end if;
  report:=public.regional_stock_preview(p_organization_id,input);
  locked_item:=(report#>>'{item,id}')::uuid;
  select array_agg((v->>'location_id')::uuid order by (v->>'location_id')::uuid) into required_ids from jsonb_array_elements(report->'lines') v;
  -- Hold catalog rows through insertion: location deletion must cascade the new assessment too.
  perform 1 from public.items where organization_id=p_organization_id and id=(report#>>'{item,id}')::uuid for share;
  if not found then raise exception using errcode='MQ409',message='assessment evidence changed'; end if;
  perform 1 from public.locations where organization_id=p_organization_id and id=any(required_ids) order by id for share;
  if input ? 'region_id' then
    perform 1 from public.stock_regions where organization_id=p_organization_id and id=(input->>'region_id')::uuid for share;
    if not found then raise exception using errcode='MQ404',message='assessment inputs unavailable'; end if;
  end if;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='assessment requires an editor';
  end if;
  report:=public.regional_stock_preview(p_organization_id,input);
  if (report#>>'{item,id}')::uuid<>locked_item or required_ids is distinct from
    (select array_agg((v->>'location_id')::uuid order by (v->>'location_id')::uuid) from jsonb_array_elements(report->'lines') v) then
    raise exception using errcode='MQ409',message='assessment identities changed';
  end if;
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='assessment evidence changed'; end if;
  if report->>'status'<>'available' then raise exception using errcode='MQ422',message='complete stock evidence required'; end if;
  insert into public.regional_stock_assessments(organization_id,required_location_ids,location_codes,item_id,item_code,
    assessment_name,as_of,unit,request_id,submitted_by,report)
    values(p_organization_id,required_ids,array(select v->>'code' from jsonb_array_elements(report->'lines') v),
      (report#>>'{item,id}')::uuid,input->>'item_code',input->>'assessment_name',(input->>'as_of')::date,
      input->>'unit',p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.regional_transfer_decide(p_organization_id uuid, p_proposal_id uuid, p_request_id uuid, p_decision text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.regional_transfer_proposals; source public.regional_freight_estimates; current_freight jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='regional decision requires membership';
  end if;
  if p_proposal_id is null or p_request_id is null or p_decision is null
    or p_decision not in ('approved','rejected','withdrawn') or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid regional decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.regional-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='regional decision requires membership';
  end if;
  select * into proposal from public.regional_transfer_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations()))
      or required_location_ids <@ array(select app.scoped_locations()));
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='regional decision requires membership';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(proposal.required_location_ids <@ array(select app.scoped_locations())) then
    raise exception using errcode='MQ404',message='proposal unavailable';
  end if;
  if p_decision='withdrawn' then
    if proposal.submitted_by<>auth.uid() then raise exception using errcode='MQ403',message='only the author may withdraw'; end if;
  elsif proposal.submitted_by=auth.uid() or not(p_organization_id=any(array(select app.approving_organizations()))) then
    raise exception using errcode='MQ403',message='independent reviewer required';
  end if;
  if proposal.status<>'pending' then
    if proposal.decision_request_id=p_request_id and proposal.decided_by=auth.uid()
      and proposal.status=p_decision and proposal.decision_reason=why then return proposal.id; end if;
    raise exception using errcode='MQ409',message='proposal already decided';
  end if;
  if exists(select 1 from public.regional_transfer_proposals where organization_id=p_organization_id and decision_request_id=p_request_id) then
    raise exception using errcode='MQ409',message='decision request conflicts';
  end if;
  if p_decision='approved' then
    select * into source from public.regional_freight_estimates where organization_id=p_organization_id and id=proposal.estimate_id;
  perform 1 from public.locations where organization_id=p_organization_id and id=any(source.required_location_ids) order by id for share;
  perform 1 from public.stock_regions where organization_id=p_organization_id and id=(source.report#>>'{source,source,region,id}')::uuid for share;
  perform 1 from public.network_links where organization_id=p_organization_id and id in
    (select (v#>>'{terms,id}')::uuid from jsonb_array_elements(source.report->'lines') v) order by id for share;
  perform 1 from public.regional_freight_estimates where organization_id=p_organization_id and id=source.id for key share;
  end if;
  perform 1 from public.regional_transfer_proposals where organization_id=p_organization_id and id=proposal.id for update;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  -- Locks may wait behind archive, deletion or role/access changes. Recheck live authority.
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='regional decision requires membership';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(proposal.required_location_ids <@ array(select app.scoped_locations())) then
    raise exception using errcode='MQ404',message='proposal unavailable';
  end if;
  if p_decision<>'withdrawn' and not(p_organization_id=any(array(select app.approving_organizations()))) then
    raise exception using errcode='MQ403',message='independent reviewer required';
  end if;
  if p_decision='approved' then
    if app.regional_review_timing_clear(source.report) is distinct from true then
      raise exception using errcode='MQ422',message='regional timing review required',hint='regional_timing_required';
    end if;
    current_freight:=public.regional_freight_preview(p_organization_id,source.scenario_id,true);
    if current_freight->>'status' is distinct from 'available'
      or current_freight->>'fingerprint' is distinct from source.report->>'fingerprint' then
      raise exception using errcode='MQ409',message='freight evidence changed',hint='regional_freight_changed';
    end if;
  end if;
  update public.regional_transfer_proposals set status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp(),
    decision_reason=why,decision_request_id=p_request_id where id=proposal.id;
  return proposal.id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.regional_transfer_submit(p_organization_id uuid, p_estimate_id uuid, p_request_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source public.regional_freight_estimates; previous public.regional_transfer_proposals;
  result uuid; sequence integer; original_sourcing uuid; current_freight jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional proposal requires an editor';
  end if;
  if p_request_id is null or p_estimate_id is null or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid regional proposal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.regional-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional proposal requires an editor';
  end if;
  select * into source from public.regional_freight_estimates where organization_id=p_organization_id and id=p_estimate_id
    and (organization_id=any(array(select app.unscoped_organizations()))
      or required_location_ids <@ array(select app.scoped_locations()));
  if not found then raise exception using errcode='MQ404',message='estimate unavailable'; end if;
  -- Parent waits must not retain obsolete role or location authority.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional proposal requires an editor';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(source.required_location_ids <@ array(select app.scoped_locations())) then
    raise exception using errcode='MQ404',message='estimate unavailable';
  end if;
  select * into previous from public.regional_transfer_proposals where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if previous.estimate_id=p_estimate_id and previous.submitted_by=auth.uid() and previous.reason=why then return previous.id; end if;
    raise exception using errcode='MQ409',message='proposal request conflicts';
  end if;
  if source.report->>'status' is distinct from 'available' or not exists(
    select 1 from jsonb_array_elements(source.report->'lines') f where (f->>'quantity')::numeric>0
  ) then raise exception using errcode='MQ422',message='choose a complete positive estimate'; end if;
  -- Derive the selection identity from the saved chain, never client locations or sourcing IDs.
  select d.sourcing_id into original_sourcing from public.regional_date_scenarios d
    join public.regional_sourcing_scenarios a on a.organization_id=d.organization_id and a.id=d.sourcing_id
    where d.organization_id=p_organization_id and d.id=source.scenario_id
      and d.required_location_ids=source.required_location_ids and a.required_location_ids=source.required_location_ids;
  if original_sourcing is null then raise exception using errcode='MQ422',message='source lineage unavailable'; end if;
  perform 1 from public.locations where organization_id=p_organization_id and id=any(source.required_location_ids) order by id for share;
  perform 1 from public.stock_regions where organization_id=p_organization_id and id=(source.report#>>'{source,source,region,id}')::uuid for share;
  perform 1 from public.network_links where organization_id=p_organization_id and id in
    (select (v#>>'{terms,id}')::uuid from jsonb_array_elements(source.report->'lines') v) order by id for share;
  perform 1 from public.regional_freight_estimates where organization_id=p_organization_id and id=source.id for key share;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='regional proposal requires an editor';
  end if;
  current_freight:=public.regional_freight_preview(p_organization_id,source.scenario_id,true);
  if current_freight->>'status' is distinct from 'available'
    or current_freight->>'fingerprint' is distinct from source.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='freight evidence changed',hint='regional_freight_changed';
  end if;
  if exists(select 1 from public.regional_transfer_proposals where sourcing_id=original_sourcing and status='pending') then
    raise exception using errcode='MQ409',message='sourcing has a pending proposal',hint='regional_pending';
  end if;
  select coalesce(max(revision),0)+1 into sequence from public.regional_transfer_proposals where sourcing_id=original_sourcing;
  insert into public.regional_transfer_proposals(organization_id,estimate_id,sourcing_id,
    required_location_ids,revision,request_id,submitted_by,reason)
    values(p_organization_id,source.id,original_sourcing,source.required_location_ids,
      sequence,p_request_id,auth.uid(),why) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.replenishment_save(p_organization_id uuid, p_policy_id uuid, p_request_id uuid, p_basis text, p_override_id uuid DEFAULT NULL::uuid, p_backorders text DEFAULT NULL::text, p_orders_confirmed boolean DEFAULT NULL::boolean, p_fingerprint text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.replenishment_drafts; report jsonb; result uuid;
begin
  if p_organization_id is null or auth.uid() is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='draft requires an editor';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_backorders is null or p_backorders!~'^[0-9]{1,15}(\.[0-9]{1,3})?$' or p_orders_confirmed is null then
    raise exception using errcode='MQ422',message='invalid draft request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.replenishment:'||p_organization_id::text,0));
  -- A queued save must recheck edit authority after another transaction commits.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='draft requires an editor';
  end if;
  select * into previous from public.replenishment_drafts where organization_id=p_organization_id and request_id=p_request_id
    and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.policy_id=p_policy_id and previous.submitted_by=auth.uid() and previous.report->>'fingerprint'=p_fingerprint
      and previous.report->'policy'->>'basis'=p_basis
      and (previous.report->'policy'->>'override_id')::uuid is not distinct from p_override_id
      and (previous.report->>'backorders')::numeric=p_backorders::numeric
      and (previous.report->>'orders_confirmed')::boolean=p_orders_confirmed then return previous.id; end if;
    raise exception using errcode='MQ409',message='draft request conflicts';
  end if;
  report:=public.replenishment_preview(p_organization_id,p_policy_id,p_basis,p_override_id,p_backorders,p_orders_confirmed);
  if report->>'fingerprint'<>p_fingerprint then
    raise exception using errcode='MQ409',message='inputs changed; refresh the preview';
  end if;
  insert into public.replenishment_drafts(organization_id,policy_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_policy_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.simulation_calendars_enqueue(p_organization_id uuid, p_source_run_id uuid, p_calendar_id uuid, p_request_id uuid, p_fingerprint text, p_calendars_confirmed boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prior public.planning_runs; options jsonb; payload jsonb; run uuid;
begin
 if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='calendar simulation requires an editor';
 end if;
 if p_source_run_id is null or p_calendar_id is null or p_request_id is null
  or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' or p_calendars_confirmed is distinct from true then
  raise exception using errcode='MQ422',message='invalid calendar inputs or confirmation';
 end if;
 options:=jsonb_build_object('method','periodic-calendars-v1','source_run_id',p_source_run_id,
  'ordering_calendar_id',p_calendar_id,'fingerprint',p_fingerprint,'calendars_confirmed',true);
 perform pg_advisory_xact_lock(hashtextextended('zeespare.planning:'||p_organization_id::text,0));
 if not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='calendar simulation requires an editor';
 end if;
 select * into prior from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if prior.kind<>'simulation' or prior.options<>options then
   raise exception using errcode='MQ409',message='request id already used with different parameters';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
   and not(prior.location_id=any(array(select app.scoped_locations()))) then
   raise exception using errcode='MQ404',message='comparison unavailable';
  end if;
  return prior.id;
 end if;
 payload:=public.simulation_calendars_preview(p_organization_id,p_source_run_id,p_calendar_id);
 if payload->>'fingerprint'<>p_fingerprint then
  raise exception using errcode='MQ409',message='calendar evidence changed; refresh preview';
 end if;
 payload:=jsonb_set(payload,'{options,calendars_confirmed}','true')||jsonb_build_object('computed_at',statement_timestamp());
 run:=app.planning_enqueue_kind(p_organization_id,payload#>>'{calendars,receiver,code}',
  (payload->>'from_date')::date,(payload->>'to_date')::date,p_request_id,'simulation',options);
 insert into planning.simulation_inputs(run_id,payload) values(run,payload);
 return run;
end; $function$
;

CREATE OR REPLACE FUNCTION public.simulation_configurations_enqueue(p_organization_id uuid, p_source_run_id uuid, p_request_id uuid, p_configurations jsonb, p_reuse_confirmed boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prior public.planning_runs; source public.policy_simulations; options jsonb; payload jsonb;
 configurations jsonb; run uuid; location_code text;
begin
 if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='configuration requires an editor';
 end if;
 configurations:=app.simulation_configurations_canonical(p_configurations);
 if p_source_run_id is null or p_request_id is null or p_reuse_confirmed is distinct from true or configurations is null then
  raise exception using errcode='MQ422',message='invalid configurations or confirmation';
 end if;
 options:=jsonb_build_object('method','periodic-configurations-v1','source_run_id',p_source_run_id,
  'configurations',configurations,'reuse_confirmed',true);
 perform pg_advisory_xact_lock(hashtextextended('zeespare.planning:'||p_organization_id::text,0));
 -- A request may have waited while membership or its active-organization scope changed.
 if not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='configuration requires an editor';
 end if;
 select * into prior from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if prior.kind<>'simulation' or prior.options<>options then
   raise exception using errcode='MQ409',message='request id already used with different parameters';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
   and not(prior.location_id=any(array(select app.scoped_locations()))) then
   raise exception using errcode='MQ404',message='comparison unavailable';
  end if;
  return prior.id;
 end if;
 select s.* into source from public.policy_simulations s join public.planning_runs r
  on r.organization_id=s.organization_id and r.id=s.run_id
  where s.organization_id=p_organization_id and s.run_id=p_source_run_id
   and r.kind='simulation' and r.status='succeeded' for share of s,r;
 if not found or (not(p_organization_id=any(array(select app.unscoped_organizations())))
   and not(source.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='source simulation unavailable';
 end if;
 if source.evidence->>'method' is distinct from 'periodic-replay-v1'
  or source.evidence#>>'{policy,unit}' is distinct from source.unit
  or source.evidence#>>'{options,history_confirmed}' is distinct from 'true'
  or source.evidence#>>'{options,empty_start_confirmed}' is distinct from 'true'
  or app.simulation_output_valid(source.evidence,source.evidence->'output') is distinct from true then
  raise exception using errcode='MQ422',message='choose a completed original policy simulation';
 end if;
 select code into location_code from public.locations where organization_id=p_organization_id
  and id=source.location_id and is_active;
 if location_code is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
 payload:=(source.evidence-'output')||jsonb_build_object('method','periodic-configurations-v1',
  'computed_at',statement_timestamp(),
  'options',((source.evidence->'options')-'alternative_maximum')||options,
  'source_simulation',jsonb_build_object('id',source.id,'run_id',source.run_id,'evidence',source.evidence));
 if octet_length(payload::text)>20000000 then raise exception using errcode='MQ422',message='configuration evidence too large'; end if;
 run:=app.planning_enqueue_kind(p_organization_id,location_code,(payload->>'from_date')::date,
  (payload->>'to_date')::date,p_request_id,'simulation',options);
 insert into planning.simulation_inputs(run_id,payload) values(run,payload);
 return run;
end; $function$
;

CREATE OR REPLACE FUNCTION public.simulation_constraints_enqueue(p_organization_id uuid, p_source_run_id uuid, p_request_id uuid, p_configurations jsonb, p_reuse_confirmed boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prior public.planning_runs; source public.policy_simulations; options jsonb; payload jsonb;
 configurations jsonb; run uuid; location_code text;
begin
 if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='configuration requires an editor';
 end if;
 configurations:=app.simulation_constraints_canonical(p_configurations);
 if p_source_run_id is null or p_request_id is null or p_reuse_confirmed is distinct from true or configurations is null then
  raise exception using errcode='MQ422',message='invalid configurations or confirmation';
 end if;
 options:=jsonb_build_object('method','periodic-constraints-v1','source_run_id',p_source_run_id,
  'configurations',configurations,'reuse_confirmed',true);
 perform pg_advisory_xact_lock(hashtextextended('zeespare.planning:'||p_organization_id::text,0));
 -- A request may have waited while membership or its active-organization scope changed.
 if not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='configuration requires an editor';
 end if;
 select * into prior from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if prior.kind<>'simulation' or prior.options<>options then
   raise exception using errcode='MQ409',message='request id already used with different parameters';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
   and not(prior.location_id=any(array(select app.scoped_locations()))) then
   raise exception using errcode='MQ404',message='comparison unavailable';
  end if;
  return prior.id;
 end if;
 select s.* into source from public.policy_simulations s join public.planning_runs r
  on r.organization_id=s.organization_id and r.id=s.run_id
  where s.organization_id=p_organization_id and s.run_id=p_source_run_id
   and r.kind='simulation' and r.status='succeeded' for share of s,r;
 if not found or (not(p_organization_id=any(array(select app.unscoped_organizations())))
   and not(source.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='source simulation unavailable';
 end if;
 if source.evidence->>'method' is distinct from 'periodic-replay-v1'
  or source.evidence#>>'{policy,unit}' is distinct from source.unit
  or source.evidence#>>'{options,history_confirmed}' is distinct from 'true'
  or source.evidence#>>'{options,empty_start_confirmed}' is distinct from 'true'
  or app.simulation_output_valid(source.evidence,source.evidence->'output') is distinct from true then
  raise exception using errcode='MQ422',message='choose a completed original policy simulation';
 end if;
 select code into location_code from public.locations where organization_id=p_organization_id
  and id=source.location_id and is_active;
 if location_code is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
 payload:=(source.evidence-'output')||jsonb_build_object('method','periodic-constraints-v1',
  'computed_at',statement_timestamp(),
  'options',((source.evidence->'options')-'alternative_maximum')||options,
  'source_simulation',jsonb_build_object('id',source.id,'run_id',source.run_id,'evidence',source.evidence));
 if octet_length(payload::text)>20000000 then raise exception using errcode='MQ422',message='configuration evidence too large'; end if;
 run:=app.planning_enqueue_kind(p_organization_id,location_code,(payload->>'from_date')::date,
  (payload->>'to_date')::date,p_request_id,'simulation',options);
 insert into planning.simulation_inputs(run_id,payload) values(run,payload);
 return run;
end; $function$
;

CREATE OR REPLACE FUNCTION public.simulation_enqueue(p_organization_id uuid, p_policy_id uuid, p_request_id uuid, p_to date, p_opening_stock text, p_alternative_maximum text, p_history_confirmed boolean, p_empty_start_confirmed boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.inventory_policies; prior public.planning_runs; source_run public.planning_runs;
 options jsonb; payload jsonb; demand jsonb; run uuid; cutoff date; horizon integer; lead integer; review integer;
 maximum text; location_code text; today date; units_match boolean;
begin
 if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='simulation requires an editor';
 end if;
 if p_policy_id is null or p_request_id is null or p_to is null or not isfinite(p_to)
  or p_history_confirmed is distinct from true or p_empty_start_confirmed is distinct from true
  or p_opening_stock is null or p_opening_stock !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$'
  or p_alternative_maximum is null or p_alternative_maximum !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$' then
  raise exception using errcode='MQ422',message='invalid simulation inputs or confirmations';
 end if;
 options:=jsonb_build_object('method','periodic-replay-v1','policy_id',p_policy_id,'to_date',p_to,
  'opening_stock',trim_scale(p_opening_stock::numeric)::text,'alternative_maximum',trim_scale(p_alternative_maximum::numeric)::text,
  'history_confirmed',true,'empty_start_confirmed',true);
 perform pg_advisory_xact_lock(hashtextextended('zeespare.planning:'||p_organization_id::text,0));
 select * into prior from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if prior.kind<>'simulation' or prior.options<>options then
   raise exception using errcode='MQ409',message='request id already used with different parameters';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(prior.location_id=any(array(select app.scoped_locations()))) then
   raise exception using errcode='MQ404',message='simulation unavailable';
  end if;
  return prior.id;
 end if;
 select * into p from public.inventory_policies where organization_id=p_organization_id and id=p_policy_id;
 if not found or (not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(p.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='policy unavailable';
 end if;
 select * into source_run from public.planning_runs where organization_id=p_organization_id and id=p.run_id;
 if source_run.status is distinct from 'succeeded' or source_run.kind is distinct from 'policy' or p.status<>'available'
  or coalesce(p.evidence#>>'{forecast,method}','') not in ('baseline-v1','expanded-v1')
  or p.unit is null or btrim(p.unit)=''
  or p.evidence#>>'{forecast,source,unit_provenance,status}' is distinct from 'consistent'
  or p.evidence#>>'{forecast,source,unit_provenance,unit}' is distinct from p.unit
  or coalesce(p.evidence#>>'{forecast,to_date}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or coalesce(p.evidence#>>'{forecast,horizon}','') !~ '^[0-9]{1,2}$'
  or coalesce(p.evidence#>>'{options,lead_time}','') !~ '^[0-9]{1,2}$'
  or coalesce(p.evidence#>>'{options,review_interval}','') !~ '^[0-9]{1,2}$' then
  raise exception using errcode='MQ422',message='choose an available individual policy with known units';
 end if;
 cutoff:=(p.evidence#>>'{forecast,to_date}')::date;
 horizon:=(p.evidence#>>'{forecast,horizon}')::integer;
 lead:=(p.evidence#>>'{options,lead_time}')::integer;
 review:=(p.evidence#>>'{options,review_interval}')::integer;
 maximum:=p.evidence#>>'{output,protection,target}';
 if not isfinite(cutoff) or cutoff<>source_run.to_date or lead not between 0 and 89 or review not between 1 and 90
  or horizon not between 1 and 90 or lead+review>horizon
  or maximum is null or maximum !~ '^[0-9]{1,31}(\.[0-9]{1,3})?$'
  or maximum is distinct from p.summary#>>'{protection,target}' then
  raise exception using errcode='MQ422',message='invalid saved policy evidence';
 end if;
 if maximum::numeric>1e30 then raise exception using errcode='MQ422',message='unsupported policy quantity'; end if;
 select (statement_timestamp() at time zone coalesce(o.time_zone,c.timezone,'UTC'))::date into today
 from public.organizations o left join public.countries c on c.code=o.home_country where o.id=p_organization_id;
 if p_to<=cutoff or p_to>cutoff+horizon or p_to>=today then
  raise exception using errcode='MQ422',message='choose completed dates within the saved forecast horizon';
 end if;
 select l.code into location_code from public.locations l where l.organization_id=p_organization_id and l.id=p.location_id and l.is_active;
 if location_code is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
 -- One statement captures both quantities and unit validation from the same history snapshot.
 select jsonb_agg(jsonb_build_object('date',cutoff+n,'quantity',trim_scale(coalesce(d.quantity,0))::text,
   'lost_sales_quantity',trim_scale(coalesce(d.lost_sales_quantity,0))::text,'recorded',d.item_id is not null) order by n),
   bool_and(d.item_id is null or d.unit_of_measure is not distinct from p.unit)
 into demand,units_match
 from generate_series(1,p_to-cutoff) n left join public.demand_history d on
  d.organization_id=p_organization_id and d.item_id=p.item_id and d.location_id=p.location_id and d.demand_date=cutoff+n;
 if units_match is distinct from true then raise exception using errcode='MQ422',message='replay history requires matching supplied units'; end if;
 payload:=jsonb_build_object('kind','simulation','method','periodic-replay-v1','computed_at',statement_timestamp(),
  'from_date',cutoff+1,'to_date',p_to,'options',options,'demand',demand,
  'policy',jsonb_build_object('id',p.id,'run_id',p.run_id,'item_id',p.item_id,'item_code',p.item_code,'unit',p.unit,
   'cutoff',cutoff,'horizon',horizon,'lead_time',lead,'review_interval',review,'maximum',trim_scale(maximum::numeric)::text,'evidence',p.evidence));
 if octet_length(payload::text)>20000000 then raise exception using errcode='MQ422',message='simulation evidence too large'; end if;
 run:=app.planning_enqueue_kind(p_organization_id,location_code,cutoff+1,p_to,p_request_id,'simulation',options);
 insert into planning.simulation_inputs(run_id,payload) values(run,payload);
 return run;
end; $function$
;

CREATE OR REPLACE FUNCTION public.simulation_sensitivity_enqueue(p_organization_id uuid, p_source_run_id uuid, p_request_id uuid, p_alternative_maxima jsonb, p_reuse_confirmed boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prior public.planning_runs; source public.policy_simulations; options jsonb; payload jsonb;
 maxima jsonb; value jsonb; run uuid; location_code text;
begin
 if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='sensitivity requires an editor';
 end if;
 if p_source_run_id is null or p_request_id is null or p_reuse_confirmed is distinct from true
  or jsonb_typeof(p_alternative_maxima) is distinct from 'array' then
  raise exception using errcode='MQ422',message='invalid sensitivity inputs or confirmation';
 end if;
 if jsonb_array_length(p_alternative_maxima) not between 1 and 10 then
  raise exception using errcode='MQ422',message='choose one to ten alternative maxima';
 end if;
 for value in select * from jsonb_array_elements(p_alternative_maxima) loop
  if jsonb_typeof(value) is distinct from 'string' or (value#>>'{}') !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$' then
   raise exception using errcode='MQ422',message='invalid alternative maximum';
  end if;
 end loop;
 select jsonb_agg(trim_scale(n)::text order by n) into maxima
 from (select distinct (v#>>'{}')::numeric n from jsonb_array_elements(p_alternative_maxima) v) canonical;
 if jsonb_array_length(maxima)<>jsonb_array_length(p_alternative_maxima) then
  raise exception using errcode='MQ422',message='alternative maxima must be distinct';
 end if;
 options:=jsonb_build_object('method','periodic-sensitivity-v1','source_run_id',p_source_run_id,
  'alternative_maxima',maxima,'reuse_confirmed',true);
 perform pg_advisory_xact_lock(hashtextextended('zeespare.planning:'||p_organization_id::text,0));
 -- A request may have waited while membership or its active-organization scope changed.
 if not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='sensitivity requires an editor';
 end if;
 select * into prior from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if prior.kind<>'simulation' or prior.options<>options then
   raise exception using errcode='MQ409',message='request id already used with different parameters';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
   and not(prior.location_id=any(array(select app.scoped_locations()))) then
   raise exception using errcode='MQ404',message='comparison unavailable';
  end if;
  return prior.id;
 end if;
 select s.* into source from public.policy_simulations s join public.planning_runs r
  on r.organization_id=s.organization_id and r.id=s.run_id
  where s.organization_id=p_organization_id and s.run_id=p_source_run_id
   and r.kind='simulation' and r.status='succeeded' for share of s,r;
 if not found or (not(p_organization_id=any(array(select app.unscoped_organizations())))
   and not(source.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='source simulation unavailable';
 end if;
 if source.evidence->>'method' is distinct from 'periodic-replay-v1'
  or source.evidence#>>'{policy,unit}' is distinct from source.unit
  or source.evidence#>>'{options,history_confirmed}' is distinct from 'true'
  or source.evidence#>>'{options,empty_start_confirmed}' is distinct from 'true'
  or app.simulation_output_valid(source.evidence,source.evidence->'output') is distinct from true then
  raise exception using errcode='MQ422',message='choose a completed original policy simulation';
 end if;
 select code into location_code from public.locations where organization_id=p_organization_id
  and id=source.location_id and is_active;
 if location_code is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
 payload:=(source.evidence-'output')||jsonb_build_object('method','periodic-sensitivity-v1',
  'computed_at',statement_timestamp(),
  'options',((source.evidence->'options')-'alternative_maximum')||options,
  'source_simulation',jsonb_build_object('id',source.id,'run_id',source.run_id,'evidence',source.evidence));
 if octet_length(payload::text)>20000000 then raise exception using errcode='MQ422',message='sensitivity evidence too large'; end if;
 run:=app.planning_enqueue_kind(p_organization_id,location_code,(payload->>'from_date')::date,
  (payload->>'to_date')::date,p_request_id,'simulation',options);
 insert into planning.simulation_inputs(run_id,payload) values(run,payload);
 return run;
end; $function$
;

CREATE OR REPLACE FUNCTION public.stock_region_save(p_organization_id uuid, p_input jsonb, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare input jsonb; report jsonb; previous public.stock_regions; required_ids uuid[]; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='region requires an editor';
  end if;
  input:=app.stock_region_input(p_input);
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid region save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.stock-region:'||p_organization_id::text||':'||p_request_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='region requires an editor';
  end if;
  select * into previous from public.stock_regions where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and not(previous.required_location_ids <@ array(select app.scoped_locations())) then
      raise exception using errcode='MQ404',message='region unavailable';
    end if;
    if previous.submitted_by=auth.uid() and previous.report->'input'=input and previous.report->>'fingerprint'=p_fingerprint then return previous.id; end if;
    raise exception using errcode='MQ409',message='region request conflicts';
  end if;
  report:=public.stock_region_preview(p_organization_id,input);
  select array_agg((v->>'id')::uuid order by (v->>'id')::uuid) into required_ids from jsonb_array_elements(report->'locations') v;
  -- Lock locations before creating a dependent region, matching location deletion order.
  perform 1 from public.locations where organization_id=p_organization_id and id=any(required_ids) order by id for share;
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='region requires an editor';
  end if;
  report:=public.stock_region_preview(p_organization_id,input);
  if required_ids is distinct from
    (select array_agg((v->>'id')::uuid order by (v->>'id')::uuid) from jsonb_array_elements(report->'locations') v)
    or report->>'fingerprint'<>p_fingerprint then
    raise exception using errcode='MQ409',message='region evidence changed';
  end if;
  insert into public.stock_regions(organization_id,required_location_ids,location_codes,name_en,name_ar,request_id,submitted_by,report)
    values(p_organization_id,required_ids,array(select jsonb_array_elements_text(input->'location_codes')),
      input->>'name_en',input->>'name_ar',p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.supplier_portal_accept(p_grant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.supplier_portal_grants; verified_email text;
begin
 perform app.require_user();
 select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 select * into g from public.supplier_portal_grants where id=p_grant_id and revoked_at is null
  and (user_id=auth.uid() or (accepted_at is null and email=verified_email and expires_at>clock_timestamp()));
 if not found then raise exception using errcode='MQ404',message='invitation unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended('zeespare.supplier-portal:'||g.organization_id::text,0));
 select lower(email) into verified_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 select * into g from public.supplier_portal_grants where id=p_grant_id and revoked_at is null for update;
 if not found or verified_email is null or (g.user_id is distinct from auth.uid() and
   (g.accepted_at is not null or g.email is distinct from verified_email or g.expires_at<=clock_timestamp())) then
  raise exception using errcode='MQ404',message='invitation unavailable'; end if;
 perform 1 from public.suppliers where organization_id=g.organization_id and id=g.supplier_id and is_active for share;
 if not found then raise exception using errcode='MQ404',message='supplier unavailable'; end if;
 if g.accepted_at is null then
  update public.supplier_portal_grants set user_id=auth.uid(),accepted_at=clock_timestamp() where id=g.id;
 end if;
end; $function$
;

CREATE OR REPLACE FUNCTION public.supplier_portal_invite(p_organization_id uuid, p_supplier_id uuid, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.supplier_portal_grants; address text:=lower(btrim(p_email));
begin
 perform app.require_role(p_organization_id,array['owner','admin']);
 if address is null or char_length(address)>254 or address !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or address ~ '[[:cntrl:]]' then
  raise exception using errcode='MQ422',message='valid email required'; end if;
 perform app.lock_memberships(p_organization_id);
 perform pg_advisory_xact_lock(hashtextextended('zeespare.supplier-portal:'||p_organization_id::text,0));
 perform app.require_role(p_organization_id,array['owner','admin']);
 perform 1 from public.suppliers where organization_id=p_organization_id and id=p_supplier_id and is_active for share;
 if not found then raise exception using errcode='MQ404',message='supplier unavailable'; end if;
 select * into g from public.supplier_portal_grants where organization_id=p_organization_id and supplier_id=p_supplier_id and email=address and revoked_at is null for update;
 if found then
  if g.accepted_at is not null then return jsonb_build_object('id',g.id,'email',g.email,'send',false); end if;
  if g.sent_at>clock_timestamp()-interval '2 minutes' or g.send_count>=10 then
   raise exception using errcode='MQ429',message='invitation rate limit'; end if;
  update public.supplier_portal_grants set sent_at=clock_timestamp(),expires_at=clock_timestamp()+interval '7 days',send_count=send_count+1 where id=g.id;
 else
  if (select count(*) from public.supplier_portal_grants where organization_id=p_organization_id and created_at>clock_timestamp()-interval '24 hours')>=100 then
   raise exception using errcode='MQ429',message='invitation daily limit'; end if;
  insert into public.supplier_portal_grants(organization_id,supplier_id,email,created_by)
   values(p_organization_id,p_supplier_id,address,auth.uid()) returning * into g;
 end if;
 return jsonb_build_object('id',g.id,'email',g.email,'send',true);
end; $function$
;

CREATE OR REPLACE FUNCTION public.supplier_portal_revoke(p_organization_id uuid, p_grant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform app.require_role(p_organization_id,array['owner','admin']);
 perform app.lock_memberships(p_organization_id);
 perform pg_advisory_xact_lock(hashtextextended('zeespare.supplier-portal:'||p_organization_id::text,0));
 perform 1 from public.supplier_portal_grants where organization_id=p_organization_id and id=p_grant_id for update;
 if not found then raise exception using errcode='MQ404',message='grant unavailable'; end if;
 perform app.require_role(p_organization_id,array['owner','admin']);
 update public.supplier_portal_grants set revoked_at=clock_timestamp(),revoked_by=auth.uid() where id=p_grant_id and revoked_at is null;
end; $function$
;

CREATE OR REPLACE FUNCTION public.supplier_publication_publish(p_organization_id uuid, p_handoff_id uuid, p_confirmed boolean, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h public.purchase_handoffs; result uuid; preview jsonb;
begin
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 if p_confirmed is distinct from true then raise exception using errcode='MQ422',message='sharing confirmation required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('zeespare.purchase-review:'||p_organization_id::text,0));
 perform app.lock_memberships(p_organization_id);
 select * into h from public.purchase_handoffs where organization_id=p_organization_id and id=p_handoff_id
  and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations()))) for share;
 perform app.require_role(p_organization_id,array['owner','admin','planner']);
 if h.id is null then raise exception using errcode='MQ404',message='handoff unavailable'; end if;
 select id into result from public.supplier_publications where organization_id=p_organization_id and handoff_id=p_handoff_id;
 -- A retry never republishes a withdrawn snapshot or refreshes historical values.
 if found then return result; end if;
 preview:=public.supplier_publication_preview(p_organization_id,p_handoff_id);
 if p_fingerprint is null or p_fingerprint is distinct from preview->>'fingerprint' then
  raise exception using errcode='MQ409',message='refresh publication preview'; end if;
 insert into public.supplier_publications(organization_id,handoff_id,supplier_id,location_id,created_by,summary)
 values(p_organization_id,h.id,(h.payload#>>'{estimate,source,supplier_id}')::uuid,h.location_id,auth.uid(),preview->'summary') returning id into result;
 return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.supplier_scenario_save(p_organization_id uuid, p_draft_id uuid, p_supplier_code text, p_terms_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.supplier_scenarios; report jsonb; result uuid;
begin
  if p_organization_id is null or auth.uid() is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='scenario requires an editor';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_supplier_code is null or p_supplier_code!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' or p_terms_confirmed is null then
    raise exception using errcode='MQ422',message='invalid scenario request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.supplier-scenario:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='scenario requires an editor';
  end if;
  select * into previous from public.supplier_scenarios where organization_id=p_organization_id and request_id=p_request_id
    and (organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
  if found then
    if previous.draft_id=p_draft_id and previous.submitted_by=auth.uid() and previous.report->>'fingerprint'=p_fingerprint
      and previous.report->>'requested_supplier_code'=p_supplier_code
      and (previous.report->>'terms_confirmed')::boolean=p_terms_confirmed then return previous.id; end if;
    raise exception using errcode='MQ409',message='scenario request conflicts';
  end if;
  report:=public.supplier_scenario_preview(p_organization_id,p_draft_id,p_supplier_code,p_terms_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='terms changed; refresh preview'; end if;
  insert into public.supplier_scenarios(organization_id,draft_id,location_id,request_id,submitted_by,report)
    values(p_organization_id,p_draft_id,(report->>'location_id')::uuid,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.transfer_date_save(p_organization_id uuid, p_redistribution_id uuid, p_requested_date date, p_calendars_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.transfer_date_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='transfer dates require an editor';
  end if;
  if p_redistribution_id is null or p_requested_date is null or not isfinite(p_requested_date)
    or p_requested_date not between date '1900-01-01' and date '2100-12-31'
    or p_calendars_confirmed is null or p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid transfer date request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.transfer-dates:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='transfer dates require an editor';
  end if;
  select * into previous from public.transfer_date_scenarios where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and (not(previous.location_id=any(array(select app.scoped_locations())))
        or not(previous.source_location_id=any(array(select app.scoped_locations())))) then
      raise exception using errcode='MQ404',message='transfer dates unavailable';
    end if;
    if previous.redistribution_id=p_redistribution_id and previous.submitted_by=auth.uid()
      and previous.report->>'fingerprint'=p_fingerprint
      and (previous.report->>'requested_date')::date=p_requested_date
      and (previous.report->>'calendars_confirmed')::boolean=p_calendars_confirmed then return previous.id; end if;
    raise exception using errcode='MQ409',message='transfer date request conflicts';
  end if;
  report := public.transfer_date_preview(p_organization_id,p_redistribution_id,p_requested_date,p_calendars_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_transfer_needed') then
    raise exception using errcode='MQ422',message='resolve unavailable transfer dates before saving';
  end if;
  insert into public.transfer_date_scenarios(organization_id,redistribution_id,location_id,source_location_id,request_id,submitted_by,report)
    values(p_organization_id,p_redistribution_id,(report->>'location_id')::uuid,(report->>'source_location_id')::uuid,p_request_id,auth.uid(),report)
    returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.transfer_freight_save(p_organization_id uuid, p_scenario_id uuid, p_terms_confirmed boolean, p_request_id uuid, p_fingerprint text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous public.transfer_freight_estimates; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='freight estimates require an editor';
  end if;
  if p_scenario_id is null or p_terms_confirmed is null or p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception using errcode='MQ422',message='invalid freight estimate request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.transfer-freight:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='freight estimates require an editor';
  end if;
  select * into previous from public.transfer_freight_estimates where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if not(p_organization_id=any(array(select app.unscoped_organizations())))
      and (not(previous.location_id=any(array(select app.scoped_locations()))) or not(previous.source_location_id=any(array(select app.scoped_locations())))) then
      raise exception using errcode='MQ404',message='freight estimate unavailable';
    end if;
    if previous.scenario_id=p_scenario_id and previous.submitted_by=auth.uid() and previous.report->>'fingerprint'=p_fingerprint
      and (previous.report->>'terms_confirmed')::boolean=p_terms_confirmed then return previous.id; end if;
    raise exception using errcode='MQ409',message='freight estimate request conflicts';
  end if;
  report := public.transfer_freight_preview(p_organization_id,p_scenario_id,p_terms_confirmed);
  if report->>'fingerprint'<>p_fingerprint then raise exception using errcode='MQ409',message='inputs changed; refresh preview'; end if;
  if report->>'status' not in ('available','no_transfer_needed') then raise exception using errcode='MQ422',message='resolve unavailable freight inputs before saving'; end if;
  insert into public.transfer_freight_estimates(organization_id,scenario_id,location_id,source_location_id,request_id,submitted_by,report)
    values(p_organization_id,p_scenario_id,(report->>'location_id')::uuid,(report->>'source_location_id')::uuid,p_request_id,auth.uid(),report) returning id into result;
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.transfer_handoff_batch_create(p_organization_id uuid, p_handoff_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare report jsonb; ids uuid[]; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb;
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='batch requires an editor';
  end if;
  -- Serializes set retries and proposal selection changes. Preview rechecks authority after waiting.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.transfer-review:'||p_organization_id::text,0));
  report:=public.transfer_handoff_batch_preview(p_organization_id,p_handoff_ids);
  if report->>'existing_batch_id' is not null then return (report->>'existing_batch_id')::uuid; end if;
  select array_agg(id order by id) into ids from unnest(p_handoff_ids) id;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','transfer-handoff-batch-v1','purpose','planning_only',
    'notice','As-of planning package only. Overlapping packages may contain the same lines. Each line retains its own freight charge. No consolidation, reservation, transfer order or inbound quantity.',
    'batch_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'summary',report->'summary','lines',report->'lines');
  insert into public.transfer_handoff_batches(id,organization_id,location_id,source_location_id,handoff_ids,created_by,created_at,payload)
    values(result,p_organization_id,(report#>>'{summary,location_id}')::uuid,(report#>>'{summary,source_location_id}')::uuid,ids,auth.uid(),captured,snapshot);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.transfer_handoff_create(p_organization_id uuid, p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.transfer_proposals; estimate public.transfer_freight_estimates;
  existing uuid; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb; current_freight jsonb;
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='transfer handoff requires an editor';
  end if;
  if p_proposal_id is null then raise exception using errcode='MQ422',message='proposal required'; end if;
  -- Share review's lock so a new approved selection cannot race export creation.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.transfer-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='transfer handoff requires an editor';
  end if;
  select * into proposal from public.transfer_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations())) or
      (location_id=any(array(select app.scoped_locations())) and source_location_id=any(array(select app.scoped_locations()))));
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  select id into existing from public.transfer_handoffs where organization_id=p_organization_id and proposal_id=p_proposal_id;
  -- Retry authority is live; an existing snapshot is never recreated/reinterpreted.
  if found then return existing; end if;
  if proposal.status<>'approved' or exists(select 1 from public.transfer_proposals
    where organization_id=p_organization_id and draft_id=proposal.draft_id and status='approved' and revision>proposal.revision) then
    raise exception using errcode='MQ409',message='selected approval required',hint='transfer_selection_changed';
  end if;
  select * into estimate from public.transfer_freight_estimates where organization_id=p_organization_id and id=proposal.estimate_id
    and location_id=proposal.location_id and source_location_id=proposal.source_location_id;
  if not found or estimate.report->>'status' is distinct from 'available' or coalesce((estimate.report#>>'{source,source,quantity}')::numeric,0)<=0 then
    raise exception using errcode='MQ422',message='available positive estimate required';
  end if;
  if estimate.report#>'{source,receipts,p50,timing_review_required}' is distinct from 'false'::jsonb
    or estimate.report#>'{source,receipts,p90,timing_review_required}' is distinct from 'false'::jsonb then
    raise exception using errcode='MQ422',message='transfer timing review required',hint='transfer_timing_required';
  end if;
  current_freight:=public.transfer_freight_preview(p_organization_id,estimate.scenario_id,true);
  if current_freight->>'status' is distinct from 'available' or current_freight->>'fingerprint' is distinct from estimate.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='freight evidence changed',hint='transfer_freight_changed';
  end if;
  captured:=clock_timestamp();
  snapshot:=jsonb_build_object('schema_version','transfer-handoff-v1','purpose','planning_only',
    'notice','As-of planning evidence only. Not a stock reservation, transfer order, inbound quantity or arrival guarantee.',
    'handoff_id',result,'organization_id',p_organization_id,'created_by',auth.uid(),
    'created_at',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'proposal',jsonb_build_object('id',proposal.id,'revision',proposal.revision,'estimate_id',estimate.id,'redistribution_id',proposal.draft_id,
      'submitted_by',proposal.submitted_by,'submitted_at',proposal.created_at,'reason',proposal.reason,
      'approved_by',proposal.decided_by,'approved_at',proposal.decided_at,'approval_reason',proposal.decision_reason),
    'estimate',estimate.report);
  insert into public.transfer_handoffs(id,organization_id,proposal_id,location_id,source_location_id,created_by,created_at,payload)
    values(result,p_organization_id,proposal.id,proposal.location_id,proposal.source_location_id,auth.uid(),captured,snapshot);
  return result;
end; $function$
;

CREATE OR REPLACE FUNCTION public.transfer_proposal_decide(p_organization_id uuid, p_proposal_id uuid, p_request_id uuid, p_decision text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.transfer_proposals; source public.transfer_freight_estimates; current_freight jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='transfer decision requires membership';
  end if;
  if p_request_id is null or p_decision is null or p_decision not in ('approved','rejected','withdrawn') or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid transfer decision';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.transfer-review:'||p_organization_id::text,0));
  if not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ403',message='transfer decision requires membership';
  end if;
  select * into proposal from public.transfer_proposals where organization_id=p_organization_id and id=p_proposal_id
    and (organization_id=any(array(select app.unscoped_organizations())) or (location_id=any(array(select app.scoped_locations())) and source_location_id=any(array(select app.scoped_locations())))) for update;
  if not found then raise exception using errcode='MQ404',message='proposal unavailable'; end if;
  if p_decision='withdrawn' then
    if proposal.submitted_by<>auth.uid() then raise exception using errcode='MQ403',message='only the author may withdraw'; end if;
  elsif proposal.submitted_by=auth.uid() or not(p_organization_id=any(array(select app.approving_organizations()))) then
    raise exception using errcode='MQ403',message='independent reviewer required';
  end if;
  if proposal.status<>'pending' then
    if proposal.decision_request_id=p_request_id and proposal.decided_by=auth.uid() and proposal.status=p_decision and proposal.decision_reason=why then return proposal.id; end if;
    raise exception using errcode='MQ409',message='proposal already decided';
  end if;
  if exists(select 1 from public.transfer_proposals where organization_id=p_organization_id and decision_request_id=p_request_id) then
    raise exception using errcode='MQ409',message='decision request conflicts';
  end if;
  if p_decision='approved' then
    select * into source from public.transfer_freight_estimates where organization_id=p_organization_id and id=proposal.estimate_id;
    if source.report#>'{source,receipts,p50,timing_review_required}' is distinct from 'false'::jsonb
      or source.report#>'{source,receipts,p90,timing_review_required}' is distinct from 'false'::jsonb then
      raise exception using errcode='MQ422',message='transfer timing review required',hint='transfer_timing_required';
    end if;
    current_freight:=public.transfer_freight_preview(p_organization_id,source.scenario_id,true);
    if current_freight->>'status' is distinct from 'available' or current_freight->>'fingerprint' is distinct from source.report->>'fingerprint' then
      raise exception using errcode='MQ409',message='freight evidence changed',hint='transfer_freight_changed';
    end if;
  end if;
  update public.transfer_proposals set status=p_decision,decided_by=auth.uid(),decided_at=clock_timestamp(),decision_reason=why,decision_request_id=p_request_id where id=proposal.id;
  return proposal.id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.transfer_proposal_submit(p_organization_id uuid, p_estimate_id uuid, p_request_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source public.transfer_freight_estimates; previous public.transfer_proposals; result uuid; sequence integer; original_draft uuid; current_freight jsonb;
  why text:=regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='transfer proposal requires an editor';
  end if;
  if p_request_id is null or p_estimate_id is null or why is null or length(why) not between 1 and 2000 then
    raise exception using errcode='MQ422',message='invalid transfer proposal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('zeespare.transfer-review:'||p_organization_id::text,0));
  -- A waiter must use current membership and location access, including on replay.
  if not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='transfer proposal requires an editor';
  end if;
  select * into source from public.transfer_freight_estimates where organization_id=p_organization_id and id=p_estimate_id
    and (organization_id=any(array(select app.unscoped_organizations())) or (location_id=any(array(select app.scoped_locations())) and source_location_id=any(array(select app.scoped_locations()))));
  if not found then raise exception using errcode='MQ404',message='estimate unavailable'; end if;
  select * into previous from public.transfer_proposals where organization_id=p_organization_id and request_id=p_request_id;
  if found then
    if previous.estimate_id=p_estimate_id and previous.submitted_by=auth.uid() and previous.reason=why then return previous.id; end if;
    raise exception using errcode='MQ409',message='proposal request conflicts';
  end if;
  if source.report->>'status' is distinct from 'available' or coalesce((source.report#>>'{source,source,quantity}')::numeric,0)<=0 then
    raise exception using errcode='MQ422',message='choose an available positive estimate';
  end if;
  -- Derive lineage from saved rows, never from a client-supplied draft/location.
  select d.redistribution_id into original_draft from public.transfer_date_scenarios d
    join public.redistribution_drafts r on r.organization_id=d.organization_id and r.id=d.redistribution_id
      and r.location_id=d.location_id and r.source_location_id=d.source_location_id
    where d.organization_id=p_organization_id and d.id=source.scenario_id
      and d.location_id=source.location_id and d.source_location_id=source.source_location_id;
  if original_draft is null then raise exception using errcode='MQ422',message='source lineage unavailable'; end if;
  current_freight:=public.transfer_freight_preview(p_organization_id,source.scenario_id,true);
  if current_freight->>'status' is distinct from 'available' or current_freight->>'fingerprint' is distinct from source.report->>'fingerprint' then
    raise exception using errcode='MQ409',message='freight evidence changed',hint='transfer_freight_changed';
  end if;
  if exists(select 1 from public.transfer_proposals where draft_id=original_draft and status='pending') then
    raise exception using errcode='MQ409',message='draft has a pending proposal',hint='transfer_pending';
  end if;
  select coalesce(max(revision),0)+1 into sequence from public.transfer_proposals where draft_id=original_draft;
  insert into public.transfer_proposals(organization_id,estimate_id,draft_id,location_id,source_location_id,revision,request_id,submitted_by,reason)
    values(p_organization_id,source.id,original_draft,source.location_id,source.source_location_id,sequence,p_request_id,auth.uid(),why) returning id into result;
  return result;
end; $function$
;

comment on function public.create_api_key(uuid,text,text[],integer,bytea,text,text) is
  'Owner or admin creates an API key from its SHA-256 (p_key_hash, 32 bytes), display prefix (zeespare_sk_ + 4) and last 4 characters; the name is trimmed, scopes are stored sorted and distinct, expires_at = now() + p_expires_in_days (1-366). MQ401 signed out; MQ403 role (not an owner or admin); MQ404 organization_id (the active organization is another one); MQ422 name/scopes/expires_in_days/key_hash/display_prefix/last4; MQ409 api_keys (20 active keys) or key_hash (duplicate). Returns the key id.';

reset lock_timeout;
