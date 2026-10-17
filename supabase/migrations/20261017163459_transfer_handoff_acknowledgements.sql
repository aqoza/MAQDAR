-- Step 16h: additive reports. Roll back web code; retain immutable event evidence.
set lock_timeout = '5s';
alter table public.api_keys drop constraint api_keys_scopes_check;
alter table public.api_keys add constraint api_keys_scopes_check check (
  cardinality(scopes) between 1 and 8 and array_position(scopes,null) is null and scopes <@ array[
    'master_data:read','master_data:write','transactions:read','transactions:write',
    'purchase_handoffs:read','purchase_handoffs:acknowledge',
    'transfer_handoffs:read','transfer_handoffs:acknowledge']::text[]
);

create table public.transfer_handoff_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  source_location_id uuid not null,
  handoff_id uuid,
  batch_id uuid,
  client_event_id uuid not null,
  api_key_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  external_system text not null check (char_length(external_system) between 1 and 80 and external_system !~ '[[:cntrl:]]' and external_system ~ '[^[:space:]]'),
  external_reference text not null check (char_length(external_reference) between 1 and 200 and external_reference !~ '[[:cntrl:]]' and external_reference ~ '[^[:space:]]'),
  status text not null check (status in ('received','rejected')),
  reason text check (reason is null or (char_length(reason) between 1 and 1000 and reason !~ '[[:cntrl:]]' and reason ~ '[^[:space:]]')),
  check (status <> 'rejected' or reason is not null),
  check (num_nonnulls(handoff_id,batch_id)=1),
  unique(organization_id,client_event_id),
  foreign key(organization_id,handoff_id) references public.transfer_handoffs(organization_id,id) on delete cascade,
  foreign key(organization_id,batch_id) references public.transfer_handoff_batches(organization_id,id) on delete cascade,
  foreign key(organization_id,source_location_id) references public.locations(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
-- Key identity is retained as attribution after key deletion; never store credentials.
create index transfer_handoff_ack_history on public.transfer_handoff_acknowledgements
  (organization_id,coalesce(handoff_id,batch_id),recorded_at desc,id);
-- Match member-facing history filters and parent foreign-key cascades as well as API paging.
create index transfer_handoff_ack_single on public.transfer_handoff_acknowledgements
  (organization_id,handoff_id,recorded_at desc,id) where handoff_id is not null;
create index transfer_handoff_ack_batch on public.transfer_handoff_acknowledgements
  (organization_id,batch_id,recorded_at desc,id) where batch_id is not null;
alter table public.transfer_handoff_acknowledgements enable row level security;
revoke all on public.transfer_handoff_acknowledgements from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.transfer_handoff_acknowledgements to authenticated;
create policy "members read" on public.transfer_handoff_acknowledgements for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.transfer_handoff_acknowledgements as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create policy "source branch scope" on public.transfer_handoff_acknowledgements as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or source_location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.transfer_handoff_acknowledgements
  for each row execute function app.audit_business_row();
comment on table public.transfer_handoff_acknowledgements is 'Append-only caller reports, not verified transfer acceptance. Client event UUID is retry identity across the organization''s transfer reports. No reservation, transmission or execution. No propagation from batches. Parent/location deletion cascades; audit evidence remains.';

create function app.transfer_handoff_ack_json(a public.transfer_handoff_acknowledgements)
returns jsonb language sql immutable set search_path='' as $$
  select (to_jsonb(a)-'organization_id'-'location_id'-'source_location_id'-'handoff_id'-'batch_id') || jsonb_build_object(
    'resource',case when a.handoff_id is not null then 'transfer-handoffs' else 'transfer-handoff-batches' end,
    'record_id',coalesce(a.handoff_id,a.batch_id));
$$;
revoke all on function app.transfer_handoff_ack_json(public.transfer_handoff_acknowledgements) from public,anon,authenticated,service_role,maqdar_worker;

-- Checks only existence/organization, deliberately allowing historical packages and freight.
create function app.transfer_handoff_ack_locations(p_org uuid,p_resource text,p_id uuid)
returns table(location_id uuid,source_location_id uuid) language plpgsql stable set search_path='' as $$
begin
  if p_resource='transfer-handoffs' then
    return query select h.location_id,h.source_location_id from public.transfer_handoffs h where h.organization_id=p_org and h.id=p_id;
  elsif p_resource='transfer-handoff-batches' then
    return query select b.location_id,b.source_location_id from public.transfer_handoff_batches b where b.organization_id=p_org and b.id=p_id;
  end if;
  if not found then raise exception using errcode='MQ404',message='package unavailable',hint='resource'; end if;
end;
$$;
revoke all on function app.transfer_handoff_ack_locations(uuid,text,uuid) from public,anon,authenticated,service_role,maqdar_worker;

create function public.api_transfer_handoff_acknowledge(p_key_hash bytea,p_resource text,p_id uuid,p_body jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
  perform pg_advisory_xact_lock(hashtextextended('maqdar.transfer-handoff-ack:'||org::text||':'||event_id::text,0));
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
$$;
revoke all on function public.api_transfer_handoff_acknowledge(bytea,text,uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.api_transfer_handoff_acknowledge(bytea,text,uuid,jsonb) to service_role;

create function public.api_transfer_handoff_acknowledgements(p_key_hash bytea,p_resource text,p_id uuid,
  p_event_id uuid default null,p_after text default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid; cap integer:=coalesce(p_limit,25); cursor_value jsonb;
  after_time timestamptz; after_id uuid; captured timestamptz:=statement_timestamp(); as_of_time timestamptz:=captured;
  rows jsonb; total integer; last_row jsonb; next_cursor text;
begin
  select a.organization_id into org from app.api_authorize(p_key_hash,'transfer_handoffs:read') a;
  perform app.transfer_handoff_ack_locations(org,p_resource,p_id);
  if p_event_id is not null then
    select app.transfer_handoff_ack_json(a) into rows from public.transfer_handoff_acknowledgements a
      where a.organization_id=org and a.id=p_event_id
        and (p_resource='transfer-handoffs' and a.handoff_id=p_id or p_resource='transfer-handoff-batches' and a.batch_id=p_id);
    if rows is null then raise exception using errcode='MQ404',message='event unavailable',hint='resource'; end if;
    return jsonb_build_object('data',rows);
  end if;
  if cap not between 1 and 100 then raise exception using errcode='MQ422',message='limit is 1 to 100',hint='limit'; end if;
  if p_after is not null then
    cursor_value:=app.api_cursor_decode(p_after,'transfer-handoff-acknowledgements');
    begin
      if cursor_value->>'o' is distinct from org::text or cursor_value->>'r' is distinct from p_resource
        or cursor_value->>'p' is distinct from p_id::text
        or jsonb_typeof(cursor_value->'a') is distinct from 'string'
        or jsonb_typeof(cursor_value->'d') is distinct from 'string'
        or jsonb_typeof(cursor_value->'t') is distinct from 'string' then raise exception 'invalid cursor'; end if;
      after_id:=(cursor_value->>'a')::uuid; after_time:=(cursor_value->>'d')::timestamptz; as_of_time:=(cursor_value->>'t')::timestamptz;
      if not isfinite(after_time) or not isfinite(as_of_time) or after_time>as_of_time or as_of_time>captured then raise exception 'invalid cursor'; end if;
    exception when others then raise exception using errcode='MQ422',message='invalid cursor',hint='cursor'; end;
  end if;
  with candidates as materialized (
    select a.* from public.transfer_handoff_acknowledgements a where a.organization_id=org
      and coalesce(a.handoff_id,a.batch_id)=p_id
      and (p_resource='transfer-handoffs' and a.handoff_id is not null or p_resource='transfer-handoff-batches' and a.batch_id is not null)
      and a.recorded_at<=as_of_time
      and (after_time is null or a.recorded_at<after_time or (a.recorded_at=after_time and a.id>after_id))
    order by a.recorded_at desc,a.id limit cap+1
  ) select coalesce(jsonb_agg(app.transfer_handoff_ack_json(c) order by recorded_at desc,id),'[]'),count(*) into rows,total
    from candidates c;
  if total>cap then
    rows:=rows-cap; last_row:=rows->(cap-1);
    next_cursor:=app.api_cursor_encode(jsonb_build_object('v',1,'k','transfer-handoff-acknowledgements','o',org,'r',p_resource,
      'p',p_id,'a',last_row->>'id','d',last_row->>'recorded_at','t',as_of_time));
  end if;
  return jsonb_build_object('data',rows,'next_cursor',next_cursor,'as_of',as_of_time);
end;
$$;
revoke all on function public.api_transfer_handoff_acknowledgements(bytea,text,uuid,uuid,text,integer) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.api_transfer_handoff_acknowledgements(bytea,text,uuid,uuid,text,integer) to service_role;
-- Retain all guarded key-management behavior; only extend the explicit scope allowlist.
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
                where s is null or s not in ('master_data:read', 'master_data:write', 'transactions:read', 'transactions:write', 'purchase_handoffs:read', 'purchase_handoffs:acknowledge', 'transfer_handoffs:read', 'transfer_handoffs:acknowledge')) then
    raise exception using errcode = 'MQ422', message = 'scopes are one or more of master_data:read, master_data:write, transactions:read, transactions:write, purchase_handoffs:read, purchase_handoffs:acknowledge, transfer_handoffs:read, transfer_handoffs:acknowledge',
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
