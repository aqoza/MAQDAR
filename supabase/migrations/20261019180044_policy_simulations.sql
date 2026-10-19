-- Step 21: additive, forward-only. Stop/upgrade workers with the web application.
-- Rollback disables new simulations and cancels pending runs; retain schema/results.
set lock_timeout='5s';
alter table public.planning_runs drop constraint planning_runs_kind_check;
alter table public.planning_runs add constraint planning_runs_kind_check
 check(kind in ('readiness','classification','forecast','preparation','policy','simulation'));

create table planning.simulation_inputs (
 run_id uuid primary key references public.planning_runs(id) on delete cascade,
 payload jsonb not null
);
revoke all on planning.simulation_inputs from public,anon,authenticated,service_role,maqdar_worker;
create table public.policy_simulations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,
 run_id uuid not null unique, location_id uuid not null, policy_id uuid not null,
 item_id uuid not null, item_code text not null, unit text not null,
 evidence jsonb not null, unique(organization_id,id),
 foreign key(organization_id,run_id,location_id) references public.planning_runs(organization_id,id,location_id) on delete cascade
);
comment on column public.policy_simulations.policy_id is 'Copied source identity; later source deletion does not delete simulation evidence.';
create index policy_simulations_source on public.policy_simulations(organization_id,policy_id);
alter table public.policy_simulations enable row level security;
revoke all on public.policy_simulations from public,anon,authenticated,service_role,maqdar_worker;
grant select on public.policy_simulations to authenticated;
create policy "members read" on public.policy_simulations for select to authenticated
 using (organization_id = any(array(select app.member_organizations())));
create policy "branch scope" on public.policy_simulations as restrictive for select to authenticated
 using (organization_id = any(array(select app.unscoped_organizations())) or location_id = any(array(select app.scoped_locations())));

