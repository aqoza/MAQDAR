-- Step 19j: additive organization-wide event read permission; no existing key or evidence changes.
set lock_timeout = '5s';
alter table public.api_keys drop constraint api_keys_scopes_check;
alter table public.api_keys add constraint api_keys_scopes_check check (
  cardinality(scopes) between 1 and 9 and array_position(scopes,null) is null and scopes <@ array[
    'master_data:read','master_data:write','transactions:read','transactions:write',
    'purchase_handoffs:read','purchase_handoffs:acknowledge','transfer_handoffs:read',
    'transfer_handoffs:acknowledge','event_purchase_handoffs:read']::text[]
);

-- Private projection, evaluated as the RPC owner. Public RPCs always constrain organization_id.
create view app.event_purchase_handoff_api_records with(security_invoker=true) as
select 'event-purchase-handoffs'::text as resource,h.organization_id,h.id,h.created_at,h.payload,
  jsonb_build_object('supplier_code',p.supplier_code,'location_code',p.location_code,
    'item_code',p.item_code,'currency',p.currency,'minor_units',p.minor_units,'subtotal',p.subtotal,
    'selected_quantity_basis','full_event_adjusted',
    'baseline_subtotal',h.payload#>>'{estimate,baseline,subtotal}',
    'cost_increase',h.payload#>>'{estimate,cost_increase}',
    'order_date',h.payload#>>'{estimate,source,order_date}',
    'line_count',1,'handoff_ids',jsonb_build_array(h.id)) as summary,
  coalesce(p.selected,false) as selected
from public.event_purchase_handoffs h left join public.event_purchase_handoff_list p
  on p.organization_id=h.organization_id and p.id=h.id
union all
select 'event-purchase-handoff-batches',b.organization_id,b.id,b.created_at,b.payload,
  jsonb_build_object('supplier_code',p.supplier_code,'location_code',p.location_code,
    'item_code',null,'currency',p.currency,'minor_units',p.minor_units,'subtotal',p.subtotal,
    'selected_quantity_basis','full_event_adjusted',
    'baseline_subtotal',p.baseline_subtotal,'cost_increase',p.cost_increase,'order_date',p.order_date,
    'line_count',p.line_count,'handoff_ids',to_jsonb(b.handoff_ids)),coalesce(p.selected,false)
from public.event_purchase_handoff_batches b join public.event_purchase_handoff_batch_list p
  on p.organization_id=b.organization_id and p.id=b.id;
revoke all on app.event_purchase_handoff_api_records from public,anon,authenticated,service_role,maqdar_worker;

