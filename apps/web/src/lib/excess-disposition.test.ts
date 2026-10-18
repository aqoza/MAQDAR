import { describe, expect, it } from 'vitest'
import { dispositionInputSchema, dispositionListParams, positiveExcess } from './excess-disposition'
const valid = {
  assessment_id: 'b2000000-0000-4000-8000-000000000001',
  item_id: 'b2000000-0000-4000-8000-000000000002',
  request_id: 'b2000000-0000-4000-8000-000000000003',
  kind: 'scrap',
  quantity: '3.333',
  reason: ' Review ',
}
describe('disposition input boundaries', () => {
  it('keeps exact quantities and supports Arabic digits without binary conversion', () => {
    expect(
      dispositionInputSchema.parse({ ...valid, quantity: '999999999999999.999' }).quantity,
    ).toBe('999999999999999.999')
    expect(dispositionInputSchema.parse({ ...valid, quantity: '٣٫٣٣٣' }).quantity).toBe('3.333')
    expect(dispositionInputSchema.parse(valid).reason).toBe('Review')
  })
  it.each(['0', '0.000', '-1', '1.0001', '1e2', 'Infinity', 'NaN', '', '1000000000000000'])(
    'rejects invalid or silently rounded quantity %s',
    (quantity) => {
      expect(dispositionInputSchema.safeParse({ ...valid, quantity }).success).toBe(false)
    },
  )
  it('requires an explicit supported intent, reason and source identity', () => {
    for (const patch of [
      { kind: '' },
      { kind: 'transfer' },
      { reason: ' ' },
      { reason: 'a'.repeat(2001) },
      { item_id: 'invalid' },
      { request_id: undefined },
    ])
      expect(dispositionInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })
  it('does not offer disposition for absent or zero comparisons', () => {
    for (const value of [null, '0', '0.000', '-1', 'NaN']) expect(positiveExcess(value)).toBe(false)
    expect(positiveExcess('0.001')).toBe(true)
  })
  it('bounds list state and rejects unknown filters', () => {
    expect(
      dispositionListParams({
        status: 'executed',
        kind: 'transfer',
        size: '9000',
        location: 'x,org',
        assessment: 'bad',
        item: valid.item_id,
      }),
    ).toMatchObject({ size: 25, filters: { item: valid.item_id } })
  })
})
