import 'server-only'
import type { Database } from '@zeespare/shared/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { displayName } from '@/lib/format'
import { searchItemIds } from './item-codes'
import { searchPatterns } from './search'
import { DEEP_OFFSET, lastPage, nearestRange, toRange, type ListParams } from './list-params'
import type { EntityDefinition, EntityRow, OptionSourceKey, OptionsSpec } from './types'

/*
 * Database reads for the master-data screens. Every query names the organization explicitly
 * (`.eq('organization_id', id)` with the id from getActiveContext(), never the token claim) even
 * though RLS also scopes rows: the filter is what lets the planner use the tenant indexes. List
 * queries count exactly (planned or estimated counts are wrong under RLS and leak table sizes) and
 * never retry (a retried page render doubles the Worker's CPU for nothing).
 */

type TypedClient = SupabaseClient<Database>

/** The client without table typing, for tables chosen at runtime from the registry. */
export function untyped(supabase: TypedClient): SupabaseClient {
  return supabase as unknown as SupabaseClient
}

// The part of PostgREST's filter builder used here. Its real type is generic over the selected
// row and too deep to constrain against, so builders pass through as `T` unchanged.
type FilterChain = {
  eq(column: string, value: unknown): FilterChain
  like(column: string, pattern: string): FilterChain
  in(column: string, values: readonly string[]): FilterChain
  or(filters: string): FilterChain
}

/**
 * Adds the search and validated filters of `params` to a query. Tables with `search_text` match
 * the normalized tokens; entities with `itemSearchColumns` match the ids of the items the search
 * found (`itemIds`, resolved beforehand by fetchListPage).
 */
export function applySearchAndFilters<T>(
  query: T,
  definition: Pick<EntityDefinition, 'list' | 'itemSearchColumns'>,
  params: ListParams,
  itemIds: readonly string[] | null = null,
): T {
  let result = query as unknown as FilterChain
  const itemColumns = definition.itemSearchColumns ?? []
  if (itemColumns.length > 0) {
    if (itemIds !== null) {
      // Ids are uuids from the database, so they need no quoting inside or=(…).
      result =
        itemColumns.length === 1
          ? result.in(itemColumns[0]!, itemIds)
          : result.or(itemColumns.map((column) => `${column}.in.(${itemIds.join(',')})`).join(','))
    }
  } else if (definition.list.search) {
    for (const pattern of searchPatterns(params.q)) result = result.like('search_text', pattern)
  }
  for (const filter of definition.list.filters) {
    const value = params.filters[filter.param]
    if (value === undefined) continue
    result = result.eq(filter.column, filter.kind === 'boolean' ? value === 'true' : value)
  }
  return result as unknown as T
}

export type ListPageResult =
  | { ok: true; rows: EntityRow[]; total: number }
  /** The page is past the end; `page` is the last page that exists. */
  | { ok: false; reason: 'past_end'; page: number }
  | { ok: false; reason: 'error'; code: string }

/**
 * One page of a list, ordered by the sort column and then the unique tiebreaker. Pages before
 * DEEP_OFFSET are one counted query. Deeper pages count first and then read from the nearer end of
 * the order (nearestRange), so the last page is as cheap as the first.
 */
export async function fetchListPage(
  supabase: TypedClient,
  definition: EntityDefinition,
  organizationId: string,
  params: ListParams,
): Promise<ListPageResult> {
  const db = untyped(supabase)
  let itemIds: string[] | null = null
  if (definition.itemSearchColumns?.length && params.q) {
    itemIds = await searchItemIds(supabase, organizationId, params.q)
    if (itemIds !== null && itemIds.length === 0) return { ok: true, rows: [], total: 0 }
  }
  const filtered = (columns: string, options?: { count: 'exact'; head?: boolean }) =>
    applySearchAndFilters(
      db.from(definition.table).select(columns, options).eq('organization_id', organizationId),
      definition,
      params,
      itemIds,
    )
  const ordered = (options: { count: 'exact' } | undefined, ascending: boolean) => {
    const query = filtered(definition.listSelect, options).order(params.sort, { ascending })
    return params.sort === definition.list.tiebreak
      ? query
      : query.order(definition.list.tiebreak, { ascending })
  }
  const failed = (error: { code?: string; message?: string }): ListPageResult => {
    console.error('master-data: list query failed', {
      table: definition.table,
      code: error.code,
      message: error.message,
    })
    return { ok: false, reason: 'error', code: error.code ?? 'unknown' }
  }
  const countRows = async (): Promise<number | ListPageResult> => {
    const head = await filtered('id', { count: 'exact', head: true }).retry(false)
    if (head.error) return failed(head.error)
    return head.count ?? 0
  }
  const pastEnd = async (): Promise<ListPageResult> => {
    // Range not satisfiable: the page is past the end (rows were deleted, or the URL was edited).
    const total = await countRows()
    if (typeof total !== 'number') return total
    return { ok: false, reason: 'past_end', page: lastPage(total, params.size) }
  }
  const finish = async (data: unknown, total: number): Promise<ListPageResult> => {
    const rows = (data ?? []) as EntityRow[]
    return {
      ok: true,
      rows: definition.enrichRows
        ? await definition.enrichRows(rows, { supabase, organizationId })
        : rows,
      total,
    }
  }

  const ascending = params.dir === 'asc'
  const { from, to } = toRange(params.page, params.size)
  if (from < DEEP_OFFSET) {
    const { data, error, count } = await ordered({ count: 'exact' }, ascending)
      .range(from, to)
      .retry(false)
    if (error?.code === 'PGRST103') return pastEnd()
    if (error) return failed(error)
    return finish(data, count ?? 0)
  }

  const total = await countRows()
  if (typeof total !== 'number') return total
  if (from >= total) return { ok: false, reason: 'past_end', page: lastPage(total, params.size) }
  const range = nearestRange(from, to, total)
  const { data, error } = await ordered(undefined, range.reversed ? !ascending : ascending)
    .range(range.from, range.to)
    .retry(false)
  // Rows deleted between the count and the read.
  if (error?.code === 'PGRST103') return pastEnd()
  if (error) return failed(error)
  const rows = (data ?? []) as unknown as EntityRow[]
  return finish(range.reversed ? rows.toReversed() : rows, total)
}

