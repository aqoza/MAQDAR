import { expect, it } from 'vitest'
import { stockRegionInputSchema } from './stock-regions'
import { regionalStockInputSchema } from './regional-stock'

const region = { name_en: ' North ', name_ar: '', location_codes: [' B ', 'A'], confirmed: true }
it('canonicalizes fixed membership, names and optional Arabic', () => {
  expect(stockRegionInputSchema.parse(region)).toEqual({
    name_en: 'North',
    name_ar: null,
    location_codes: ['A', 'B'],
    confirmed: true,
  })
})
it.each([
  { name_en: '' },
  { name_en: 'n'.repeat(201) },
  { name_ar: 'n'.repeat(201) },
  { location_codes: ['A'] },
  { location_codes: ['A', ' A '] },
  { location_codes: Array.from({ length: 21 }, (_, i) => `L${i}`) },
  { location_codes: ['A', null] },
  { confirmed: false },
])('rejects invalid fixed region input %j', (change) => {
  expect(stockRegionInputSchema.safeParse({ ...region, ...change }).success).toBe(false)
})
it('requires exactly one location-selection mode, preserving manual inputs', () => {
  const base = {
    assessment_name: 'Assessment',
    item_code: 'ITEM',
    unit: 'EA',
    as_of: '2026-01-01',
    confirmed: true,
  }
  const region_id = '25000000-0000-4000-8000-000000000001'
  expect(regionalStockInputSchema.parse({ ...base, region_id })).toEqual({ ...base, region_id })
  expect(regionalStockInputSchema.safeParse({ ...base, location_codes: ['A', 'B'] }).success).toBe(
    true,
  )
  for (const selection of [
    {},
    { region_id: null },
    { region_id: 'invalid' },
    { region_id, location_codes: ['A', 'B'] },
  ]) {
    expect(regionalStockInputSchema.safeParse({ ...base, ...selection }).success).toBe(false)
  }
})
