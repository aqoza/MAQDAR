import { describe, expect, it } from 'vitest'
import { availability, dashboardParams, formatInventoryValue, reportingDay } from './dashboard'

describe('dashboard presentation', () => {
  it('does not turn missing observations into zero availability', () => {
    expect(availability(0, 0)).toBeNull()
    expect(availability(0, 3)).toBe(0)
    expect(availability(2, 4)).toBe(0.5)
  })
  it('validates dates and location codes without rolling invalid dates forward', () => {
    expect(
      dashboardParams({ day: ['2026-10-01', '2026-10-02'], location: ' DXB-1 ' }, '2026-10-16'),
    ).toEqual({ day: '2026-10-01', location: 'DXB-1' })
    for (const day of ['0000-01-01', '2026-02-30', '2026-10-17', 'infinity', 'x']) {
      expect(dashboardParams({ day, location: '(bad)' }, '2026-10-16')).toEqual({
        day: '2026-10-16',
        location: null,
      })
    }
  })
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
