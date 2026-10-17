import { describe, expect, it } from 'vitest'
import { stockLocatorHref, stockLocatorInputSchema, stockLocatorParams } from './stock-locator'

describe('stock locator URL inputs', () => {
  it('requires explicit known units and exact codes without inferring from the catalog', () => {
    const base = { item: ' P/1 ', receiving: ' DC ', day: '2026-10-17' }
    expect(stockLocatorInputSchema.safeParse(base).success).toBe(false)
    expect(stockLocatorInputSchema.parse({ ...base, unit: 'EA' })).toEqual({
      item: 'P/1',
      receiving: 'DC',
      day: base.day,
      unit: 'EA',
      scope: 'exact',
    })
    for (const changes of [
      { unit: 'ea' },
      { scope: 'supersessions' },
      { unit: 'BOX' },
      { item: '%P%' },
      { receiving: 'DC/1' },
      { day: '2026-02-30' },
      { day: '0000-01-01' },
    ]) {
      expect(stockLocatorInputSchema.safeParse({ ...base, unit: 'EA', ...changes }).success).toBe(
        false,
      )
    }
  })
  it('bounds paging and search without accepting supplied query column names', () => {
    const parsed = stockLocatorParams(
      { page: '999999999', size: '1000', sort: 'secret', view: 'bad', q: ' A\u0000B ' },
      '2026-10-17',
    )
    expect(parsed).toMatchObject({
      page: 100000,
      size: 25,
      view: 'matching',
      q: 'A B',
      day: '2026-10-17',
      unit: '',
    })
    expect(stockLocatorParams({ item: 'X'.repeat(66) }, '2026-10-17').item).toHaveLength(65)
    expect(
      stockLocatorInputSchema.safeParse({
        ...parsed,
        item: 'X'.repeat(65),
        receiving: 'DC',
        unit: 'EA',
      }).success,
    ).toBe(false)
  })
  it.each(['exact', 'interchangeable', 'substitutes'] as const)(
    'preserves %s selection and filters while paging, including slash-containing items',
    (scope) => {
      const parsed = stockLocatorParams(
        {
          item: ['P/1', 'ignored'],
          receiving: 'DC',
          unit: 'KG',
          day: '2026-09-01',
          view: 'other',
          q: 'North',
          size: '50',
          scope,
        },
        '2026-10-17',
      )
      const url = new URL(stockLocatorHref(parsed, 3), 'https://example.com')
      expect(stockLocatorInputSchema.parse(parsed).scope).toBe(scope)
      expect(url.pathname).toBe('/replenishment/stock-locator')
      expect(stockLocatorParams(Object.fromEntries(url.searchParams), '2026-10-17')).toEqual({
        ...parsed,
        page: 3,
      })
      expect(new URL(stockLocatorHref(parsed, 1), url.origin).searchParams.has('page')).toBe(false)
    },
  )
})
