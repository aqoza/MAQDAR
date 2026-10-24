import { expect, it } from 'vitest'
import { dealerReturnInputSchema, returnQuantitySchema, dealerReturnParams } from './dealer-returns'
const input = {
  item_code: 'A/1',
  source_code: 'B',
  location_code: 'H',
  unit: 'EA',
  quantity: '1.125',
  requested_date: '2026-10-24',
  condition: 'unknown',
  reason: 'Return',
  sale_reference: '',
  confirmed: true,
}
it('preserves exact quantities and normalizes Arabic digits without binary rounding', () => {
  expect(returnQuantitySchema.parse('٩٩٩٩٩٩٩٩٩٩٩٩٩٩٩٫٩٩٩')).toBe('999999999999999.999')
  expect(returnQuantitySchema.parse('002.100')).toBe('2.1')
  for (const value of ['0', '-1', '0.0001', '1e3', 'NaN', '1000000000000000', '1,000'])
    expect(returnQuantitySchema.safeParse(value).success).toBe(false)
})
it('requires declared evidence, a valid date and distinct endpoints', () => {
  expect(dealerReturnInputSchema.parse(input)).toMatchObject({
    sale_reference: null,
    condition: 'unknown',
  })
  for (const change of [
    { confirmed: false },
    { location_code: 'B' },
    { reason: '' },
    { condition: 'good' },
    { unit: '' },
    { requested_date: '2026-02-30' },
    { requested_date: '0000-01-01' },
    { reason: 'line\nbreak' },
    { sale_reference: 'x'.repeat(201) },
    { extra: true },
  ])
    expect(dealerReturnInputSchema.safeParse({ ...input, ...change }).success).toBe(false)
})
it('bounds history filters and refuses arbitrary states and sorting', () => {
  expect(
    dealerReturnParams({
      page: '999999999',
      size: '100000',
      sort: 'report',
      dir: 'asc',
      status: 'approved',
    }),
  ).toMatchObject({ page: 100000, size: 25, sort: 'created_at', dir: 'desc', filters: {} })
  expect(dealerReturnParams({ status: 'withdrawn', q: ' x ' })).toMatchObject({
    filters: { status: 'withdrawn' },
    q: 'x',
  })
})
