import { describe, expect, it } from 'vitest'
import { configurationsRequestSchema, configurationsSchema } from './policy-configurations'

const row = (maximum = '6', lead_time = 1, review_interval = 2) => ({
  maximum,
  lead_time,
  review_interval,
})
describe('policy configurations', () => {
  it('normalizes exact maxima and sorts by maximum, then lead and review', () => {
    expect(
      configurationsSchema.parse([
        row('999999999999999.999'),
        row('06.000', 365, 365),
        row('6', 0, 2),
        row('6', 0, 1),
        row('999999999999999.998'),
      ]),
    ).toEqual([
      row('6', 0, 1),
      row('6', 0, 2),
      row('6', 365, 365),
      row('999999999999999.998'),
      row('999999999999999.999'),
    ])
  })
  it.each([
    { value: [] },
    { value: Array(11).fill(row()) },
    { value: [row(), row('06.00')] },
    ...[-1, 366, 1.5, '1', true, null].map((lead_time) => ({ value: [{ ...row(), lead_time }] })),
    ...[0, 366, 1.5, '1', false, null].map((review_interval) => ({
      value: [{ ...row(), review_interval }],
    })),
    ...['-1', '1e3', '0.0001', '1000000000000000', 'NaN', ''].map((maximum) => ({
      value: [row(maximum)],
    })),
    { value: [{ ...row(), extra: 'ignored?' }] },
    { value: [{}] },
  ])('rejects invalid or duplicate tuples $value', ({ value }) => {
    expect(configurationsSchema.safeParse(value).success).toBe(false)
  })
  it('requires confirmation and a bounded JSON payload', () => {
    const input = {
      source_run_id: '11111111-1111-4111-8111-111111111111',
      request_id: '22222222-2222-4222-8222-222222222222',
      configurations: JSON.stringify([row('0', 0, 1)]),
      reuse_confirmed: 'on',
    }
    expect(configurationsRequestSchema.parse(input).configurations).toEqual([row('0', 0, 1)])
    expect(configurationsRequestSchema.safeParse({ ...input, reuse_confirmed: '' }).success).toBe(
      false,
    )
    expect(configurationsRequestSchema.safeParse({ ...input, configurations: '{' }).success).toBe(
      false,
    )
    expect(
      configurationsRequestSchema.safeParse({ ...input, configurations: ' '.repeat(2001) }).success,
    ).toBe(false)
  })
})
