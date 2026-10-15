-- The scheduler removes actual objects through Storage, then acknowledges their absence here.
-- Never delete storage.objects directly: that would orphan the uploaded bytes.
set lock_timeout = '5s';
alter table public.import_files add column source_purged_at timestamptz;

create or replace function public.import_retention_candidates()
returns table(batch_id uuid,file_no smallint,storage_path text)
language sql stable security definer set search_path = '' as $$
  select f.batch_id,f.file_no,f.storage_path
  from public.import_files f join public.import_batches b on b.id=f.batch_id
  where f.source_stored and b.status in ('succeeded','canceled','expired')
    and b.finished_at < now()-interval '30 days'
  order by b.finished_at,f.batch_id,f.file_no limit 100;
$$;
revoke all on function public.import_retention_candidates() from public,anon,authenticated;
grant execute on function public.import_retention_candidates() to service_role;

create or replace function public.import_retention_complete(p_batch_id uuid,p_file_no smallint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.import_files f set source_stored=false,source_purged_at=now()
  from public.import_batches b where f.batch_id=p_batch_id and f.file_no=p_file_no and b.id=f.batch_id
    and f.source_stored and b.status in ('succeeded','canceled','expired')
    and b.finished_at<now()-interval '30 days'
    and not exists(select 1 from storage.objects o where o.bucket_id='imports' and o.name=f.storage_path);
  get diagnostics n=row_count;
  return n=1;
end; $$;
revoke all on function public.import_retention_complete(uuid,smallint) from public,anon,authenticated;
grant execute on function public.import_retention_complete(uuid,smallint) to service_role;
reset lock_timeout;
