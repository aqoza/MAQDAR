-- Private, durable onboarding. No API role can read or mutate queue/policy tables directly.
create schema if not exists onboarding;
revoke all on schema onboarding from public, anon, authenticated, service_role;

create table onboarding.policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  organization_daily integer not null check (organization_daily between 100 and 10000),
  inviter_daily integer not null check (inviter_daily between 50 and 10000),
  valid_until timestamptz not null,
  reason text not null check (length(trim(reason)) between 10 and 500)
);
create table onboarding.attempts (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  invitation_id uuid not null references public.organization_invitations(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index on onboarding.attempts (organization_id, attempted_at);
create index on onboarding.attempts (actor_id, attempted_at);
-- Preserve the old limiter's rolling-window history when introducing a true attempt ledger.
insert into onboarding.attempts (organization_id, actor_id, invitation_id, attempted_at)
select organization_id, invited_by, id, last_sent_at from public.organization_invitations
where last_sent_at > now() - interval '24 hours';

create table onboarding.batches (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  role text not null,
  fingerprint text not null,
  unique (organization_id, id)
);
create table onboarding.jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references onboarding.batches(id) on delete cascade,
  email text not null,
  state text not null default 'queued' check (state in ('queued','sending','sent','failed','uncertain','cancelled','skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease uuid,
  lease_until timestamptz,
  invitation_id uuid references public.organization_invitations(id) on delete set null,
  result_code text,
  unique (batch_id, email)
);
create index on onboarding.jobs (next_attempt_at, id) where state = 'queued';
create index on onboarding.jobs (batch_id);
create index jobs_sending_lease_idx on onboarding.jobs (lease_until) where state = 'sending';
create table onboarding.delivery_control (
  singleton boolean primary key default true check (singleton),
  next_send_at timestamptz not null default '-infinity'
);
insert into onboarding.delivery_control default values;

alter table onboarding.policies enable row level security;
alter table onboarding.attempts enable row level security;
alter table onboarding.batches enable row level security;
alter table onboarding.jobs enable row level security;
alter table onboarding.delivery_control enable row level security;
revoke all on all tables in schema onboarding from public, anon, authenticated, service_role;
revoke all on all sequences in schema onboarding from public, anon, authenticated, service_role;

-- Owner-approved three-month enterprise POC. Every other workspace retains the 100/50 defaults.
-- The existing OTE binding is already public deployment configuration in wrangler.jsonc.
insert into onboarding.policies(organization_id,organization_daily,inviter_daily,valid_until,reason)
select id,2000,2000,now()+interval '90 days','Approved OTE enterprise POC: onboard more than 1000 users with paced transactional invitations'
from public.organizations where id='49727e18-35a9-462f-998f-9f202f963dfc';

-- Both interactive and queued sends use exactly the same guarded invitation preparation.
create function onboarding.prepare_invitation(p_actor uuid, p_organization_id uuid, p_email text, p_role text)
returns table(id uuid, email text, resend boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_email text := lower(trim(p_email));
  v_existing public.organization_invitations%rowtype;
  v_id uuid;
  v_org_limit integer := 100;
  v_actor_limit integer := 50;
begin
  if v_email is null or length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = 'MQ422', message = 'invalid email';
  end if;
  if p_role is null or not (p_role = any(array['owner','admin','planner','approver','branch_user','viewer'])) then
    raise exception using errcode = 'MQ422', message = 'unknown role';
  end if;
  -- Serialize org and actor quotas, including concurrent requests for different addresses/orgs.
  perform pg_advisory_xact_lock(hashtextextended('zeespare.invite.org:' || p_organization_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('zeespare.invite.actor:' || p_actor::text, 0));
  select m.role into v_role from public.memberships m
  where m.organization_id = p_organization_id and m.user_id = p_actor for share;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception using errcode = 'MQ403', message = 'administrator membership required';
  end if;
  if v_role = 'admin' and p_role = 'owner' then
    raise exception using errcode = 'MQ422', message = 'only owners invite owners';
  end if;
  if exists (select 1 from public.memberships m join auth.users u on u.id=m.user_id
             where m.organization_id=p_organization_id and lower(u.email)=v_email) then
    raise exception using errcode='MQ409', message='already a member';
  end if;
  if exists (select 1 from public.organization_invitations i where i.organization_id=p_organization_id
             and i.email=v_email and i.last_sent_at > now()-interval '2 minutes') then
    raise exception using errcode='MQ429', message='an invitation was sent less than two minutes ago';
  end if;
  if (select count(*) from public.organization_invitations i where i.organization_id=p_organization_id
      and i.email=v_email and i.created_at > now()-interval '24 hours') >= 5 then
    raise exception using errcode='MQ429', message='too many invitations to this address today';
  end if;
  select coalesce(p.organization_daily,100), coalesce(p.inviter_daily,50)
    into v_org_limit,v_actor_limit from (values(1)) x(n)
    left join onboarding.policies p on p.organization_id=p_organization_id and p.valid_until>now();
  if (select count(*) from onboarding.attempts a where a.organization_id=p_organization_id
      and a.attempted_at > now()-interval '24 hours') >= v_org_limit then
    raise exception using errcode='MQ429', message='too many invitations from this organization today';
  end if;
  if (select count(*) from onboarding.attempts a where a.actor_id=p_actor
      and a.attempted_at > now()-interval '24 hours') >= v_actor_limit then
    raise exception using errcode='MQ429', message='too many invitations sent by you today';
  end if;
  select * into v_existing from public.organization_invitations i where i.organization_id=p_organization_id
    and i.email=v_email and i.accepted_at is null and i.revoked_at is null for update;
  if found then
    if v_role='admin' and v_existing.role='owner' then
      raise exception using errcode='MQ403', message='only owners manage owner invitations';
    end if;
    if v_existing.send_count >= 10 then
      raise exception using errcode='MQ429', message='this invitation has been sent too many times';
    end if;
    update public.organization_invitations i set role=p_role, invited_by=p_actor,
      send_count=i.send_count+1, last_sent_at=now(), expires_at=now()+interval '7 days'
      where i.id=v_existing.id returning i.id into v_id;
  else
    insert into public.organization_invitations (organization_id,email,role,invited_by)
      values(p_organization_id,v_email,p_role,p_actor) returning organization_invitations.id into v_id;
  end if;
  insert into onboarding.attempts(organization_id,actor_id,invitation_id) values(p_organization_id,p_actor,v_id);
  return query select v_id,v_email,v_existing.id is not null;
end;
$$;
revoke all on function onboarding.prepare_invitation(uuid,uuid,text,text) from public,anon,authenticated,service_role;

create or replace function public.invite_member(p_organization_id uuid,p_email text,p_role text)
returns table(id uuid,email text,resend boolean)
language plpgsql security definer set search_path='' as $$
begin
  return query select * from onboarding.prepare_invitation(app.require_user(),p_organization_id,p_email,p_role);
end;
$$;

create function public.onboarding_enqueue(p_organization_id uuid,p_batch_id uuid,p_emails text[],p_role text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := app.require_user();
  v_role text;
  v_emails text[];
  v_hash text;
  v_existing onboarding.batches%rowtype;
begin
  v_role := app.require_role(p_organization_id,array['owner','admin']);
  perform pg_advisory_xact_lock(hashtextextended('zeespare.invite.org:'||p_organization_id::text,0));
  perform app.require_role(p_organization_id,array['owner','admin']);
  if p_batch_id is null or p_emails is null or cardinality(p_emails) not between 1 and 2000
     or p_role is null or p_role not in ('admin','planner','approver','branch_user','viewer') then
    raise exception using errcode='MQ422',message='invalid bulk invitation';
  end if;
  if exists(select 1 from unnest(p_emails) e where e is null or length(trim(e))>254
    or trim(e) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception using errcode='MQ422',message='invalid email';
  end if;
  select array_agg(distinct lower(trim(e)) order by lower(trim(e))) into v_emails from unnest(p_emails) e;
  if cardinality(v_emails)<>cardinality(p_emails) then
    raise exception using errcode='MQ422',message='duplicate email';
  end if;
  v_hash := md5(p_role || ':' || array_to_string(v_emails,E'\n'));
  select * into v_existing from onboarding.batches b where b.id=p_batch_id;
  if found then
    if v_existing.organization_id<>p_organization_id or v_existing.created_by<>v_actor or v_existing.fingerprint<>v_hash then
      raise exception using errcode='MQ409',message='batch identity conflict';
    end if;
    return p_batch_id;
  end if;
  -- An operator must explicitly approve a dated enterprise policy; tenant admins cannot raise caps.
  if not exists(select 1 from onboarding.policies p where p.organization_id=p_organization_id and p.valid_until>now()) then
    raise exception using errcode='MQ403',message='enterprise onboarding is not enabled';
  end if;
  if (select count(*) from onboarding.batches b where b.organization_id=p_organization_id
      and b.created_at>now()-interval '24 hours')>=20 then
    raise exception using errcode='MQ429',message='too many onboarding batches today';
  end if;
  if (select count(*) from onboarding.batches b where b.organization_id=p_organization_id
      and exists(select 1 from onboarding.jobs j where j.batch_id=b.id and j.state in ('queued','sending')))>=20 then
    raise exception using errcode='MQ429',message='too many active onboarding batches';
  end if;
  if (select count(*) from onboarding.jobs j join onboarding.batches b on b.id=j.batch_id
      where b.organization_id=p_organization_id and j.state in ('queued','sending')) + cardinality(v_emails)>2000 then
    raise exception using errcode='MQ429',message='onboarding queue is full';
  end if;
  if exists(select 1 from onboarding.jobs j join onboarding.batches b on b.id=j.batch_id
      where b.organization_id=p_organization_id and j.state in ('queued','sending') and j.email=any(v_emails)) then
    raise exception using errcode='MQ409',message='an address is already queued';
  end if;
  insert into onboarding.batches(id,organization_id,created_by,role,fingerprint)
    values(p_batch_id,p_organization_id,v_actor,p_role,v_hash);
  insert into onboarding.jobs(batch_id,email) select p_batch_id,e from unnest(v_emails) e;
  return p_batch_id;
end;
$$;

create function public.onboarding_status(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform app.require_role(p_organization_id,array['owner','admin']);
  return jsonb_build_object('enabled',exists(select 1 from onboarding.policies p
    where p.organization_id=p_organization_id and p.valid_until>now()),
    'issues',coalesce((select jsonb_agg(x) from (
      select j.email,j.result_code from onboarding.jobs j join onboarding.batches b on b.id=j.batch_id
      where b.organization_id=p_organization_id and j.state in ('failed','uncertain')
      order by b.created_at desc,j.id limit 20
    ) x),'[]'::jsonb),'batches',coalesce((
    select jsonb_agg(x order by x.created_at desc,x.id) from (
      select b.id,b.created_at,b.role,count(j.id)::integer as total,
        count(*) filter(where j.state='sent')::integer as sent,
        count(*) filter(where j.state in ('queued','sending'))::integer as pending,
        count(*) filter(where j.state in ('failed','uncertain'))::integer as failed,
        count(*) filter(where j.state in ('skipped','cancelled'))::integer as skipped
      from (select * from onboarding.batches b where b.organization_id=p_organization_id and (
              exists(select 1 from onboarding.jobs active where active.batch_id=b.id and active.state in ('queued','sending'))
              or b.id in (select recent.id from onboarding.batches recent where recent.organization_id=p_organization_id
                           order by recent.created_at desc,recent.id limit 10))
            order by b.created_at desc,b.id) b
      join onboarding.jobs j on j.batch_id=b.id group by b.id,b.created_at,b.role
    ) x),'[]'::jsonb));
end;
$$;

create function public.onboarding_cancel(p_organization_id uuid,p_batch_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform app.require_role(p_organization_id,array['owner','admin']);
  perform 1 from onboarding.delivery_control where singleton for update;
  perform 1 from onboarding.batches b where b.id=p_batch_id and b.organization_id=p_organization_id for update;
  if not found then raise exception using errcode='MQ404',message='batch not found'; end if;
  perform app.require_role(p_organization_id,array['owner','admin']);
  -- Stop pending work; an already delivered invitation is managed/revoked separately in Settings.
  update public.organization_invitations i set revoked_at=now()
    from onboarding.jobs j where j.batch_id=p_batch_id and j.state='sending'
      and i.id=j.invitation_id and i.accepted_at is null and i.revoked_at is null;
  update onboarding.jobs set state='cancelled',lease=null,lease_until=null
    where batch_id=p_batch_id and state in ('queued','sending');
  return true;
end;
$$;

-- The cron consumer can only claim guarded work. No browser role can call these functions.
create function public.onboarding_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_next timestamptz;
  v_job onboarding.jobs%rowtype;
  v_batch onboarding.batches%rowtype;
  v_inv record;
  v_lease uuid;
  v_code text;
begin
  select next_send_at into v_next from onboarding.delivery_control where singleton for update;
  if v_next>clock_timestamp() then return null; end if;
  -- A crash may have happened after SMTP accepted mail. Hold expired leases for manual review.
  update onboarding.jobs set state='uncertain',result_code='lease_expired',lease=null
    where state='sending' and lease_until<now();
  for counter in 1..20 loop
    select * into v_job from onboarding.jobs j where j.state='queued' and j.next_attempt_at<=now()
      order by j.next_attempt_at,j.id limit 1 for update skip locked;
    if not found then return null; end if;
    select * into v_batch from onboarding.batches b where b.id=v_job.batch_id for update;
    if v_job.invitation_id is not null and not exists(select 1 from public.organization_invitations i
      where i.id=v_job.invitation_id and i.revoked_at is null and i.accepted_at is null) then
      update onboarding.jobs set state='cancelled',result_code='invitation_closed' where id=v_job.id;
      continue;
    end if;
    if v_batch.created_at<now()-interval '7 days' or not exists(select 1 from onboarding.policies p
      where p.organization_id=v_batch.organization_id and p.valid_until>now()) then
      update onboarding.jobs set state='failed',result_code='policy_expired' where id=v_job.id;
      continue;
    end if;
    begin
      select * into v_inv from onboarding.prepare_invitation(v_batch.created_by,v_batch.organization_id,v_job.email,v_batch.role);
    exception when sqlstate 'MQ403' or sqlstate 'MQ409' or sqlstate 'MQ422' or sqlstate 'MQ429' then
      get stacked diagnostics v_code=returned_sqlstate;
      update onboarding.jobs set state=case when v_code='MQ429' then 'queued' when v_code='MQ409' then 'skipped' else 'failed' end,
        result_code=v_code,next_attempt_at=now()+interval '1 hour' where id=v_job.id;
      continue;
    end;
    v_lease := gen_random_uuid();
    update onboarding.jobs set state='sending',attempts=attempts+1,lease=v_lease,lease_until=now()+interval '5 minutes',
      invitation_id=v_inv.id,result_code=null where id=v_job.id;
    update onboarding.delivery_control set next_send_at=clock_timestamp()+interval '12 seconds' where singleton;
    return jsonb_build_object('id',v_job.id,'lease',v_lease,'email',v_job.email,
      'invitation_id',v_inv.id,'organization_id',v_batch.organization_id);
  end loop;
  return null;
end;
$$;

create function public.onboarding_finish(p_job_id uuid,p_lease uuid,p_outcome text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_job onboarding.jobs%rowtype;
begin
  if p_outcome is null or p_outcome not in ('sent','retry','failed','uncertain') then
    raise exception using errcode='MQ422',message='invalid outcome';
  end if;
  -- Same lock order as claim: global control, then job. Never complete a replaced/cancelled lease.
  perform 1 from onboarding.delivery_control where singleton for update;
  select * into v_job from onboarding.jobs where id=p_job_id for update;
  if not found or v_job.state<>'sending' or v_job.lease is distinct from p_lease or v_job.lease_until<now() then
    raise exception using errcode='MQ409',message='stale delivery lease';
  end if;
  update onboarding.jobs set state=case when p_outcome='retry' and attempts<5 then 'queued'
      when p_outcome='retry' then 'failed' else p_outcome end,
    result_code=case when p_outcome='retry' then 'email_rate_limited' when p_outcome='uncertain' then 'delivery_unknown'
      when p_outcome='failed' then 'email_failed' else null end,
    next_attempt_at=now()+interval '1 hour',lease=null,lease_until=null where id=p_job_id;
  if p_outcome='retry' then
    update onboarding.delivery_control set next_send_at=greatest(next_send_at,now()+interval '15 minutes') where singleton;
  end if;
  return true;
end;
$$;

-- JSON pages are a single Data API row; never truncate at the global 1,000-row response cap.
create function public.organization_members_page(p_organization_id uuid,p_page integer default 1,
  p_search text default '',p_user_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_total bigint; v_rows jsonb; v_page integer;
begin
  perform app.require_role(p_organization_id,array['owner','admin']);
  if p_page is null or p_page not between 1 and 10000 or p_search is null or length(p_search)>254
    or cardinality(p_user_ids)>100 then raise exception using errcode='MQ422',message='invalid page'; end if;
  select count(*) into v_total from public.memberships m join auth.users u on u.id=m.user_id
    where m.organization_id=p_organization_id and position(lower(trim(p_search)) in lower(u.email))>0
      and (p_user_ids is null or m.user_id=any(p_user_ids));
  v_page := least(p_page,greatest(1,ceil(v_total/100.0)::integer));
  select coalesce(jsonb_agg(x order by x.created_at,x.user_id),'[]'::jsonb) into v_rows from (
    select m.user_id,u.email::text,m.role,m.created_at,
      array(select ml.location_id from public.membership_locations ml where ml.organization_id=m.organization_id
        and ml.user_id=m.user_id order by ml.location_id) as location_ids
    from public.memberships m join auth.users u on u.id=m.user_id where m.organization_id=p_organization_id
      and position(lower(trim(p_search)) in lower(u.email))>0 and (p_user_ids is null or m.user_id=any(p_user_ids))
    order by m.created_at,m.user_id limit 100 offset (v_page-1)*100
  ) x;
  return jsonb_build_object('rows',v_rows,'total',v_total,'page',v_page);
end;
$$;

create function public.organization_invitations_page(p_organization_id uuid,p_page integer default 1,p_search text default '')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_total bigint; v_rows jsonb; v_page integer;
begin
  perform app.require_role(p_organization_id,array['owner','admin']);
  if p_page is null or p_page not between 1 and 10000 or p_search is null or length(p_search)>254 then
    raise exception using errcode='MQ422',message='invalid page'; end if;
  select count(*) into v_total from public.organization_invitations i where i.organization_id=p_organization_id
    and i.accepted_at is null and i.revoked_at is null and position(lower(trim(p_search)) in i.email)>0;
  v_page := least(p_page,greatest(1,ceil(v_total/100.0)::integer));
  select coalesce(jsonb_agg(x order by x.created_at desc,x.id),'[]'::jsonb) into v_rows from (
    select i.id,i.email,i.role,i.created_at,i.last_sent_at,i.expires_at,i.send_count
    from public.organization_invitations i where i.organization_id=p_organization_id
      and i.accepted_at is null and i.revoked_at is null and position(lower(trim(p_search)) in i.email)>0
    order by i.created_at desc,i.id limit 100 offset (v_page-1)*100
  ) x;
  return jsonb_build_object('rows',v_rows,'total',v_total,'page',v_page);
end;
$$;

revoke all on function public.onboarding_enqueue(uuid,uuid,text[],text),public.onboarding_status(uuid),
  public.onboarding_cancel(uuid,uuid),public.organization_members_page(uuid,integer,text,uuid[]),
  public.organization_invitations_page(uuid,integer,text),public.onboarding_claim(),
  public.onboarding_finish(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.onboarding_enqueue(uuid,uuid,text[],text),public.onboarding_status(uuid),
  public.onboarding_cancel(uuid,uuid),public.organization_members_page(uuid,integer,text,uuid[]),
  public.organization_invitations_page(uuid,integer,text) to authenticated;
grant execute on function public.onboarding_claim(),public.onboarding_finish(uuid,uuid,text) to service_role;
