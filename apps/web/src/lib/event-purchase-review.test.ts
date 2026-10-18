import { describe, expect, it } from 'vitest'
import {
  eventApprovalTimingClear,
  eventReviewCostSchema,
  workbenchParams,
  proposalSchema,
  decisionSchema,
} from './event-purchase-review'
describe('event approval evidence', () => {
  it('requires an explicit false policy flag and a known empty event list', () => {
    expect(
      eventApprovalTimingClear({ policy_recalculation_required: false, event_before_receipt: [] }),
    ).toBe(true)
    for (const policy_recalculation_required of [true, null, undefined])
      expect(
        eventApprovalTimingClear({ policy_recalculation_required, event_before_receipt: [] }),
      ).toBe(false)
    for (const event_before_receipt of [
      null,
      undefined,
      {},
      '',
      [{ date: '2026-10-11', quantity: '1' }],
    ])
      expect(
        eventApprovalTimingClear({ policy_recalculation_required: false, event_before_receipt }),
      ).toBe(false)
  })
  it('keeps missing legacy timing inspectable without allowing approval', () => {
    const timing = eventReviewCostSchema.shape.source
      .pick({ policy_recalculation_required: true, event_before_receipt: true })
      .parse({})
    expect(timing).toEqual({ policy_recalculation_required: null, event_before_receipt: null })
    expect(eventApprovalTimingClear(timing)).toBe(false)
  })
  it('keeps exact draft/location filters and rejects unsupported statuses', () => {
    const params = workbenchParams({ q: 'Campaign ITEM', location: 'BRANCH', status: 'executed' })
    expect(params.q).toBe('Campaign ITEM')
    expect(params.filters.location).toBe('BRANCH')
    expect(params.filters.status).toBeUndefined()
  })
  it('accepts legacy source GUIDs but requires strict retry UUIDs and reasons', () => {
    const id = '00000000-0000-0000-0000-000000000001',
      request = '99300000-0000-4000-8000-000000000001'
    expect(
      proposalSchema.safeParse({ estimate_id: id, request_id: request, reason: 'Reviewed' })
        .success,
    ).toBe(true)
    expect(
      proposalSchema.safeParse({ estimate_id: id, request_id: id, reason: 'Reviewed' }).success,
    ).toBe(false)
    expect(
      decisionSchema.safeParse({
        proposal_id: id,
        request_id: request,
        reason: ' ',
        decision: 'approved',
      }).success,
    ).toBe(false)
  })
})
