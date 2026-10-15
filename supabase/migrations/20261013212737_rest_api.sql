-- Step 5b: REST API (per-organization API keys, /api/v1 lists and bulk upserts over the 5a pipeline).
--
-- * public.api_keys stores only the SHA-256 of each key (computed in the Worker; the plaintext never
--   reaches Postgres), a display prefix and the last four characters. Owners and admins create and
--   revoke keys through create_api_key / revoke_api_key and read them through the "admins read"
--   policy; key_hash is not granted to any API role (column-level SELECT). Keys are revoked, never
--   hard-deleted (an organization delete cascades). A key works only while it is not revoked, not
--   expired and its creator is still an owner or admin of the organization.
-- * The /api/v1 route handlers call four RPCs with the secret key (service_role only):
--   api_organization, api_list, api_list_demand and api_upsert. Each authorizes the key first
--   (app.api_authorize) and takes the organization only from the key; every statement filters
--   organization_id explicitly. Static SQL only: no api_* body runs dynamic SQL.
-- * api_upsert runs one request in one transaction over the unchanged 5a helpers: field-set check,
--   the 5a import lock (try, never wait), sweep, the daily cap, then in an inner block a batch
--   (source api) and one file (extension json), staging, the cell, reference, row and set rules, and
--   app.import_commit_atomic. A write that fails validation, fails at commit or changes nothing is
--   rolled back completely by an internal SQLSTATE MQ499 that never leaves the function; only writes
--   that changed data stay as import_batches rows (expires_at null, created_by null).
-- * API writes set maqdar.import_analyze = skip_locked for the call (set_config, restored before
--   api_upsert returns), so app.import_prepare_stats and app.import_analyze_demand_months run
--   ANALYZE (SKIP_LOCKED) and never wait for another organization's ANALYZE; the wizard (setting
--   unset) keeps the blocking ANALYZE.
-- * app.import_drop_staging deletes by ctid: its 5a semi-join turned quadratic once VACUUM left the
--   emptied staging table with reltuples = 0 (API writes never analyze ingest.staged_rows).
-- * Lists are built in SQL as rows of the composite types ingest.api_record_<entity> (contract columns
--   in position order, plus updated_at for master data; a DO block fails on drift from
--   ingest.contract_columns): decimals and money as canonical strings (trim_scale), weekdays as sorted
--   integer arrays, dates and booleans native, references as codes. Master lists page by id; demand
--   lists page in key order inside a required date range. Cursors are opaque base64url JSON, checked
--   in SQL against the filters they were issued for.

set lock_timeout = '5s';

------------------------------------------------------------------------------------------------
-- api_keys
------------------------------------------------------------------------------------------------

create table public.api_keys (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  display_prefix text not null check (display_prefix ~ '^maqdar_sk_[0-9A-Za-z]{4}$'),
  last4 text not null check (last4 ~ '^[0-9A-Za-z]{4}$'),
  key_hash bytea not null check (octet_length(key_hash) = 32),
  scopes text[] not null check (cardinality(scopes) between 1 and 4 and scopes <@ array[
    'master_data:read', 'master_data:write', 'transactions:read', 'transactions:write']::text[]),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  primary key (id),
  unique (organization_id, id),
  constraint api_keys_key_hash_key unique (key_hash),
  constraint api_keys_expiry_check check (expires_at > created_at and expires_at <= created_at + interval '366 days'),
  constraint api_keys_revoked_check check (revoked_by is null or revoked_at is not null)
);
comment on table public.api_keys is 'REST API keys per organization. Only the SHA-256 of a key is stored (key_hash, never selectable by an API role); display_prefix and last4 identify it in Settings. Written only through create_api_key and revoke_api_key (owners and admins); read by owners and admins. Active = not revoked and not expired; a key also stops working when its creator is no longer an owner or admin.';
comment on column public.api_keys.key_hash is 'SHA-256 of the full key (maqdar_sk_ + 43 base62 characters + a 6-character base62 CRC32), computed in the Worker. Not granted to any API role.';
comment on column public.api_keys.last_used_at is 'Last successful authorization, updated at most once a minute.';
create index api_keys_list_idx on public.api_keys (organization_id, created_at desc);
create index api_keys_created_by_idx on public.api_keys (created_by);
create trigger api_keys_set_updated_at
  before update on public.api_keys
  for each row execute function app.set_updated_at();

alter table public.api_keys enable row level security;
revoke all on public.api_keys from public, anon, authenticated, service_role;
grant select (id, organization_id, name, display_prefix, last4, scopes, created_by, created_at, updated_at,
              expires_at, last_used_at, revoked_at, revoked_by) on public.api_keys to authenticated;
create policy "admins read" on public.api_keys for select to authenticated
  using (organization_id = any (array(select app.admin_organizations())));

------------------------------------------------------------------------------------------------
-- import_batches and import_files: API batches
------------------------------------------------------------------------------------------------

alter table public.import_batches
  add column api_key_id uuid,
  add column api_request_id uuid,
  add constraint import_batches_api_key_fkey foreign key (organization_id, api_key_id)
    references public.api_keys (organization_id, id) on delete set null (api_key_id),
  add constraint import_batches_api_columns_check check (source = 'api' or (api_key_id is null and api_request_id is null));
comment on table public.import_batches is 'One import: files staged, validated and committed together. id is generated by the client so creation is retry-safe (source wizard); source api batches are written by public.api_upsert and exist only for writes that changed data. Written only through the import_* and api_upsert RPCs; readable by owners, admins and planners.';
comment on column public.import_batches.api_key_id is 'The API key that made this write (source api); null for the wizard and after the key is deleted with its organization.';
comment on column public.import_batches.api_request_id is 'The X-Request-Id of the API request that made this write (source api).';
-- The daily cap of recorded API writes per organization.
create index import_batches_api_recent_idx on public.import_batches (organization_id, created_at) where source = 'api';

alter table public.import_files drop constraint import_files_extension_check;
alter table public.import_files
  add constraint import_files_extension_check check (extension in ('csv', 'tsv', 'txt', 'xlsx', 'json'));

------------------------------------------------------------------------------------------------
-- List records: one composite type per contract entity, guarded against drift
------------------------------------------------------------------------------------------------

create type ingest.api_record_work_calendars as (
  work_calendar_code text, name_en text, name_ar text, country_code text, weekend_days smallint[],
  observe_public_holidays boolean, is_active boolean, updated_at text);
create type ingest.api_record_holiday_overrides as (
  country_code text, work_calendar_code text, starts_on date, ends_on date, kind text, name_en text, name_ar text,
  note text, updated_at text);
create type ingest.api_record_locations as (
  location_code text, name_en text, name_ar text, location_type text, country_code text, city text, latitude text,
  longitude text, timezone text, parent_location_code text, is_active boolean, work_calendar_code text, updated_at text);
create type ingest.api_record_network_links as (
  from_location_code text, to_location_code text, lead_time_days_p50 integer, lead_time_days_p90 integer,
  freight_basis text, freight_cost text, currency text, is_active boolean, updated_at text);
create type ingest.api_record_brands as (
  brand_code text, name_en text, name_ar text, brand_type text, country_of_origin text, is_active boolean, updated_at text);
create type ingest.api_record_items as (
  item_code text, name_en text, name_ar text, brand_code text, product_group text, unit_of_measure text, unit_cost text,
  currency text, status text, introduced_on date, discontinued_on date, updated_at text);
create type ingest.api_record_item_supersessions as (
  predecessor_item_code text, successor_item_code text, effective_on date, quantity_factor text, note text, updated_at text);
create type ingest.api_record_item_interchanges as (
  item_code text, alternate_item_code text, direction text, priority integer, note text, updated_at text);
create type ingest.api_record_suppliers as (
  supplier_code text, name_en text, name_ar text, country_code text, currency text, lead_time_days_p50 integer,
  lead_time_days_p90 integer, is_active boolean, work_calendar_code text, updated_at text);
create type ingest.api_record_supplier_items as (
  supplier_code text, item_code text, supplier_part_number text, lead_time_days integer, lead_time_days_p90 integer,
  min_order_quantity text, pack_size text, unit_price text, currency text, is_preferred boolean, valid_from date,
  updated_at text);