/** One row of the active organization by id, or null. */
export async function fetchRow(
  supabase: TypedClient,
  definition: EntityDefinition,
  organizationId: string,
  id: string,
): Promise<EntityRow | null> {
  const { data, error } = await untyped(supabase)
    .from(definition.table)
    .select(definition.editSelect)
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle()
    .retry(false)
  if (error) {
    console.error('master-data: row query failed', { table: definition.table, code: error.code })
    return null
  }
  return (data as unknown as EntityRow | null) ?? null
}

/* ------------------------------------------------------------------------------------------ */
/* Select options                                                                              */
/* ------------------------------------------------------------------------------------------ */

export type SelectOption = { value: string; label: string; lang?: 'ar' }

const OPTION_LIMIT = 1000

type CodeNameRow = { id: string; code: string; name_en: string; name_ar: string | null }

function codeNameOptions(rows: CodeNameRow[] | null, locale: string): SelectOption[] {
  return (rows ?? []).map((row) => ({
    value: row.id,
    label: `${row.code} · ${displayName(row, locale).primary}`,
  }))
}

async function loadSource(
  supabase: TypedClient,
  source: OptionSourceKey,
  organizationId: string,
  locale: string,
): Promise<SelectOption[]> {
  switch (source) {
    case 'currencies': {
      const { data } = await supabase.from('currencies').select('code, name_en').order('code')
      return (data ?? []).map((row) => ({ value: row.code, label: `${row.code} · ${row.name_en}` }))
    }
    case 'countries': {
      const { data } = await supabase
        .from('countries')
        .select('code, name_en, name_ar')
        .order('name_en')
      return (data ?? []).map((row) => ({
        value: row.code,
        label: displayName(row, locale).primary,
      }))
    }
    case 'brands':
    case 'locations':
    case 'suppliers':
    case 'work_calendars': {
      const { data } = await supabase
        .from(source)
        .select('id, code, name_en, name_ar')
        .eq('organization_id', organizationId)
        .order('code')
        .limit(OPTION_LIMIT)
        .retry(false)
      return codeNameOptions(data as CodeNameRow[] | null, locale)
    }
    case 'holiday_scopes': {
      const [countries, calendars] = await Promise.all([
        loadSource(supabase, 'countries', organizationId, locale),
        loadSource(supabase, 'work_calendars', organizationId, locale),
      ])
      return [
        ...countries.map((option) => ({ ...option, value: `country:${option.value}` })),
        ...calendars.map((option) => ({ ...option, value: `calendar:${option.value}` })),
      ]
    }
  }
}

/** Loads each distinct option source once, in parallel. */
export async function loadOptions(
  supabase: TypedClient,
  sources: readonly OptionSourceKey[],
  organizationId: string,
  locale: string,
): Promise<Partial<Record<OptionSourceKey, SelectOption[]>>> {
  const unique = [...new Set(sources)]
  const loaded = await Promise.all(
    unique.map((source) => loadSource(supabase, source, organizationId, locale)),
  )
  return Object.fromEntries(unique.map((source, index) => [source, loaded[index]]))
}

/** The option sources a definition's fields and filters need. */
export function optionSourcesOf(
  definition: Pick<EntityDefinition, 'fields' | 'filterOptions'>,
  which: 'fields' | 'filters',
): OptionSourceKey[] {
  if (which === 'filters') return Object.values(definition.filterOptions ?? {})
  return definition.fields
    .map((field) => field.options)
    .filter((options): options is Exclude<OptionsSpec, { source: 'enum' }> =>
      Boolean(options && options.source !== 'enum'),
    )
    .map((options) => options.source)
}

export { lookupItems, resolveItemCodes, searchItemIds } from './item-codes'
