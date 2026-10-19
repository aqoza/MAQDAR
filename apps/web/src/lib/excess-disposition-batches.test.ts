import { expect, it } from 'vitest'
import { batchFixture } from './excess-disposition-batches.fixture'
import {
  batchJson,
  batchCsv,
  batchInputSchema,
  batchPayloadSchema,
  batchListParams,
  batchSelection,
  batchSelectionHref,
  batchErrorKey,
} from './excess-disposition-batches'

it('freezes original v1 files, including full line evidence and independent units', () => {
  expect(batchJson(batchFixture)).toMatchSnapshot()
  expect(batchCsv(batchFixture)).toMatchSnapshot()
  const result = JSON.parse(batchJson(batchFixture))
  expect(result.lines.map((l: (typeof batchFixture.lines)[number]) => l.disposition.unit)).toEqual([
    'EA',
    'KG',
  ])
  expect(result.summary.quantity).toBeUndefined()
})
it('retains exact large totals and unknown nested evidence without recomputation', () => {
  const p = structuredClone(batchFixture)
  p.summary.reference_value = '49999999999999999900000000000000.000050'
  p.lines[0].line = Object.assign(p.lines[0].line, {
    original: { z: 'retained', a: ['0.000000001'] },
  })
  const file = JSON.parse(batchJson(p))
  expect(file.summary.reference_value).toBe(p.summary.reference_value)
  expect(file.lines[0].line).toEqual(p.lines[0].line)
  expect(batchCsv(p)).toContain(p.summary.reference_value)
})
it('is stable across nested key ordering and excludes live context', () => {
  const p = { ...batchFixture, selection: 'historical', overlap_count: 2 }
  expect(batchJson(batchPayloadSchema.parse(p))).toBe(batchJson(batchFixture))
  expect(batchCsv(batchPayloadSchema.parse(p))).toBe(batchCsv(batchFixture))
  const reordered = structuredClone(batchFixture)
  reordered.lines[0].line = Object.fromEntries(
    Object.entries(reordered.lines[0].line).reverse(),
  ) as (typeof reordered.lines)[0]['line']
  expect(batchJson(reordered)).toBe(batchJson(batchFixture))
})
it('protects CSV formulas while preserving original Arabic reasons in JSON', () => {
  const p = structuredClone(batchFixture)
  p.lines[0].disposition.item_code = '=COMMAND("x")'
  p.lines[0].proposal.reason = '@run\nمرتجع "خاص"'
  expect(batchCsv(p)).toContain('"\'=COMMAND(""x"")"')
  expect(batchCsv(p)).toContain('"\'@run\nمرتجع ""خاص"""')
  expect(JSON.parse(batchJson(p)).lines[0].proposal.reason).toBe(p.lines[0].proposal.reason)
})
it('bounds distinct input without silently dropping malformed choices', () => {
  const id = batchFixture.lines[0].handoff_id
  for (const value of [
    [],
    [id, id],
    ['bad'],
    Array.from({ length: 51 }, (_, i) => `92000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
  ])
    expect(batchInputSchema.safeParse(value).success).toBe(false)
  expect(batchInputSchema.safeParse([id]).success).toBe(true)
  expect(batchSelection({ handoff: [id, 'bad'] })).toEqual([id, 'bad'])
  expect(batchSelectionHref([id])).toContain(`handoff=${id}`)
})
it('requires valid versions, bounded lines and known summary fields', () => {
  for (const patch of [
    { schema_version: 'other' },
    { purpose: 'executed' },
    { lines: [] },
    { summary: { ...batchFixture.summary, reference_value: 'NaN' } },
    { summary: { ...batchFixture.summary, kind: 'return' } },
  ])
    expect(batchPayloadSchema.safeParse({ ...batchFixture, ...patch }).success).toBe(false)
})
it('allows missing live context as a separate filter and rejects unsafe filters', () => {
  expect(batchListParams({ selection: 'unavailable', kind: 'scrap', size: '100' })).toMatchObject({
    size: 100,
    filters: { selection: 'unavailable', kind: 'scrap' },
  })
  expect(
    batchListParams({ selection: 'executed', kind: 'anything', location: 'bad,eq', size: '5000' }),
  ).toMatchObject({ size: 25, filters: {} })
  expect(batchErrorKey('excess_disposition_changed')).toBe('evidenceChanged')
  expect(batchErrorKey('private details')).toBe('unavailable')
})
