import { describe, expect, it } from 'vitest'
import { regionalSourcingInputSchema, sourcingSourceSchema } from './regional-sourcing'
const a = 'ac251000-0000-4000-8000-000000000001',
  b = 'ac251000-0000-4000-8000-000000000002'
const source = { location_id: a, policy_id: b, maximum: 'calculated', backorders: '0' }
const input = {
  region_id: a,
  draft_id: b,
  sources: [source],
  commitments_confirmed: true,
  lanes_confirmed: true,
}
describe('regional sourcing input', () => {
  it('canonicalizes case, source order and decimal representation without floating point', () => {
    const parsed = regionalSourcingInputSchema.parse({
      ...input,
      sources: [
        { ...source, location_id: b, backorders: '٠٠١٫٢' },
        { ...source, location_id: a.toUpperCase(), backorders: '999999999999999.999' },
      ],
    })
    expect(parsed.sources.map((s) => s.location_id)).toEqual([a, b])
    expect(parsed.sources.map((s) => s.backorders)).toEqual(['999999999999999.999', '1.200'])
  })
  it.each(['', '-1', '1.0001', 'NaN', 'Infinity', '1e2', '1000000000000000'])(
    'rejects invalid backorders %s',
    (backorders) => {
      expect(sourcingSourceSchema.safeParse({ ...source, backorders }).success).toBe(false)
    },
  )
  it('requires explicit maximum and confirmations', () => {
    for (const override of [
      { sources: [{ ...source, maximum: '' }] },
      { commitments_confirmed: false },
      { lanes_confirmed: false },
    ])
      expect(regionalSourcingInputSchema.safeParse({ ...input, ...override }).success).toBe(false)
  })
  it('requires one to nineteen distinct source locations', () => {
    for (const sources of [
      [],
      [source, { ...source, location_id: a.toUpperCase() }],
      Array.from({ length: 20 }, (_, i) => ({
        ...source,
        location_id: `ac251000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      })),
    ])
      expect(regionalSourcingInputSchema.safeParse({ ...input, sources }).success).toBe(false)
  })
})