create type ingest.api_record_fx_rates as (
  from_currency text, to_currency text, valid_from date, rate text, note text, updated_at text);
create type ingest.api_record_demand_history as (
  item_code text, location_code text, demand_date date, quantity text, lost_sales_quantity text);

revoke all on type ingest.api_record_work_calendars, ingest.api_record_holiday_overrides, ingest.api_record_locations,
  ingest.api_record_network_links, ingest.api_record_brands, ingest.api_record_items, ingest.api_record_item_supersessions,
  ingest.api_record_item_interchanges, ingest.api_record_suppliers, ingest.api_record_supplier_items,
  ingest.api_record_fx_rates, ingest.api_record_demand_history
  from public;

-- Entities whose record type differs from the contract (attribute names, order and types: text for
-- every kind except integer, boolean, date and weekdays (smallint[]), plus updated_at text for master
-- data), or record types without an entity. Null when they all match.
create or replace function app.api_record_type_drift()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with expected as (
    select c.entity, array_agg(c.name || ' ' || c.type_name order by c.pos) as attrs
    from (
      select x.entity, x.position::integer as pos, x.name,
             case x.kind when 'integer' then 'integer' when 'boolean' then 'boolean' when 'date' then 'date'
                         when 'weekdays' then 'smallint[]' else 'text' end as type_name
      from ingest.contract_columns x
      union all
      select e.entity, 1000, 'updated_at', 'text'
      from ingest.contract_entities e
      where e.entity <> 'demand_history'
    ) as c
    group by c.entity
  ), actual as (
    select substr(t.typname, 12) as entity,
           array_agg(a.attname || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod) order by a.attnum) as attrs
    from pg_catalog.pg_type t
    join pg_catalog.pg_class r on r.oid = t.typrelid and r.relkind = 'c'
    join pg_catalog.pg_attribute a on a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped
    where t.typnamespace = 'ingest'::regnamespace and t.typname like 'api\_record\_%'
    group by t.typname
  )
  select string_agg(coalesce(e.entity, a.entity), ', ' order by coalesce(e.entity, a.entity))
  from expected e
  full join actual a on a.entity = e.entity
  where e.attrs is distinct from a.attrs;
$$;
comment on function app.api_record_type_drift() is 'Entities whose ingest.api_record_<entity> type does not match ingest.contract_columns (plus updated_at for master data), or null. The migration fails when it is not null; pgTAP calls it too.';

do $$
declare
  v_bad text := app.api_record_type_drift();
begin
  if v_bad is not null then
    raise exception 'the API record types do not match the import contract: %', v_bad;
  end if;
end
$$;

------------------------------------------------------------------------------------------------
-- 5a helpers: ANALYZE (SKIP_LOCKED) when maqdar.import_analyze = skip_locked (API writes), and a
-- staging cleanup that does not depend on the staging table's statistics
------------------------------------------------------------------------------------------------

