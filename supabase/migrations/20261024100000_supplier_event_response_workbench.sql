-- Step 26h: read-only internal publication/response search; existing RLS remains authoritative.
-- Rollback: remove the web entry point; retaining this additive RPC preserves compatibility.
create function public.supplier_event_response_workbench(
 p_organization_id uuid,p_filters jsonb default '{}',p_page integer default 1,p_size integer default 25
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare filters jsonb:=coalesce(p_filters,'{}'); tokens text[]; result jsonb;
begin
 if auth.uid() is null then raise exception using errcode='MQ401',message='sign in required'; end if;
 if p_organization_id is null or not(p_organization_id=any(array(select app.member_organizations()))) then
  raise exception using errcode='MQ404',message='organization unavailable'; end if;
 if p_page is null or p_page not between 1 and 100000 or p_size is null or p_size not in (25,50,100)
  or jsonb_typeof(filters) is distinct from 'object' or octet_length(filters::text)>4096 then
  raise exception using errcode='MQ422',message='invalid workbench parameters'; end if;
 if exists(select 1 from jsonb_each(filters) f where f.key not in ('q','supplier','location','kind','state','status')
  or jsonb_typeof(f.value) is distinct from 'string'
  or char_length(f.value#>>'{}')>case f.key when 'q' then 100 else 64 end
  or (f.value#>>'{}') ~ '[[:cntrl:]]')
  or coalesce(filters->>'kind','') not in ('','handoff','batch')
  or coalesce(filters->>'state','') not in ('','published','withdrawn')
  or coalesce(filters->>'status','') not in ('','received','declined','no_response') then
  raise exception using errcode='MQ422',message='invalid workbench filters'; end if;
 tokens:=regexp_split_to_array(app.normalize_search(coalesce(filters->>'q','')),' +');
 with publications as (
  select p.id,'handoff'::text kind,p.handoff_id source_id,p.created_at,p.withdrawn_at,
   p.summary->>'supplier_code' supplier_code,p.summary->>'location_code' location_code,
   jsonb_build_array(p.summary->>'item_code') item_codes,1 line_count
  from public.supplier_event_publications p where p.organization_id=p_organization_id
   and coalesce(filters->>'kind','') in ('','handoff')
  union all
  select p.id,'batch',p.batch_id,p.created_at,p.withdrawn_at,
   p.summary->>'supplier_code',p.summary->>'location_code',
   (select jsonb_agg(l->>'item_code' order by n) from jsonb_array_elements(p.summary->'lines') with ordinality x(l,n)),
   jsonb_array_length(p.summary->'lines')
  from public.supplier_event_batch_publications p where p.organization_id=p_organization_id
   and coalesce(filters->>'kind','') in ('','batch')
 ), latest as (
  select p.*,case when p.withdrawn_at is null then 'published' else 'withdrawn' end state,
   coalesce(r.status,'no_response') status,
   case when r.id is null then null else jsonb_build_object('id',r.id,'revision',r.revision,
    'status',r.status,'reference',r.reference,'reason',r.reason,'author',r.actor_email,'created_at',r.created_at) end response,
   app.normalize_search(concat_ws(' ',p.id::text,p.source_id::text,p.supplier_code,p.location_code,
    p.item_codes::text,r.actor_email,r.reference,r.reason)) search_text
  from publications p
  left join lateral (
   -- Select the latest exact-publication revision BEFORE filtering. No member/overlap propagation.
   select a.* from public.supplier_event_responses a where a.organization_id=p_organization_id
    and (p.kind='handoff' and a.publication_id=p.id or p.kind='batch' and a.batch_publication_id=p.id)
   order by a.revision desc limit 1
  ) r on true
 ), matching as materialized (
  select * from latest l
  where (coalesce(filters->>'supplier','')='' or l.supplier_code=filters->>'supplier')
   and (coalesce(filters->>'location','')='' or l.location_code=filters->>'location')
   and (coalesce(filters->>'state','')='' or l.state=filters->>'state')
   and (coalesce(filters->>'status','')='' or l.status=filters->>'status')
   and not exists(select 1 from unnest(tokens) token where token<>'' and strpos(l.search_text,token)=0)
 ), totals as (select count(*) total from matching), paging as (
  select total,least(p_page,greatest(1,ceil(total::numeric/p_size)::integer)) page from totals
 ) select jsonb_build_object('total',paging.total,'page',paging.page,'size',p_size,'as_of',statement_timestamp(),
  'rows',coalesce((select jsonb_agg(to_jsonb(r)-'search_text' order by r.created_at desc,r.kind,r.id)
   from (select * from matching order by created_at desc,kind,id limit p_size offset (paging.page-1)*p_size) r),'[]'::jsonb))
  into result from paging;
 return result;
end; $$;
revoke all on function public.supplier_event_response_workbench(uuid,jsonb,integer,integer) from public,anon,authenticated,service_role,zeespare_worker,zeespare_simulation_worker;
grant execute on function public.supplier_event_response_workbench(uuid,jsonb,integer,integer) to authenticated;
comment on function public.supplier_event_response_workbench(uuid,jsonb,integer,integer) is
 'Internal member/location-scoped event publication search. Ordinary publications remain separate. Latest serial response per exact publication, independent withdrawal state; copied batches survive source deletion. No supplier access or operational effects.';
