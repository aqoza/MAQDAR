-- Step 13d is additive and forward-only. Retain saved evidence on web rollback.
set lock_timeout = '5s';

create function public.purchase_cost_preview(p_organization_id uuid, p_delivery_id uuid, p_price_confirmed boolean)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  delivery public.delivery_scenarios; scenario public.supplier_scenarios;
  supplier public.suppliers; terms public.supplier_items;
  quantity numeric; product numeric; subtotal numeric; digits integer;
  order_day date; status text; result jsonb; price_valid boolean;
begin
  -- Explicit checks also protect invocation from the definer save RPC.
  if p_organization_id is null or not(p_organization_id = any(array(select app.member_organizations()))) then
    raise exception using errcode = 'MQ404', message = 'no such delivery scenario';
  end if;
  select * into delivery from public.delivery_scenarios
    where organization_id = p_organization_id and id = p_delivery_id
    and (organization_id = any(array(select app.unscoped_organizations()))
      or location_id = any(array(select app.scoped_locations())));
  if not found then raise exception using errcode = 'MQ404', message = 'no such delivery scenario'; end if;
  if p_price_confirmed is null then
    raise exception using errcode = 'MQ422', message = 'price confirmation is required';
  end if;
  select * into scenario from public.supplier_scenarios
    where organization_id = p_organization_id and id = delivery.supplier_scenario_id;
  quantity := (delivery.report->'source'->>'quantity')::numeric;
  order_day := (delivery.report->>'order_date')::date;
  select * into supplier from public.suppliers where organization_id = p_organization_id
    and id = (scenario.report->'supplier'->>'id')::uuid;
  -- Bind to the saved row and identities. Do not substitute a recreated row or same-code item.
  select * into terms from public.supplier_items where organization_id = p_organization_id
    and id = (scenario.report->'terms'->>'id')::uuid
    and supplier_id = (scenario.report->'supplier'->>'id')::uuid
    and item_id = (scenario.report->'source'->>'item_id')::uuid;
  select minor_units into digits from public.currencies where code = terms.currency;
  price_valid := terms.unit_price is not null and terms.unit_price::text ~ '^\d+(\.\d+)?$';
  status := case
    when scenario.report->>'status' is distinct from 'available' or quantity is null or quantity < 0
      or quantity::text !~ '^\d+(\.\d+)?$' then 'source_unavailable'
    when delivery.report->>'status' = 'no_order_needed' and quantity = 0 then 'no_order_needed'
    when delivery.report->>'status' is distinct from 'available' or order_day is null then 'source_unavailable'
    when quantity = 0 then 'no_order_needed'
    when supplier.id is null or not supplier.is_active then 'supplier_unavailable'
    when terms.id is null then 'terms_missing'
    when terms.unit_of_measure is null or delivery.report->'source'->>'unit' is null then 'unit_unknown'
    when terms.unit_of_measure is distinct from delivery.report->'source'->>'unit' then 'unit_mismatch'
    when not price_valid or digits is null then 'price_invalid'
    when terms.valid_from is null or not isfinite(terms.valid_from) then 'price_date_unknown'
    when terms.valid_from > order_day then 'price_not_effective'
    when not p_price_confirmed then 'price_unconfirmed'
    else 'available' end;
  if status = 'available' then
    -- Unbounded numeric preserves the exact product before a single half-up rounding.
    product := quantity * terms.unit_price;
    subtotal := round(product, digits);
    if subtotal > 999999999999999.999 then status := 'amount_out_of_range'; subtotal := null; end if;
  end if;
  result := jsonb_build_object('method', 'purchase-cost-v1', 'status', status,
    'location_id', delivery.location_id, 'price_confirmed', p_price_confirmed,
    'source', jsonb_build_object('delivery_id', delivery.id, 'delivery_fingerprint', delivery.report->>'fingerprint',
      'supplier_scenario_id', scenario.id, 'supplier_fingerprint', scenario.report->>'fingerprint',
      'draft_id', scenario.draft_id, 'item_id', scenario.report->'source'->>'item_id',
      'item_code', delivery.report->'source'->>'item_code', 'location_code', delivery.report->'source'->>'location_code',
      'supplier_id', scenario.report->'supplier'->>'id', 'supplier_code', delivery.report->'source'->>'supplier_code',
      'unit', delivery.report->'source'->>'unit', 'quantity', quantity::text,
      'cutoff', delivery.report->'source'->>'cutoff', 'order_date', order_day,
      'receipt_date', delivery.report->>'receipt_date',
      'policy_recalculation_required', delivery.report->'policy_recalculation_required'),
    'supplier', case when supplier.id is null then null else jsonb_build_object('id', supplier.id,
      'code', supplier.code, 'active', supplier.is_active, 'updated_at', supplier.updated_at) end,
    'price', case when terms.id is null then null else jsonb_build_object('terms_id', terms.id,
      'item_id', terms.item_id, 'supplier_id', terms.supplier_id, 'unit', terms.unit_of_measure,
      'unit_price', case when price_valid then terms.unit_price::text end, 'raw_unit_price', terms.unit_price::text,
      'currency', terms.currency, 'minor_units', digits, 'valid_from', terms.valid_from::text, 'updated_at', terms.updated_at) end,
    'exact_product', product::text, 'subtotal', subtotal::text, 'rounding', 'half-up-currency-minor-units');
  return result || jsonb_build_object('fingerprint', encode(sha256(convert_to(result::text, 'UTF8')), 'hex'));