-- ANALYZE the target tables whose statistics look stale (never analyzed but not empty, grown by
-- more than 20 % since the last analyze, or more than 10 % modified) or of which this batch inserted
-- more than 10 %. Merges and reference checks join on these tables; stale statistics once turned a
-- 14 s load into 724 s. The size check needs no pgstat flush, which lags a commit by seconds.
-- API writes (maqdar.import_analyze = skip_locked, set by public.api_upsert for its call) skip a table another
-- session is analyzing instead of waiting for it.
create or replace function app.import_prepare_stats(p_batch_id uuid, p_entities text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text;
  v_reltuples real;
  v_relpages integer;
  v_pages bigint;
  v_modified bigint;
  v_inserted bigint;
  v_counts jsonb;
  v_done text[] := '{}';
  v_skip boolean := coalesce(current_setting('maqdar.import_analyze', true), '') = 'skip_locked';
begin
  select b.counts into v_counts from public.import_batches b where b.id = p_batch_id;
  for v_entity in
    select distinct x from unnest(p_entities) as x
    where x in ('work_calendars', 'holiday_overrides', 'locations', 'network_links', 'brands', 'items', 'item_supersessions',
                'item_interchanges', 'suppliers', 'supplier_items', 'fx_rates')
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
          when 'fx_rates' then analyze public.fx_rates;
        end case;
      end if;
      v_done := v_done || ('public.' || v_entity);
    end if;
  end loop;
  return v_done;
end;
$$;

-- ANALYZE the demand partitions overlapping [p_first, p_last] whose statistics are stale (never
-- analyzed but not empty, or grown by more than 20 % since the last analyze). Demand probes and the
-- MERGE join on one month partition; with a stale partition (say 21,000 rows that the statistics
-- still count as none) the planner reads the organization's whole month once per source row
-- (measured: 21 s for 20,000 unchanged rows, 0.7 s once analyzed). Never the 96-partition parent.
-- The partition names come from the catalog (regclass), never from input. API writes
-- (maqdar.import_analyze = skip_locked) use ANALYZE (SKIP_LOCKED).
create or replace function app.import_analyze_demand_months(p_first date, p_last date)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partition regclass;
  v_done text[] := '{}';
  v_skip boolean := coalesce(current_setting('maqdar.import_analyze', true), '') = 'skip_locked';
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
$$;

-- Deletes up to p_max_rows staged rows of a batch; once none are left, its chunks and pending
-- errors too, and records staging_cleared_at. Returns the rows deleted.
-- The rows are deleted by ctid (a TID scan whatever the statistics say). The Step 5a form, a
-- semi-join with the limited subquery, became a nested loop quadratic in the rows of the batch
-- whenever VACUUM had left the emptied staging table with reltuples = 0 and the batch's rows were
-- never analyzed (API writes, imports canceled before seal): 11.9 s for 5,000 rows, 32 ms now for
-- 20,000.
create or replace function app.import_drop_staging(p_batch_id uuid, p_max_rows integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from ingest.staged_rows s
  where s.ctid = any (array(
      select r.ctid from ingest.staged_rows r
      where r.batch_id = p_batch_id
      limit greatest(p_max_rows, 0)));
  get diagnostics v_n = row_count;
  if v_n < p_max_rows then
    delete from ingest.staged_chunks c where c.batch_id = p_batch_id;
    delete from ingest.pending_errors e where e.batch_id = p_batch_id;
    update public.import_batches b set staging_cleared_at = now()
    where b.id = p_batch_id and b.staging_cleared_at is null;
  end if;
  return v_n;
end;
$$;

------------------------------------------------------------------------------------------------
-- Internal API helpers (no API role may run them)
------------------------------------------------------------------------------------------------

-- The key behind a hash, refused with MQ401 (hint api_key, revoked, expired or creator_inactive)
-- or MQ403 (hint scope) when p_scope is not null and the key lacks it. Records last_used_at at most
-- once a minute without waiting for a concurrent request of the same key.
create or replace function app.api_authorize(p_key_hash bytea, p_scope text)
returns table (organization_id uuid, api_key_id uuid, scopes text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys;
begin
  if p_key_hash is null or octet_length(p_key_hash) <> 32 then
    raise exception using errcode = 'MQ401', message = 'invalid API key', hint = 'api_key';
  end if;
  select * into v_key from public.api_keys k where k.key_hash = p_key_hash;
  if v_key.id is null then
    raise exception using errcode = 'MQ401', message = 'invalid API key', hint = 'api_key';
  end if;
  if v_key.revoked_at is not null then
    raise exception using errcode = 'MQ401', message = 'this API key was revoked', hint = 'revoked';
  end if;
  if v_key.expires_at <= now() then
    raise exception using errcode = 'MQ401', message = 'this API key has expired', hint = 'expired';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.organization_id = v_key.organization_id and m.user_id = v_key.created_by and m.role in ('owner', 'admin')
  ) then
    raise exception using errcode = 'MQ401',
      message = 'the creator of this API key is no longer an owner or admin of the organization', hint = 'creator_inactive';
  end if;
  if p_scope is not null and not (p_scope = any (v_key.scopes)) then
    raise exception using errcode = 'MQ403', message = format('this API key lacks the %s scope', p_scope), hint = 'scope';
  end if;
  update public.api_keys k
  set last_used_at = now()
  where k.id = (select x.id from public.api_keys x
                where x.id = v_key.id and (x.last_used_at is null or x.last_used_at < now() - interval '1 minute')
                for no key update skip locked);
  return query select v_key.organization_id, v_key.id, v_key.scopes;
end;
$$;
comment on function app.api_authorize(bytea, text) is 'Authorizes an API key hash for a scope (null = any valid key): MQ401 api_key/revoked/expired/creator_inactive, MQ403 scope. Returns the organization, the key id and its scopes.';

-- The API limits as GET /organization reports them (api_organization embeds this value, key order
-- included). api_check_fields takes the record caps from here. The same object is
-- supabase/tests/fixtures/api_limits.json and organizationLimits() in apps/web/src/lib/api/limits.ts
-- (a Vitest test compares them); change all three together.
create or replace function app.api_limits()
returns json
language sql
immutable
parallel safe
set search_path = ''
as $$
  select '{"body_bytes": 1048576, "upsert_records": {"master_data": 1000, "demand_history": 2500}, "list_limit": {"master_data": 1000, "demand_history": 5000}, "list_default_limit": {"master_data": 100, "demand_history": 1000}, "demand_list_days": 366, "recorded_writes_per_day": 5000, "active_keys": 20}'::json;
$$;
comment on function app.api_limits() is 'The API limits reported by api_organization: {body_bytes, upsert_records {master_data, demand_history}, list_limit {...}, list_default_limit {...}, demand_list_days, recorded_writes_per_day, active_keys}. api_check_fields reads its record caps from upsert_records. Mirrored by supabase/tests/fixtures/api_limits.json and organizationLimits() in apps/web/src/lib/api/limits.ts.';

-- SQL backstop of the Worker's request checks: the body is {"records": [1..cap objects]}, every
-- record has the same fields (updated_at ignored for master data; the holiday scope pair counts as
-- always provided), every field is a contract column, the natural key is present, column groups are
-- all or none, demand provides quantity or lost_sales_quantity, and every value has a JSON type its
-- kind accepts. MQ422 hint records, detail {code, record, field[, limit]}. Returns the provided
-- columns in contract order.
create or replace function app.api_check_fields(p_entity text, p_body jsonb)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contract ingest.contract_entities;
  v_cap integer := (app.api_limits() -> 'upsert_records'
                    ->> case when p_entity = 'demand_history' then 'demand_history' else 'master_data' end)::integer;
  v_master boolean := p_entity is distinct from 'demand_history';
  v_scope text[] := case when p_entity = 'holiday_overrides' then array['country_code', 'work_calendar_code'] else '{}'::text[] end;
  v_records jsonb;
  v_keys text[];
  v_columns text[];
  v_record integer;
  v_field text;
begin
  select * into v_contract from ingest.contract_entities e where e.entity = p_entity;
  if v_contract.entity is null then
    raise exception using errcode = 'MQ404', message = 'no such resource', hint = 'resource';
  end if;

  if p_body is null or jsonb_typeof(p_body) <> 'object' then
    raise exception using errcode = 'MQ422', message = 'the body is a JSON object with one member, records', hint = 'records',
      detail = jsonb_build_object('code', 'not_an_object')::text;
  end if;
  select k into v_field from jsonb_object_keys(p_body) as k where k <> 'records' order by k limit 1;
  if v_field is not null then
    raise exception using errcode = 'MQ422', message = format('%s is not a member of the body', left(v_field, 64)), hint = 'records',
      detail = jsonb_build_object('code', 'unknown_field', 'field', left(v_field, 64))::text;
  end if;
  v_records := p_body -> 'records';
  if v_records is null or jsonb_typeof(v_records) <> 'array' or jsonb_array_length(v_records) = 0 then
    raise exception using errcode = 'MQ422', message = format('records is an array of 1 to %s records', v_cap), hint = 'records',
      detail = jsonb_build_object('code', 'missing_records')::text;
  end if;
  if jsonb_array_length(v_records) > v_cap then
    raise exception using errcode = 'MQ422', message = format('at most %s records per request', v_cap), hint = 'records',
      detail = jsonb_build_object('code', 'too_many_records', 'limit', v_cap)::text;
  end if;

  select (e.ord - 1)::integer into v_record
  from jsonb_array_elements(v_records) with ordinality as e(r, ord)
  where jsonb_typeof(e.r) <> 'object'
  order by e.ord
  limit 1;
  if v_record is not null then
    raise exception using errcode = 'MQ422', message = format('record %s is not an object', v_record), hint = 'records',
      detail = jsonb_build_object('code', 'not_an_object', 'record', v_record)::text;
  end if;

  -- One field set per request: compared with the first record.
  v_keys := array(select k from jsonb_object_keys(v_records -> 0) as k
                  where not (v_master and k = 'updated_at') and not (k = any (v_scope))
                  order by k);
  select (r.ord - 1)::integer,
         coalesce((select k from unnest(r.keys) as k where not (k = any (v_keys)) order by k limit 1),
                  (select k from unnest(v_keys) as k where not (k = any (r.keys)) order by k limit 1))
    into v_record, v_field
  from (
    select e.ord,
           array(select k from jsonb_object_keys(e.r) as k
                 where not (v_master and k = 'updated_at') and not (k = any (v_scope))
                 order by k) as keys
    from jsonb_array_elements(v_records) with ordinality as e(r, ord)
  ) as r
  where r.keys is distinct from v_keys
  order by r.ord
  limit 1;
  if v_record is not null then
    raise exception using errcode = 'MQ422',
      message = format('record %s does not have the same fields as record 0 (%s)', v_record, left(v_field, 64)), hint = 'records',
      detail = jsonb_build_object('code', 'inconsistent_fields', 'record', v_record, 'field', left(v_field, 64))::text;
  end if;

  select k into v_field
  from unnest(v_keys) as k
  where not exists (select 1 from ingest.contract_columns c where c.entity = p_entity and c.name = k)
  order by k
  limit 1;
  if v_field is not null then
    raise exception using errcode = 'MQ422', message = format('%s is not a field of %s', left(v_field, 64), p_entity), hint = 'records',
      detail = jsonb_build_object('code', 'unknown_field', 'record', 0, 'field', left(v_field, 64))::text;
  end if;

  select x.n into v_field
  from unnest(v_contract.natural_key) with ordinality as x(n, o)
  where not (x.n = any (v_keys)) and not (x.n = any (v_scope))
  order by x.o
  limit 1;
  if v_field is not null then
    raise exception using errcode = 'MQ422', message = format('every record needs the key field %s', v_field), hint = 'records',
      detail = jsonb_build_object('code', 'missing_key_field', 'record', 0, 'field', v_field)::text;
  end if;

  select (select m from jsonb_array_elements_text(g.members) with ordinality as y(m, o)
          where not (y.m = any (v_keys)) order by y.o limit 1)
    into v_field
  from jsonb_array_elements(v_contract.column_groups) with ordinality as g(members, o)
  where (select count(*) from jsonb_array_elements_text(g.members) as y(m) where y.m = any (v_keys))
        not in (0, jsonb_array_length(g.members))
  order by g.o
  limit 1;
  if v_field is not null then
    raise exception using errcode = 'MQ422', message = format('the fields of a group are sent together or not at all (%s)', v_field),
      hint = 'records', detail = jsonb_build_object('code', 'incomplete_group', 'record', 0, 'field', v_field)::text;
  end if;

  if p_entity = 'demand_history' and not (v_keys && array['quantity', 'lost_sales_quantity']) then
    raise exception using errcode = 'MQ422', message = 'demand records need quantity, lost_sales_quantity or both', hint = 'records',
      detail = jsonb_build_object('code', 'value_field_required', 'record', 0, 'field', 'quantity')::text;
  end if;

  v_columns := array(select c.name from ingest.contract_columns c
                     where c.entity = p_entity and (c.name = any (v_keys) or c.name = any (v_scope))
                     order by c.position);

  -- JSON types: null everywhere; a string for the text-like kinds and integer, decimal and money;
  -- "" for every kind; a number for integer, decimal and money; true or false for boolean; an array
  -- of numbers for weekdays.
  select (e.ord - 1)::integer, c.name into v_record, v_field
  from jsonb_array_elements(v_records) with ordinality as e(r, ord)
  join ingest.contract_columns c on c.entity = p_entity and c.name = any (v_columns)
  where not (case jsonb_typeof(e.r -> c.name)
               when 'null' then true
               when 'string' then c.kind not in ('boolean', 'weekdays') or (e.r ->> c.name) = ''
               when 'number' then c.kind in ('integer', 'decimal', 'money')
               when 'boolean' then c.kind = 'boolean'
               when 'array' then c.kind = 'weekdays'
                                 and not exists (select 1 from jsonb_array_elements(e.r -> c.name) as a(v)
                                                 where jsonb_typeof(a.v) <> 'number')
               when 'object' then false
               else true
             end)
  order by e.ord, c.position
  limit 1;
  if v_record is not null then
    raise exception using errcode = 'MQ422', message = format('record %s: %s has a JSON type its field does not accept', v_record, v_field),
      hint = 'records', detail = jsonb_build_object('code', 'invalid_type', 'record', v_record, 'field', v_field)::text;
  end if;

  return v_columns;
end;
$$;
comment on function app.api_check_fields(text, jsonb) is 'Request-shape backstop for api_upsert: MQ422 hint records with detail {code, record, field[, limit]} (codes not_an_object, unknown_field, missing_records, too_many_records, inconsistent_fields, missing_key_field, incomplete_group, value_field_required, invalid_type). Returns the provided contract columns in position order.';

-- Stages the records of an API batch (file 1) as contract cells: NULL for columns the request does
-- not provide, '' for null or "", the string as sent, an integer-kind number as its plain digits
-- (3.0 gives 3), a decimal or money number as its exact JSON digits (jsonb keeps them), true or
-- false, weekdays joined with ';'. Duplicate keys become duplicate_key errors (detail first_row),
-- like import_stage_chunk. Never touches expires_at. Returns the rows staged.
create or replace function app.api_stage_records(p_batch_id uuid, p_records jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_entity text;
  v_columns text[];
  v_staged integer;
begin
  select f.organization_id, f.entity, f.columns into v_org, v_entity, v_columns
  from public.import_files f
  where f.batch_id = p_batch_id and f.file_no = 1;

  with src as materialized (
    select e.ord::integer as row_no, x.cells, app.import_nk(v_entity, x.cells) as nk
    from jsonb_array_elements(p_records) with ordinality as e(r, ord)
    cross join lateral (
      select array(
        select case
                 when not (c.name = any (v_columns)) then null
                 else case jsonb_typeof(e.r -> c.name)
                        when 'string' then e.r ->> c.name
                        when 'number' then case when c.kind = 'integer' then trim_scale((e.r ->> c.name)::numeric)::text
                                                else e.r ->> c.name end
                        when 'boolean' then e.r ->> c.name
                        when 'array' then array_to_string(array(
                          select trim_scale((a.v #>> '{}')::numeric)::text
                          from jsonb_array_elements(e.r -> c.name) with ordinality as a(v, o)
                          order by a.o), ';')
                        else ''
                      end
               end
        from ingest.contract_columns c
        where c.entity = v_entity
        order by c.position) as cells
      offset 0
    ) as x
  ), ins as (
    insert into ingest.staged_rows (organization_id, batch_id, file_no, entity, row_no, nk, cells)
    select v_org, p_batch_id, 1, v_entity, s.row_no, s.nk, s.cells
    from src s
    order by s.row_no
    on conflict (batch_id, entity, nk) do nothing
    returning 1
  ), dup as (
    insert into ingest.pending_errors (organization_id, batch_id, file_no, row_no, column_name, code, level, value, detail)
    select v_org, p_batch_id, 1, d.row_no, '', 'duplicate_key', 'error', left(replace(d.nk, E'\x1f', ' | '), 200),
           jsonb_build_object('first_row', d.first_row, 'first_file_no', 1)
    from (select s.row_no, s.nk, min(s.row_no) over (partition by s.nk) as first_row from src s) as d
    where d.row_no > d.first_row
    returning 1
  )
  select (select count(*)::integer from ins) into v_staged;

  update public.import_files f set rows_staged = f.rows_staged + v_staged
  where f.organization_id = v_org and f.batch_id = p_batch_id and f.file_no = 1;
  update public.import_batches b set rows_staged = b.rows_staged + v_staged
  where b.organization_id = v_org and b.id = p_batch_id;
  return v_staged;
end;
$$;
comment on function app.api_stage_records(uuid, jsonb) is 'Stages the records of an API batch (file 1) and records duplicate keys; returns the rows staged.';

-- JSON pointer, record index and field of a stored error or warning: row_no 0 is the whole request,
-- column '' the whole record.
-- The result of a failed write: {result, failure_code, error_count, error_counts, errors,
-- errors_truncated, warning_count, warnings, warnings_truncated}. errors are the first 1,000 errors
-- {pointer, record, field, code, value, detail}; detail is rebuilt from an allow-list (first_record,
-- stored) and never carries the phase, SQLSTATE or message of a commit failure. error_counts
-- ({code: {field: n}}, field '' for record-level codes) is complete and leaves out warning codes.
create or replace function app.api_error_result(p_batch_id uuid, p_result text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'result', p_result,
    'failure_code', b.failure_code,
    'error_count', b.error_count,
    'error_counts', coalesce((select jsonb_object_agg(o.key, o.value)
                              from jsonb_each(f.error_counts) as o
                              where o.key not in ('zero_row_new_key', 'source_missing')), '{}'::jsonb),
    'errors', e.items,
    'errors_truncated', b.error_count > e.n,
    'warning_count', b.warning_count,
    'warnings', w.items,
    'warnings_truncated', b.warning_count > w.n)
  from public.import_batches b
  join public.import_files f on f.organization_id = b.organization_id and f.batch_id = b.id and f.file_no = 1
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
             'pointer', '#/records' || case when x.row_no > 0 then '/' || (x.row_no - 1)::text else '' end
                                    || case when x.column_name <> '' then '/' || x.column_name else '' end,
             'record', nullif(x.row_no, 0) - 1,
             'field', nullif(x.column_name, ''),
             'code', x.code,
             'value', nullif(x.value, ''),
             'detail', nullif(jsonb_strip_nulls(jsonb_build_object(
               'first_record', case when jsonb_typeof(x.detail -> 'first_row') = 'number'
                                    then (x.detail ->> 'first_row')::integer - 1 end,
               'stored', case when jsonb_typeof(x.detail -> 'stored') = 'object' then x.detail -> 'stored' end)), '{}'::jsonb))
             order by x.row_no, x.column_name, x.id), '[]'::jsonb) as items,
           count(*)::integer as n
    from (
      select r.id, r.row_no, r.column_name, r.code, r.value, r.detail
      from public.import_errors r
      where r.organization_id = b.organization_id and r.batch_id = b.id and r.level = 'error'
      order by r.row_no, r.column_name, r.id
      limit 1000
    ) as x
  ) as e
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
             'pointer', '#/records' || case when x.row_no > 0 then '/' || (x.row_no - 1)::text else '' end,
             'record', nullif(x.row_no, 0) - 1,
             'code', x.code)
             order by x.row_no, x.id), '[]'::jsonb) as items,
           count(*)::integer as n
    from (
      select r.id, r.row_no, r.code
      from public.import_errors r
      where r.organization_id = b.organization_id and r.batch_id = b.id and r.level = 'warning'
      order by r.row_no, r.id
      limit 100
    ) as x
  ) as w
  where b.id = p_batch_id;
