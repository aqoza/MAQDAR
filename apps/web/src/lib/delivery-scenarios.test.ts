import { expect, it } from 'vitest'
import {
  deliveryScenarioInputSchema,
  deliveryScenarioParams,
  deliveryScenarioSaveSchema,
} from './delivery-scenarios'
const id = '99000000-0000-4000-8000-000000000001'
const input = { scenario: id, requested: '2026-10-10', confirmed: 'true' }
it('requires a real bounded date and explicit source identity', () => {
  expect(deliveryScenarioInputSchema.parse(input)).toEqual(input)
  for (const requested of [
    '2026-02-30',
    'infinity',
    '2101-01-01',
    '1899-12-31',
    '2026-10-10T12:00:00Z',
    '',
  ])
    expect(deliveryScenarioInputSchema.safeParse({ ...input, requested }).success).toBe(false)
  expect(deliveryScenarioInputSchema.safeParse({ ...input, scenario: 'bad' }).success).toBe(false)
})
it('keeps confirmation explicit and validates save identity', () => {
  expect(deliveryScenarioParams({ scenario: id, requested: ['2026-10-10', '2026-10-11'] })).toEqual(
    { ...input, confirmed: 'false' },
  )
  expect(deliveryScenarioInputSchema.safeParse({ ...input, confirmed: 'yes' }).success).toBe(false)
  expect(deliveryScenarioSaveSchema.safeParse(input).success).toBe(false)
  expect(
    deliveryScenarioSaveSchema.safeParse({ ...input, request_id: id, fingerprint: 'a'.repeat(64) })
      .success,
  ).toBe(true)
})
