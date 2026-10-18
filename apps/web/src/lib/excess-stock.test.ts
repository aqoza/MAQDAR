import { describe, expect, it } from 'vitest'
import {
  excessChoices,
  excessCutoff,
  excessHref,
  excessListParams,
  excessSaveSchema,
  excessTokens,
} from './excess-stock'
import { formatCostDecimal } from './purchase-costs'

const id = 'a2000000-0000-4000-8000-000000001001'
const override = 'a2000000-0000-4000-8000-000000000061'
describe('explicit assessment selection', () => {
  it('round-trips calculated and particular approved choices without choosing a default', () => {
    const tokens = [`${id}:calculated`, `${override}:${id}`]
    const url = new URL(excessHref(tokens), 'https://local.invalid')
    expect(excessTokens({ choice: url.searchParams.getAll('choice') })).toEqual(tokens)
    expect(excessChoices(tokens).data).toEqual([
      { policy_id: id, maximum: 'calculated' },
      { policy_id: override, maximum: id },
    ])
    expect(excessTokens({})).toEqual([])
    expect(excessTokens({ choice: tokens[0], [`pick.${override}`]: tokens[1] })).toEqual(tokens)
  })
  it.each(
    [
      [],
      [id],
      [`${id}:latest`],
      [`${id}:calculated:extra`],
      [`${id}:calculated`, `${id}:${override}`],
      Array(51).fill(`${id}:calculated`),
    ].map((tokens) => ({ tokens })),
  )('rejects missing, implicit, duplicate or oversized selections $tokens', ({ tokens }) => {
    expect(excessChoices(tokens).success).toBe(false)
  })
  const valid = {
    selections: JSON.stringify([{ policy_id: id, maximum: 'calculated' }]),
    reason: ' Review ',
    confirmed: 'true',
    request_id: override,
    fingerprint: 'a'.repeat(64),
  }
  it('normalizes reasons and requires explicit as-of confirmation', () => {
    expect(excessSaveSchema.parse(valid).reason).toBe('Review')
    for (const patch of [
      { reason: ' ' },
      { reason: 'a'.repeat(2001) },
      { confirmed: 'false' },
      { confirmed: undefined },
      { fingerprint: 'invalid' },
      { selections: '{bad' },
      { selections: '[]' },
    ])
      expect(excessSaveSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })
  it('keeps decimal strings exact beyond binary floating precision and currency decimals', () => {
    expect(formatCostDecimal('9007199254740993.123456789', 'en', 100)).toBe(
      '9,007,199,254,740,993.123456789',
    )
    expect(formatCostDecimal('0.000000001', 'en', 100)).toBe('0.000000001')
  })
  it('bounds URL paging and filters and validates dates', () => {
    expect(
      excessListParams({ size: '5000', sort: 'secret', location: 'A,org', page: '99999999' }),
    ).toMatchObject({ size: 25, page: 100000, sort: 'created_at', filters: {} })
    expect(excessCutoff({ cutoff: '2026-02-30' })).toBeUndefined()
    expect(excessCutoff({ cutoff: ['2026-10-10', '2026-10-11'] })).toBe('2026-10-10')
  })
})
