import { expect, it } from 'vitest'
import { simulationEnd, simulationRequestSchema } from './policy-simulation'

it('limits the replay to completed post-cutoff dates inside the saved horizon', () => {
  expect(simulationEnd('2026-10-01', 28, '2026-10-10')).toEqual({
    first: '2026-10-02',
    last: '2026-10-09',
    available: true,
  })
  expect(simulationEnd('2026-10-01', 7, '2026-10-20').last).toBe('2026-10-08')
  expect(simulationEnd('2026-10-01', 28, '2026-10-02').available).toBe(false)
})
const valid = {
  policy_id: '12345678-1234-4234-8234-123456789000',
  request_id: '12345678-1234-4234-8234-123456789001',
  to_date: '2026-10-03',
  opening_stock: '999999999999999.999',
  alternative_maximum: '0',
  history_confirmed: 'on',
  empty_start_confirmed: 'on',
}
it('preserves large decimal text and requires both explicit confirmations', () => {
  expect(simulationRequestSchema.parse(valid).opening_stock).toBe(valid.opening_stock)
  for (const key of ['history_confirmed', 'empty_start_confirmed'])
    expect(simulationRequestSchema.safeParse({ ...valid, [key]: '' }).success).toBe(false)
})
it.each(['-1', '1e3', 'NaN', 'Infinity', '0.0001', '1000000000000000', ' 1'])(
  'rejects unsupported quantity %s',
  (value) => {
    expect(simulationRequestSchema.safeParse({ ...valid, opening_stock: value }).success).toBe(
      false,
    )
  },
)