end;
$$;
revoke all on function public.purchase_cost_preview(uuid,uuid,boolean) from public, anon, authenticated, service_role, maqdar_worker;
grant execute on function public.purchase_cost_preview(uuid,uuid,boolean) to authenticated;

create table public.purchase_cost_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  delivery_id uuid not null,
  location_id uuid not null,
  request_id uuid not null,
  submitted_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  report jsonb not null,
  unique (organization_id,id),
  unique (organization_id,request_id),
  foreign key (organization_id,delivery_id) references public.delivery_scenarios(organization_id,id) on delete cascade,
  foreign key (organization_id,location_id) references public.locations(organization_id,id) on delete cascade
);
comment on table public.purchase_cost_estimates is 'Immutable quantity times quoted unit price, without landed-cost adjustments or purchasing authority.';
create index purchase_cost_estimates_source on public.purchase_cost_estimates(organization_id,delivery_id,created_at desc,id);
create index purchase_cost_estimates_location on public.purchase_cost_estimates(organization_id,location_id);
alter table public.purchase_cost_estimates enable row level security;
revoke all on public.purchase_cost_estimates from public, anon, authenticated, service_role, maqdar_worker;
grant select on public.purchase_cost_estimates to authenticated;
create policy "members read" on public.purchase_cost_estimates for select to authenticated
  using (organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.purchase_cost_estimates as restrictive for select to authenticated
  using (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.purchase_cost_estimates
  for each row execute function app.audit_business_row();

create function public.purchase_cost_save(p_organization_id uuid, p_delivery_id uuid, p_price_confirmed boolean,
  p_request_id uuid, p_fingerprint text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare previous public.purchase_cost_estimates; report jsonb; result uuid;
begin
  if p_organization_id is null or auth.uid() is null
    or not(p_organization_id = any(array(select app.editable_organizations()))) then
    raise exception using errcode = 'MQ403', message = 'purchase cost estimate requires an editor';
  end if;
  if p_request_id is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_price_confirmed is null then
    raise exception using errcode = 'MQ422', message = 'invalid purchase cost request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('maqdar.purchase-cost:' || p_organization_id::text, 0));
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
$$;
revoke all on function public.purchase_cost_save(uuid,uuid,boolean,uuid,text) from public, anon, authenticated, service_role, maqdar_worker;
grant execute on function public.purchase_cost_save(uuid,uuid,boolean,uuid,text) to authenticated;

create view public.purchase_cost_list with (security_invoker = true) as
select id, organization_id, delivery_id, location_id, created_at, report->>'status' status,
  report->'source'->>'item_code' item_code, report->'source'->>'order_date' order_date,
  report->'price'->>'currency' currency, (report->'price'->>'minor_units')::integer minor_units,
  report->>'subtotal' subtotal
from public.purchase_cost_estimates;
revoke all on public.purchase_cost_list from public, anon, authenticated, service_role, maqdar_worker;
grant select on public.purchase_cost_list to authenticated;
reset lock_timeout;
