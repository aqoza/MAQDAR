'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { toErrorCounts, type ErrorExample } from '@/components/imports/types'
import { isEditorRole } from '@/lib/auth/roles'
import { getSessionClaims } from '@/lib/auth/session'
import type { ActionState } from '@/lib/forms'
import { TERMINAL_STATUSES, isImportStatus } from '@/lib/imports/client'
import { deleteImportInOrder } from '@/lib/imports/delete'
import { isUuid } from '@/lib/master-data/list-params'
import { getActiveContext } from '@/lib/organizations/context'
import { invalidState, requireEditor, rpcErrorState } from '@/lib/organizations/guard'
import { createClient } from '@/lib/supabase/server'
import { loadErrorExamples } from './data'

/**
 * Deletes a finished, canceled or expired import of the active organization: leftover staging
 * rows first (so import_delete cannot refuse afterwards), then its stored originals (Storage API
 * with the user's client; the bucket's policies allow editors to delete the originals of finished
 * imports), then the batch, files and error details (`import_delete`). Imported data is never
 * touched.
 */
export async function deleteImport(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const guard = await requireEditor(formData)
  if (!guard.ok) return guard.state
  const { organizationId } = guard
  const batchId = formData.get('batch_id')
  if (!isUuid(batchId)) return invalidState('invalid_import')

  const supabase = await createClient()
  const { data: batch, error } = await supabase
    .from('import_batches')
    .select('id, status')
    .eq('organization_id', organizationId)
    .eq('id', batchId)
    .maybeSingle()
  if (error) return rpcErrorState(error)
  if (!batch) return rpcErrorState({ code: 'MQ404' })
  const t = await getTranslations('Imports.detail')
  if (!isImportStatus(batch.status) || !TERMINAL_STATUSES.includes(batch.status)) {
    return { status: 'error', message: t('deleteNotAllowed'), code: 'MQ409' }
  }

  const outcome = await deleteImportInOrder(batch.status, {
    drain: async () => {
      const { data, error: cancelError } = await supabase.rpc('import_cancel_step', {
        p_batch_id: batchId,
      })
      if (cancelError) return { error: cancelError }
      return { done: Boolean((data as { done?: boolean } | null)?.done) }
    },
    listPaths: async () => {
      const { data: files, error: filesError } = await supabase
        .from('import_files')
        .select('storage_path')
        .eq('organization_id', organizationId)
        .eq('batch_id', batchId)
      if (filesError) return { error: filesError }
      // Every path, stored or not: an upload may have finished after the file was sealed.
      return { paths: (files ?? []).map((file) => file.storage_path) }
    },
    removeOriginals: async (paths) => {
      const { error: storageError } = await supabase.storage.from('imports').remove(paths)
      return { error: storageError ? { code: 'storage', message: storageError.message } : null }
    },
    deleteBatch: async () => {
      const { error: deleteError } = await supabase.rpc('import_delete', { p_batch_id: batchId })
      return { error: deleteError }
    },
  })
  if (!outcome.ok) {
    if (outcome.step === 'storage' && outcome.error?.code === 'storage') {
      return { status: 'error', message: t('deleteStorageFailed'), code: 'storage' }
    }
    return rpcErrorState(outcome.error ?? { code: 'MQ409', hint: 'cleanup' })
  }

  revalidatePath('/imports')
  redirect('/imports?notice=deleted')
}

/**
 * Examples for the wizard's error summary once every file is checked (the route handlers return
 * counts only). Editors of the active organization; anything else gets no examples.
 */
export async function fetchErrorExamples(batchId: string): Promise<ErrorExample[]> {
  if (!isUuid(batchId) || !(await getSessionClaims())) return []
  const context = await getActiveContext()
  if (!context?.active || !isEditorRole(context.role)) return []
  const organizationId = context.active.id

  const supabase = await createClient()
  const { data: files, error } = await supabase
    .from('import_files')
    .select('file_no, error_counts')
    .eq('organization_id', organizationId)
    .eq('batch_id', batchId)
  if (error || !files) return []
  return loadErrorExamples(
    supabase,
    organizationId,
    batchId,
    files.map((file) => ({
      file_no: file.file_no,
      error_counts: toErrorCounts(file.error_counts),
    })),
  )
}
