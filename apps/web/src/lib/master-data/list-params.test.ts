import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  RESERVED_PARAMS,
  isFiltered,
  isUuid,
  lastPage,
  nearestRange,
  listHref,
  paramsKey,
  parseListParams,
  sortHref,
  toRange,
  type ListSpec,
} from './list-params'

const BRAND_ID = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'

const spec: ListSpec = {
  sorts: ['code', 'name_en', 'status'],
  defaultSort: 'code',
  defaultDir: 'asc',
  tiebreak: 'code',
  filters: [
    { param: 'status', column: 'status', kind: 'enum', values: ['active', 'new'] },
    { param: 'brand', column: 'brand_id', kind: 'uuid' },
    { param: 'active', column: 'is_active', kind: 'boolean' },
    { param: 'currency', column: 'currency', kind: 'pattern', pattern: /^[A-Z]{3}$/ },
  ],
  search: true,
}

describe('parseListParams', () => {
  it('returns defaults for an empty query', () => {
    expect(parseListParams({}, spec)).toEqual({
      page: 1,
      size: DEFAULT_PAGE_SIZE,
      sort: 'code',
      dir: 'asc',
      q: '',
      filters: {},
    })
  })

  it('accepts allow-listed values', () => {
    const params = parseListParams(
      {
        page: '3',
        size: '100',
        sort: 'name_en',
        dir: 'desc',
        q: '  oil filter ',
        status: 'active',
        brand: BRAND_ID.toUpperCase(),
        active: 'false',
        currency: 'KWD',
      },
      spec,
    )
    expect(params).toEqual({
      page: 3,
      size: 100,
      sort: 'name_en',
      dir: 'desc',
      q: 'oil filter',
      filters: { status: 'active', brand: BRAND_ID, active: 'false', currency: 'KWD' },
    })
  })

  it('takes the first value of repeated params', () => {
    const params = parseListParams({ page: ['2', '9'], sort: ['status', 'code'] }, spec)
    expect(params.page).toBe(2)
    expect(params.sort).toBe('status')
  })

  it('falls back on anything not allow-listed', () => {
    const params = parseListParams(
      {
        page: '-1',
        size: '30',
        sort: 'organization_id',
        dir: 'sideways',
        status: 'deleted',
        brand: 'not-a-uuid',
        active: 'yes',
        currency: 'kwd',
        other: 'x',
      },
      spec,
    )
    expect(params).toEqual({
      page: 1,
      size: 25,
      sort: 'code',
      dir: 'asc',
      q: '',
      filters: {},
    })
  })

  it('caps the page and rejects non-numeric pages', () => {
    expect(parseListParams({ page: '999999999' }, spec).page).toBe(MAX_PAGE)
    expect(parseListParams({ page: '2.5' }, spec).page).toBe(1)
    expect(parseListParams({ page: '1e3' }, spec).page).toBe(1)
    expect(parseListParams({ page: '0' }, spec).page).toBe(1)
  })

  it('ignores search when the entity has none and caps its length', () => {
    expect(parseListParams({ q: 'x' }, { ...spec, search: false }).q).toBe('')
    expect(parseListParams({ q: 'a'.repeat(500) }, spec).q).toHaveLength(100)
  })

  it('uses the spec direction only for the default sort', () => {
    const descSpec: ListSpec = { ...spec, defaultSort: 'status', defaultDir: 'desc' }
    expect(parseListParams({}, descSpec).dir).toBe('desc')
    expect(parseListParams({ sort: 'code' }, descSpec).dir).toBe('asc')
  })
})

