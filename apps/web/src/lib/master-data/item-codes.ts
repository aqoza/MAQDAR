import type { Database } from '@zeespare/shared/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { searchPatterns, searchTokens } from './search'
import type { EntityContext, MasterDataErrorKey } from './types'

/**
 * Items referenced by part code. Forms that point at items (supersessions, interchanges, supplier
 * items) take part codes, never ids; these helpers resolve them for the active organization. No
 * server-only imports (the client is passed in), so entity definitions that use them stay
 * loadable by Vitest.
 */

type Client = SupabaseClient<Database>

/** `%`, `_` and `\` are LIKE wildcards; item codes may contain `_`. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/**
 * Maps part codes to item ids. Exact matches first; a code that only matches one item when case is
 * ignored (`p-000001` for `P-000001`) resolves to it too. Unknown codes are absent from the map.
 */
export async function resolveItemCodes(
  supabase: Client,
  organizationId: string,
  codes: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(codes.map((code) => code.trim()).filter(Boolean))]
  const resolved = new Map<string, string>()
  if (unique.length === 0) return resolved
  const { data, error } = await supabase
    .from('items')
    .select('id, code')
    .eq('organization_id', organizationId)
    .in('code', unique)
    .retry(false)
  if (error) throw new Error(`resolveItemCodes failed: ${error.code}`)
  for (const row of data ?? []) resolved.set(row.code, row.id)

  for (const code of unique.filter((candidate) => !resolved.has(candidate))) {
    const { data: matches, error: caseError } = await supabase
      .from('items')
      .select('id')
      .eq('organization_id', organizationId)
      .ilike('code', escapeLike(code))
      .limit(2)
      .retry(false)
    if (caseError) throw new Error(`resolveItemCodes failed: ${caseError.code}`)
    if (matches?.length === 1 && matches[0]) resolved.set(code, matches[0].id)
  }
  return resolved
}

export type ItemCodeFieldsResult<F extends string> =
  | { ok: true; ids: Record<F, string | null> }
  | { ok: false; fieldErrors: Partial<Record<F, MasterDataErrorKey>> }

/**
 * Resolves the part-code fields of a form (`{ predecessor_item_code: 'P-1', … }`) to item ids, or
 * returns `unknownItem` errors for the fields whose code matches no item. Null codes stay null.
 * Use it in an entity's `toRow`.
 */
export async function resolveItemCodeFields<F extends string>(
  ctx: EntityContext,
  codes: Record<F, string | null>,
): Promise<ItemCodeFieldsResult<F>> {
  const entries = Object.entries(codes) as Array<[F, string | null]>
  const map = await resolveItemCodes(
    ctx.supabase,
    ctx.organizationId,
    entries.map(([, code]) => code ?? '').filter(Boolean),
  )
  const ids = {} as Record<F, string | null>
  const fieldErrors: Partial<Record<F, MasterDataErrorKey>> = {}
  for (const [field, code] of entries) {
    if (code === null || code.trim() === '') {
      ids[field] = null
      continue
    }
    const id = map.get(code.trim())
    if (id) ids[field] = id
    else fieldErrors[field] = 'unknownItem'
  }
  return Object.keys(fieldErrors).length > 0 ? { ok: false, fieldErrors } : { ok: true, ids }
}

/** The most item ids a list search by item resolves (more matches are cut off; 50 ids in two
 * columns keep the request URL near 4 KB). */
export const ITEM_SEARCH_LIMIT = 50

/**
 * Ids of items whose code or name matches the search (normalized tokens, AND-ed), for lists that
 * filter by item (supersessions, interchanges, supplier items). Null when the query has no tokens.
 */
export async function searchItemIds(
  supabase: Client,
  organizationId: string,
  query: string,
  limit = ITEM_SEARCH_LIMIT,
): Promise<string[] | null> {
  if (searchTokens(query).length === 0) return null
  let builder = supabase.from('items').select('id').eq('organization_id', organizationId)
  for (const pattern of searchPatterns(query)) builder = builder.like('search_text', pattern)
  const { data, error } = await builder.order('code').limit(limit).retry(false)
  if (error) throw new Error(`searchItemIds failed: ${error.code}`)
  return (data ?? []).map((row) => row.id)
}

/** Items for the part-code datalist (/api/lookup/items). */
export async function lookupItems(
  supabase: Client,
  organizationId: string,
  query: string,
  limit = 20,
): Promise<Array<{ code: string; name_en: string }>> {
  if (searchTokens(query).length === 0) return []
  let builder = supabase.from('items').select('code, name_en').eq('organization_id', organizationId)
  for (const pattern of searchPatterns(query)) builder = builder.like('search_text', pattern)
  const { data, error } = await builder.order('code').limit(limit).retry(false)
  if (error) throw new Error(`lookupItems failed: ${error.code}`)
  return data ?? []
}
