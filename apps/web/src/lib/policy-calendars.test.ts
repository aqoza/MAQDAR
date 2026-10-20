import { expect, it } from 'vitest'
import {
  calendarEnqueueInput,
  calendarPreviewInput,
  calendarPreviewSchema,
} from './policy-calendars'

const source = '11111111-1111-4111-8111-111111111111'
const calendar = '22222222-2222-4222-8222-222222222222'
const valid = { source, calendar, request_id: source, fingerprint: 'a'.repeat(64), confirmed: 'on' }
it('requires explicit calendar selection, preview identity and applicability confirmation', () => {
  expect(calendarEnqueueInput.parse(valid)).toEqual(valid)
  expect(calendarPreviewInput.parse({ source, calendar })).toEqual({ source, calendar })
})
it.each(['source', 'calendar', 'request_id', 'fingerprint', 'confirmed'])(
  'rejects missing or invalid %s',
  (key) => {
    expect(calendarEnqueueInput.safeParse({ ...valid, [key]: undefined }).success).toBe(false)
    expect(calendarEnqueueInput.safeParse({ ...valid, [key]: 'invalid' }).success).toBe(false)
  },
)
it('preserves unknown working dates and allows calendars with no country when holidays are disabled', () => {
  const schema = calendarPreviewSchema.shape.calendars.shape.ordering
  expect(
    schema.parse({
      country: null,
      calendar_id: calendar,
      calendar_code: 'TEST',
      calendar_updated_at: '2026-01-01',
      active: true,
      weekend_days: [],
      observe_public_holidays: false,
      coverage_from: null,
      coverage_to: null,
      holidays: [],
      overrides: [],
    }).country,
  ).toBeNull()
  const days = calendarPreviewSchema.shape.calendars.shape.ordering_days
  expect(
    days.parse({
      '2026-01-01': {
        date: '2026-01-01',
        working: null,
        reason: 'unknown_coverage',
        weekend: false,
        holiday: null,
        verified: false,
        override_id: null,
      },
    })['2026-01-01'].working,
  ).toBeNull()
})
