import { expect, it } from 'vitest'
import en from '../../messages/en.json'
import ar from '../../messages/ar.json'
import raw from './regional-handoffs.fixture.json'
import { handoffFixture } from './regional-handoffs.fixture'
import {
  handoffPayloadSchema,
  handoffCsv,
  handoffCsvRows,
  handoffJson,
  handoffListParams,
} from './regional-handoffs'

it('retains the complete saved evidence and pins the v1 JSON and CSV bytes', () => {
  expect(handoffPayloadSchema.parse(raw)).toEqual(raw)
  expect(handoffJson(handoffFixture)).toMatchSnapshot()
  expect(handoffCsv(handoffFixture)).toMatchSnapshot()
})
it('keeps each source dispatch/receipt separate and does not recalculate currency totals', () => {
  const p = structuredClone(handoffFixture)
  p.estimate.source.lines[1].dispatch!.date = '2026-10-14'
  p.estimate.source.lines[1].receipts.p50!.search.date = '2026-10-16'
  const rows = handoffCsvRows(p)
  expect(rows.map((r) => r.dispatch_date)).toEqual(
    p.estimate.source.lines.map((l) => l.dispatch!.date),
  )
  expect(rows[1].typical_receipt_date).toBe('2026-10-16')
  expect(rows.map((r) => r.subtotal)).toEqual(p.estimate.lines.map((l) => l.subtotal))
  expect(rows.every((r) => r.package_totals_json === JSON.stringify(p.estimate.totals))).toBe(true)
})
it('preserves decimal strings beyond binary floating-point precision', () => {
  const p = structuredClone(handoffFixture)
  p.estimate.lines[0].quantity = '999999999999999.999'
  p.estimate.lines[0].subtotal = '1234999999999999.999'
  expect(handoffJson(p)).toContain('"quantity": "999999999999999.999"')
  expect(handoffCsvRows(p)[0].subtotal).toBe('1234999999999999.999')
  expect(
    handoffPayloadSchema.safeParse({
      ...p,
      estimate: { ...p.estimate, totals: [{ currency: 'SAR', minor_units: 2, subtotal: 1.25 }] },
    }).success,
  ).toBe(false)
})
it('keeps zero sources as context without inventing dates or costs', () => {
  const p = structuredClone(handoffFixture)
  p.estimate.lines[0] = {
    ...p.estimate.lines[0],
    status: 'no_transfer_needed',
    quantity: '0',
    dispatch_date: null,
    subtotal: null,
    exact_product: null,
    shipment_count: null,
  }
  p.estimate.source.lines[0] = {
    ...p.estimate.source.lines[0],
    status: 'no_transfer_needed',
    quantity: '0',
    dispatch: null,
    receipts: {},
  }
  const zero = handoffCsvRows(p)[0]
  expect(zero.dispatch_date).toBeNull()
  expect(zero.typical_receipt_date).toBeUndefined()
  expect(zero.subtotal).toBeNull()
  expect(zero.freight_basis).toBeDefined()
})
it('escapes spreadsheet formulas, quotations and newlines without rewriting JSON evidence', () => {
  const p = structuredClone(handoffFixture)
  p.proposal.approval_reason = '=SUM(1,2)\n"Evidence"'
  const csv = handoffCsv(p)
  expect(csv.startsWith('\ufeff')).toBe(true)
  expect(csv).toContain("'=SUM(1,2)")
  expect(csv).toContain('""Evidence""')
  expect(csv).toContain('\r\n')
  expect(JSON.parse(handoffJson(p)).proposal.approval_reason).toBe(p.proposal.approval_reason)
})
it('rejects mismatched source lineage and malformed filters', () => {
  const p = structuredClone(handoffFixture)
  p.estimate.source.lines.pop()
  expect(() => handoffCsv(p)).toThrow('Incomplete regional handoff lineage')
  const params = handoffListParams({ selection: 'bad', destination: 'bad value', sort: 'payload' })
  expect(params.filters).toEqual({})
  expect(params.sort).toBe('created_at')
  expect(handoffListParams({ selection: 'historical', destination: 'DEST' }).filters).toEqual({
    selection: 'historical',
    destination: 'DEST',
  })
})
it('provides the same complete English and Arabic interface keys', () => {
  expect(Object.keys(ar.RegionalHandoffs).sort()).toEqual(Object.keys(en.RegionalHandoffs).sort())
  for (const value of Object.values(ar.RegionalHandoffs))
    expect(value.trim().length).toBeGreaterThan(0)
})
