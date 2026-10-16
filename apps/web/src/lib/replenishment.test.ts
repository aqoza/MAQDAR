import { expect, it } from 'vitest'
import { draftInputSchema, draftSaveSchema, draftListParams, draftParams } from './replenishment'
const id = '98000000-0000-4000-8000-000000000001'
const input = {
  policy: id,
  basis: 'calculated',
  backorders: '999999999999999.999',
  confirmed: 'true',
}
it('preserves exact quantities and normalizes Arabic digits', () => {
  expect(draftInputSchema.parse(input).backorders).toBe(input.backorders)
  expect(draftInputSchema.parse({ ...input, backorders: '١٢.٣٤٥' }).backorders).toBe('12.345')
})
it('requires explicit backorders, basis and boolean confirmation', () => {
  for (const value of ['', '-1', '1e3', '0.0001', '1000000000000000', 'NaN', 'Infinity']) {
    expect(draftInputSchema.safeParse({ ...input, backorders: value }).success, value).toBe(false)
  }
  expect(draftInputSchema.safeParse({ ...input, confirmed: 'yes' }).success).toBe(false)
  expect(draftInputSchema.safeParse({ ...input, basis: 'approved' }).success).toBe(false)
  expect(draftInputSchema.safeParse({ ...input, override: id }).success).toBe(false)
  expect(draftInputSchema.safeParse({ ...input, basis: 'approved', override: id }).success).toBe(
    true,
  )
})
it('defaults an unchecked confirmation to false and requires save identity', () => {
  expect(draftParams({ policy: id, basis: 'calculated', backorders: '0' }).confirmed).toBe('false')
  expect(draftSaveSchema.safeParse(input).success).toBe(false)
  expect(
    draftSaveSchema.safeParse({ ...input, request_id: id, fingerprint: 'a'.repeat(64) }).success,
  ).toBe(true)
})
it('allow-lists draft filters and pagination', () => {
  const p = draftListParams({ page: '-1', status: 'invented', location: '%', sort: 'report' })
  expect(p.page).toBe(1)
  expect(p.sort).toBe('created_at')
  expect(p.filters.status).toBeUndefined()
  expect(p.filters.location).toBeUndefined()
})
