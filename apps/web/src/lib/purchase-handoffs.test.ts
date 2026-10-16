import { expect, it } from 'vitest'
import Papa from 'papaparse'
import { handoffFixture } from './purchase-handoffs.fixture'
import { handoffCsv, handoffJson, handoffInputSchema, handoffListParams } from './purchase-handoffs'

it('exports lossless JSON with stable order independent of database key ordering', () => {
  const body = handoffJson(handoffFixture)
  expect(body).toMatchSnapshot('purchase-handoff-v1 JSON contract')
  expect(JSON.parse(body)).toEqual(handoffFixture)
  expect(body).toContain('"quantity": "999999999999999.999"')
  expect(body).toContain('"item_code": "000123"')
  const reversed = Object.fromEntries(Object.entries(handoffFixture).reverse())
  expect(handoffJson(reversed as typeof handoffFixture)).toBe(body)
  expect(handoffJson(handoffFixture)).toBe(body)
})
it('exports a spreadsheet-safe CSV with exact numeric text, source references and a planning label', () => {
  const body = handoffCsv(handoffFixture)
  expect(body).toMatchSnapshot('purchase-handoff-v1 CSV contract')
  expect(body.charCodeAt(0)).toBe(0xfeff)
  const result = Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true })
  expect(result.errors).toEqual([])
  expect(result.data).toHaveLength(1)
  expect(result.data[0]).toMatchObject({
    purpose: 'planning_only',
    quantity: '999999999999999.999',
    subtotal: '999999999999999.999',
    item_code: '000123',
    proposal_reason: '\'="quoted",\nقطعة',
    handoff_id: handoffFixture.handoff_id,
    estimate_id: handoffFixture.proposal.estimate_id,
    currency_minor_units: '3',
    price_valid_from: '2026-10-10',
  })
  expect(handoffCsv(handoffFixture)).toBe(body)
})
it.each(['=HYPERLINK("https://invalid")', ' +CMD', '\t=1', '＠SUM(1)', '\u200f-evil'])(
  'neutralizes formula text %s without changing JSON',
  (reason) => {
    const input = { ...handoffFixture, proposal: { ...handoffFixture.proposal, reason } }
    const row = Papa.parse<Record<string, string>>(handoffCsv(input), {
      header: true,
      skipEmptyLines: true,
    }).data[0]
    expect(row.proposal_reason).toBe("'" + reason)
    expect(JSON.parse(handoffJson(input)).proposal.reason).toBe(reason)
  },
)
it('requires a UUID source and allow-lists search filters', () => {
  expect(handoffInputSchema.safeParse({ proposal_id: 'bad' }).success).toBe(false)
  const params = handoffListParams({
    q: ' part ',
    selection: 'injected',
    supplier: '%',
    location: 'L1',
    size: '100',
    page: '2',
  })
  expect(params.filters).toEqual({ location: 'L1' })
  expect(params.page).toBe(2)
  expect(params.size).toBe(100)
  expect(handoffListParams({ selection: 'historical' }).filters.selection).toBe('historical')
})