$$;
comment on function app.api_error_result(uuid, text) is 'Result of a failed API write (invalid or conflict) built from the batch before it is rolled back; error details come from an allow-list only.';

-- The result of a successful write: {result: succeeded, import_id (null when not recorded),
-- recorded, entity, records, counts, warning_count, warnings (first 100 {pointer, record, code}),
-- warnings_truncated}.
create or replace function app.api_success_result(p_batch_id uuid, p_recorded boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'result', 'succeeded',
    'import_id', case when p_recorded then b.id end,
    'recorded', p_recorded,
    'entity', f.entity,
    'records', b.rows_total,
    'counts', coalesce(b.counts -> f.entity, '{}'::jsonb),
    'warning_count', b.warning_count,
    'warnings', w.items,
    'warnings_truncated', b.warning_count > w.n)
  from public.import_batches b
  join public.import_files f on f.organization_id = b.organization_id and f.batch_id = b.id and f.file_no = 1
  cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object(
             'pointer', '#/records' || case when x.row_no > 0 then '/' || (x.row_no - 1)::text else '' end,
             'record', nullif(x.row_no, 0) - 1,
             'code', x.code)
             order by x.row_no, x.id), '[]'::jsonb) as items,
           count(*)::integer as n
    from (
      select r.id, r.row_no, r.code
      from public.import_errors r
      where r.organization_id = b.organization_id and r.batch_id = b.id and r.level = 'warning'
      order by r.row_no, r.id
      limit 100
    ) as x
  ) as w
  where b.id = p_batch_id;
