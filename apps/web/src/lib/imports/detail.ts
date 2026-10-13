/**
 * Decisions of the import detail page, kept pure so Vitest covers them: what to render from the
 * two independent queries (batch and files), and whether a stepped commit is idle long enough to
 * be abandoned. No server or Next.js imports.
 */

/** The shape of a supabase-js query result the page looks at. */
export type QueryOutcome<T> = { data: T | null; error: { message: string } | null }

export type DetailOutcome<B, F> =
  { kind: 'ok'; batch: B; files: F[] } | { kind: 'not_found' } | { kind: 'failed' }

/**
 * `failed` when either query failed (the page says so instead of showing an import without files
 * and "no errors"), `not_found` when the batch is not there, `ok` otherwise.
 */
export function detailOutcome<B, F>(
  batch: QueryOutcome<B>,
  files: QueryOutcome<F[]>,
): DetailOutcome<B, F> {
  if (batch.error) return { kind: 'failed' }
  if (!batch.data) return { kind: 'not_found' }
  if (files.error) return { kind: 'failed' }
  return { kind: 'ok', batch: batch.data, files: files.data ?? [] }
}

/** A stepped commit without a step for this long can be abandoned (import_cancel_step). */
export const IDLE_COMMIT_MS = 30 * 60_000

/** Whether a committing import has had no step for 30 minutes (so cancel abandons it). */
export function isIdleCommit(
  status: string,
  lastStepAt: string | null,
  now: number = Date.now(),
): boolean {
  if (status !== 'committing' || !lastStepAt) return false
  const last = Date.parse(lastStepAt)
  return Number.isFinite(last) && now - last > IDLE_COMMIT_MS
}
