-- Step 19f is additive/forward-only. Web rollback retains schema and evidence.
set lock_timeout = '5s';
create table public.event_purchase_cost_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  delivery_id uuid not null,
  location_id uuid not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null,
  unique(organization_id,id), unique(organization_id,request_id),
  foreign key(organization_id,delivery_id) references public.event_delivery_scenarios(organization_id,id) on delete cascade,
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
create index event_purchase_cost_history on public.event_purchase_cost_estimates(organization_id,delivery_id,created_at desc,id);
create index event_purchase_cost_location on public.event_purchase_cost_estimates(organization_id,location_id);
alter table public.event_purchase_cost_estimates enable row level security;
revoke all on public.event_purchase_cost_estimates from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.event_purchase_cost_estimates to authenticated;
create policy "members read" on public.event_purchase_cost_estimates for select to authenticated
  using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.event_purchase_cost_estimates as restrictive for select to authenticated
  using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.event_purchase_cost_estimates
  for each row execute function app.audit_business_row();
comment on table public.event_purchase_cost_estimates is 'Fixed event delivery quantities priced independently under one confirmed quote; no landed costs or purchasing authority.';

create function public.event_purchase_cost_preview(p_organization_id uuid,p_delivery_id uuid,p_price_confirmed boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  source public.event_delivery_scenarios; supplier public.suppliers; receiver public.locations;
  terms public.supplier_items; result jsonb; status text; digits integer; order_day date;
  baseline numeric; adjusted numeric; baseline_product numeric; adjusted_product numeric;
  baseline_subtotal numeric; adjusted_subtotal numeric; increase numeric; price_valid boolean;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='event delivery unavailable';
  end if;
  select * into source from public.event_delivery_scenarios x where x.organization_id=p_organization_id and x.id=p_delivery_id
    and (x.organization_id=any(array(select app.unscoped_organizations())) or x.location_id=any(array(select app.scoped_locations())));
  if not found then raise exception using errcode='MQ404',message='event delivery unavailable'; end if;
  if p_price_confirmed is null then raise exception using errcode='MQ422',message='price confirmation required'; end if;
  if source.report->>'method' is distinct from 'event-delivery-v1'
    or source.report->>'location_id' is distinct from source.location_id::text
    or source.report#>>'{source,method}' is distinct from 'event-supplier-v1'
    or source.report#>>'{source,status}' is distinct from 'available'
    or coalesce(source.report#>>'{source,baseline,quantity}','')!~'^[0-9]{1,15}(\.[0-9]{1,3})?$'
    or coalesce(source.report#>>'{source,adjusted,quantity}','')!~'^[0-9]{1,15}(\.[0-9]{1,3})?$' then
    status:='source_unavailable';
  else
    baseline:=(source.report#>>'{source,baseline,quantity}')::numeric;
    adjusted:=(source.report#>>'{source,adjusted,quantity}')::numeric;
    order_day:=(source.report->>'order_date')::date;
    status:=case
      when adjusted<baseline then 'source_unavailable'
      when adjusted=0 and source.report->>'status'='no_order_needed' then 'no_order_needed'
      when source.report->>'status' is distinct from 'available' or adjusted=0
        or order_day is null or not isfinite(order_day) then 'source_unavailable'
      else null end;
  end if;
  if status is null then
    select * into supplier from public.suppliers where organization_id=p_organization_id
      and id=(source.report#>>'{source,supplier,id}')::uuid;
    select * into receiver from public.locations where organization_id=p_organization_id and id=source.location_id;
    -- Bind to the original row, not a recreated supplier/item pair or catalog code.
    select * into terms from public.supplier_items where organization_id=p_organization_id
      and id=(source.report#>>'{source,terms,id}')::uuid
      and supplier_id=(source.report#>>'{source,supplier,id}')::uuid
      and item_id=(source.report#>>'{source,draft,scenario,event,source,item_id}')::uuid;
    select minor_units into digits from public.currencies where code=terms.currency;
    price_valid:=terms.unit_price is not null and terms.unit_price::text~'^[0-9]+(\.[0-9]+)?$';
    status:=case
      when supplier.id is null or not supplier.is_active then 'supplier_unavailable'
      when receiver.id is null or not receiver.is_active then 'location_unavailable'
      when terms.id is null then 'terms_missing'
      when terms.unit_of_measure is null or source.report#>>'{source,draft,scenario,event,input,unit}' is null then 'unit_unknown'
      when terms.unit_of_measure is distinct from source.report#>>'{source,draft,scenario,event,input,unit}' then 'unit_mismatch'
      when not price_valid or digits is null then 'price_invalid'
      when terms.valid_from is null or not isfinite(terms.valid_from) then 'price_date_unknown'
      when terms.valid_from>order_day then 'price_not_effective'
      when not p_price_confirmed then 'price_unconfirmed'
      else 'available' end;
  end if;
  if status='available' then
    baseline_product:=baseline*terms.unit_price;
    adjusted_product:=adjusted*terms.unit_price;
    baseline_subtotal:=round(baseline_product,digits);
    adjusted_subtotal:=round(adjusted_product,digits);
    if greatest(baseline_subtotal,adjusted_subtotal)>999999999999999.999 then
      status:='amount_out_of_range'; baseline_subtotal:=null; adjusted_subtotal:=null;
    else increase:=adjusted_subtotal-baseline_subtotal; end if;
  end if;
  result:=jsonb_build_object('method','event-purchase-cost-v1','status',status,'location_id',source.location_id,
    'input',jsonb_build_object('delivery_id',source.id,'price_confirmed',p_price_confirmed),'source',source.report,
    'supplier',case when supplier.id is null then null else jsonb_build_object('id',supplier.id,'code',supplier.code,'name',supplier.name_en,'active',supplier.is_active,'updated_at',supplier.updated_at) end,
    'receiver',case when receiver.id is null then null else jsonb_build_object('id',receiver.id,'code',receiver.code,'name',receiver.name_en,'active',receiver.is_active,'updated_at',receiver.updated_at) end,
    'price',case when terms.id is null then null else jsonb_build_object('terms_id',terms.id,'item_id',terms.item_id,'supplier_id',terms.supplier_id,
      'unit',terms.unit_of_measure,'unit_price',case when price_valid then terms.unit_price::text end,'raw_unit_price',terms.unit_price::text,
      'currency',terms.currency,'minor_units',digits,'valid_from',terms.valid_from::text,'updated_at',terms.updated_at) end,
    'baseline',jsonb_build_object('quantity',baseline::text,'exact_product',baseline_product::text,'subtotal',baseline_subtotal::text),
    'adjusted',jsonb_build_object('quantity',adjusted::text,'exact_product',adjusted_product::text,'subtotal',adjusted_subtotal::text),
    'cost_increase',increase::text,'rounding','half-up-currency-minor-units');
  return result||jsonb_build_object('fingerprint',encode(extensions.digest(result::text,'sha256'),'hex'));
end; $$;
revoke all on function public.event_purchase_cost_preview(uuid,uuid,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_purchase_cost_preview(uuid,uuid,boolean) to authenticated;

create function public.event_purchase_cost_save(p_organization_id uuid,p_delivery_id uuid,p_price_confirmed boolean,p_request_id uuid,p_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.event_purchase_cost_estimates; report jsonb; result uuid;
begin
  if auth.uid() is null or p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='event cost save forbidden';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' or p_price_confirmed is null then
    raise exception using errcode='MQ422',message='invalid event cost save'; end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.event-cost:'||p_organization_id::text||':'||p_request_id::text,0));
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
end; $$;
revoke all on function public.event_purchase_cost_save(uuid,uuid,boolean,uuid,text) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_purchase_cost_save(uuid,uuid,boolean,uuid,text) to authenticated;
reset lock_timeout;
