import { expect, it } from 'vitest'
import { handoffFixture } from './excess-disposition-handoffs.fixture'
import {
  handoffCsv,
  handoffJson,
  handoffInputSchema,
  handoffListParams,
  handoffPayloadSchema,
} from './excess-disposition-handoffs'

it('freezes the v1 JSON and CSV contracts', () => {
  expect(handoffJson(handoffFixture)).toMatchSnapshot()
  expect(handoffCsv(handoffFixture)).toMatchSnapshot()
})
it('retains complete nested evidence and exact strings without recalculating money', () => {
  const p = structuredClone(handoffFixture)
  p.disposition.quantity = '999999999999999.999'
  p.disposition.reference_value = '999999999999999998000000000000.000001'
  const line = { ...p.line, original_extra: { z: 'original', a: ['0.000000001'] } }
  const input = { ...p, line }
  const saved = JSON.parse(handoffJson(input))
  expect(saved.disposition).toEqual(p.disposition)
  expect(saved.line).toEqual(line)
  expect(handoffCsv(input)).toContain('"999999999999999998000000000000.000001"')
})
it('is byte-stable across object key ordering and never exports live selection', () => {
  const reversed = Object.fromEntries(Object.entries(handoffFixture).reverse())
  const withContext = { ...reversed, selected: false }
  expect(handoffJson(handoffPayloadSchema.parse(withContext))).toBe(handoffJson(handoffFixture))
  expect(handoffJson(handoffFixture)).not.toContain('"selected"')
})
it('escapes spreadsheet formulas, embedded quotes, line breaks and Arabic', () => {
  const p = structuredClone(handoffFixture)
  p.disposition.item_code = '=HYPERLINK("bad")'
  p.proposal.reason = '@command\nمرتجع "خاص"'
  const csv = handoffCsv(p)
  expect(csv.startsWith('\ufeff')).toBe(true)
  expect(csv).toContain('"\'=HYPERLINK(""bad"")"')
  expect(csv).toContain('"\'@command\nمرتجع ""خاص"""')
  expect(JSON.parse(handoffJson(p)).proposal.reason).toBe(p.proposal.reason)
})
it.each(['0', '-1', 'NaN', 'Infinity', '1e3'])(
  'rejects invalid selected quantity %s',
  (quantity) => {
    expect(
      handoffPayloadSchema.safeParse({
        ...handoffFixture,
        disposition: { ...handoffFixture.disposition, quantity },
      }).success,
    ).toBe(false)
  },
)
it('requires version, planning purpose, original line and confirmation', () => {
  for (const patch of [
    { schema_version: 'other' },
    { purpose: 'executed' },
    { line: {} },
    { assessment: { ...handoffFixture.assessment, as_of_confirmed: false } },
  ])
    expect(handoffPayloadSchema.safeParse({ ...handoffFixture, ...patch }).success).toBe(false)
  expect(handoffInputSchema.safeParse({ proposal_id: 'bad' }).success).toBe(false)
})
it('bounds paging and allow-lists selection and disposition filters', () => {
  expect(
    handoffListParams({ size: '5000', kind: 'transfer', selection: 'executed', location: 'A,org' }),
  ).toMatchObject({ size: 25, filters: {} })
  expect(handoffListParams({ size: '100', kind: 'scrap', selection: 'historical' })).toMatchObject({
    size: 100,
    filters: { kind: 'scrap', selection: 'historical' },
  })
})
