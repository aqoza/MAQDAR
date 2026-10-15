import { expect, it } from 'vitest'
import { forecastOptionsSchema } from './forecasting'

it('normalizes one code per line and accepts the horizon bounds', () => {
  expect(forecastOptionsSchema.parse({ item_codes: ' A/1 \r\n\nB-2', horizon: '28' })).toEqual({
    item_codes: ['A/1', 'B-2'],
    horizon: 28,
  })
  for (const horizon of ['1', '90'])
    expect(forecastOptionsSchema.safeParse({ item_codes: 'P1', horizon }).success).toBe(true)
})
it('rejects duplicate or oversized selections and invalid horizons', () => {
  for (const item_codes of [
    '',
    'P1\nP1',
    'A'.repeat(65),
    Array.from({ length: 101 }, (_, i) => `P${i}`).join('\n'),
  ]) {
    expect(forecastOptionsSchema.safeParse({ item_codes, horizon: '28' }).success).toBe(false)
  }
  for (const horizon of ['0', '91', '1.5', 'NaN', ''])
    expect(forecastOptionsSchema.safeParse({ item_codes: 'P1', horizon }).success).toBe(false)
})
