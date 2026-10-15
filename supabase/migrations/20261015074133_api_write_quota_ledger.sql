-- Keep the rolling API write quota independent of deletable import history.
-- Logged and private, like ingest.import_creations for the wizard. No FK to import_batches:
-- deleting history must not restore quota. Organization deletion still cascades its ledger.
set lock_timeout = '5s';

create table ingest.api_writes (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid primary key,
  created_at timestamptz not null default now()
);
create index api_writes_org_created_idx on ingest.api_writes (organization_id, created_at);
alter table ingest.api_writes enable row level security;
revoke all on ingest.api_writes from public, anon, authenticated, service_role;
comment on table ingest.api_writes is 'Successful changed API writes, retained for the rolling 24-hour cap even after import history deletion. Expired entries are pruned by the next API write of the organization.';

-- Also supports a local stack that already exercised the Step 5b migration.
insert into ingest.api_writes (organization_id, batch_id, created_at)
select organization_id, id, created_at from public.import_batches
where source = 'api' and status = 'succeeded' and created_at > now() - interval '24 hours';

create or replace function public.api_upsert(p_key_hash bytea, p_entity text, p_body jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_key uuid;
  v_columns text[];
  v_n integer;
  v_batch uuid := gen_random_uuid();
  v_file_no constant smallint := 1;
  v_sha bytea;
  v_errors integer;
  v_commit jsonb;
  v_counts jsonb;
  v_result jsonb;
  v_constraint text;
  v_analyze text;
begin
  if p_entity is null or not exists (select 1 from ingest.contract_entities e where e.entity = p_entity) then
    raise exception using errcode = 'MQ404', message = 'no such resource', hint = 'resource';
  end if;
  select a.organization_id, a.api_key_id into v_org, v_key
  from app.api_authorize(p_key_hash, case when p_entity = 'demand_history' then 'transactions:write' else 'master_data:write' end) as a;
  if p_request_id is null then
    raise exception using errcode = 'MQ422', message = 'a request id is required', hint = 'request_id';
  end if;

  v_columns := app.api_check_fields(p_entity, p_body);
  v_n := jsonb_array_length(p_body -> 'records');

  -- The 5a import lock: one writer per organization, refused at once rather than waited for. It is
  -- taken here, outside the block below, because a lock taken in a rolled-back subtransaction is
  -- released with it.
  if not pg_try_advisory_xact_lock(hashtextextended('maqdar.import:' || v_org::text, 0)) then
    raise exception using errcode = 'MQ409', message = 'another import is writing to this organization; try again shortly',
      hint = 'import_in_progress';
  end if;
  perform app.import_sweep(0);
  delete from ingest.api_writes w
  where w.organization_id = v_org and w.created_at <= now() - interval '24 hours';
  if (select count(*) from (select 1 from ingest.api_writes w
                            where w.organization_id = v_org and w.created_at > now() - interval '24 hours'
                            limit 5000) as x) >= 5000 then
    raise exception using errcode = 'MQ429', message = 'too many recorded API writes in the last 24 hours (at most 5,000)',
      hint = 'api_writes_per_day';
  end if;

  -- ANALYZE (SKIP_LOCKED) in the 5a statistics helpers for this write only. A function SET clause
  -- cannot name a custom setting unless the owner is a superuser (postgres is not, locally or
  -- hosted), so it is set for the transaction here and restored below; an error rolls it back.
  v_analyze := current_setting('maqdar.import_analyze', true);
  perform set_config('maqdar.import_analyze', 'skip_locked', true);

  -- Everything below is undone when the write fails or changes nothing (MQ499 is internal: raised
  -- and caught here only). v_result survives the rollback.
  begin
    v_sha := sha256(convert_to(p_body::text, 'UTF8'));
    begin
      insert into public.import_batches (id, organization_id, source, status, commit_mode, created_by, api_key_id, api_request_id,
                                         files_sha256, file_count, rows_total, validated_at, commit_started_at, last_step_at,
                                         expires_at)
      values (v_batch, v_org, 'api', 'committing', 'atomic', null, v_key, p_request_id,
              v_sha, 1, v_n, now(), now(), now(), null);
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'import_batches_one_committing' then
        raise exception using errcode = 'MQ409', message = 'another import of this organization is committing',
          hint = 'another_commit';
      end if;
      raise;
    end;
    insert into public.import_files (organization_id, batch_id, file_no, entity, original_name, content_type, extension,
                                     size_bytes, sha256, storage_path, columns, rows_total)
    values (v_org, v_batch, v_file_no, p_entity, 'POST /api/v1/' || replace(p_entity, '_', '-') || ':upsert', 'application/json',
            'json', octet_length(p_body::text), v_sha, v_org::text || '/' || v_batch::text || '/1.json', v_columns, v_n);

    -- import_stage_chunk's order: stage, statistics of the entity and its lookups, cells,
    -- references and row rules; then import_seal_file's set rules.
    perform app.api_stage_records(v_batch, p_body -> 'records');
    perform app.import_prepare_stats(v_batch, array(
      select p_entity
      union
      select c.lookup_entity from ingest.contract_columns c where c.entity = p_entity and c.lookup_entity is not null));
    perform app.import_check_cells(v_batch, v_file_no, 1, v_n);
    perform app.import_check_refs(v_batch, v_file_no, 1, v_n, 'stage');
    perform app.import_flush_errors(v_batch, v_file_no);
    perform app.import_check_sets(v_batch, v_file_no);
    perform app.import_flush_errors(v_batch, v_file_no);
    update public.import_files f set status = 'sealed', sealed_at = now()
    where f.organization_id = v_org and f.batch_id = v_batch and f.file_no = v_file_no;

    select b.error_count into v_errors from public.import_batches b where b.id = v_batch;
    if v_errors > 0 then
      v_result := app.api_error_result(v_batch, 'invalid');
      raise exception using errcode = 'MQ499', message = 'api write rolled back';
    end if;

    v_commit := app.import_commit_atomic(v_batch);
    if v_commit ->> 'failure_code' is not null then
      v_result := app.api_error_result(v_batch, 'conflict');
      raise exception using errcode = 'MQ499', message = 'api write rolled back';
    end if;

    select b.counts -> p_entity into v_counts from public.import_batches b where b.id = v_batch;
    if coalesce((v_counts ->> 'inserted')::bigint, 0) + coalesce((v_counts ->> 'updated')::bigint, 0)
       + coalesce((v_counts ->> 'deleted')::bigint, 0) + coalesce((v_counts ->> 'parents_set')::bigint, 0)
       + coalesce((v_counts ->> 'preferred_cleared')::bigint, 0) = 0 then
      v_result := app.api_success_result(v_batch, false);
      raise exception using errcode = 'MQ499', message = 'api write rolled back';
    end if;
    -- In the same transaction as the data; failures and no-ops never reach this insert.
    insert into ingest.api_writes (organization_id, batch_id) values (v_org, v_batch);
    v_result := app.api_success_result(v_batch, true);
  exception when sqlstate 'MQ499' then
    null;
  end;
  perform set_config('maqdar.import_analyze', coalesce(v_analyze, ''), true);
  return v_result;
end;
$$;

-- CREATE OR REPLACE preserves the existing ACL; repeat it explicitly for review.
revoke all on function public.api_upsert(bytea, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.api_upsert(bytea, text, jsonb, uuid) to service_role;
reset lock_timeout;
