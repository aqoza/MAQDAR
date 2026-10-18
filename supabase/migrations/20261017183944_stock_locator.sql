-- Step 17: read-only member stock locator. Roll back the web build; retain this additive RPC.
-- No master/transaction schema or data changes. Invoker rights preserve branch RLS throughout.
create function public.stock_locator(
  p_organization_id uuid, p_item_code text, p_receiving_code text, p_unit text, p_day date,
  p_filters jsonb default '{}', p_page integer default 1, p_size integer default 25
)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  filters jsonb:=coalesce(p_filters,'{}');
  receiving public.locations; item public.items; result jsonb; tokens text[];
begin
  if auth.uid() is null then
    raise exception using errcode='MQ401',message='sign in required',hint='auth';
  end if;
  if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='organization unavailable',hint='organization_id';
  end if;
  if p_item_code is null or p_item_code !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'
    or p_receiving_code is null or p_receiving_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or p_unit is null or p_unit not in ('EA','SET','L','KG')
    or p_day is null or not isfinite(p_day) or p_day not between date '0001-01-01' and date '9999-12-31'
    or p_page is null or p_page not between 1 and 100000 or p_size is null or p_size not in (25,50,100)
    or jsonb_typeof(filters) is distinct from 'object' or octet_length(filters::text)>4096 then
    raise exception using errcode='MQ422',message='invalid locator parameters',hint='filters';
  end if;
  if exists(select 1 from jsonb_each(filters) f where f.key not in ('q','view')
      or jsonb_typeof(f.value) is distinct from 'string' or char_length(f.value#>>'{}')>100
      or (f.value#>>'{}') ~ '[[:cntrl:]]')
    or coalesce(filters->>'view','matching') not in ('matching','other','all') then
    raise exception using errcode='MQ422',message='invalid locator filters',hint='filters';
  end if;
  select * into receiving from public.locations
    where organization_id=p_organization_id and code=p_receiving_code and is_active;
  if not found then
    raise exception using errcode='MQ404',message='receiving location unavailable',hint='receiving';
  end if;
  select * into item from public.items where organization_id=p_organization_id and code=p_item_code;
  if not found then
    raise exception using errcode='MQ404',message='item unavailable',hint='item';
  end if;
  tokens:=regexp_split_to_array(app.normalize_search(coalesce(filters->>'q','')),' +');
  with observations as (
    select l.id,l.code,l.name_en,l.name_ar,l.city,l.country_code,l.latitude,l.longitude,
      case when l.latitude is not null and l.longitude is not null
        and receiving.latitude is not null and receiving.longitude is not null then
        -- Spherical great-circle distance, mean Earth radius 6371.0088 km. Clamp roundoff at antipodes.
        2*6371.0088*asin(sqrt(least(1.0,greatest(0.0,
          power(sin(radians((l.latitude-receiving.latitude)::double precision)/2),2)
          +cos(radians(receiving.latitude::double precision))*cos(radians(l.latitude::double precision))
          *power(sin(radians((l.longitude-receiving.longitude)::double precision)/2),2)))))
      end as distance,
      case when s.id is null then 'missing'
        when s.snapshot_date<p_day-7 then 'stale'
        when s.unit_of_measure is null then 'unit_unknown'
        when s.unit_of_measure<>p_unit then 'unit_mismatch'
        when s.quantity-s.allocated_quantity<=0 then 'no_stock'
        else 'matching' end as status,
      case when s.id is not null then jsonb_build_object('id',s.id,'date',s.snapshot_date,
        'updated_at',s.updated_at,'age',p_day-s.snapshot_date,'unit',s.unit_of_measure,
        'quantity',s.quantity::text,'allocated',s.allocated_quantity::text,
        'net',(s.quantity-s.allocated_quantity)::text) end as snapshot,
      case when lane.id is not null then jsonb_build_object('id',lane.id,
        'p50',lane.lead_time_days_p50,'p90',lane.lead_time_days_p90,'updated_at',lane.updated_at) end as lane
    from public.locations l
    left join lateral (
      -- Choose the latest dated observation BEFORE checking unit, age or quantity. Never fall back to older favorable stock.
      select s.* from public.stock_snapshots s
      where s.organization_id=p_organization_id and s.item_id=item.id and s.location_id=l.id
        and s.snapshot_date<=p_day order by s.snapshot_date desc limit 1
    ) s on true
    left join public.network_links lane on lane.organization_id=p_organization_id
      and lane.from_location_id=l.id and lane.to_location_id=receiving.id and lane.is_active
    where l.organization_id=p_organization_id and l.is_active and l.id<>receiving.id
      and not exists(select 1 from unnest(tokens) token where token<>''
        and strpos(app.normalize_search(concat_ws(' ',l.code,l.name_en,l.name_ar,l.city,l.country_code)),token)=0)
  ), evidence as materialized (
    select o.*,round(o.distance::numeric,1) as distance_km from observations o
  ), matching as materialized (
    select * from evidence where coalesce(filters->>'view','matching')='all'
      or (coalesce(filters->>'view','matching')='matching' and status='matching')
      or (filters->>'view'='other' and status<>'matching')
  ), paging as (
    select count(*) as total,least(p_page,greatest(1,ceil(count(*)::numeric/p_size)::integer)) as page from matching
  )
  select jsonb_build_object('total',paging.total,'page',paging.page,'size',p_size,'checked_at',statement_timestamp(),
    'day',p_day,'unit',p_unit,
    'item',jsonb_build_object('id',item.id,'code',item.code,'name_en',item.name_en,'name_ar',item.name_ar),
    'receiving',jsonb_build_object('id',receiving.id,'code',receiving.code,'name_en',receiving.name_en,
      'name_ar',receiving.name_ar,'latitude',receiving.latitude,'longitude',receiving.longitude),
    'counts',(select jsonb_build_object('matching',count(*) filter(where status='matching'),
      'other',count(*) filter(where status<>'matching')) from evidence),
    'rows',coalesce((select jsonb_agg(to_jsonb(r)-'distance'
      order by (r.status='matching') desc,r.distance nulls last,r.code collate "C",r.id)
      from (select * from matching order by (status='matching') desc,distance nulls last,code collate "C",id
        limit p_size offset (paging.page-1)*p_size) r),'[]'::jsonb)) into result from paging;
  return result;
end;
$$;
revoke all on function public.stock_locator(uuid,text,text,text,date,jsonb,integer,integer) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.stock_locator(uuid,text,text,text,date,jsonb,integer,integer) to authenticated;
comment on function public.stock_locator(uuid,text,text,text,date,jsonb,integer,integer) is
  'Member stock observations with both-location access; latest dated snapshot, known matching unit and seven-day freshness. Distance and lanes use current master data. No surplus, route, arrival or reservation promise.';
