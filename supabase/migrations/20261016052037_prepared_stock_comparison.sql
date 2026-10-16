-- Step 12d: additive captured evidence and read-only group comparison.
-- No historical evidence is backfilled; rollback is a reviewed forward migration.
set lock_timeout='5s';

create or replace function app.preparation_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' set plan_cache_mode=force_custom_plan as $$
declare r public.planning_runs; l planning.leases; result jsonb;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if not found or r.status<>'running' or r.kind<>'preparation' then return null; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return null; end if;
  select payload into result from planning.preparation_inputs where run_id=r.id;
  if found then return result; end if;
  -- One statement captures graph, observations and calendar under one MVCC snapshot.
  with recursive edges(a,b) as materialized (
    select predecessor_item_id,successor_item_id from public.item_supersessions where organization_id=r.organization_id and effective_on<=r.to_date
    union all select item_id,alternate_item_id from public.item_interchanges where organization_id=r.organization_id and direction='two_way'
  ), seeds as materialized (
    select id from public.items where organization_id=r.organization_id and code in (select jsonb_array_elements_text(r.options->'item_codes'))
  ), connected(id) as (
    select id from seeds union
    select case when e.a=c.id then e.b else e.a end from connected c join edges e on e.a=c.id or e.b=c.id
  ), bounded as materialized (select id from connected limit 101), catalog as materialized (
    select i.* from public.items i join bounded b on b.id=i.id where i.organization_id=r.organization_id
  ), history as (
    select d.item_id,jsonb_agg(jsonb_build_array(d.demand_date,d.quantity::text,d.lost_sales_quantity::text) order by d.demand_date) demand,
      bool_or(d.unit_of_measure<>i.unit_of_measure and d.demand_date>=coalesce(i.introduced_on,r.from_date) and d.demand_date<=coalesce(i.discontinued_on,r.to_date)) unit_conflict,
      count(*) filter(where d.demand_date>=coalesce(i.introduced_on,r.from_date) and d.demand_date<=coalesce(i.discontinued_on,r.to_date)) unit_rows,
      count(*) filter(where d.demand_date>=coalesce(i.introduced_on,r.from_date) and d.demand_date<=coalesce(i.discontinued_on,r.to_date) and d.unit_of_measure is null) unknown_rows,
      array_agg(distinct d.unit_of_measure order by d.unit_of_measure) filter(where d.demand_date>=coalesce(i.introduced_on,r.from_date) and d.demand_date<=coalesce(i.discontinued_on,r.to_date) and d.unit_of_measure is not null) units
    from public.demand_history d join catalog i on i.id=d.item_id
    where d.organization_id=r.organization_id and d.location_id=r.location_id and d.demand_date between r.from_date and r.to_date
    group by d.item_id
  ), context as (
    select jsonb_build_object('country',c.code,'calendar_id',w.id,'calendar_code',w.code,
      'weekend_days',coalesce(w.weekend_days,c.weekend_days),'observe_public_holidays',coalesce(w.observe_public_holidays,true),
      'active',coalesce(w.is_active,true),'coverage_from',c.holiday_coverage_from,'coverage_to',c.holiday_coverage_to,
      'holidays',coalesce((select jsonb_agg(jsonb_build_object('date',h.holiday_date,'sector',h.sector,'name',h.name_en,'source',h.source) order by h.holiday_date,h.sector)
        from public.public_holidays h where h.country_code=c.code and h.holiday_date between r.from_date and r.to_date),'[]'::jsonb),
      'windows',coalesce((select jsonb_agg(to_jsonb(v) order by v.hijri_year) from public.ramadan_windows v where v.country_code=c.code),'[]'::jsonb),
      'overrides',coalesce((select jsonb_agg(jsonb_build_object('calendar_id',o.work_calendar_id,'starts_on',o.starts_on,'ends_on',o.ends_on,'kind',o.kind,'name',o.name_en) order by o.id)
        from public.holiday_overrides o where o.organization_id=r.organization_id and (o.work_calendar_id=w.id or o.country_code=c.code)
        and o.starts_on<=r.to_date and o.ends_on>=r.from_date),'[]'::jsonb)) payload
    from public.locations loc left join public.work_calendars w on w.organization_id=loc.organization_id and w.id=loc.work_calendar_id
    join public.countries c on c.code=coalesce(w.country_code,loc.country_code)
    where loc.organization_id=r.organization_id and loc.id=r.location_id
  )
  select jsonb_build_object('kind','preparation','method','preparation-v1','computed_at',statement_timestamp(),
    'from_date',r.from_date,'to_date',r.to_date,'selected_count',(select count(*) from seeds),'calendar',(select payload from context),
    'items',(select coalesce(jsonb_agg(jsonb_build_object('item_id',i.id,'item_code',i.code,'item_name',i.name_en,'unit',i.unit_of_measure,'unit_conflict',coalesce(h.unit_conflict,false),
      'unit_provenance',app.demand_unit_evidence(coalesce(h.unit_rows,0),coalesce(h.unknown_rows,0),coalesce(h.units,array[]::text[])),
      'introduced_on',i.introduced_on,'discontinued_on',i.discontinued_on,'demand',coalesce(h.demand,'[]'::jsonb)) order by i.id),'[]'::jsonb)
      from catalog i left join history h on h.item_id=i.id),
    'supersessions',(select coalesce(jsonb_agg(jsonb_build_object('predecessor',s.predecessor_item_id,'successor',s.successor_item_id,'effective_on',s.effective_on,'factor',s.quantity_factor::text) order by s.id),'[]'::jsonb)
      from public.item_supersessions s where s.organization_id=r.organization_id and s.predecessor_item_id in (select id from bounded) and s.successor_item_id in (select id from bounded)),
    'interchanges',(select coalesce(jsonb_agg(jsonb_build_object('item',e.item_id,'alternate',e.alternate_item_id,'direction',e.direction) order by e.id),'[]'::jsonb)
      from public.item_interchanges e where e.organization_id=r.organization_id and e.item_id in (select id from bounded) and e.alternate_item_id in (select id from bounded))) into result;
  if (result->>'selected_count')::integer<>jsonb_array_length(r.options->'item_codes') or jsonb_array_length(result->'items') not between 1 and 100
    or result->'calendar'='null'::jsonb or octet_length(result::text)>8000000 then
    raise exception using errcode='MQ422',message='preparation input unavailable or exceeds source limits';
  end if;
  if l.expires_at<=clock_timestamp() then return null; end if;
  insert into planning.preparation_inputs(run_id,payload) values(r.id,result);
  return result;
