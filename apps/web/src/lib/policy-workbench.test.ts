import { expect, it } from 'vitest'
import { decisionSchema, proposalSchema, workbenchParams } from './policy-workbench'

const ids = {
  policy_id: '93000000-0000-4000-8000-000000000001',
  request_id: '93000000-0000-4000-8000-000000000002',
}
const proposal = {
  ...ids,
  reorder_point: '999999999999999.998',
  order_up_to: '999999999999999.999',
  reason: ' More cover ',
}
it('preserves exact quantities beyond JavaScript number precision', () => {
  expect(proposalSchema.parse(proposal)).toEqual({ ...proposal, reason: 'More cover' })
  expect(
    proposalSchema.safeParse({
      ...proposal,
      reorder_point: '999999999999999.999',
      order_up_to: '999999999999999.998',
    }).success,
  ).toBe(false)
})
it.each(['-1', 'NaN', '1e3', '1.0001', '1000000000000000', ''])(
  'rejects invalid quantity %s',
  (value) => {
    expect(proposalSchema.safeParse({ ...proposal, reorder_point: value }).success).toBe(false)
  },
)
it('normalizes Arabic digits and requires a bounded reason', () => {
  expect(proposalSchema.parse({ ...proposal, reorder_point: '١٫٥' }).reorder_point).toBe('1.5')
  expect(proposalSchema.safeParse({ ...proposal, reason: '  ' }).success).toBe(false)
  expect(proposalSchema.safeParse({ ...proposal, reason: 'x'.repeat(2001) }).success).toBe(false)
})
it('only accepts explicit terminal decisions and UUIDs', () => {
  expect(
    decisionSchema.safeParse({
      override_id: ids.policy_id,
      request_id: ids.request_id,
      decision: 'approved',
      reason: 'Reviewed',
    }).success,
  ).toBe(true)
  expect(
    decisionSchema.safeParse({
      override_id: ids.policy_id,
      request_id: ids.request_id,
      decision: 'pending',
      reason: 'Reviewed',
    }).success,
  ).toBe(false)
})
it('allow-lists pagination and filters', () => {
  const params = workbenchParams({
    page: '-1',
    size: '999',
    sort: 'evidence',
    review: 'forged',
    status: 'available',
    location: 'L1',
    q: 'ITEM',
  })
  expect(params).toMatchObject({
    page: 1,
    size: 25,
    sort: 'finished_at',
    q: 'ITEM',
    filters: { status: 'available', location: 'L1' },
  })
})