$$;
comment on function app.api_success_result(uuid, boolean) is 'Result of a successful API write: counts of the entity and the first 100 warnings.';

-- Opaque cursors: base64url of a JSON object, without padding.
create or replace function app.api_cursor_encode(p_value jsonb)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select translate(encode(convert_to(p_value::text, 'UTF8'), 'base64'), E'+/=\n', '-_');
$$;
comment on function app.api_cursor_encode(jsonb) is 'Encodes a list cursor (JSON object) as unpadded base64url.';

-- Decodes a cursor of the given kind (an entity name). MQ422 hint cursor when it is longer than
-- 1,024 characters, not base64url JSON, not version 1 or of another kind; the caller type-checks the
-- members it uses.
create or replace function app.api_cursor_decode(p_cursor text, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value jsonb;
begin
  if p_cursor is null then
    return null;
  end if;
  if char_length(p_cursor) > 1024 or p_cursor !~ '^[A-Za-z0-9_-]+$' then
    raise exception using errcode = 'MQ422', message = 'invalid cursor', hint = 'cursor';
  end if;
  begin
    v_value := convert_from(
      decode(rpad(translate(p_cursor, '-_', '+/'), ((char_length(p_cursor) + 3) / 4) * 4, '='), 'base64'), 'UTF8')::jsonb;
  exception when others then
    v_value := null;
  end;
  if v_value is null or jsonb_typeof(v_value) <> 'object'
     or (v_value -> 'v') is distinct from '1'::jsonb or (v_value ->> 'k') is distinct from p_kind then
    raise exception using errcode = 'MQ422', message = 'invalid cursor', hint = 'cursor';
  end if;
  return v_value;
end;
$$;
comment on function app.api_cursor_decode(text, text) is 'Decodes a list cursor of the given kind; MQ422 hint cursor when it is not one.';

------------------------------------------------------------------------------------------------
-- Key management (owners and admins, authenticated only)
------------------------------------------------------------------------------------------------

create or replace function public.create_api_key(
  p_organization_id uuid,
  p_name text,
  p_scopes text[],
  p_expires_in_days integer,
  p_key_hash bytea,
  p_display_prefix text,
  p_last4 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
                where s is null or s not in ('master_data:read', 'master_data:write', 'transactions:read', 'transactions:write')) then
    raise exception using errcode = 'MQ422', message = 'scopes are one or more of master_data:read, master_data:write, transactions:read, transactions:write',
      hint = 'scopes';
  end if;
  v_scopes := array(select distinct s from unnest(p_scopes) as s order by s);
  if p_expires_in_days is null or p_expires_in_days not between 1 and 366 then
    raise exception using errcode = 'MQ422', message = 'a key expires in 1 to 366 days', hint = 'expires_in_days';
  end if;
  if p_key_hash is null or octet_length(p_key_hash) <> 32 then
    raise exception using errcode = 'MQ422', message = 'key_hash is a SHA-256 digest (32 bytes)', hint = 'key_hash';
  end if;
  if p_display_prefix is null or p_display_prefix !~ '^maqdar_sk_[0-9A-Za-z]{4}$' then
    raise exception using errcode = 'MQ422', message = 'display_prefix is maqdar_sk_ and four base62 characters', hint = 'display_prefix';
  end if;
  if p_last4 is null or p_last4 !~ '^[0-9A-Za-z]{4}$' then
    raise exception using errcode = 'MQ422', message = 'last4 is four base62 characters', hint = 'last4';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('maqdar.api_keys:' || p_organization_id::text, 0));
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
$$;
comment on function public.create_api_key(uuid, text, text[], integer, bytea, text, text) is 'Owner or admin creates an API key from its SHA-256 (p_key_hash, 32 bytes), display prefix (maqdar_sk_ + 4) and last 4 characters; the name is trimmed, scopes are stored sorted and distinct, expires_at = now() + p_expires_in_days (1-366). MQ401 signed out; MQ403 role (not an owner or admin); MQ404 organization_id (the active organization is another one); MQ422 name/scopes/expires_in_days/key_hash/display_prefix/last4; MQ409 api_keys (20 active keys) or key_hash (duplicate). Returns the key id.';

