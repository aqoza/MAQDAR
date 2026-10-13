import type { NextRequest } from 'next/server'
import {
  IMPORTS_BUCKET,
  badRequest,
  errorResponse,
  guardMutation,
  jsonResponse,
  parseUuid,
  rpcErrorResponse,
  unexpectedErrorResponse,
} from '@/lib/imports/route'
import { requireEditorRoute } from '@/lib/imports/route-auth'
import { deleteImportInOrder } from '@/lib/imports/delete'

type Params = { params: Promise<{ id: string }> }

const BATCH_COLUMNS =
  'id, organization_id, source, status, commit_mode, created_by, file_count, rows_total, rows_staged, error_count, warning_count, counts, progress, failure_code, failure_detail, created_at, updated_at, validated_at, commit_started_at, last_step_at, finished_at, expires_at, staging_cleared_at'

// Everything the status view needs; header, mapping and parse options (up to 32 KB each) and the
// storage path stay out of the polling response.
const FILE_COLUMNS =
  'file_no, entity, original_name, extension, content_type, size_bytes, status, source_stored, columns, rows_total, rows_staged, rows_new, rows_existing, error_count, warning_count, errors_stored, error_counts, merged_through_row, counts, sealed_at, created_at, updated_at'

const notFound = () => errorResponse(404, { code: 'MQ404', hint: 'batch_id' })

/**
 * Status of an import: the batch and its files, read through RLS (editors of the organization
 * only) and filtered on the active organization. 404 when the import does not exist there.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const route = 'GET /api/imports/[id]'
  const auth = await requireEditorRoute()
  if (!auth.ok) return auth.response
  const batchId = parseUuid((await params).id)
  if (!batchId) return badRequest('batch_id')

  try {
    const [batch, files] = await Promise.all([
      auth.supabase
        .from('import_batches')
        .select(BATCH_COLUMNS)
        .eq('organization_id', auth.organizationId)
        .eq('id', batchId)
        .maybeSingle(),
      auth.supabase
        .from('import_files')
        .select(FILE_COLUMNS)
        .eq('organization_id', auth.organizationId)
        .eq('batch_id', batchId)
        .order('file_no'),
    ])
    if (batch.error) return rpcErrorResponse(batch.error, route)
    if (!batch.data) return notFound()
    if (files.error) return rpcErrorResponse(files.error, route)
    return jsonResponse({ batch: batch.data, files: files.data ?? [] })
  } catch (error) {
    return unexpectedErrorResponse(error, route)
  }
}

/**
 * Deletes a finished import (succeeded, canceled or expired): leftover staging rows first
 * (import_cancel_step until done, so import_delete cannot refuse afterwards), then the originals
 * in Storage, with the user's client (the Storage delete policy applies), then import_delete,
 * which removes the batch, its files and its errors. If the originals cannot be removed nothing is
 * deleted, so no stored file outlives its import and no import loses its originals while it stays.
 * Other statuses go straight to import_delete for its MQ409.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const route = 'DELETE /api/imports/[id]'
  const guard = await guardMutation(request)
  if (!guard.ok) return guard.response
  const batchId = parseUuid((await params).id)
  if (!batchId) return badRequest('batch_id')
  const auth = await requireEditorRoute()
  if (!auth.ok) return auth.response

  try {
    const batch = await auth.supabase
      .from('import_batches')
      .select('status')
      .eq('organization_id', auth.organizationId)
      .eq('id', batchId)
      .maybeSingle()
    if (batch.error) return rpcErrorResponse(batch.error, route)
    if (!batch.data) return notFound()

    const supabase = auth.supabase
    const outcome = await deleteImportInOrder(batch.data.status, {
      drain: async () => {
        const { data, error } = await supabase.rpc('import_cancel_step', { p_batch_id: batchId })
        if (error) return { error }
        return { done: Boolean((data as { done?: boolean } | null)?.done) }
      },
      listPaths: async () => {
        const files = await supabase
          .from('import_files')
          .select('storage_path')
          .eq('organization_id', auth.organizationId)
          .eq('batch_id', batchId)
        if (files.error) return { error: files.error }
        return { paths: (files.data ?? []).map((file) => file.storage_path) }
      },
      removeOriginals: async (paths) => {
        const removed = await supabase.storage.from(IMPORTS_BUCKET).remove(paths)
        return { error: removed.error ? { code: 'storage', message: removed.error.message } : null }
      },
      deleteBatch: async () => {
        const { error } = await supabase.rpc('import_delete', { p_batch_id: batchId })
        return { error }
      },
    })
    if (!outcome.ok) {
      return rpcErrorResponse(outcome.error ?? { code: 'MQ409', hint: 'cleanup' }, route)
    }
    return jsonResponse({ batch_id: batchId, deleted: true })
  } catch (error) {
    return unexpectedErrorResponse(error, route)
  }
}
