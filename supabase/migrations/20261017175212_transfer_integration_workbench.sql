-- Step 16i: additive, read-only member workbench. Roll back the web build; retain this RPC.
-- Invoker rights preserve tenant and BOTH endpoint policies on packages, proposals and reports.
create function public.transfer_integration_workbench(
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
  if exists(select 1 from jsonb_each(filters) f where f.key not in ('q','location','source','selection','status','kind','system')
      or jsonb_typeof(f.value) is distinct from 'string'
      or char_length(f.value#>>'{}')>case f.key when 'q' then 100 when 'system' then 80 else 64 end
      or (f.value#>>'{}') ~ '[[:cntrl:]]')
    or coalesce(filters->>'selection','') not in ('','current','historical')
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
    select h.id,'handoff'::text as kind,h.created_at,h.location_code,h.source_code,h.item_code,
      1 as line_count,h.selected,h.search_text
    from public.transfer_handoff_list h where h.organization_id=p_organization_id
      and coalesce(filters->>'kind','') in ('','handoff')
    union all
    select b.id,'batch',b.created_at,b.location_code,b.source_code,null,b.line_count,b.selected,b.search_text
    from public.transfer_handoff_batch_list b where b.organization_id=p_organization_id
      and coalesce(filters->>'kind','') in ('','batch')
  ), matching_packages as (
    select p.* from packages p
    where (coalesce(filters->>'source','')='' or p.source_code=filters->>'source')
      and (coalesce(filters->>'location','')='' or p.location_code=filters->>'location')
      and (coalesce(filters->>'selection','')='' or p.selected=((filters->>'selection')='current'))
  ), latest as (
    select p.id,p.kind,p.created_at,p.location_code,p.source_code,p.item_code,p.line_count,p.selected,
      a.id as event_id,coalesce(a.external_system,system_label) as external_system,a.external_reference,
      coalesce(a.status,'no_report') as status,a.reason,a.recorded_at,a.api_key_id,a.client_event_id,
      app.normalize_search(concat_ws(' ',p.search_text,p.id::text,p.source_code,p.location_code,
        a.external_system,a.external_reference)) as search_text
    from matching_packages p
    left join lateral (
      -- Pick the latest report BEFORE status/search filtering. Labels remain exact, even across key rotation.
      select distinct on (a.external_system collate "C") a.*
      from public.transfer_handoff_acknowledgements a
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
revoke all on function public.transfer_integration_workbench(uuid,jsonb,integer,integer) from public,anon,authenticated,service_role,maqdar_worker;
grant execute on function public.transfer_integration_workbench(uuid,jsonb,integer,integer) to authenticated;
comment on function public.transfer_integration_workbench(uuid,jsonb,integer,integer) is
  'Member-scoped latest caller reports per exact system label and package. No report means absent evidence, not failed delivery. No writes or propagation; live selection remains separate.';
