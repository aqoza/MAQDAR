import { describe, expect, it } from 'vitest'
import { isActiveRun, planningRequestSchema, readinessSchema } from './planning'

const request = {
  location_code: 'L1',
  from_date: '2026-01-01',
  to_date: '2026-10-15',
  request_id: '70000000-0000-4000-8000-000000000001',
}
describe('planning input', () => {
  it('accepts a bounded valid window', () =>
    expect(planningRequestSchema.safeParse(request).success).toBe(true))
  it.each([
    { from_date: '2026-02-30' },
    { to_date: '2025-01-01' },
    { from_date: '2020-01-01' },
    { location_code: '../other' },
    { request_id: 'bad' },
  ])('rejects invalid input %j', (value) =>
    expect(planningRequestSchema.safeParse({ ...request, ...value }).success).toBe(false),
  )
  it('only queues and processing states are active', () => {
    expect(['queued', 'running', 'succeeded', 'failed', 'canceled'].map(isActiveRun)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ])
  })
  it('rejects unversioned readiness instead of rendering unknown results', () => {
    expect(readinessSchema.safeParse({ quantity: 1 }).success).toBe(false)
  })
})
