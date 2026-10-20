import { describe, expect, it } from 'vitest'
import { hasPositiveAllocation, networkTimingBlocked, workbenchParams } from './network-review'

const clear = {
  status: 'available',
  lines: [
    { location_id: 'a', quantity: '0.001' },
    { location_id: 'b', quantity: '0.000' },
  ],
  source: {
    lines: [
      {
        location_id: 'a',
        status: 'available',
        receipts: {
          p50: { timing_review_required: false, search: { date: '2026-10-12' } },
          p90: { timing_review_required: false, search: { date: '2026-10-13' } },
        },
      },
      { location_id: 'b', status: 'no_transfer_needed', receipts: {} },
    ],
  },
}
describe('whole-network timing', () => {
  it('retains zero branches without requiring receipt dates', () => {
    expect(networkTimingBlocked(clear)).toBe(false)
    expect(hasPositiveAllocation(clear)).toBe(true)
  })
  it.each([true, null, undefined])('blocks one positive branch with flag %s', (flag) => {
    const report = structuredClone(clear)
    report.source.lines[0].receipts.p90 = {
      timing_review_required: flag as boolean,
      search: { date: '2026-10-13' },
    }
    expect(networkTimingBlocked(report)).toBe(true)
  })
  it('blocks missing branch, missing dates and zero-only proposals', () => {
    expect(networkTimingBlocked({ ...clear, source: { lines: [] } })).toBe(true)
    const missing = structuredClone(clear)
    delete missing.source.lines[0].receipts.p50
    expect(networkTimingBlocked(missing)).toBe(true)
    const noDate = structuredClone(clear)
    noDate.source.lines[0].receipts.p50!.search.date = ''
    expect(networkTimingBlocked(noDate)).toBe(true)
    expect(networkTimingBlocked({ ...clear, lines: [{ location_id: 'a', quantity: '0' }] })).toBe(
      true,
    )
  })
  it('restricts history filters to network fields', () => {
    const parsed = workbenchParams({ allocation: 'invalid', status: 'executed', source: 'WH-01' })
    expect(parsed.filters).toEqual({ source: 'WH-01' })
  })
})
