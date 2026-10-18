-- Step 19d: independent supplier comparisons over immutable event-draft evidence.
-- Roll back the web build without deleting the additive schema or saved history.
set lock_timeout='5s';
create table public.event_supplier_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  draft_id uuid not null,
  location_id uuid not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null,
  unique(organization_id,id),
  unique(organization_id,request_id),
  foreign key(organization_id,draft_id) references public.event_replenishment_drafts(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
create index event_supplier_history on public.event_supplier_scenarios(organization_id,draft_id,created_at desc,id);
create index event_supplier_location on public.event_supplier_scenarios(organization_id,location_id);
alter table public.event_supplier_scenarios enable row level security;
revoke all on public.event_supplier_scenarios from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.event_supplier_scenarios to authenticated;
create policy "members read" on public.event_supplier_scenarios for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.event_supplier_scenarios as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.event_supplier_scenarios
  for each row execute function app.audit_business_row();
comment on table public.event_supplier_scenarios is 'Fixed event-draft gaps rounded using one supplier term snapshot. No refreshed commitments, reservations or purchasing execution.';

create function public.event_supplier_preview(p_organization_id uuid,p_draft_id uuid,p_supplier_code text,p_terms_confirmed boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  d public.event_replenishment_drafts; s public.suppliers; terms public.supplier_items;
  status text; result jsonb; comparisons jsonb:='{}'; key text; unit text; lead integer; item uuid;
  gap numeric; quantity numeric; required_milli numeric; pack_milli numeric;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='event draft unavailable';
  end if;
  select * into d from public.event_replenishment_drafts x where x.organization_id=p_organization_id and x.id=p_draft_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='event draft unavailable'; end if;
  if p_supplier_code is null or p_supplier_code!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' or p_terms_confirmed is null then
    raise exception using errcode='MQ422',message='select supplier and confirm terms';
  end if;
  -- Item, unit and lead time come from the saved draft, never a refreshed policy.
  unit:=d.report#>>'{scenario,event,input,unit}';
  if coalesce(d.report#>>'{scenario,event,source,item_id}','')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    item:=(d.report#>>'{scenario,event,source,item_id}')::uuid;
  end if;
  if coalesce(d.report#>>'{scenario,policy,evidence,options,lead_time}','')~'^[0-9]{1,2}$' then
    lead:=(d.report#>>'{scenario,policy,evidence,options,lead_time}')::integer;
  end if;
  select * into s from public.suppliers where organization_id=p_organization_id and code=p_supplier_code;
  select * into terms from public.supplier_items where organization_id=p_organization_id
    and item_id=item and supplier_id=s.id;
  status:=case
    when item is null or d.report->>'method' is distinct from 'event-replenishment-v1' or d.report->>'status' is distinct from 'available'
      or d.location_id::text is distinct from d.report->>'location_id'
      or coalesce(d.report->>'baseline_gap','')!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
      or coalesce(d.report->>'adjusted_gap','')!~'^[0-9]{1,15}(\.[0-9]{1,3})?$' then 'draft_unavailable'
    when lead is null then 'policy_unavailable'
    when s.id is null then 'supplier_missing'
    when not s.is_active then 'supplier_inactive'
    when terms.id is null then 'terms_missing'
    when unit is null or unit not in ('EA','SET','L','KG') or terms.unit_of_measure is null then 'unit_unknown'
    when terms.unit_of_measure is distinct from unit then 'unit_mismatch'
    when terms.lead_time_days is distinct from lead then 'lead_time_mismatch'
    when not p_terms_confirmed then 'terms_unconfirmed'
    else 'available' end;
  if status='available' then
    if (d.report->>'adjusted_gap')::numeric<(d.report->>'baseline_gap')::numeric then status:='draft_unavailable';
    else
      foreach key in array array['baseline','adjusted'] loop
        gap:=(d.report->>(key||'_gap'))::numeric;
        if gap=0 then quantity:=0;
        else
          -- Same exact quotient/remainder rule as supplier-rounding-v1. A division
          -- rounded before ceil would cross pack boundaries at large magnitudes.
          required_milli:=greatest(gap,terms.min_order_quantity)*1000;
          pack_milli:=terms.pack_size*1000;
          quantity:=(div(required_milli,pack_milli)+case when mod(required_milli,pack_milli)>0 then 1 else 0 end)*pack_milli/1000;
        end if;
        if quantity>999999999999999.999 then status:='quantity_out_of_range'; comparisons:='{}'; exit; end if;
        comparisons:=comparisons||jsonb_build_object(key,jsonb_build_object('gap',trim_scale(gap)::text,
          'quantity',trim_scale(quantity)::text,'overage',trim_scale(quantity-gap)::text));
      end loop;
    end if;
  end if;
  result:=jsonb_build_object('method','event-supplier-v1','status',status,'location_id',d.location_id,
    'input',jsonb_build_object('draft_id',d.id,'supplier_code',p_supplier_code,'terms_confirmed',p_terms_confirmed),
    'draft',d.report,
    'supplier',case when s.id is null then null else jsonb_build_object('id',s.id,'code',s.code,'name',s.name_en,'active',s.is_active,'updated_at',s.updated_at) end,
    'terms',case when terms.id is null then null else jsonb_build_object('id',terms.id,'unit',terms.unit_of_measure,
      'moq',trim_scale(terms.min_order_quantity)::text,'pack',trim_scale(terms.pack_size)::text,'lead_time',terms.lead_time_days,'updated_at',terms.updated_at) end,
    'baseline',comparisons->'baseline','adjusted',comparisons->'adjusted',
    'quantity_increase',trim_scale((comparisons#>>'{adjusted,quantity}')::numeric-(comparisons#>>'{baseline,quantity}')::numeric)::text);
  return result||jsonb_build_object('fingerprint',encode(extensions.digest(result::text,'sha256'),'hex'));
end; $$;
revoke all on function public.event_supplier_preview(uuid,uuid,text,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_supplier_preview(uuid,uuid,text,boolean) to authenticated;

create function public.event_supplier_save(p_organization_id uuid,p_draft_id uuid,p_supplier_code text,p_terms_confirmed boolean,p_request_id uuid,p_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.event_supplier_scenarios; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event supplier save forbidden';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$'
    or p_supplier_code is null or p_supplier_code!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' or p_terms_confirmed is null then
    raise exception using errcode='MQ422',message='invalid event supplier save';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.event-supplier:'||p_organization_id::text||':'||p_request_id::text,0));
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
end; $$;
revoke all on function public.event_supplier_save(uuid,uuid,text,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_supplier_save(uuid,uuid,text,boolean,uuid,text) to authenticated;
reset lock_timeout;
