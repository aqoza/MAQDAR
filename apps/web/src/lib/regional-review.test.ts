import { describe, expect, it } from 'vitest'
import { hasPositiveAllocation, regionalTimingBlocked, workbenchParams } from './regional-review'

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
describe('whole-region timing', () => {
  it('retains zero sources without requiring receipt dates', () => {
    expect(regionalTimingBlocked(clear)).toBe(false)
    expect(hasPositiveAllocation(clear)).toBe(true)
  })
  it.each([true, null, undefined])('blocks one positive source with flag %s', (flag) => {
    const report = structuredClone(clear)
    report.source.lines[0].receipts.p90 = {
      timing_review_required: flag as boolean,
      search: { date: '2026-10-13' },
    }
    expect(regionalTimingBlocked(report)).toBe(true)
  })
  it('blocks missing source, missing dates and zero-only proposals', () => {
    expect(regionalTimingBlocked({ ...clear, source: { lines: [] } })).toBe(true)
    const missing = structuredClone(clear)
    delete missing.source.lines[0].receipts.p50
    expect(regionalTimingBlocked(missing)).toBe(true)
    const noDate = structuredClone(clear)
    noDate.source.lines[0].receipts.p50!.search.date = ''
    expect(regionalTimingBlocked(noDate)).toBe(true)
    expect(regionalTimingBlocked({ ...clear, lines: [{ location_id: 'a', quantity: '0' }] })).toBe(
      true,
    )
  })
  it('restricts history filters to regional fields', () => {
    const parsed = workbenchParams({ sourcing: 'invalid', status: 'executed', destination: 'DEST' })
    expect(parsed.filters).toEqual({ destination: 'DEST' })
  })
})