create or replace function public.revoke_api_key(p_key_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := app.require_user();
  v_key public.api_keys;
begin
  -- Unknown ids and keys of organizations the caller does not administer (or that are not the
  -- token's active organization) get the same answer.
  select * into v_key from public.api_keys k
  where k.id = p_key_id and k.organization_id = any (array(select app.admin_organizations()));
  if v_key.id is null then
    raise exception using errcode = 'MQ404', message = 'no such API key', hint = 'key_id';
  end if;
  select * into v_key from public.api_keys k where k.id = p_key_id for no key update;
  if v_key.revoked_at is not null then
    return;
  end if;
  update public.api_keys k set revoked_at = now(), revoked_by = v_user where k.id = p_key_id;
end;
$$;
comment on function public.revoke_api_key(uuid) is 'Owner or admin revokes an API key at once (a repeat is a no-op). MQ401 signed out; MQ404 key_id for unknown keys and keys of organizations the caller does not administer.';

------------------------------------------------------------------------------------------------
-- API RPCs (service_role only; called by the /api/v1 route handlers with the key hash)
------------------------------------------------------------------------------------------------

create or replace function public.api_organization(p_key_hash bytea)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_key uuid;
  v_result json;
begin
  select a.organization_id, a.api_key_id into v_org, v_key from app.api_authorize(p_key_hash, null) as a;
  select json_build_object(
    'organization', json_build_object(
      'name', o.name,
      'slug', o.slug,
      'base_currency', o.base_currency::text,
      'home_country', o.home_country::text,
      'time_zone', coalesce(o.time_zone, c.timezone)),
    'key', json_build_object(
      'id', k.id,
      'name', k.name,
      'display', k.display_prefix || '…' || k.last4,
      'scopes', to_json(k.scopes),
      'created_at', to_char(k.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'expires_at', to_char(k.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
    'demand_window', json_build_object('from', lower(d.w), 'until_exclusive', upper(d.w)),
    'limits', app.api_limits())
    into v_result
  from public.organizations o
  join public.api_keys k on k.organization_id = o.id and k.id = v_key
  left join public.countries c on c.code = o.home_country
  cross join lateral (select app.demand_history_window() as w) as d
  where o.id = v_org;
  return v_result;
end;
$$;
comment on function public.api_organization(bytea) is 'The organization and key behind an API key hash (any valid key): {organization {name, slug, base_currency, home_country, time_zone}, key {id, name, display, scopes, created_at, expires_at}, demand_window {from, until_exclusive}, limits (app.api_limits())}. MQ401 api_key/revoked/expired/creator_inactive.';

-- One page of a master-data entity in id order: {data, next_cursor, as_of}. as_of is the time of
-- the first page and travels in the cursor; updated_since keeps rows with updated_at >= it.
create or replace function public.api_list(
  p_key_hash bytea,
  p_entity text,
  p_after text default null,
  p_limit integer default null,
  p_updated_since timestamptz default null
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_key uuid;
  v_limit integer := coalesce(p_limit, 100);
  v_after uuid := '00000000-0000-0000-0000-000000000000';
  v_since timestamptz := p_updated_since;
  v_since_text text := to_char(p_updated_since at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  v_as_of text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  v_cursor jsonb;
  v_data json;
  v_count integer;
  v_last uuid;
  v_next text;
begin
  select a.organization_id, a.api_key_id into v_org, v_key from app.api_authorize(p_key_hash, 'master_data:read') as a;
  if p_entity is null or p_entity = 'demand_history'
     or not exists (select 1 from ingest.contract_entities e where e.entity = p_entity) then
    raise exception using errcode = 'MQ404', message = 'no such resource', hint = 'resource';
  end if;
  if v_limit not between 1 and 1000 then
    raise exception using errcode = 'MQ422', message = 'limit is 1 to 1000', hint = 'limit';
  end if;
  if p_updated_since is not null and not isfinite(p_updated_since) then
    raise exception using errcode = 'MQ422', message = 'updated_since is a finite timestamp', hint = 'updated_since';
  end if;
  if p_after is not null then
    v_cursor := app.api_cursor_decode(p_after, p_entity);
    if not coalesce(
         jsonb_typeof(v_cursor -> 'a') = 'string' and pg_catalog.pg_input_is_valid(v_cursor ->> 'a', 'uuid')
         and jsonb_typeof(v_cursor -> 't') = 'string'
         and (v_cursor ->> 't') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
         and pg_catalog.pg_input_is_valid(v_cursor ->> 't', 'timestamptz')
         and v_cursor ? 'u'
         and (jsonb_typeof(v_cursor -> 'u') = 'null'
              or (jsonb_typeof(v_cursor -> 'u') = 'string'
                  and (v_cursor ->> 'u') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
                  and pg_catalog.pg_input_is_valid(v_cursor ->> 'u', 'timestamptz'))),
         false) then
      raise exception using errcode = 'MQ422', message = 'invalid cursor', hint = 'cursor';
    end if;
    if (v_cursor ->> 'u')::timestamptz is distinct from p_updated_since then
      raise exception using errcode = 'MQ422', message = 'this cursor belongs to another updated_since', hint = 'cursor';
    end if;
    v_after := (v_cursor ->> 'a')::uuid;
    v_as_of := v_cursor ->> 't';
  end if;

  if p_entity = 'work_calendars' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.code, t.name_en, t.name_ar, t.country_code::text,
                 array(select d.v from unnest(t.weekend_days) as d(v) order by d.v),
                 t.observe_public_holidays, t.is_active,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_work_calendars as rec
      from (
        select w.id, w.code, w.name_en, w.name_ar, w.country_code, w.weekend_days, w.observe_public_holidays, w.is_active, w.updated_at
        from public.work_calendars w
        where w.organization_id = v_org and w.id > v_after and (v_since is null or w.updated_at >= v_since)
        order by w.id
        limit v_limit + 1
      ) as t
    ) as x;
  elsif p_entity = 'holiday_overrides' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.country_code::text, wc.code, t.starts_on, t.ends_on, t.kind, t.name_en, t.name_ar, t.note,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_holiday_overrides as rec
      from (
        select h.id, h.country_code, h.work_calendar_id, h.starts_on, h.ends_on, h.kind, h.name_en, h.name_ar, h.note, h.updated_at
        from public.holiday_overrides h
        where h.organization_id = v_org and h.id > v_after and (v_since is null or h.updated_at >= v_since)
        order by h.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select w.code from public.work_calendars w where w.organization_id = v_org and w.id = t.work_calendar_id
      ) as wc on true
    ) as x;
  elsif p_entity = 'locations' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.code, t.name_en, t.name_ar, t.location_type, t.country_code::text, t.city,
                 trim_scale(t.latitude)::text, trim_scale(t.longitude)::text, t.timezone, p.code, t.is_active, wc.code,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_locations as rec
      from (
        select l.id, l.code, l.name_en, l.name_ar, l.location_type, l.country_code, l.city, l.latitude, l.longitude, l.timezone,
               l.parent_location_id, l.is_active, l.work_calendar_id, l.updated_at
        from public.locations l
        where l.organization_id = v_org and l.id > v_after and (v_since is null or l.updated_at >= v_since)
        order by l.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select pl.code from public.locations pl where pl.organization_id = v_org and pl.id = t.parent_location_id
      ) as p on true
      left join lateral (
        select w.code from public.work_calendars w where w.organization_id = v_org and w.id = t.work_calendar_id
      ) as wc on true
    ) as x;
  elsif p_entity = 'network_links' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(fl.code, tl.code, t.lead_time_days_p50, t.lead_time_days_p90, t.freight_basis, trim_scale(t.freight_cost)::text,
                 t.currency::text, t.is_active,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_network_links as rec
      from (
        select n.id, n.from_location_id, n.to_location_id, n.lead_time_days_p50, n.lead_time_days_p90, n.freight_basis,
               n.freight_cost, n.currency, n.is_active, n.updated_at
        from public.network_links n
        where n.organization_id = v_org and n.id > v_after and (v_since is null or n.updated_at >= v_since)
        order by n.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select l.code from public.locations l where l.organization_id = v_org and l.id = t.from_location_id
      ) as fl on true
      left join lateral (
        select l.code from public.locations l where l.organization_id = v_org and l.id = t.to_location_id
      ) as tl on true
    ) as x;
  elsif p_entity = 'brands' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.code, t.name_en, t.name_ar, t.brand_type, t.country_of_origin::text, t.is_active,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_brands as rec
      from (
        select b.id, b.code, b.name_en, b.name_ar, b.brand_type, b.country_of_origin, b.is_active, b.updated_at
        from public.brands b
        where b.organization_id = v_org and b.id > v_after and (v_since is null or b.updated_at >= v_since)
        order by b.id
        limit v_limit + 1
      ) as t
    ) as x;
  elsif p_entity = 'items' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.code, t.name_en, t.name_ar, br.code, t.product_group, t.unit_of_measure, trim_scale(t.unit_cost)::text,
                 t.currency::text, t.status, t.introduced_on, t.discontinued_on,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_items as rec
      from (
        select i.id, i.code, i.name_en, i.name_ar, i.brand_id, i.product_group, i.unit_of_measure, i.unit_cost, i.currency,
               i.status, i.introduced_on, i.discontinued_on, i.updated_at
        from public.items i
        where i.organization_id = v_org and i.id > v_after and (v_since is null or i.updated_at >= v_since)
        order by i.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select b.code from public.brands b where b.organization_id = v_org and b.id = t.brand_id
      ) as br on true
    ) as x;
  elsif p_entity = 'item_supersessions' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(pi.code, si.code, t.effective_on, trim_scale(t.quantity_factor)::text, t.note,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_item_supersessions as rec
      from (
        select s.id, s.predecessor_item_id, s.successor_item_id, s.effective_on, s.quantity_factor, s.note, s.updated_at
        from public.item_supersessions s
        where s.organization_id = v_org and s.id > v_after and (v_since is null or s.updated_at >= v_since)
        order by s.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select i.code from public.items i where i.organization_id = v_org and i.id = t.predecessor_item_id
      ) as pi on true
      left join lateral (
        select i.code from public.items i where i.organization_id = v_org and i.id = t.successor_item_id
      ) as si on true
    ) as x;
  elsif p_entity = 'item_interchanges' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(ii.code, ai.code, t.direction, t.priority::integer, t.note,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_item_interchanges as rec
      from (
        select c.id, c.item_id, c.alternate_item_id, c.direction, c.priority, c.note, c.updated_at
        from public.item_interchanges c
        where c.organization_id = v_org and c.id > v_after and (v_since is null or c.updated_at >= v_since)
        order by c.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select i.code from public.items i where i.organization_id = v_org and i.id = t.item_id
      ) as ii on true
      left join lateral (
        select i.code from public.items i where i.organization_id = v_org and i.id = t.alternate_item_id
      ) as ai on true
    ) as x;
  elsif p_entity = 'suppliers' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.code, t.name_en, t.name_ar, t.country_code::text, t.currency::text, t.lead_time_days_p50, t.lead_time_days_p90,
                 t.is_active, wc.code,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_suppliers as rec
      from (
        select s.id, s.code, s.name_en, s.name_ar, s.country_code, s.currency, s.lead_time_days_p50, s.lead_time_days_p90,
               s.is_active, s.work_calendar_id, s.updated_at
        from public.suppliers s
        where s.organization_id = v_org and s.id > v_after and (v_since is null or s.updated_at >= v_since)
        order by s.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select w.code from public.work_calendars w where w.organization_id = v_org and w.id = t.work_calendar_id
      ) as wc on true
    ) as x;
  elsif p_entity = 'supplier_items' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(sp.code, it.code, t.supplier_part_number, t.lead_time_days, t.lead_time_days_p90,
                 trim_scale(t.min_order_quantity)::text, trim_scale(t.pack_size)::text, trim_scale(t.unit_price)::text,
                 t.currency::text, t.is_preferred, t.valid_from,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_supplier_items as rec
      from (
        select si.id, si.supplier_id, si.item_id, si.supplier_part_number, si.lead_time_days, si.lead_time_days_p90,
               si.min_order_quantity, si.pack_size, si.unit_price, si.currency, si.is_preferred, si.valid_from, si.updated_at
        from public.supplier_items si
        where si.organization_id = v_org and si.id > v_after and (v_since is null or si.updated_at >= v_since)
        order by si.id
        limit v_limit + 1
      ) as t
      left join lateral (
        select s.code from public.suppliers s where s.organization_id = v_org and s.id = t.supplier_id
      ) as sp on true
      left join lateral (
        select i.code from public.items i where i.organization_id = v_org and i.id = t.item_id
      ) as it on true
    ) as x;
  elsif p_entity = 'fx_rates' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(x.id) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select t.id, row_number() over (order by t.id) as n,
             row(t.from_currency::text, t.to_currency::text, t.valid_from, trim_scale(t.rate)::text, t.note,
                 to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::ingest.api_record_fx_rates as rec
      from (
        select f.id, f.from_currency, f.to_currency, f.valid_from, f.rate, f.note, f.updated_at
        from public.fx_rates f
        where f.organization_id = v_org and f.id > v_after and (v_since is null or f.updated_at >= v_since)
        order by f.id
        limit v_limit + 1
      ) as t
    ) as x;
  end if;

  if v_count > v_limit then
    v_next := app.api_cursor_encode(jsonb_build_object('v', 1, 'k', p_entity, 'a', v_last, 'u', v_since_text, 't', v_as_of));
  end if;
  return json_build_object('data', v_data, 'next_cursor', v_next, 'as_of', v_as_of);
end;
$$;
comment on function public.api_list(bytea, text, text, integer, timestamptz) is 'One page of a master-data entity (scope master_data:read) in id order: {data: [records in contract column order plus updated_at], next_cursor, as_of}. p_entity is a contract entity name except demand_history; p_limit 1-1000 (default 100); p_after a cursor from an earlier page with the same entity and updated_since; p_updated_since keeps rows with updated_at >= it. MQ401, MQ403 scope, MQ404 resource, MQ422 limit/updated_since/cursor.';

-- One page of demand in key order inside [p_from, p_to] (at most 366 days), optionally for one item
-- and/or one location. Four static shapes, each an index range: no filter (primary key), item
-- (primary-key prefix), location ((organization_id, location_id, demand_date) plus an incremental
-- sort), both (primary-key prefix). plan_cache_mode = force_custom_plan plans every call with its
-- dates, so only the partitions of the range are read.
create or replace function public.api_list_demand(
  p_key_hash bytea,
  p_from date,
  p_to date,
  p_item_code text default null,
  p_location_code text default null,
  p_after text default null,
  p_limit integer default null
)
returns json
language plpgsql
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
declare
  v_org uuid;
  v_key uuid;
  v_limit integer := coalesce(p_limit, 1000);
  v_mode text := case when p_item_code is null and p_location_code is null then 'all'
                      when p_location_code is null then 'item'
                      when p_item_code is null then 'location'
                      else 'both' end;
  v_as_of text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  v_cursor jsonb;
  v_item uuid;
  v_location uuid;
  v_ai uuid := '00000000-0000-0000-0000-000000000000';
  v_al uuid := '00000000-0000-0000-0000-000000000000';
  v_ad date := '-infinity';
  v_data json;
  v_count integer;
  v_last jsonb;
  v_next text;
begin
  select a.organization_id, a.api_key_id into v_org, v_key from app.api_authorize(p_key_hash, 'transactions:read') as a;
  if p_from is null or not isfinite(p_from) then
    raise exception using errcode = 'MQ422', message = 'from is a date', hint = 'from';
  end if;
  if p_to is null or not isfinite(p_to) or p_to < p_from or p_to - p_from > 365 then
    raise exception using errcode = 'MQ422', message = 'to is on or after from and at most 365 days later', hint = 'to';
  end if;
  if v_limit not between 1 and 5000 then
    raise exception using errcode = 'MQ422', message = 'limit is 1 to 5000', hint = 'limit';
  end if;
  if p_item_code is not null and p_item_code !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$' then
    raise exception using errcode = 'MQ422', message = 'item_code is not a valid item code', hint = 'item_code';
  end if;
  if p_location_code is not null and p_location_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then
    raise exception using errcode = 'MQ422', message = 'location_code is not a valid location code', hint = 'location_code';
  end if;
  if p_after is not null then
    v_cursor := app.api_cursor_decode(p_after, 'demand_history');
    if not coalesce(
         (v_cursor ->> 'm') = v_mode
         and (v_cursor ->> 'f') = to_char(p_from, 'YYYY-MM-DD')
         and (v_cursor ->> 'e') = to_char(p_to, 'YYYY-MM-DD')
         and (v_cursor ->> 'i') is not distinct from p_item_code
         and (v_cursor ->> 'l') is not distinct from p_location_code
         and jsonb_typeof(v_cursor -> 'a') = 'array'
         and (case when jsonb_typeof(v_cursor -> 'a') = 'array' then jsonb_array_length(v_cursor -> 'a') end) = 3
         and jsonb_typeof(v_cursor -> 'a' -> 0) = 'string' and pg_catalog.pg_input_is_valid(v_cursor -> 'a' ->> 0, 'uuid')
         and jsonb_typeof(v_cursor -> 'a' -> 1) = 'string' and pg_catalog.pg_input_is_valid(v_cursor -> 'a' ->> 1, 'uuid')
         and jsonb_typeof(v_cursor -> 'a' -> 2) = 'string' and (v_cursor -> 'a' ->> 2) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         and pg_catalog.pg_input_is_valid(v_cursor -> 'a' ->> 2, 'date')
         and jsonb_typeof(v_cursor -> 't') = 'string'
         and (v_cursor ->> 't') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
         and pg_catalog.pg_input_is_valid(v_cursor ->> 't', 'timestamptz'),
         false) then
      raise exception using errcode = 'MQ422', message = 'invalid cursor', hint = 'cursor';
    end if;
    v_ai := (v_cursor -> 'a' ->> 0)::uuid;
    v_al := (v_cursor -> 'a' ->> 1)::uuid;
    v_ad := (v_cursor -> 'a' ->> 2)::date;
    v_as_of := v_cursor ->> 't';
  end if;

  -- Unknown codes: an empty page.
  if p_item_code is not null then
    select i.id into v_item from public.items i where i.organization_id = v_org and i.code = p_item_code;
    if v_item is null then
      return json_build_object('data', '[]'::json, 'next_cursor', null, 'as_of', v_as_of);
    end if;
  end if;
  if p_location_code is not null then
    select l.id into v_location from public.locations l where l.organization_id = v_org and l.code = p_location_code;
    if v_location is null then
      return json_build_object('data', '[]'::json, 'next_cursor', null, 'as_of', v_as_of);
    end if;
  end if;

  if v_mode = 'all' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(jsonb_build_array(x.item_id, x.location_id, x.demand_date)) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select p.item_id, p.location_id, p.demand_date,
             row_number() over (order by p.item_id, p.location_id, p.demand_date) as n,
             row(i.code, l.code, p.demand_date, trim_scale(p.quantity)::text,
                 trim_scale(p.lost_sales_quantity)::text)::ingest.api_record_demand_history as rec
      from (
        select d.item_id, d.location_id, d.demand_date, d.quantity, d.lost_sales_quantity
        from public.demand_history d
        where d.organization_id = v_org and d.demand_date >= p_from and d.demand_date < p_to + 1
          and (d.item_id, d.location_id, d.demand_date) > (v_ai, v_al, v_ad)
        order by d.item_id, d.location_id, d.demand_date
        limit v_limit + 1
      ) as p
      left join lateral (select t.code from public.items t where t.organization_id = v_org and t.id = p.item_id) as i on true
      left join lateral (select t.code from public.locations t where t.organization_id = v_org and t.id = p.location_id) as l on true
    ) as x;
  elsif v_mode = 'item' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(jsonb_build_array(x.item_id, x.location_id, x.demand_date)) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select p.item_id, p.location_id, p.demand_date,
             row_number() over (order by p.location_id, p.demand_date) as n,
             row(p_item_code, l.code, p.demand_date, trim_scale(p.quantity)::text,
                 trim_scale(p.lost_sales_quantity)::text)::ingest.api_record_demand_history as rec
      from (
        select d.item_id, d.location_id, d.demand_date, d.quantity, d.lost_sales_quantity
        from public.demand_history d
        where d.organization_id = v_org and d.item_id = v_item and d.demand_date >= p_from and d.demand_date < p_to + 1
          and (d.location_id, d.demand_date) > (v_al, v_ad)
        order by d.location_id, d.demand_date
        limit v_limit + 1
      ) as p
      left join lateral (select t.code from public.locations t where t.organization_id = v_org and t.id = p.location_id) as l on true
    ) as x;
  elsif v_mode = 'location' then
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(jsonb_build_array(x.item_id, x.location_id, x.demand_date)) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select p.item_id, p.location_id, p.demand_date,
             row_number() over (order by p.demand_date, p.item_id) as n,
             row(i.code, p_location_code, p.demand_date, trim_scale(p.quantity)::text,
                 trim_scale(p.lost_sales_quantity)::text)::ingest.api_record_demand_history as rec
      from (
        select d.item_id, d.location_id, d.demand_date, d.quantity, d.lost_sales_quantity
        from public.demand_history d
        where d.organization_id = v_org and d.location_id = v_location and d.demand_date >= p_from and d.demand_date < p_to + 1
          and (d.demand_date, d.item_id) > (v_ad, v_ai)
        order by d.demand_date, d.item_id
        limit v_limit + 1
      ) as p
      left join lateral (select t.code from public.items t where t.organization_id = v_org and t.id = p.item_id) as i on true
    ) as x;
  else
    select coalesce(json_agg(x.rec order by x.n) filter (where x.n <= v_limit), '[]'::json), count(*)::integer,
           (array_agg(jsonb_build_array(x.item_id, x.location_id, x.demand_date)) filter (where x.n = v_limit))[1]
      into v_data, v_count, v_last
    from (
      select p.item_id, p.location_id, p.demand_date,
             row_number() over (order by p.demand_date) as n,
             row(p_item_code, p_location_code, p.demand_date, trim_scale(p.quantity)::text,
                 trim_scale(p.lost_sales_quantity)::text)::ingest.api_record_demand_history as rec
      from (
        select d.item_id, d.location_id, d.demand_date, d.quantity, d.lost_sales_quantity
        from public.demand_history d
        where d.organization_id = v_org and d.item_id = v_item and d.location_id = v_location
          and d.demand_date >= p_from and d.demand_date < p_to + 1 and d.demand_date > v_ad
        order by d.demand_date
        limit v_limit + 1
      ) as p
    ) as x;
  end if;

  if v_count > v_limit then
    v_next := app.api_cursor_encode(jsonb_build_object(
      'v', 1, 'k', 'demand_history', 'm', v_mode, 'f', to_char(p_from, 'YYYY-MM-DD'), 'e', to_char(p_to, 'YYYY-MM-DD'),
      'i', p_item_code, 'l', p_location_code, 'a', v_last, 't', v_as_of));
  end if;
  return json_build_object('data', v_data, 'next_cursor', v_next, 'as_of', v_as_of);