describe('ranges and pages', () => {
  it('computes inclusive ranges', () => {
    expect(toRange(1, 25)).toEqual({ from: 0, to: 24 })
    expect(toRange(3, 50)).toEqual({ from: 100, to: 149 })
  })

  it('has at least one page', () => {
    expect(lastPage(0, 25)).toBe(1)
    expect(lastPage(25, 25)).toBe(1)
    expect(lastPage(26, 25)).toBe(2)
    expect(lastPage(50_000, 100)).toBe(500)
  })

  it('reads deep pages from the nearer end', () => {
    // Last page of 50,000 rows at 25 per page: rows 49,975..49,999 are the first 25 backwards.
    expect(nearestRange(49_975, 49_999, 50_000)).toEqual({ from: 0, to: 24, reversed: true })
    // A short last page: rows 100..124 of 110 exist as 100..109, i.e. the first 10 backwards.
    expect(nearestRange(100, 124, 110)).toEqual({ from: 0, to: 9, reversed: true })
    // Second-to-last page.
    expect(nearestRange(49_950, 49_974, 50_000)).toEqual({ from: 25, to: 49, reversed: true })
    // Front half and the exact middle stay forwards.
    expect(nearestRange(1_000, 1_024, 50_000)).toEqual({ from: 1_000, to: 1_024, reversed: false })
    expect(nearestRange(24_975, 24_999, 50_000)).toEqual({
      from: 24_975,
      to: 24_999,
      reversed: false,
    })
    // Mirrored ranges cover exactly the same rows.
    for (const [from, to, total] of [
      [49_975, 49_999, 50_000],
      [100, 124, 110],
      [30_000, 30_099, 45_123],
    ] as const) {
      const range = nearestRange(from, to, total)
      const rows = Array.from({ length: range.to - range.from + 1 }, (_, i) =>
        range.reversed ? total - 1 - (range.from + i) : range.from + i,
      )
      if (range.reversed) rows.reverse()
      expect(rows[0]).toBe(from)
      expect(rows.at(-1)).toBe(Math.min(to, total - 1))
    }
  })
})

describe('listHref', () => {
  const base = parseListParams({}, spec)

  it('drops defaults', () => {
    expect(listHref('/items', spec, base)).toBe('/items')
    expect(listHref('/items', spec, base, { page: 1, size: 25 })).toBe('/items')
  })

  it('keeps the page for page changes and resets it otherwise', () => {
    const onPage4 = { ...base, page: 4, q: 'oil' }
    expect(listHref('/items', spec, onPage4, { page: 5 })).toBe('/items?q=oil&page=5')
    expect(listHref('/items', spec, onPage4, { size: 50 })).toBe('/items?q=oil&size=50')
    expect(listHref('/items', spec, onPage4, { filters: { status: 'new' } })).toBe(
      '/items?q=oil&status=new',
    )
    expect(listHref('/items', spec, onPage4)).toBe('/items?q=oil&page=4')
  })

  it('removes cleared filters and encodes values', () => {
    const params = { ...base, q: 'قطع & co', filters: { status: 'active', brand: BRAND_ID } }
    const href = listHref('/items', spec, params, { filters: { status: null } })
    expect(href).toBe(`/items?q=%D9%82%D8%B7%D8%B9+%26+co&brand=${BRAND_ID}`)
  })

  it('writes sort and direction only when they differ from the defaults', () => {
    expect(listHref('/items', spec, base, { sort: 'name_en', dir: 'asc' })).toBe(
      '/items?sort=name_en',
    )
    expect(listHref('/items', spec, base, { sort: 'code', dir: 'desc' })).toBe('/items?dir=desc')
  })
})

describe('sortHref', () => {
  const base = parseListParams({}, spec)

  it('toggles the current column and starts others ascending', () => {
    expect(sortHref('/items', spec, base, 'code')).toBe('/items?dir=desc')
    expect(sortHref('/items', spec, { ...base, dir: 'desc' }, 'code')).toBe('/items')
    expect(sortHref('/items', spec, { ...base, page: 3 }, 'name_en')).toBe('/items?sort=name_en')
  })
})

describe('helpers', () => {
  it('detects filtering', () => {
    expect(isFiltered(parseListParams({}, spec))).toBe(false)
    expect(isFiltered(parseListParams({ q: 'x' }, spec))).toBe(true)
    expect(isFiltered(parseListParams({ status: 'new' }, spec))).toBe(true)
  })

  it('builds stable keys', () => {
    const a = parseListParams({ status: 'new', brand: BRAND_ID }, spec)
    const b = parseListParams({ brand: BRAND_ID, status: 'new' }, spec)
    expect(paramsKey(a)).toBe(paramsKey(b))
    expect(paramsKey(a)).not.toBe(paramsKey(parseListParams({ status: 'new' }, spec)))
  })

  it('validates uuids', () => {
    expect(isUuid(BRAND_ID)).toBe(true)
    expect(isUuid('x')).toBe(false)
    expect(isUuid(undefined)).toBe(false)
  })

  it('reserves the list params', () => {
    expect(RESERVED_PARAMS).toEqual(['page', 'size', 'sort', 'dir', 'q', 'notice'])
  })
})
