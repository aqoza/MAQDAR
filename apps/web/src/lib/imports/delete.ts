/**
 * The order of deleting an import, shared by the Server Action and `DELETE /api/imports/{id}`:
 *
 * 1. drain the leftover staging rows of a canceled or expired import (import_cancel_step until
 *    done), because import_delete refuses (MQ409 cleanup) while many remain;
 * 2. remove the stored originals from Storage;
 * 3. delete the batch with its files and errors (import_delete).
 *
 * Draining first means import_delete can no longer refuse after the originals are gone, so an
 * import is never left in the history with its audit copy deleted. If the originals cannot be
 * removed, nothing is deleted. Pure orchestration: every call is injected (Vitest covers it).
 */

export type DeleteSteps<E> = {
  /** One import_cancel_step: `done` once no staging row is left. */
  drain: () => Promise<{ done: boolean } | { error: E }>
  /** The storage paths of every file of the import (stored or not). */
  listPaths: () => Promise<{ paths: string[] } | { error: E }>
  removeOriginals: (paths: string[]) => Promise<{ error: E | null }>
  deleteBatch: () => Promise<{ error: E | null }>
}

export type DeleteOutcome<E> =
  { ok: true } | { ok: false; step: 'cleanup' | 'storage' | 'delete'; error: E | null }

/** Statuses import_delete accepts. */
export const DELETABLE_STATUSES: readonly string[] = ['succeeded', 'canceled', 'expired']

/** Rounds of import_cancel_step (20,000 rows each): more than the 1,000,000 rows of an import. */
export const DRAIN_ROUNDS = 60

export async function deleteImportInOrder<E>(
  status: string,
  steps: DeleteSteps<E>,
  rounds: number = DRAIN_ROUNDS,
): Promise<DeleteOutcome<E>> {
  if (!DELETABLE_STATUSES.includes(status)) {
    // Let import_delete answer with its own refusal (MQ409 status); nothing else is touched.
    const { error } = await steps.deleteBatch()
    return error ? { ok: false, step: 'delete', error } : { ok: true }
  }

  // A succeeded import was drained by its commit; canceled and expired ones may still hold rows.
  if (status !== 'succeeded') {
    let done = false
    for (let round = 0; round < rounds && !done; round += 1) {
      const result = await steps.drain()
      if ('error' in result) return { ok: false, step: 'cleanup', error: result.error }
      done = result.done
    }
    if (!done) return { ok: false, step: 'cleanup', error: null }
  }

  const listed = await steps.listPaths()
  if ('error' in listed) return { ok: false, step: 'storage', error: listed.error }
  if (listed.paths.length > 0) {
    const { error } = await steps.removeOriginals(listed.paths)
    if (error) return { ok: false, step: 'storage', error }
  }

  const { error } = await steps.deleteBatch()
  return error ? { ok: false, step: 'delete', error } : { ok: true }
}
