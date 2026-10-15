import { expect, it } from 'vitest'
import { preparationOptionsSchema } from './preparation'

it('normalizes codes and bounds preparation selection', () => {
  expect(preparationOptionsSchema.parse({ item_codes: ' OLD\r\nNEW ' })).toEqual({
    item_codes: ['OLD', 'NEW'],
  })
  for (const item_codes of [
    '',
    'OLD\nOLD',
    'A'.repeat(65),
    Array.from({ length: 26 }, (_, i) => `PART${i}`).join('\n'),
  ]) {
    expect(preparationOptionsSchema.safeParse({ item_codes }).success).toBe(false)
  }
})
