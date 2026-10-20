-- Step 22i: additive, read-only member workbench. Roll back the web build; retain this RPC.
-- Invoker rights preserve the existing package, proposal and acknowledgement RLS policies.
create function public.network_integration_workbench(
  p_organization_id uuid, p_filters jsonb default '{}', p_page integer default 1, p_size integer default 25
)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  filters jsonb:=coalesce(p_filters,'{}');
  system_label text; query_tokens text[]; result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode='MQ401',message='sign in required',hint='auth';
  end if;
  if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
    raise exception using errcode='MQ404',message='organization unavailable',hint='organization_id';
  end if;
  if p_page is null or p_page not between 1 and 100000 or p_size is null or p_size not in (25,50,100)
    or jsonb_typeof(filters) is distinct from 'object' or octet_length(filters::text)>4096 then
    raise exception using errcode='MQ422',message='invalid workbench parameters',hint='filters';
  end if;
  if exists(select 1 from jsonb_each(filters) f where f.key not in ('q','source','branch','selection','status','kind','system')
      or jsonb_typeof(f.value) is distinct from 'string'
      or char_length(f.value#>>'{}')>case f.key when 'q' then 100 when 'system' then 80 else 64 end
      or (f.value#>>'{}') ~ '[[:cntrl:]]')
    or coalesce(filters->>'selection','') not in ('','current','historical','unavailable')
    or coalesce(filters->>'status','') not in ('','received','rejected','no_report')
    or coalesce(filters->>'kind','') not in ('','handoff','batch') then
    raise exception using errcode='MQ422',message='invalid workbench filters',hint='filters';
  end if;
  system_label:=nullif(filters->>'system','');
  if system_label is not null and system_label !~ '[^[:space:]]' then
    raise exception using errcode='MQ422',message='invalid system label',hint='filters';
  end if;
  query_tokens:=regexp_split_to_array(app.normalize_search(coalesce(filters->>'q','')),' +');
  with packages as (
    select h.id,'handoff'::text as kind,h.created_at,
      h.payload#>>'{estimate,source,source,source_location_code}' as source_code,
      h.payload#>>'{estimate,source,source,source_policy,item_code}' as item_code,
      h.payload#>>'{estimate,source,dispatch,date}' as dispatch_date,
      1 as line_count,jsonb_array_length(h.payload#>'{estimate,lines}') as branch_row_count,
      array(select distinct v->>'location_code' collate "C"
        from jsonb_array_elements(h.payload#>'{estimate,lines}') v order by 1) as branch_codes,
      case when live.id is null then 'unavailable' when live.selected then 'current' else 'historical' end as selection,
      live.search_text
    from public.network_transfer_handoffs h left join public.network_handoff_list live
      on live.organization_id=h.organization_id and live.id=h.id
    where h.organization_id=p_organization_id and coalesce(filters->>'kind','') in ('','handoff')
    union all
    select b.id,'batch',b.created_at,b.payload#>>'{summary,source_code}',null::text,
      b.payload#>>'{summary,dispatch_date}',cardinality(b.handoff_ids),
      (b.payload#>>'{summary,branch_row_count}')::integer,
      array(select distinct v->>'location_code' collate "C"
        from jsonb_array_elements(b.payload->'lines') h
        cross join lateral jsonb_array_elements(h#>'{estimate,lines}') v order by 1),
      live.selection,live.search_text
    from public.network_handoff_batches b join public.network_handoff_batch_list live
      on live.organization_id=b.organization_id and live.id=b.id
    where b.organization_id=p_organization_id and coalesce(filters->>'kind','') in ('','batch')
  ), matching_packages as (
    -- These are package filters only. RLS still requires every saved location, including zero branches.
    select p.* from packages p
    where (coalesce(filters->>'source','')='' or p.source_code=filters->>'source')
      and (coalesce(filters->>'branch','')='' or (filters->>'branch')=any(p.branch_codes))
      and (coalesce(filters->>'selection','')='' or p.selection=filters->>'selection')
  ), latest as (
    select p.id,p.kind,p.created_at,p.source_code,p.item_code,p.dispatch_date,p.line_count,p.branch_row_count,p.branch_codes,p.selection,
      a.id as event_id,coalesce(a.external_system,system_label) as external_system,a.external_reference,
      coalesce(a.status,'no_report') as status,a.reason,a.recorded_at,a.api_key_id,a.client_event_id,
      app.normalize_search(concat_ws(' ',p.search_text,p.id::text,p.item_code,p.source_code,array_to_string(p.branch_codes,' '),
        a.external_system,a.external_reference)) as search_text
    from matching_packages p
    left join lateral (
      -- Pick the latest report BEFORE status/search filtering. Labels remain exact, even across key rotation.
      select distinct on (a.external_system collate "C") a.*
      from public.network_handoff_acknowledgements a
      where a.organization_id=p_organization_id
        and (p.kind='handoff' and a.handoff_id=p.id or p.kind='batch' and a.batch_id=p.id)
        and (system_label is null or a.external_system collate "C"=system_label collate "C")
      order by a.external_system collate "C",a.recorded_at desc,a.id
    ) a on true
  ), matching as materialized (
    select l.* from latest l
    where (coalesce(filters->>'status','')='' or l.status=filters->>'status')
      and not exists(select 1 from unnest(query_tokens) token where token<>'' and strpos(l.search_text,token)=0)
  ), totals as (
    select count(*) as total from matching
  ), paging as (
    select total,least(p_page,greatest(1,ceil(total::numeric/p_size)::integer)) as page from totals
  )
  select jsonb_build_object('total',paging.total,'page',paging.page,'size',p_size,'as_of',statement_timestamp(),
    'rows',coalesce((select jsonb_agg(to_jsonb(r)-'search_text' order by r.created_at desc,r.kind,r.id,r.external_system collate "C" nulls first)
      from (select * from matching order by created_at desc,kind,id,external_system collate "C" nulls first
        limit p_size offset (paging.page-1)*p_size) r),'[]'::jsonb)) into result from paging;
  return result;
end;
$$;
revoke all on function public.network_integration_workbench(uuid,jsonb,integer,integer) from public,anon,authenticated,service_role,maqdar_worker,maqdar_simulation_worker;
grant execute on function public.network_integration_workbench(uuid,jsonb,integer,integer) to authenticated;
comment on function public.network_integration_workbench(uuid,jsonb,integer,integer) is
  'All-location member-scoped whole-network reports per exact system label and package. No report means absent evidence, not failed delivery. No writes or propagation; live current/historical/unavailable context remains separate. Copied batches survive source deletion.';