end; $$;

-- Derive stock eligibility only from a saved preparation, never the live graph.
-- Called by the guarded forecast task; no new worker/session capability.
create or replace function app.prepared_stock_evidence(p_source jsonb,p_output jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare items jsonb:=p_source->'items'; members jsonb; provenance jsonb; status text;
  n integer; connected_count integer; unit text:=p_output->>'unit';
begin
  n:=jsonb_array_length(items);
  select jsonb_agg(jsonb_build_object('item_id',i->'item_id','item_code',i->'item_code',
    'unit_provenance',i->'unit_provenance') order by i->>'item_code',i->>'item_id') into members
    from jsonb_array_elements(items) i;
  if n is null or n not between 1 and 100 or exists(select 1 from jsonb_array_elements(items) i
      where i->'unit_provenance'->>'method' is distinct from 'source-units-v1') then
    status:='unknown_evidence';
  else
    select app.demand_unit_evidence(
      (select sum((i->'unit_provenance'->>'rows')::bigint)::bigint from jsonb_array_elements(items) i),
      (select sum((i->'unit_provenance'->>'unknown_rows')::bigint)::bigint from jsonb_array_elements(items) i),
      array(select distinct u from jsonb_array_elements(items) i,
        jsonb_array_elements_text(i->'unit_provenance'->'units') u order by u)) into provenance;
    -- Only two-way edges whose endpoints both belong to this saved group count.
    with recursive ids as (select i->>'item_id' id from jsonb_array_elements(items) i),
    edges as (select e->>'item' a,e->>'alternate' b from jsonb_array_elements(p_source->'interchanges') e
      where e->>'direction'='two_way' and e->>'item' in(select id from ids) and e->>'alternate' in(select id from ids)),
    connected(id) as (
      select items->0->>'item_id' union
      select case when e.a=c.id then e.b else e.a end from connected c join edges e on e.a=c.id or e.b=c.id
    ) select count(*) into connected_count from connected;
    status:=case
      when connected_count<>n or p_output->>'status' is distinct from 'ready'
        or exists(select 1 from jsonb_array_elements(items) i where i->>'unit' is distinct from unit)
        or jsonb_array_length(p_output->'contributors') is distinct from n
        or exists(select 1 from jsonb_array_elements(p_output->'contributors') c where (c->>'factor')::numeric is distinct from 1)
        then 'not_interchangeable'
      when provenance->>'status' is distinct from 'consistent' or provenance->>'unit' is distinct from unit then 'unknown_units'
      else 'eligible' end;
  end if;
  return jsonb_build_object('method','two-way-stock-v1','status',status,'unit',unit,
    'unit_provenance',provenance,'members',coalesce(members,'[]'::jsonb));
end; $$;
revoke all on function app.prepared_stock_evidence(jsonb,jsonb) from public,anon,authenticated,service_role,maqdar_worker;


create or replace function app.forecast_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' set plan_cache_mode=force_custom_plan as $$
declare r public.planning_runs; l planning.leases; result jsonb;
begin
  select * into r from public.planning_runs where id=p_run_id for update;
  if r.options->>'method' is distinct from 'regional-v1' then return app.forecast_task_individual(p_run_id,p_token); end if;
  if r.status<>'running' or r.kind<>'forecast' then return null; end if;
  select * into l from planning.leases where run_id=r.id;
  if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return null; end if;
  select payload into result from planning.forecast_inputs where run_id=r.id;
  if found then return result; end if;
  -- The saved group is immutable. Only future reference dates/overrides are captured now.
  with prepared as materialized (
    select p.*,greatest(r.from_date,coalesce((select max((d->>'date')::date)+1
      from jsonb_array_elements(p.evidence->'output'->'daily') d where d->'sold'='null'::jsonb),r.from_date)) start_day,
      p.evidence->'source'->'calendar' cal
    from public.demand_preparations p where p.organization_id=r.organization_id
      and p.location_id=r.location_id and p.id=(r.options->>'preparation_id')::uuid and p.status='ready'
  ), future as (
    select p.cal || jsonb_build_object('coverage_from',c.holiday_coverage_from,'coverage_to',c.holiday_coverage_to,
      'holidays',coalesce((select jsonb_agg(jsonb_build_object('date',h.holiday_date,'sector',h.sector,'name',h.name_en,'source',h.source) order by h.holiday_date,h.sector)
        from public.public_holidays h where h.country_code=c.code and h.holiday_date>r.to_date and h.holiday_date<=r.to_date+(r.options->>'horizon')::integer),'[]'::jsonb),
      'windows',coalesce((select jsonb_agg(to_jsonb(w) order by w.hijri_year) from public.ramadan_windows w where w.country_code=c.code),'[]'::jsonb),
      'overrides',coalesce((select jsonb_agg(jsonb_build_object('calendar_id',o.work_calendar_id,'starts_on',o.starts_on,'ends_on',o.ends_on,'kind',o.kind,'name',o.name_en) order by o.id)
        from public.holiday_overrides o where o.organization_id=r.organization_id and (o.work_calendar_id=(p.cal->>'calendar_id')::uuid or o.country_code=c.code)
        and o.starts_on<=r.to_date+(r.options->>'horizon')::integer and o.ends_on>r.to_date),'[]'::jsonb)) cal
    from prepared p join public.countries c on c.code=p.cal->>'country'
  )
  select jsonb_build_object('kind','forecast','method','regional-v1','computed_at',statement_timestamp(),
    'from_date',r.from_date,'to_date',r.to_date,'options',r.options,'calendar_future',(select cal from future),
    'items',coalesce((select jsonb_agg(jsonb_build_object('item_id',p.group_id,'item_code',p.summary->>'target_code',
      'item_name',p.summary->>'target_code','start_day',p.start_day,'end_day',r.to_date,'introduced_on',null,'discontinued_on',null,
      'demand',coalesce((select jsonb_agg(jsonb_build_array(d->>'date',d->>'sold',d->>'lost') order by d->>'date')
        from jsonb_array_elements(p.evidence->'output'->'daily') d where (d->>'date')::date>=p.start_day),'[]'::jsonb),
      'calendar',coalesce((select jsonb_agg(d order by d->>'date') from jsonb_array_elements(p.evidence->'output'->'daily') d
        where (d->>'date')::date>=p.start_day),'[]'::jsonb),
      'preparation',jsonb_build_object('id',p.id,'run_id',p.run_id,'group_id',p.group_id,'unit',p.summary->>'unit',
        'stock_pool',app.prepared_stock_evidence(p.evidence->'source',p.evidence->'output'),
        'comparison','fixed-group-v1','original_from',r.from_date,'contributors',p.evidence->'output'->'contributors',
        'members',(select jsonb_agg(jsonb_build_object('item_id',i->'item_id','introduced_on',i->'introduced_on','discontinued_on',i->'discontinued_on') order by i->>'item_id')
          from jsonb_array_elements(p.evidence->'source'->'items') i)))) from prepared p),'[]'::jsonb)) into result;
  if jsonb_array_length(result->'items')<>1 or result->'calendar_future'='null'::jsonb or octet_length(result::text)>20000000 then
    raise exception using errcode='MQ422',message='prepared forecast input unavailable or too large';
  end if;
  if l.expires_at<=clock_timestamp() then return null; end if;
  insert into planning.forecast_inputs(run_id,payload) values(r.id,result);
  return result;
end; $$;

create or replace function public.policy_stock_comparison(p_organization_id uuid,p_policy_id uuid,p_day date,p_basis text,p_override_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare p public.inventory_policies; s public.stock_snapshots; o public.policy_overrides;
  cutoff date; maximum numeric; excess numeric; status text; result jsonb; provenance jsonb; location_code text;
  pool jsonb; member jsonb; members jsonb:='[]'::jsonb; member_status text;
  pooled numeric:=0; values_by_currency jsonb:='[]'::jsonb; all_stock_valid boolean:=true;
begin
  if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='no such policy';
  end if;
  select i.* into p from public.inventory_policies i join public.planning_runs r
    on r.organization_id=i.organization_id and r.id=i.run_id and r.location_id=i.location_id
    where i.organization_id=p_organization_id and i.id=p_policy_id and r.kind='policy' and r.status='succeeded';
  if not found then raise exception using errcode='MQ404',message='no such policy'; end if;
  if p_day is null or not isfinite(p_day) or p_basis is null or p_basis not in ('calculated','approved')
    or (p_basis='calculated' and p_override_id is not null) or (p_basis='approved' and p_override_id is null) then
    raise exception using errcode='MQ422',message='choose a finite day and an explicit threshold basis';
  end if;
  if p_basis='approved' then
    select v.* into o from public.policy_overrides v where v.organization_id=p_organization_id and v.policy_id=p.id
      and v.id=p_override_id and v.status='approved';
    if not found then raise exception using errcode='MQ404',message='no such approved revision'; end if;
    maximum:=o.order_up_to;
  else
    maximum:=(p.summary->'protection'->>'target')::numeric;
  end if;
  cutoff:=(p.evidence->'forecast'->>'to_date')::date;
  provenance:=p.evidence->'forecast'->'source'->'unit_provenance';
  select code into location_code from public.locations where organization_id=p_organization_id and id=p.location_id;
  if p.evidence->'forecast'->>'method'='regional-v1' or p.evidence->'forecast'->'source' ? 'preparation' then
    pool:=p.evidence->'forecast'->'source'->'preparation'->'stock_pool';
    provenance:=pool->'unit_provenance';
    status:=case
      when p.status<>'available' or maximum is null then 'policy_unavailable'
      when p_day is distinct from cutoff then 'date_mismatch'
      when pool->>'method' is distinct from 'two-way-stock-v1' or pool->>'status'='unknown_evidence' then 'prepared_group'
      when pool->>'status'='not_interchangeable' then 'group_not_interchangeable'
      when pool->>'status' is distinct from 'eligible' or provenance->>'status' is distinct from 'consistent'
        or p.unit is null or pool->>'unit' is distinct from p.unit or provenance->>'unit' is distinct from p.unit then 'policy_unit_unknown'
      else 'available' end;
    -- Captured membership is bounded and unique. Do not silently pool a partial set.
    if pool->>'method'='two-way-stock-v1' and jsonb_array_length(pool->'members') between 1 and 100
      and (select count(distinct m->>'item_id') from jsonb_array_elements(pool->'members') m)=jsonb_array_length(pool->'members') then
      for member in select m from jsonb_array_elements(pool->'members') m order by m->>'item_code',m->>'item_id' loop
        select * into s from public.stock_snapshots where organization_id=p_organization_id
          and item_id=(member->>'item_id')::uuid and location_id=p.location_id and snapshot_date<=p_day
          order by snapshot_date desc limit 1;
        member_status:=case when s.id is null then 'stock_missing'
          when s.snapshot_date<p_day-7 then 'stock_stale'
          when s.unit_of_measure is null then 'stock_unit_unknown'
          when s.unit_of_measure<>p.unit then 'unit_mismatch' else 'available' end;
        if member_status<>'available' then
          all_stock_valid:=false;
          if status='available' then status:=member_status; end if;
        end if;
        pooled:=pooled+coalesce(s.quantity-s.allocated_quantity,0);
        members:=members||jsonb_build_array(jsonb_build_object('item_id',member->'item_id','item_code',member->'item_code',
          'unit_provenance',member->'unit_provenance','status',member_status,
          'inventory_value',case when member_status='available' then (s.quantity*s.unit_cost)::text else null end,
          'snapshot',case when s.id is null then null else jsonb_build_object('id',s.id,'date',s.snapshot_date,
            'updated_at',s.updated_at,'age',p_day-s.snapshot_date,'unit',s.unit_of_measure,'quantity',s.quantity::text,
            'allocated',s.allocated_quantity::text,'available',(s.quantity-s.allocated_quantity)::text,
            'unit_cost',s.unit_cost::text,'currency',s.currency) end));
      end loop;
    else
      all_stock_valid:=false;
      if status='available' then status:='prepared_group'; end if;
    end if;
    if status='available' and all_stock_valid then
      excess:=greatest(pooled-maximum,0);
      select coalesce(jsonb_agg(jsonb_build_object('currency',v.currency,'value',v.value::text) order by v.currency),'[]'::jsonb)
        into values_by_currency from (select m->'snapshot'->>'currency' currency,sum((m->>'inventory_value')::numeric) value
          from jsonb_array_elements(members) m group by m->'snapshot'->>'currency') v;
    end if;
    return jsonb_build_object('status',status,'policy_id',p.id,'run_id',p.run_id,'forecast_id',p.forecast_id,
      'item_code',p.item_code,'location_code',location_code,'day',p_day,'cutoff',cutoff,'unit',p.unit,
      'unit_provenance',provenance,'basis',p_basis,'override_id',p_override_id,'revision',o.revision,
      'maximum',maximum::text,'quantity_above',excess::text,'value_above',null,'snapshot',null,
      'pool',jsonb_build_object('members',members,'available',case when status='available' then pooled::text else null end,
        'inventory_values',values_by_currency));
  end if;

  select * into s from public.stock_snapshots where organization_id=p_organization_id and item_id=p.item_id
    and location_id=p.location_id and snapshot_date<=p_day order by snapshot_date desc limit 1;
  status:=case
    when p.status<>'available' or maximum is null then 'policy_unavailable'
    when p.evidence->'forecast'->>'method'='regional-v1' or p.evidence->'forecast'->'source' ? 'preparation' then 'prepared_group'
    when p_day is distinct from cutoff then 'date_mismatch'
    when provenance->>'method' is distinct from 'source-units-v1' or provenance->>'status' is distinct from 'consistent'
      or p.unit is null or provenance->>'unit' is distinct from p.unit then 'policy_unit_unknown'
    when s.id is null then 'stock_missing'
    when s.snapshot_date<p_day-7 then 'stock_stale'
    when s.unit_of_measure is null then 'stock_unit_unknown'
    when s.unit_of_measure<>p.unit then 'unit_mismatch'
    else 'available' end;
  if status='available' then excess:=greatest(s.quantity-s.allocated_quantity-maximum,0); end if;
  result:=jsonb_build_object('status',status,'policy_id',p.id,'run_id',p.run_id,'forecast_id',p.forecast_id,
    'item_code',p.item_code,'location_code',location_code,'day',p_day,'cutoff',cutoff,'unit',p.unit,
    'unit_provenance',provenance,'basis',p_basis,'override_id',p_override_id,'revision',o.revision,
    'maximum',maximum::text,'quantity_above',excess::text,'value_above',(excess*s.unit_cost)::text,
    'snapshot',case when s.id is null then null else jsonb_build_object('id',s.id,'date',s.snapshot_date,
      'updated_at',s.updated_at,'age',p_day-s.snapshot_date,'unit',s.unit_of_measure,'quantity',s.quantity::text,
      'allocated',s.allocated_quantity::text,'available',(s.quantity-s.allocated_quantity)::text,
      'unit_cost',s.unit_cost::text,'currency',s.currency) end);
  return result;
end; $$;

reset lock_timeout;
