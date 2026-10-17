import { expect, it } from 'vitest'
import {
  proposalSchema,
  decisionSchema,
  workbenchParams,
  transferTimingBlocked,
} from './transfer-review'
const id = '98000000-0000-4000-8000-000000000001'
it('accepts only a source identity and a bounded trimmed reason', () => {
  expect(
    proposalSchema.parse({
      estimate_id: id,
      request_id: id,
      reason: '  evidence  ',
      quantity: '999',
    }),
  ).toEqual({ estimate_id: id, request_id: id, reason: 'evidence' })
  for (const reason of ['', ' \n ', 'a'.repeat(2001)])
    expect(proposalSchema.safeParse({ estimate_id: id, request_id: id, reason }).success).toBe(
      false,
    )
})
it('allows only terminal decisions with identities and reasons', () => {
  for (const decision of ['approved', 'rejected', 'withdrawn'])
    expect(
      decisionSchema.safeParse({ proposal_id: id, request_id: id, decision, reason: 'Reviewed' })
        .success,
    ).toBe(true)
  expect(
    decisionSchema.safeParse({
      proposal_id: id,
      request_id: id,
      decision: 'pending',
      reason: 'Reviewed',
    }).success,
  ).toBe(false)
})
it('allows exact code, draft and status filters and bounds pagination', () => {
  const valid = workbenchParams({
    q: ' ITEM ',
    source: 'SOURCE',
    location: 'LOC',
    draft: id,
    status: 'approved',
    page: '2',
    size: '50',
  })
  expect(valid.filters).toEqual({
    source: 'SOURCE',
    location: 'LOC',
    draft: id,
    status: 'approved',
  })
  expect(valid.page).toBe(2)
  const invalid = workbenchParams({
    source: '%',
    location: 'x,y',
    draft: 'invalid',
    status: 'executed',
    page: '-1',
    size: '999',
  })
  expect(invalid.filters).toEqual({})
  expect(invalid.page).toBe(1)
})

it('requires both timing gates explicitly false', () => {
  expect(
    transferTimingBlocked({
      source: {
        receipts: {
          p50: { timing_review_required: false },
          p90: { timing_review_required: false },
        },
      },
    }),
  ).toBe(false)
  for (const value of [true, null, undefined]) {
    for (const key of ['p50', 'p90'] as const) {
      expect(
        transferTimingBlocked({
          source: {
            receipts: {
              p50: { timing_review_required: false },
              p90: { timing_review_required: false },
              [key]: { timing_review_required: value },
            },
          },
        }),
      ).toBe(true)
    }
  }
  expect(transferTimingBlocked({ source: { receipts: {} } })).toBe(true)
})
