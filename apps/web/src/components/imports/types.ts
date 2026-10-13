import type { ErrorCounts } from '../../lib/imports/client'
import type { EntityName } from '../../lib/imports/contract'

/**
 * Shapes the import pages pass from the server to their components (all serializable). Pure
 * module, shared by server pages, Server Actions and client components.
 */

/** One stored error or warning detail shown as an example (`import_errors`). */
export type ErrorExample = {
  file_no: number
  row_no: number
  column_name: string
  code: string
  value: string | null
}

/** What the error summary needs of a file. */
export type SummaryFile = {
  file_no: number
  entity: EntityName
  name: string
  error_counts: ErrorCounts
  error_count: number
  warning_count: number
  errors_stored: number
}

/** Display label per contract column, per entity (in the request's language). */
export type ColumnLabelMap = Partial<Record<EntityName, Record<string, string>>>

/** Labels to match file headers against (English and Arabic), per entity and column. */
export type MatchLabelMap = Partial<Record<EntityName, Record<string, string[]>>>

/** A file the organization imported before (duplicate warning by SHA-256). */
export type PreviousFile = {
  sha256: string
  name: string
  created_at: string
  batch_id: string
}

/** The mapping last used per entity (contract column → header text). */
export type PreviousMappings = Partial<Record<EntityName, Record<string, string>>>

/** `import_batches.failure_code` values (why a commit stopped). */
export const FAILURE_CODES = [
  'changed_during_commit',
  'preferred_conflict',
  'supersession_cycle',
  'location_cycle',
  'holiday_overlap',
  'timeout',
  'concurrent_change',
  'abandoned',
  'staging_lost',
] as const

export type FailureCode = (typeof FAILURE_CODES)[number]

export function isFailureCode(value: unknown): value is FailureCode {
  return typeof value === 'string' && (FAILURE_CODES as readonly string[]).includes(value)
}

/** Rows a stepped commit already saved: each file's merge cursor, capped at its row count. */
export function appliedRows(
  files: readonly { merged_through_row: number; rows_total: number }[],
): number {
  return files.reduce((sum, file) => sum + Math.min(file.merged_through_row, file.rows_total), 0)
}

/**
 * Whether an import saved some rows but not all: a stepped commit that is running or stopped
 * (failed), or one that ended without succeeding (abandoned, expired, staging lost) after its
 * first unit. Its rows stay saved whatever the status says.
 */
export function partialState(
  batch: { commit_mode: string | null; status: string },
  applied: number,
): 'running' | 'stopped' | null {
  if (batch.commit_mode !== 'stepped' || batch.status === 'succeeded') return null
  if (batch.status === 'committing' || batch.status === 'failed') return 'running'
  return applied > 0 ? 'stopped' : null
}

/** What a commit did, for the history: inserted, updated and deleted rows over every entity. */
export function countTotals(counts: Record<string, Partial<Record<string, number>>>): {
  inserted: number
  updated: number
  deleted: number
} {
  let inserted = 0
  let updated = 0
  let deleted = 0
  for (const entry of Object.values(counts)) {
    inserted += entry.inserted ?? 0
    updated += entry.updated ?? 0
    deleted += entry.deleted ?? 0
  }
  return { inserted, updated, deleted }
}

/**
 * Whether the history shows a result for an import: committed (succeeded or failed), or a
 * stepped commit that ended otherwise (abandoned, expired) after saving rows.
 */
export function hasCommitResult(
  status: string,
  counts: Record<string, Partial<Record<string, number>>>,
): boolean {
  if (status === 'succeeded' || status === 'failed') return true
  const totals = countTotals(counts)
  return totals.inserted + totals.updated + totals.deleted > 0
}

/** Count columns a commit result table shows: the five always, the two extra ones when used. */
export const BASE_COUNT_COLUMNS = [
  'inserted',
  'updated',
  'unchanged',
  'deleted',
  'skipped',
] as const
export const EXTRA_COUNT_COLUMNS = ['parents_set', 'preferred_cleared'] as const
export type CountColumn = (typeof BASE_COUNT_COLUMNS)[number] | (typeof EXTRA_COUNT_COLUMNS)[number]

/**
 * The count columns of a result: location parents changed in the second pass (a parent-only
 * change counts as unchanged in the first) and other suppliers' preferred flags cleared appear
 * only when an entity reports them.
 */
export function countColumns(
  counts: Record<string, Partial<Record<string, number>>> | undefined,
): CountColumn[] {
  const entries = Object.values(counts ?? {})
  const extras = EXTRA_COUNT_COLUMNS.filter((column) =>
    entries.some((entry) => (entry[column] ?? 0) > 0),
  )
  return [...BASE_COUNT_COLUMNS, ...extras]
}

/** Turns `import_files.error_counts` (jsonb) into counts, dropping anything malformed. */
export function toErrorCounts(value: unknown): ErrorCounts {
  const counts: ErrorCounts = {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return counts
  for (const [code, columns] of Object.entries(value)) {
    if (typeof columns !== 'object' || columns === null || Array.isArray(columns)) continue
    const perColumn: Record<string, number> = {}
    for (const [column, count] of Object.entries(columns)) {
      if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
        perColumn[column] = count
      }
    }
    if (Object.keys(perColumn).length > 0) counts[code] = perColumn
  }
  return counts
}
