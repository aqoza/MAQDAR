-- Step 19i: additive, forward-only. Web rollback retains saved batch evidence.
set lock_timeout = '5s';

create table public.event_purchase_handoff_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  handoff_ids uuid[] not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  payload jsonb not null,
  unique(organization_id,id),
  unique(organization_id,handoff_ids),
  foreign key(organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
  check(array_ndims(handoff_ids)=1 and cardinality(handoff_ids) between 1 and 50),
  check(coalesce(payload->>'schema_version'='event-purchase-handoff-batch-v1' and payload->>'purpose'='planning_only',false))
);
create index event_purchase_handoff_batches_recent on public.event_purchase_handoff_batches(organization_id,created_at desc,id);
create index event_purchase_handoff_batches_location on public.event_purchase_handoff_batches(organization_id,location_id);
create index event_purchase_handoff_batches_members on public.event_purchase_handoff_batches using gin(handoff_ids);
alter table public.event_purchase_handoff_batches enable row level security;
revoke all on public.event_purchase_handoff_batches from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.event_purchase_handoff_batches to authenticated;
create policy "members read" on public.event_purchase_handoff_batches for select to authenticated using(organization_id=any(array(select app.member_organizations())));
create policy "branch scope" on public.event_purchase_handoff_batches as restrictive for select to authenticated using(organization_id=any(array(select app.unscoped_organizations())) or location_id=any(array(select app.scoped_locations())));
create trigger audit_business_row after insert or update or delete on public.event_purchase_handoff_batches for each row execute function app.audit_business_row();
comment on table public.event_purchase_handoff_batches is 'Immutable planning packages. Sorted unique handoff IDs are the retry identity. Overlap is allowed, never an order reservation. Copied evidence survives deletion of an individual source handoff; organization/location deletion cascades.';

