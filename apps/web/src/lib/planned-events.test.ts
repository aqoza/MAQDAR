import { describe, expect, it } from 'vitest'
import { eventInputSchema, eventQuantitySchema, eventFormValues } from './planned-events'

const input = {
  forecast_id: '99000000-0000-4000-8000-000000000050',
  event_type: 'campaign',
  name: ' Launch ',
  reason: ' Incremental ',
  unit: 'EA',
  confirmed: true,
  additions: [{ date: '2026-10-11', quantity: '0.009' }],
}
describe('event inputs', () => {
  it.each([
    ['999999999999999.999', '999999999999999.999'],
    ['١٬٢٣٤٫٥٠٠', '1234.5'],
    ['000.000', '0'],
  ])('preserves exact quantity %s', (value, expected) =>
    expect(eventQuantitySchema.parse(value)).toBe(expected),
  )
  it.each(['', '-1', 'NaN', '1e2', '1.0001', '1,23', '1000000000000000'])('rejects %s', (value) =>
    expect(eventQuantitySchema.safeParse(value).success).toBe(false),
  )
  it('trims reasons and canonicalizes date order', () => {
    expect(
      eventInputSchema.parse({
        ...input,
        additions: [{ date: '2026-10-12', quantity: '0' }, ...input.additions],
      }),
    ).toMatchObject({
      name: 'Launch',
      reason: 'Incremental',
      additions: [...input.additions, { date: '2026-10-12', quantity: '0' }],
    })
  })
  it.each([
    { reason: ' ' },
    { name: '' },
    { unit: 'BOX' },
    { additions: [] },
    { additions: [input.additions[0], input.additions[0]] },
    { additions: [{ date: '2026-02-30', quantity: '1' }] },
  ])('rejects incompatible metadata %j', (change) =>
    expect(eventInputSchema.safeParse({ ...input, ...change }).success).toBe(false),
  )
  it('bounds one horizon to 90 dates', () =>
    expect(
      eventInputSchema.safeParse({ ...input, additions: Array(91).fill(input.additions[0]) })
        .success,
    ).toBe(false))
  it('rejects malformed form JSON and keeps confirmation explicit', () => {
    const form = new FormData()
    form.set('additions', '[invalid')
    expect(eventFormValues(form)).toMatchObject({ additions: null, confirmed: false })
  })
})
