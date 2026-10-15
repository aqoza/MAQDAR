import { expect, it } from 'vitest'
import { policyRequestSchema } from './inventory-policy'

const valid = {
  forecast_id: '70000000-0000-4000-8000-000000000001',
  request_id: '70000000-0000-4000-8000-000000000002',
  lead_time: '0',
  review_interval: '90',
  service_percent: '99.9',
}
it('accepts the zero-lead and full-horizon boundaries', () => {
  expect(policyRequestSchema.parse(valid)).toMatchObject({
    lead_time: 0,
    review_interval: 90,
    service_percent: 99.9,
  })
})
it.each([
  { lead_time: '-1' },
  { lead_time: '1' },
  { review_interval: '0' },
  { review_interval: '1.5' },
  { service_percent: 'NaN' },
  { service_percent: '49.9' },
  { service_percent: '100' },
  { forecast_id: 'arbitrary' },
  { request_id: '' },
])('rejects invalid policy request %s', (change) => {
  expect(policyRequestSchema.safeParse({ ...valid, ...change }).success).toBe(false)
})