create function public.event_purchase_handoff_batch_preview(p_organization_id uuid,p_handoff_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare ids uuid[]; evidence jsonb; line jsonb; first_line jsonb; summary jsonb;
  existing public.event_purchase_handoff_batches; total numeric:=0; baseline_total numeric:=0; current_price jsonb;
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='batch requires an editor';
  end if;
  if p_handoff_ids is null or cardinality(p_handoff_ids) not between 1 and 50
      or array_ndims(p_handoff_ids)<>1 then
    raise exception using errcode='MQ422',message='select 1 to 50 distinct handoffs',hint='batch_selection_invalid';
  end if;
  if array_position(p_handoff_ids,null) is not null then
    raise exception using errcode='MQ422',message='null handoff',hint='batch_selection_invalid';
  end if;
  select array_agg(distinct id order by id) into ids from unnest(p_handoff_ids) id;
  if cardinality(ids)<>cardinality(p_handoff_ids) then
    raise exception using errcode='MQ422',message='duplicate handoff',hint='batch_selection_invalid';
  end if;
  -- Explicit scope remains effective when invoked by the security-definer save RPC.
  select jsonb_agg(h.payload order by h.id) into evidence from public.event_purchase_handoffs h
    where h.organization_id=p_organization_id and h.id=any(ids)
      and (h.organization_id=any(array(select app.unscoped_organizations())) or h.location_id=any(array(select app.scoped_locations())));
  if coalesce(jsonb_array_length(evidence),0)<>cardinality(ids) then
    raise exception using errcode='MQ404',message='handoff unavailable';
  end if;
  select * into existing from public.event_purchase_handoff_batches b
    where b.organization_id=p_organization_id and b.handoff_ids=ids
      and (b.organization_id=any(array(select app.unscoped_organizations())) or b.location_id=any(array(select app.scoped_locations())));
  if found then
    -- A replay is not a fresh validation of historical planning evidence.
    return jsonb_build_object('existing_batch_id',existing.id,'summary',existing.payload->'summary','lines',existing.payload->'lines');
  end if;
  first_line:=evidence->0;
  for line in select value from jsonb_array_elements(evidence) loop
    if line#>>'{estimate,status}' is distinct from 'available'
        or coalesce((line#>>'{estimate,adjusted,quantity}')::numeric,0)<=0
        or line#>>'{estimate,source,source,draft,scenario,event,source,item_id}' is null
        or line#>>'{estimate,source,source,supplier,id}' is null
        or line#>>'{estimate,source,source,draft,scenario,event,input,unit}' is null
        or line#>>'{estimate,source,order_date}' is null
        or line#>>'{estimate,source,receipt_date}' is null
        or line#>>'{estimate,price,currency}' is null
        or line#>>'{estimate,price,minor_units}' is null
        or line#>>'{estimate,adjusted,subtotal}' is null
        or line#>>'{estimate,baseline,subtotal}' is null
        or line->>'selected_quantity_basis' is distinct from 'full_event_adjusted' then
      raise exception using errcode='MQ422',message='incomplete saved evidence',hint='batch_source_invalid';
    end if;
    if line#>'{estimate,source,policy_recalculation_required}' is distinct from 'false'::jsonb then
      raise exception using errcode='MQ422',message='policy recalculation required',hint='event_purchase_policy_required';
    end if;
    if line#>'{estimate,source,event_before_receipt}' is distinct from '[]'::jsonb then
      raise exception using errcode='MQ422',message='event timing review required',hint='event_purchase_timing_required';
    end if;
    if (line#>'{estimate,source,source,supplier,id}') is distinct from (first_line#>'{estimate,source,source,supplier,id}')
        or (line#>'{estimate,location_id}') is distinct from (first_line#>'{estimate,location_id}')
        or (line#>'{estimate,price,currency}') is distinct from (first_line#>'{estimate,price,currency}')
        or (line#>'{estimate,price,minor_units}') is distinct from (first_line#>'{estimate,price,minor_units}')
        or (line#>'{estimate,source,order_date}') is distinct from (first_line#>'{estimate,source,order_date}') then
      raise exception using errcode='MQ422',message='incompatible batch headers',hint='batch_group_mismatch';
    end if;
    if not exists(select 1 from public.event_purchase_review_list p where p.organization_id=p_organization_id
        and p.id=(line#>>'{proposal,id}')::uuid and p.selected) then
      raise exception using errcode='MQ409',message='selected approval required',hint='handoff_selection_changed';
    end if;
    current_price:=public.event_purchase_cost_preview(p_organization_id,(line#>>'{evidence,delivery_id}')::uuid,true);
    if current_price->>'status' is distinct from 'available'
        or current_price->>'fingerprint' is distinct from line#>>'{estimate,fingerprint}' then
      raise exception using errcode='MQ409',message='price evidence changed',hint='event_purchase_price_changed';
    end if;
    total:=total+(line#>>'{estimate,adjusted,subtotal}')::numeric;
    baseline_total:=baseline_total+(line#>>'{estimate,baseline,subtotal}')::numeric;
  end loop;
  if (select count(distinct value#>>'{estimate,source,source,draft,scenario,event,source,item_id}') from jsonb_array_elements(evidence))<>cardinality(ids)
      or (select count(distinct value#>>'{estimate,source,source,draft,scenario,event,source,item_code}') from jsonb_array_elements(evidence))<>cardinality(ids) then
    raise exception using errcode='MQ422',message='repeated item in batch',hint='batch_duplicate_item';
  end if;
  summary:=jsonb_build_object('supplier_id',first_line#>'{estimate,source,source,supplier,id}',
    'supplier_code',first_line#>'{estimate,source,source,supplier,code}',
    'location_id',first_line#>'{estimate,location_id}','location_code',first_line#>'{estimate,source,source,draft,scenario,event,source,location_code}',
    'currency',first_line#>'{estimate,price,currency}','minor_units',first_line#>'{estimate,price,minor_units}',
    'order_date',first_line#>'{estimate,source,order_date}','line_count',cardinality(ids),'subtotal',total::text,
    'baseline_subtotal',baseline_total::text,'cost_increase',(total-baseline_total)::text);
  return jsonb_build_object('existing_batch_id',null,'summary',summary,'lines',evidence);
end; $$;
revoke all on function public.event_purchase_handoff_batch_preview(uuid,uuid[]) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_purchase_handoff_batch_preview(uuid,uuid[]) to authenticated;

create function public.event_purchase_handoff_batch_create(p_organization_id uuid,p_handoff_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $$
declare report jsonb; ids uuid[]; result uuid:=gen_random_uuid(); captured timestamptz; snapshot jsonb;
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
    raise exception using errcode='MQ403',message='batch requires an editor';
  end if;
  -- Serializes set retries and proposal selection changes. Preview rechecks authority after waiting.
  perform pg_advisory_xact_lock(hashtextextended('maqdar.event-purchase-review:'||p_organization_id::text,0));
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
end; $$;
revoke all on function public.event_purchase_handoff_batch_create(uuid,uuid[]) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.event_purchase_handoff_batch_create(uuid,uuid[]) to authenticated;

create view public.event_purchase_handoff_batch_list with(security_invoker=true) as
select b.id,b.organization_id,b.location_id,b.handoff_ids,b.created_at,
  b.payload#>>'{summary,supplier_code}' as supplier_code,b.payload#>>'{summary,location_code}' as location_code,
  b.payload#>>'{summary,currency}' as currency,(b.payload#>>'{summary,minor_units}')::integer as minor_units,
  b.payload#>>'{summary,subtotal}' as subtotal,b.payload#>>'{summary,baseline_subtotal}' as baseline_subtotal,
  b.payload#>>'{summary,cost_increase}' as cost_increase,b.payload#>>'{summary,order_date}' as order_date,
  cardinality(b.handoff_ids) as line_count,
  (select count(*) from public.event_purchase_handoffs h join public.event_purchase_review_list p
    on p.organization_id=h.organization_id and p.id=h.proposal_id
    where h.organization_id=b.organization_id and h.id=any(b.handoff_ids) and p.selected)=cardinality(b.handoff_ids) as selected,
  (select count(*) from public.event_purchase_handoff_batches other where other.organization_id=b.organization_id
    and other.id<>b.id and other.handoff_ids && b.handoff_ids) as overlap_count,
  app.normalize_search((select string_agg(concat_ws(' ',value#>>'{estimate,source,source,draft,scenario,event,source,item_code}',value#>>'{estimate,source,source,draft,scenario,event,input,name}'),' ') from jsonb_array_elements(b.payload->'lines'))) as search_text
from public.event_purchase_handoff_batches b;
revoke all on public.event_purchase_handoff_batch_list from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.event_purchase_handoff_batch_list to authenticated;
reset lock_timeout;

-- Candidate picker exposes saved dates and reuse counts without copying payloads into the browser.
create view public.event_purchase_handoff_batch_candidates with(security_invoker=true) as
select p.*,h.payload#>>'{estimate,source,order_date}' as order_date,
  (select count(*) from public.event_purchase_handoff_batches b where b.organization_id=h.organization_id
    and b.handoff_ids @> array[h.id]) as batch_count
from public.event_purchase_handoff_list p join public.event_purchase_handoffs h on h.organization_id=p.organization_id and h.id=p.id;
revoke all on public.event_purchase_handoff_batch_candidates from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.event_purchase_handoff_batch_candidates to authenticated;
