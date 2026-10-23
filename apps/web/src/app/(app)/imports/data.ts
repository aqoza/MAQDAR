import 'server-only'
import type { Database } from '@zeespare/shared/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ErrorExample,
  PreviousFile,
  PreviousMappings,
  SummaryFile,
} from '@/components/imports/types'
import { isEntityName } from '@/lib/imports/contract'

/**
 * Reads for the import pages, through the user's client (RLS: editors read their organization's
 * imports). Every query names the organization explicitly, like the master-data lists.
 */

type Client = SupabaseClient<Database>

/** `import_batches.source`: the import wizard or the REST API (the history's source filter). */
export const IMPORT_SOURCES = ['wizard', 'api'] as const
export type ImportSource = (typeof IMPORT_SOURCES)[number]

/**
 * The history's `eq` conditions from its validated filters (status, source), shared by the page
 * query and the count behind its past-the-end redirect so both see the same rows.
 */
export function historyConditions(
  filters: Readonly<Record<string, string>>,
): Array<['status' | 'source', string]> {
  const conditions: Array<['status' | 'source', string]> = []
  if (filters.status) conditions.push(['status', filters.status])
  if (filters.source) conditions.push(['source', filters.source])
  return conditions
}

const EXAMPLES_PER_GROUP = 5
/** Error details read in one ordered pass; groups whose rows come later are fetched one by one. */
const FIRST_PASS_ROWS = 1_000
const MAX_TARGETED_GROUPS = 24
/** Earlier files offered for the duplicate warning and the previous mappings. */
const MEMORY_FILES = 500

const groupKey = (fileNo: number, code: string, column: string) =>
  `${fileNo}\u0000${code}\u0000${column}`

/**
 * Up to five stored examples per file, code and column, in row order. One pass over the first
 * 1,000 details, then a few targeted reads for groups that first appear later.
 */
export async function loadErrorExamples(
  supabase: Client,
  organizationId: string,
  batchId: string,
  files: readonly Pick<SummaryFile, 'file_no' | 'error_counts'>[],
): Promise<ErrorExample[]> {
  const columns = 'file_no, row_no, column_name, code, value'
  const { data, error } = await supabase
    .from('import_errors')
    .select(columns)
    .eq('organization_id', organizationId)
    .eq('batch_id', batchId)
    .order('file_no')
    .order('row_no')
    .order('id')
    .limit(FIRST_PASS_ROWS)
  if (error) return []

  const groups = new Map<string, ErrorExample[]>()
  const add = (row: ErrorExample) => {
    const key = groupKey(row.file_no, row.code, row.column_name)
    const list = groups.get(key) ?? []
    if (list.length < EXAMPLES_PER_GROUP) list.push(row)
    groups.set(key, list)
  }
  for (const row of data ?? []) add(row)

  const missing: { fileNo: number; code: string; column: string }[] = []
  for (const file of files) {
    for (const [code, perColumn] of Object.entries(file.error_counts)) {
      for (const column of Object.keys(perColumn)) {
        if (!groups.has(groupKey(file.file_no, code, column))) {
          missing.push({ fileNo: file.file_no, code, column })
        }
      }
    }
  }
  const targeted = await Promise.all(
    missing
      .slice(0, MAX_TARGETED_GROUPS)
      .map(({ fileNo, code, column }) =>
        supabase
          .from('import_errors')
          .select(columns)
          .eq('organization_id', organizationId)
          .eq('batch_id', batchId)
          .eq('file_no', fileNo)
          .eq('code', code)
          .eq('column_name', column)
          .order('row_no')
          .order('id')
          .limit(EXAMPLES_PER_GROUP),
      ),
  )
  for (const result of targeted) {
    for (const row of result.data ?? []) add(row)
  }
  return [...groups.values()].flat()
}

/** `\x…` (PostgREST's bytea text) as plain lower-case hex. */
export function byteaToHex(value: string): string {
  return (value.startsWith('\\x') ? value.slice(2) : value).toLowerCase()
}

/**
 * The organization's recent import files: their hashes (the duplicate warning) and the newest
 * non-empty mapping per entity (offered again by the mapping step).
 */
export async function loadImportMemory(
  supabase: Client,
  organizationId: string,
): Promise<{ previousFiles: PreviousFile[]; previousMappings: PreviousMappings }> {
  const { data, error } = await supabase
    .from('import_files')
    .select('batch_id, entity, original_name, sha256, mapping, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(MEMORY_FILES)
  if (error || !data) return { previousFiles: [], previousMappings: {} }

  const previousFiles: PreviousFile[] = []
  const previousMappings: PreviousMappings = {}
  for (const row of data) {
    previousFiles.push({
      sha256: byteaToHex(row.sha256),
      name: row.original_name,
      created_at: row.created_at,
      batch_id: row.batch_id,
    })
    if (!isEntityName(row.entity) || previousMappings[row.entity]) continue
    const mapping = row.mapping
    if (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping)) continue
    const entries = Object.entries(mapping).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
    )
    if (entries.length > 0) previousMappings[row.entity] = Object.fromEntries(entries)
  }
  return { previousFiles, previousMappings }
}

/**
 * E-mail addresses of the organization's members, for "started by". Only owners and admins may
 * list members (organization_members raises MQ403 otherwise), so other editors get an empty map.
 */
export async function loadMemberEmails(
  supabase: Client,
  organizationId: string,
  isAdmin: boolean,
): Promise<Map<string, string>> {
  if (!isAdmin) return new Map()
  const { data, error } = await supabase.rpc('organization_members', {
    p_organization_id: organizationId,
  })
  if (error || !data) return new Map()
  return new Map(data.map((member) => [member.user_id, member.email]))
}
