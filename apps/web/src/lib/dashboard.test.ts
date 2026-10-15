import { describe, expect, it } from 'vitest'
import { formatInventoryValue, reportingDay } from './dashboard'

describe('dashboard presentation', () => {
  it('keeps fractional inventory value beyond JavaScript number precision', () => {
    expect(formatInventoryValue('123456789012345678.123', 'KWD', 'en-US')).toContain(
      '123,456,789,012,345,678.123',
    )
  })
  it('uses the configured business day at the UTC date boundary', () => {
    expect(reportingDay(new Date('2026-10-15T21:00:00Z'), 'Asia/Dubai')).toBe('2026-10-16')
    expect(reportingDay(new Date('2026-10-15T21:00:00Z'), 'America/New_York')).toBe('2026-10-15')
  })
})
