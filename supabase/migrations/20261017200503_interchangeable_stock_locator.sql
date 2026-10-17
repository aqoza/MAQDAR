-- Step 17b: optional same-unit, two-way interchangeable stock observations.
-- Additive result fields; exact-only remains the default. No table/data changes.
-- Roll back the web build; retain this backwards-compatible read-only RPC.
create or replace function public.stock_locator(
  p_organization_id uuid, p_item_code text, p_receiving_code text, p_unit text, p_day date,
  p_filters jsonb default '{}', p_page integer default 1, p_size integer default 25
)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  filters jsonb:=coalesce(p_filters,'{}');
  receiving public.locations; item public.items; result jsonb; tokens text[];
  candidates jsonb; additions jsonb; seen uuid[]; frontier uuid[];
  scope text:=coalesce(filters->>'scope','exact');
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
  if exists(select 1 from jsonb_each(filters) f where f.key not in ('q','view','scope')
      or jsonb_typeof(f.value) is distinct from 'string' or char_length(f.value#>>'{}')>100
      or (f.value#>>'{}') ~ '[[:cntrl:]]')
    or coalesce(filters->>'view','matching') not in ('matching','other','all')
    or scope not in ('exact','interchangeable') then
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
  candidates:=jsonb_build_array(jsonb_build_object('id',item.id,'path',jsonb_build_array(item.id)));
  seen:=array[item.id]; frontier:=seen;
  -- Breadth-first expansion visits each item once, including cyclic graphs. Each retained
  -- shortest-hop path is deterministic, not a preferred substitution or priority ranking.
  -- Catalog units qualify connections only; they never relabel stock observations.
  if scope='interchangeable' and item.unit_of_measure=p_unit then
    loop
      select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'path',n.path) order by n.id),'[]'::jsonb)
        into additions from (
        select distinct on (target.id) target.id,
          (parent->'path')||jsonb_build_array(target.id) as path
        from jsonb_array_elements(candidates) parent
        join public.items origin on origin.organization_id=p_organization_id and origin.id=(parent->>'id')::uuid
        join public.item_interchanges e on e.organization_id=p_organization_id and e.direction='two_way'
          and (e.item_id=origin.id or e.alternate_item_id=origin.id)
        join public.items target on target.organization_id=p_organization_id
          and target.id=case when e.item_id=origin.id then e.alternate_item_id else e.item_id end
        where origin.id=any(frontier) and origin.unit_of_measure=p_unit and target.unit_of_measure=p_unit
          and not(target.id=any(seen))
        order by target.id,origin.id,e.id limit 101
      ) n;
      exit when jsonb_array_length(additions)=0;
      if jsonb_array_length(candidates)+jsonb_array_length(additions)>100 then
        raise exception using errcode='MQ422',message='interchange group exceeds 100 items',hint='group_limit';
      end if;
      frontier:=array(select (n->>'id')::uuid from jsonb_array_elements(additions) n);
      seen:=seen||frontier; candidates:=candidates||additions;
    end loop;
  end if;
  tokens:=regexp_split_to_array(app.normalize_search(coalesce(filters->>'q','')),' +');
  with observations as (
    select l.id,l.code,l.name_en,l.name_ar,l.city,l.country_code,l.latitude,l.longitude,
      i.code as item_code,i.id as item_id,
      jsonb_build_object('id',i.id,'code',i.code,'name_en',i.name_en,'name_ar',i.name_ar,
        'status',i.status,'unit',i.unit_of_measure,'updated_at',i.updated_at) as item,
      case when i.id=item.id then 'exact' else 'interchangeable' end as match_kind,
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
    cross join jsonb_array_elements(candidates) candidate
    join public.items i on i.organization_id=p_organization_id and i.id=(candidate->>'id')::uuid
    left join lateral (
      -- Choose the latest dated observation BEFORE checking unit, age or quantity. Never fall back to older favorable stock.
      select s.* from public.stock_snapshots s
      where s.organization_id=p_organization_id and s.item_id=i.id and s.location_id=l.id
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
  ), page_rows as materialized (
    select * from matching order by (status='matching') desc,distance nulls last,code collate "C",id,item_code collate "C",item_id
      limit p_size offset ((select page from paging)-1)*p_size
  ), paths as materialized (
    -- Traversal carries compact item IDs. Expand metadata once per item on this page,
    -- rather than repeatedly copying long relationship records during graph discovery.
    select (c->>'id')::uuid as item_id,coalesce((
      select jsonb_agg(jsonb_build_object('id',e.id,'direction',e.direction,
        'from_code',origin.code,'to_code',target.code,'unit',p_unit,'priority',e.priority,
        'updated_at',e.updated_at,'from_updated_at',origin.updated_at,'to_updated_at',target.updated_at) order by step.position)
      from (
        select node::uuid as target_id,lag(node::uuid) over(order by position) as origin_id,position
        from jsonb_array_elements_text(c->'path') with ordinality as nodes(node,position)
      ) step
      join public.items origin on origin.organization_id=p_organization_id and origin.id=step.origin_id
      join public.items target on target.organization_id=p_organization_id and target.id=step.target_id
      join public.item_interchanges e on e.organization_id=p_organization_id and e.direction='two_way'
        and ((e.item_id=origin.id and e.alternate_item_id=target.id)
          or (e.alternate_item_id=origin.id and e.item_id=target.id))
    ),'[]'::jsonb) as path
    from jsonb_array_elements(candidates) c where (c->>'id')::uuid in(select item_id from page_rows)
  )
  select jsonb_build_object('total',paging.total,'page',paging.page,'size',p_size,'checked_at',statement_timestamp(),
    'day',p_day,'unit',p_unit,'scope',scope,'item_count',jsonb_array_length(candidates),
    'relationship_status',case when scope='exact' then 'not_requested'
      when item.unit_of_measure<>p_unit then 'unit_mismatch' else 'ready' end,
    'item',jsonb_build_object('id',item.id,'code',item.code,'name_en',item.name_en,'name_ar',item.name_ar),
    'receiving',jsonb_build_object('id',receiving.id,'code',receiving.code,'name_en',receiving.name_en,
      'name_ar',receiving.name_ar,'latitude',receiving.latitude,'longitude',receiving.longitude),
    'counts',(select jsonb_build_object('matching',count(*) filter(where status='matching'),
      'other',count(*) filter(where status<>'matching')) from evidence),
    -- Attach potentially long paths only after paging, not to every item/location observation.
    'rows',coalesce((select jsonb_agg((to_jsonb(r)-'distance'-'item_code'-'item_id')||jsonb_build_object(
      'relationship_path',(select p.path from paths p where p.item_id=r.item_id))
      order by (r.status='matching') desc,r.distance nulls last,r.code collate "C",r.id,r.item_code collate "C",r.item_id)
      from page_rows r),'[]'::jsonb)) into result from paging;
  return result;
end;
$$;
revoke all on function public.stock_locator(uuid,text,text,text,date,jsonb,integer,integer) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.stock_locator(uuid,text,text,text,date,jsonb,integer,integer) to authenticated;
comment on function public.stock_locator(uuid,text,text,text,date,jsonb,integer,integer) is
  'Member stock observations with both-location access; latest dated snapshot, known matching unit and seven-day freshness. Distance and lanes use current master data. Optional current same-unit two-way connections; separate item/location rows, never pooled. No surplus, route, arrival or reservation promise.';