create function public.simulation_enqueue(p_organization_id uuid,p_policy_id uuid,p_request_id uuid,p_to date,
 p_opening_stock text,p_alternative_maximum text,p_history_confirmed boolean,p_empty_start_confirmed boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.inventory_policies; prior public.planning_runs; source_run public.planning_runs;
 options jsonb; payload jsonb; demand jsonb; run uuid; cutoff date; horizon integer; lead integer; review integer;
 maximum text; location_code text; today date; units_match boolean;
begin
 if p_organization_id is null or not(p_organization_id=any(array(select app.editable_organizations()))) then
  raise exception using errcode='MQ403',message='simulation requires an editor';
 end if;
 if p_policy_id is null or p_request_id is null or p_to is null or not isfinite(p_to)
  or p_history_confirmed is distinct from true or p_empty_start_confirmed is distinct from true
  or p_opening_stock is null or p_opening_stock !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$'
  or p_alternative_maximum is null or p_alternative_maximum !~ '^[0-9]{1,15}(\.[0-9]{1,3})?$' then
  raise exception using errcode='MQ422',message='invalid simulation inputs or confirmations';
 end if;
 options:=jsonb_build_object('method','periodic-replay-v1','policy_id',p_policy_id,'to_date',p_to,
  'opening_stock',trim_scale(p_opening_stock::numeric)::text,'alternative_maximum',trim_scale(p_alternative_maximum::numeric)::text,
  'history_confirmed',true,'empty_start_confirmed',true);
 perform pg_advisory_xact_lock(hashtextextended('maqdar.planning:'||p_organization_id::text,0));
 select * into prior from public.planning_runs where organization_id=p_organization_id and request_id=p_request_id;
 if found then
  if prior.kind<>'simulation' or prior.options<>options then
   raise exception using errcode='MQ409',message='request id already used with different parameters';
  end if;
  if not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(prior.location_id=any(array(select app.scoped_locations()))) then
   raise exception using errcode='MQ404',message='simulation unavailable';
  end if;
  return prior.id;
 end if;
 select * into p from public.inventory_policies where organization_id=p_organization_id and id=p_policy_id;
 if not found or (not(p_organization_id=any(array(select app.unscoped_organizations())))
    and not(p.location_id=any(array(select app.scoped_locations())))) then
  raise exception using errcode='MQ404',message='policy unavailable';
 end if;
 select * into source_run from public.planning_runs where organization_id=p_organization_id and id=p.run_id;
 if source_run.status is distinct from 'succeeded' or source_run.kind is distinct from 'policy' or p.status<>'available'
  or coalesce(p.evidence#>>'{forecast,method}','') not in ('baseline-v1','expanded-v1')
  or p.unit is null or btrim(p.unit)=''
  or p.evidence#>>'{forecast,source,unit_provenance,status}' is distinct from 'consistent'
  or p.evidence#>>'{forecast,source,unit_provenance,unit}' is distinct from p.unit
  or coalesce(p.evidence#>>'{forecast,to_date}','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  or coalesce(p.evidence#>>'{forecast,horizon}','') !~ '^[0-9]{1,2}$'
  or coalesce(p.evidence#>>'{options,lead_time}','') !~ '^[0-9]{1,2}$'
  or coalesce(p.evidence#>>'{options,review_interval}','') !~ '^[0-9]{1,2}$' then
  raise exception using errcode='MQ422',message='choose an available individual policy with known units';
 end if;
 cutoff:=(p.evidence#>>'{forecast,to_date}')::date;
 horizon:=(p.evidence#>>'{forecast,horizon}')::integer;
 lead:=(p.evidence#>>'{options,lead_time}')::integer;
 review:=(p.evidence#>>'{options,review_interval}')::integer;
 maximum:=p.evidence#>>'{output,protection,target}';
 if not isfinite(cutoff) or cutoff<>source_run.to_date or lead not between 0 and 89 or review not between 1 and 90
  or horizon not between 1 and 90 or lead+review>horizon
  or maximum is null or maximum !~ '^[0-9]{1,31}(\.[0-9]{1,3})?$'
  or maximum is distinct from p.summary#>>'{protection,target}' then
  raise exception using errcode='MQ422',message='invalid saved policy evidence';
 end if;
 if maximum::numeric>1e30 then raise exception using errcode='MQ422',message='unsupported policy quantity'; end if;
 select (statement_timestamp() at time zone coalesce(o.time_zone,c.timezone,'UTC'))::date into today
 from public.organizations o left join public.countries c on c.code=o.home_country where o.id=p_organization_id;
 if p_to<=cutoff or p_to>cutoff+horizon or p_to>=today then
  raise exception using errcode='MQ422',message='choose completed dates within the saved forecast horizon';
 end if;
 select l.code into location_code from public.locations l where l.organization_id=p_organization_id and l.id=p.location_id and l.is_active;
 if location_code is null then raise exception using errcode='MQ422',message='choose an active location'; end if;
 -- One statement captures both quantities and unit validation from the same history snapshot.
 select jsonb_agg(jsonb_build_object('date',cutoff+n,'quantity',trim_scale(coalesce(d.quantity,0))::text,
   'lost_sales_quantity',trim_scale(coalesce(d.lost_sales_quantity,0))::text,'recorded',d.item_id is not null) order by n),
   bool_and(d.item_id is null or d.unit_of_measure is not distinct from p.unit)
 into demand,units_match
 from generate_series(1,p_to-cutoff) n left join public.demand_history d on
  d.organization_id=p_organization_id and d.item_id=p.item_id and d.location_id=p.location_id and d.demand_date=cutoff+n;
 if units_match is distinct from true then raise exception using errcode='MQ422',message='replay history requires matching supplied units'; end if;
 payload:=jsonb_build_object('kind','simulation','method','periodic-replay-v1','computed_at',statement_timestamp(),
  'from_date',cutoff+1,'to_date',p_to,'options',options,'demand',demand,
  'policy',jsonb_build_object('id',p.id,'run_id',p.run_id,'item_id',p.item_id,'item_code',p.item_code,'unit',p.unit,
   'cutoff',cutoff,'horizon',horizon,'lead_time',lead,'review_interval',review,'maximum',trim_scale(maximum::numeric)::text,'evidence',p.evidence));
 if octet_length(payload::text)>20000000 then raise exception using errcode='MQ422',message='simulation evidence too large'; end if;
 run:=app.planning_enqueue_kind(p_organization_id,location_code,cutoff+1,p_to,p_request_id,'simulation',options);
 insert into planning.simulation_inputs(run_id,payload) values(run,payload);
 return run;
end; $$;
revoke all on function public.simulation_enqueue(uuid,uuid,uuid,date,text,text,boolean,boolean) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.simulation_enqueue(uuid,uuid,uuid,date,text,text,boolean,boolean) to authenticated;

create function app.simulation_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.planning_runs; l planning.leases;
begin
 select * into r from public.planning_runs where id=p_run_id for update;
 if not found or r.kind<>'simulation' or r.status<>'running' then return null; end if;
 select * into l from planning.leases where run_id=r.id;
 if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return null; end if;
 return (select payload from planning.simulation_inputs where run_id=r.id);
end; $$;
revoke all on function app.simulation_task(uuid,uuid) from public,anon,authenticated,service_role,maqdar_worker;
create or replace function app.planning_task(p_run_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.planning_runs where id=p_run_id and kind='simulation') then return app.simulation_task(p_run_id,p_token); end if;
 if exists(select 1 from public.planning_runs where id=p_run_id and kind='policy') then return app.policy_task(p_run_id,p_token); end if;
 if exists(select 1 from public.planning_runs where id=p_run_id and kind='preparation') then return app.preparation_task(p_run_id,p_token); end if;
 if exists(select 1 from public.planning_runs where id=p_run_id and kind='forecast') then return app.forecast_task(p_run_id,p_token); end if;
 return app.planning_task_classification(p_run_id,p_token);
end; $$;

create function app.simulation_output_valid(input jsonb,output jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare v jsonb; row jsonb; m jsonb; field text; count_days integer; i integer; variant integer;
 stock numeric; backlog numeric; pipeline numeric; sold numeric; lost numeric; immediate numeric; closing_sum numeric;
 ordered numeric; received numeric; backlog_days integer; orders integer; day date;
begin
 if jsonb_typeof(output) is distinct from 'object' or output->>'method' is distinct from 'periodic-replay-v1'
  or jsonb_typeof(output->'variants') is distinct from 'array' or octet_length(output::text)>1000000 then return false; end if;
 if jsonb_array_length(output->'variants')<>2 then return false; end if;
 count_days:=jsonb_array_length(input->'demand');
 for variant in 0..1 loop
  v:=output->'variants'->variant; m:=v->'metrics';
  if v->>'name' is distinct from (case when variant=0 then 'baseline' else 'alternative' end)
   or v->>'maximum' is distinct from (case when variant=0 then input#>>'{policy,maximum}' else input#>>'{options,alternative_maximum}' end)
   or jsonb_typeof(v->'ledger') is distinct from 'array' or jsonb_typeof(m) is distinct from 'object' then return false; end if;
  if jsonb_array_length(v->'ledger')<>count_days then return false; end if;
  stock:=(input#>>'{options,opening_stock}')::numeric; backlog:=0; pipeline:=0;
  sold:=0; lost:=0; immediate:=0; closing_sum:=0; ordered:=0; received:=0; backlog_days:=0; orders:=0;
  for i in 0..count_days-1 loop
   row:=v->'ledger'->i; day:=(input->>'from_date')::date+i;
   foreach field in array array['demand','lost_sales','opening_stock','receipts','backlog_fulfilled','order_quantity',
     'immediate_fulfilled','new_backlog','closing_stock','closing_backlog','closing_on_order'] loop
    if jsonb_typeof(row->field) is distinct from 'string' or (row->>field)!~'^[0-9]{1,35}(\.[0-9]{1,3})?$' then return false; end if;
   end loop;
   if row->>'date' is distinct from day::text or row->'review' is distinct from to_jsonb(i % (input#>>'{policy,review_interval}')::integer=0)
    or (row->>'demand')::numeric<>(input->'demand'->i->>'quantity')::numeric
    or (row->>'lost_sales')::numeric<>(input->'demand'->i->>'lost_sales_quantity')::numeric
    or (row->>'opening_stock')::numeric<>stock
    or (row->>'closing_stock')::numeric<>stock+(row->>'receipts')::numeric-(row->>'backlog_fulfilled')::numeric-(row->>'immediate_fulfilled')::numeric
    or (row->>'closing_backlog')::numeric<>backlog+(row->>'new_backlog')::numeric-(row->>'backlog_fulfilled')::numeric
    or (row->>'closing_on_order')::numeric<>pipeline+(row->>'order_quantity')::numeric-(row->>'receipts')::numeric
    or (row->>'demand')::numeric<>(row->>'immediate_fulfilled')::numeric+(row->>'new_backlog')::numeric
    or ((row->>'closing_stock')::numeric>0 and (row->>'closing_backlog')::numeric>0) then return false; end if;
   if (row->>'order_quantity')::numeric>0 then
    if row->'review'<>'true'::jsonb or row->>'order_due' is distinct from (day+(input#>>'{policy,lead_time}')::integer)::text then return false; end if;
    orders:=orders+1;
   elsif row->'order_due' is distinct from 'null'::jsonb then return false; end if;
   stock:=(row->>'closing_stock')::numeric; backlog:=(row->>'closing_backlog')::numeric; pipeline:=(row->>'closing_on_order')::numeric;
   sold:=sold+(row->>'demand')::numeric; lost:=lost+(row->>'lost_sales')::numeric;
   immediate:=immediate+(row->>'immediate_fulfilled')::numeric; closing_sum:=closing_sum+stock;
   ordered:=ordered+(row->>'order_quantity')::numeric; received:=received+(row->>'receipts')::numeric;
   if backlog>0 then backlog_days:=backlog_days+1; end if;
  end loop;
  foreach field in array array['sold_quantity','lost_sales_quantity','ordered_quantity','received_quantity','immediate_fulfilled',
    'closing_stock_sum','average_closing_stock','ending_stock','ending_backlog','ending_on_order'] loop
   if jsonb_typeof(m->field) is distinct from 'string' or (m->>field)!~'^[0-9]{1,35}(\.[0-9]{1,6})?$' then return false; end if;
  end loop;
  if m->'days' is distinct from to_jsonb(count_days) or m->'order_count' is distinct from to_jsonb(orders)
   or m->'backlog_days' is distinct from to_jsonb(backlog_days)
   or (m->>'sold_quantity')::numeric<>sold or (m->>'lost_sales_quantity')::numeric<>lost
   or (m->>'ordered_quantity')::numeric<>ordered or (m->>'received_quantity')::numeric<>received
   or (m->>'immediate_fulfilled')::numeric<>immediate or (m->>'closing_stock_sum')::numeric<>closing_sum
   or (m->>'average_closing_stock')::numeric<>round(closing_sum::numeric(75,40)/count_days,6)
   or (m->>'ending_stock')::numeric<>stock or (m->>'ending_backlog')::numeric<>backlog or (m->>'ending_on_order')::numeric<>pipeline then return false; end if;
  if sold=0 then
   if m->'immediate_fill_rate' is distinct from 'null'::jsonb then return false; end if;
  else
   if jsonb_typeof(m->'immediate_fill_rate') is distinct from 'string' or (m->>'immediate_fill_rate')!~'^[01](\.[0-9]{1,6})?$' then return false; end if;
   if (m->>'immediate_fill_rate')::numeric<>round(immediate::numeric(75,40)/sold::numeric(75,40),6) then return false; end if;
  end if;
 end loop;
 return true;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return false;
end; $$;
revoke all on function app.simulation_output_valid(jsonb,jsonb) from public,anon,authenticated,service_role,maqdar_worker;

create function app.simulation_finish(p_run_id uuid,p_token uuid,p_output jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.planning_runs; l planning.leases; input jsonb;
begin
 select * into r from public.planning_runs where id=p_run_id for update;
 if not found or r.kind<>'simulation' or r.status<>'running' then return false; end if;
 select * into l from planning.leases where run_id=r.id;
 if p_token is null or l.token is distinct from p_token or l.expires_at<=clock_timestamp() then return false; end if;
 select payload into input from planning.simulation_inputs where run_id=r.id;
 if input is null or app.simulation_output_valid(input,p_output) is distinct from true then
  raise exception using errcode='MQ422',message='invalid simulation output';
 end if;
 insert into public.policy_simulations(organization_id,run_id,location_id,policy_id,item_id,item_code,unit,evidence)
 values(r.organization_id,r.id,r.location_id,(input#>>'{policy,id}')::uuid,(input#>>'{policy,item_id}')::uuid,
  input#>>'{policy,item_code}',input#>>'{policy,unit}',input||jsonb_build_object('output',p_output));
 if l.expires_at<=clock_timestamp() then raise exception using errcode='MQ409',message='simulation lease expired'; end if;
 update public.planning_runs set status='succeeded',finished_at=clock_timestamp(),error_code=null,
  result=jsonb_build_object('version',1,'method','periodic-replay-v1','computed_at',input->'computed_at','item_count',1) where id=r.id;
 perform pgmq.archive('planning',l.message_id);
 delete from planning.leases where run_id=r.id;
 return true;
end; $$;
revoke all on function app.simulation_finish(uuid,uuid,jsonb) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function app.simulation_finish(uuid,uuid,jsonb) to maqdar_worker;

create function app.simulation_input_cleanup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('succeeded','failed','canceled') then delete from planning.simulation_inputs where run_id=new.id; end if;
 return new;
end; $$;
revoke all on function app.simulation_input_cleanup() from public,anon,authenticated,service_role,maqdar_worker;
create trigger simulation_input_cleanup after update of status on public.planning_runs for each row execute function app.simulation_input_cleanup();
reset lock_timeout;
