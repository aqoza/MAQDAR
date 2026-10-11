/**
 * URL state of a server-rendered master-data list: page, page size, sort, direction, search and
 * filters. Everything is allow-listed against the entity's ListSpec, so a URL can never name a
 * column the definition did not offer; array params (`?page=1&page=2`) use their first value.
 * Defaults are dropped from generated links, and changing anything but the page resets it.
 *
 * Pure module with no imports, so Vitest can load it.
 */

export const PAGE_SIZES = [25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 25
/** Larger pages are clamped; PostgREST answers PGRST103 past the end and the list redirects. */
export const MAX_PAGE = 100_000
export const MAX_QUERY_LENGTH = 100

export type SortDirection = 'asc' | 'desc'

/** Params a list owns; filter params must not reuse them. */
export const RESERVED_PARAMS = ['page', 'size', 'sort', 'dir', 'q', 'notice'] as const

export type FilterSpec = {
  /** URL parameter, e.g. `brand`. */
  param: string
  /** Column it filters with `eq`, e.g. `brand_id`. */
  column: string
} & (
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'uuid' }
  | { kind: 'boolean' }
  | { kind: 'pattern'; pattern: RegExp }
)

export type ListSpec = {
  /** Sortable columns of the table itself (each should lead an index ending in the tiebreaker). */
  sorts: readonly string[]
  defaultSort: string
  defaultDir: SortDirection
  /** Unique column appended to every order so pages are stable (`code` or `id`). */
  tiebreak: string
  filters: readonly FilterSpec[]
  /** Whether the table has a `search_text` column to match normalized tokens against. */
  search: boolean
}

export type ListParams = {
  page: number
  size: PageSize
  sort: string
  dir: SortDirection
  q: string
  /** Validated filter values by param (absent when not filtered). */
  filters: Record<string, string>
}

export type RawSearchParams = Record<string, string | string[] | undefined>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** The first value of a search param (Next passes repeated params as arrays). */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null
  const number = Number(value)
  return number >= 1 ? number : null
}

/** The default direction for a sort column: the spec's own for its default sort, else ascending. */
export function defaultDirFor(spec: ListSpec, sort: string): SortDirection {
  return sort === spec.defaultSort ? spec.defaultDir : 'asc'
}

export function filterValue(spec: FilterSpec, raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  switch (spec.kind) {
    case 'enum':
      return spec.values.includes(value) ? value : null
    case 'uuid':
      return isUuid(value) ? value.toLowerCase() : null
    case 'boolean':
      return value === 'true' || value === 'false' ? value : null
    case 'pattern':
      return value.length <= 64 && spec.pattern.test(value) ? value : null
  }
}

/** Validates raw search params against the spec. Unknown or malformed values fall back to defaults. */
export function parseListParams(raw: RawSearchParams, spec: ListSpec): ListParams {
  const page = Math.min(parsePositiveInt(firstParam(raw.page)) ?? 1, MAX_PAGE)
  const sizeValue = parsePositiveInt(firstParam(raw.size))
  const size = PAGE_SIZES.find((candidate) => candidate === sizeValue) ?? DEFAULT_PAGE_SIZE
  const sortValue = firstParam(raw.sort)
  const sort = sortValue && spec.sorts.includes(sortValue) ? sortValue : spec.defaultSort
  const dirValue = firstParam(raw.dir)
  const dir: SortDirection =
    dirValue === 'asc' || dirValue === 'desc' ? dirValue : defaultDirFor(spec, sort)
  const q = spec.search ? (firstParam(raw.q) ?? '').trim().slice(0, MAX_QUERY_LENGTH) : ''
  const filters: Record<string, string> = {}
  for (const filter of spec.filters) {
    const value = filterValue(filter, firstParam(raw[filter.param]))
    if (value !== null) filters[filter.param] = value
  }
  return { page, size, sort, dir, q, filters }
}

/** Inclusive row range for PostgREST `.range(from, to)`. */
export function toRange(page: number, size: number): { from: number; to: number } {
  const from = (page - 1) * size
  return { from, to: from + size - 1 }
}

/**
 * From this row offset on, a list page is read after counting, from whichever end of the order is
 * nearer. Offset paging makes Postgres read (or sort) every skipped row, so the last page of 50,000
 * items costs ~150 ms forwards and ~1 ms backwards. Shallow pages keep the single counted query.
 */
export const DEEP_OFFSET = 1_000

/**
 * The rows to fetch for page range [from, to] of `total` rows: the same range, or, when the far end
 * is nearer, the mirrored range in the opposite order (the caller reverses the rows it gets back).
 * The opposite order flips every ORDER BY term, which with default NULL placement (ASC NULLS LAST,
 * DESC NULLS FIRST) is an exact mirror. Callers check `from < total` first.
 */
export function nearestRange(
  from: number,
  to: number,
  total: number,
): { from: number; to: number; reversed: boolean } {
  const last = Math.min(to, total - 1)
  const mirroredFrom = total - 1 - last
  return mirroredFrom < from
    ? { from: mirroredFrom, to: total - 1 - from, reversed: true }
    : { from, to, reversed: false }
}

/** The last page for a total (at least 1, so an empty list has one page). */
export function lastPage(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size))
}

export type ListPatch = Partial<Omit<ListParams, 'filters'>> & {
  filters?: Record<string, string | null>
}

/**
 * Link to the list with `patch` applied. Changing anything other than `page` returns to page 1.
 * Default values are left out so links stay short and canonical.
 */
export function listHref(
  pathname: string,
  spec: ListSpec,
  params: ListParams,
  patch: ListPatch = {},
): string {
  const changesOtherThanPage = Object.keys(patch).some((key) => key !== 'page')
  const next: ListParams = {
    ...params,
    ...patch,
    page: patch.page ?? (changesOtherThanPage ? 1 : params.page),
    filters: { ...params.filters },
  }
  for (const [param, value] of Object.entries(patch.filters ?? {})) {
    if (value === null || value === '') delete next.filters[param]
    else next.filters[param] = value
  }

  const search = new URLSearchParams()
  if (next.q) search.set('q', next.q)
  for (const filter of spec.filters) {
    const value = next.filters[filter.param]
    if (value) search.set(filter.param, value)
  }
  if (next.sort !== spec.defaultSort) search.set('sort', next.sort)
  if (next.dir !== defaultDirFor(spec, next.sort)) search.set('dir', next.dir)
  if (next.size !== DEFAULT_PAGE_SIZE) search.set('size', String(next.size))
  if (next.page > 1) search.set('page', String(next.page))
  const query = search.toString()
  return query ? `${pathname}?${query}` : pathname
}

/** Link that sorts by `column`: toggles the direction when it is already the sort column. */
export function sortHref(
  pathname: string,
  spec: ListSpec,
  params: ListParams,
  column: string,
): string {
  const dir: SortDirection =
    params.sort === column ? (params.dir === 'asc' ? 'desc' : 'asc') : defaultDirFor(spec, column)
  return listHref(pathname, spec, params, { sort: column, dir })
}

/** Whether search or any filter narrows the list (an empty result then means "no matches"). */
export function isFiltered(params: ListParams): boolean {
  return params.q !== '' || Object.keys(params.filters).length > 0
}

/** Stable string of the params, for Suspense keys. */
export function paramsKey(params: ListParams): string {
  const filters = Object.entries(params.filters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  return [params.page, params.size, params.sort, params.dir, params.q, filters].join('|')
}