create function public.api_event_purchase_handoff_list(p_key_hash bytea,p_resource text,
  p_after text default null,p_limit integer default 25,p_created_since timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  org uuid; cap integer:=coalesce(p_limit,25); cursor_value jsonb;
  after_time timestamptz; after_id uuid; captured timestamptz:=statement_timestamp();
  as_of_time timestamptz:=captured; rows jsonb; total integer; last_row jsonb; next_cursor text;
begin
  select a.organization_id into org from app.api_authorize(p_key_hash,'event_purchase_handoffs:read') a;
  if p_resource is null or p_resource not in ('event-purchase-handoffs','event-purchase-handoff-batches') then
    raise exception using errcode='MQ404',message='no such resource',hint='resource';
  end if;
  if cap not between 1 and 100 then
    raise exception using errcode='MQ422',message='limit is 1 to 100',hint='limit';
  end if;
  if p_created_since is not null and not isfinite(p_created_since) then
    raise exception using errcode='MQ422',message='created_since must be finite',hint='created_since';
  end if;
  if p_after is not null then
    cursor_value:=app.api_cursor_decode(p_after,p_resource);
    begin
      if jsonb_typeof(cursor_value->'a') is distinct from 'string'
        or jsonb_typeof(cursor_value->'d') is distinct from 'string'
        or jsonb_typeof(cursor_value->'t') is distinct from 'string'
        or cursor_value->>'o' is distinct from org::text
        or not(cursor_value ? 's')
        or jsonb_typeof(cursor_value->'s') not in ('string','null') then
        raise exception 'invalid cursor fields';
      end if;
      after_id:=(cursor_value->>'a')::uuid;
      after_time:=(cursor_value->>'d')::timestamptz;
      as_of_time:=(cursor_value->>'t')::timestamptz;
      if not isfinite(after_time) or not isfinite(as_of_time)
        or after_time>as_of_time or as_of_time>captured
        or (cursor_value->>'s')::timestamptz is distinct from p_created_since then
        raise exception 'invalid cursor position';
      end if;
    exception when others then
      raise exception using errcode='MQ422',message='invalid cursor',hint='cursor';
    end;
  end if;
  with candidates as materialized (
    select r.id,r.created_at,r.summary,r.selected
    from app.event_purchase_handoff_api_records r
    where r.organization_id=org and r.resource=p_resource and r.created_at<=as_of_time
      and (p_created_since is null or r.created_at>=p_created_since)
      and (after_time is null or r.created_at<after_time or (r.created_at=after_time and r.id>after_id))
    order by r.created_at desc,r.id limit cap+1
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'summary',summary,
    'current',jsonb_build_object('selected',selected,'checked_at',captured)) order by created_at desc,id),'[]'),count(*)
    into rows,total from candidates;
  if total>cap then
    rows:=rows-cap;
    last_row:=rows->(cap-1);
    next_cursor:=app.api_cursor_encode(jsonb_build_object('v',1,'k',p_resource,'o',org,
      'a',last_row->>'id','d',last_row->>'created_at','t',as_of_time,'s',p_created_since));
  end if;
  return jsonb_build_object('data',rows,'next_cursor',next_cursor,'as_of',as_of_time);
end;
$$;
revoke all on function public.api_event_purchase_handoff_list(bytea,text,text,integer,timestamptz) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.api_event_purchase_handoff_list(bytea,text,text,integer,timestamptz) to service_role;

create function public.api_event_purchase_handoff_get(p_key_hash bytea,p_resource text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; result jsonb;
begin
  select a.organization_id into org from app.api_authorize(p_key_hash,'event_purchase_handoffs:read') a;
  if p_resource is null or p_resource not in ('event-purchase-handoffs','event-purchase-handoff-batches') then
    raise exception using errcode='MQ404',message='no such resource',hint='resource';
  end if;
  select jsonb_build_object('data',jsonb_build_object('id',r.id,'created_at',r.created_at,
    'summary',r.summary,'payload',r.payload,
    'current',jsonb_build_object('selected',r.selected,'checked_at',statement_timestamp())))
  into result from app.event_purchase_handoff_api_records r
  where r.organization_id=org and r.resource=p_resource and r.id=p_id;
  if result is null then
    raise exception using errcode='MQ404',message='no such handoff',hint='resource';
  end if;
  return result;
end;
$$;
revoke all on function public.api_event_purchase_handoff_get(bytea,text,uuid) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.api_event_purchase_handoff_get(bytea,text,uuid) to service_role;

-- Retain existing guarded key creation; only extend its explicit scope allowlist.
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
                where s is null or s not in ('master_data:read', 'master_data:write', 'transactions:read', 'transactions:write', 'purchase_handoffs:read', 'purchase_handoffs:acknowledge', 'transfer_handoffs:read', 'transfer_handoffs:acknowledge', 'event_purchase_handoffs:read')) then
    raise exception using errcode = 'MQ422', message = 'scopes are one or more of master_data:read, master_data:write, transactions:read, transactions:write, purchase_handoffs:read, purchase_handoffs:acknowledge, transfer_handoffs:read, transfer_handoffs:acknowledge, event_purchase_handoffs:read',
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

reset lock_timeout;