end;
$$;
comment on function public.api_list_demand(bytea, date, date, text, text, text, integer) is 'One page of demand history (scope transactions:read) inside [p_from, p_to] (inclusive, p_to - p_from <= 365), optionally for one item and/or location code: {data: [{item_code, location_code, demand_date, quantity, lost_sales_quantity}], next_cursor, as_of}. Unknown codes give an empty page. p_limit 1-5000 (default 1000). MQ401, MQ403 scope, MQ422 from/to/limit/item_code/location_code/cursor.';

-- One bulk upsert of one entity, all or nothing. Records only writes that changed data.
create or replace function public.api_upsert(p_key_hash bytea, p_entity text, p_body jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  from app.api_authorize(p_key_hash, case when p_entity = 'demand_history' then 'transactions:write' else 'master_data:write' end) as a;
  if p_request_id is null then
    raise exception using errcode = 'MQ422', message = 'a request id is required', hint = 'request_id';
  end if;

  v_columns := app.api_check_fields(p_entity, p_body);
  v_n := jsonb_array_length(p_body -> 'records');

  -- The 5a import lock: one writer per organization, refused at once rather than waited for. It is
  -- taken here, outside the block below, because a lock taken in a rolled-back subtransaction is
  -- released with it.
  if not pg_try_advisory_xact_lock(hashtextextended('maqdar.import:' || v_org::text, 0)) then
    raise exception using errcode = 'MQ409', message = 'another import is writing to this organization; try again shortly',
      hint = 'import_in_progress';
  end if;
  perform app.import_sweep(0);
  if (select count(*) from (select 1 from public.import_batches b
                            where b.organization_id = v_org and b.source = 'api' and b.created_at > now() - interval '24 hours'
                            limit 5000) as x) >= 5000 then
    raise exception using errcode = 'MQ429', message = 'too many recorded API writes in the last 24 hours (at most 5,000)',
      hint = 'api_writes_per_day';
  end if;

  -- ANALYZE (SKIP_LOCKED) in the 5a statistics helpers for this write only. A function SET clause
  -- cannot name a custom setting unless the owner is a superuser (postgres is not, locally or
  -- hosted), so it is set for the transaction here and restored below; an error rolls it back.
  v_analyze := current_setting('maqdar.import_analyze', true);
  perform set_config('maqdar.import_analyze', 'skip_locked', true);

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
    v_result := app.api_success_result(v_batch, true);
  exception when sqlstate 'MQ499' then
    null;
  end;
  perform set_config('maqdar.import_analyze', coalesce(v_analyze, ''), true);
  return v_result;
end;
$$;
comment on function public.api_upsert(bytea, text, jsonb, uuid) is 'Bulk upsert of one entity (scope master_data:write, or transactions:write for demand_history) over the 5a validators and merges, all or nothing. p_body is {"records": [...]} (1-1000 records, 2500 for demand; app.api_limits() upsert_records). Returns {result: succeeded, import_id, recorded, entity, records, counts, warning_count, warnings, warnings_truncated} or {result: invalid|conflict, failure_code, error_count, error_counts, errors, errors_truncated, warning_count, warnings, warnings_truncated}; only writes that changed data are recorded (import_batches source api). MQ401, MQ403 scope, MQ404 resource, MQ409 import_in_progress/another_commit, MQ422 records (detail {code, record, field})/request_id, MQ429 api_writes_per_day.';

------------------------------------------------------------------------------------------------
-- Function privileges
------------------------------------------------------------------------------------------------

do $$
declare
  f regprocedure;
  v_internal integer := 0;
  v_api integer := 0;
  v_keys integer := 0;
begin
  for f in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname like 'api\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    v_internal := v_internal + 1;
  end loop;
  for f in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('api_organization', 'api_list', 'api_list_demand', 'api_upsert')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
    v_api := v_api + 1;
  end loop;
  for f in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_api_key', 'revoke_api_key')
  loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
    v_keys := v_keys + 1;
  end loop;
  if v_internal <> 9 or v_api <> 4 or v_keys <> 2 then
    raise exception 'unexpected API function count: % internal, % api, % key', v_internal, v_api, v_keys;
  end if;
end
$$;
