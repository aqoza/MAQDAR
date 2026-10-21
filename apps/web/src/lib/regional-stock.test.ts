import { describe, it, expect } from 'vitest'
import { regionalStockInputSchema } from './regional-stock'
const input = {
  assessment_name: ' Regional ',
  item_code: ' ITEM ',
  unit: 'EA',
  as_of: '2026-01-01',
  location_codes: [' B ', 'A'],
  confirmed: true,
}
describe('regional stock boundary', () => {
  it('canonicalizes names and location order without changing item case', () => {
    expect(regionalStockInputSchema.parse(input)).toEqual({
      ...input,
      assessment_name: 'Regional',
      item_code: 'ITEM',
      location_codes: ['A', 'B'],
    })
  })
  it.each([undefined, null, false, 'true', 1])(
    'requires distinct-holdings confirmation %s',
    (confirmed) => {
      expect(regionalStockInputSchema.safeParse({ ...input, confirmed }).success).toBe(false)
    },
  )
  it.each([
    [],
    ['A'],
    ['A', ' A '],
    ['A', 'bad/code'],
    ['A', null],
    Array.from({ length: 21 }, (_, i) => `L${i}`),
  ])('rejects invalid location sets %s', (...codes) => {
    expect(regionalStockInputSchema.safeParse({ ...input, location_codes: codes }).success).toBe(
      false,
    )
  })
  it.each(['0000-01-01', '2026-02-30', 'infinity', '2026-1-1'])(
    'rejects invalid dates %s',
    (as_of) => {
      expect(regionalStockInputSchema.safeParse({ ...input, as_of }).success).toBe(false)
    },
  )
  it('supports all twenty distinct codes and Arabic names', () => {
    expect(
      regionalStockInputSchema.parse({
        ...input,
        assessment_name: 'تقييم',
        location_codes: Array.from({ length: 20 }, (_, i) => `L${i}`),
      }).location_codes,
    ).toHaveLength(20)
  })
})
