import { expect, it } from 'vitest'
import Papa from 'papaparse'
import { batchFixture } from './network-batches.fixture'
import {
  batchCsv,
  batchJson,
  batchPayloadSchema,
  batchInputSchema,
  batchListParams,
  batchSelection,
  batchSelectionHref,
  batchErrorKey,
} from './network-batches'
import { handoffJson } from './network-handoffs'

it('pins complete original handoffs and unbounded exact currency totals in versioned JSON', () => {
  const body = batchJson(batchFixture)
  expect(body).toMatchSnapshot('network-batch-v1 JSON')
  const parsed = JSON.parse(body)
  expect(parsed).toEqual(batchPayloadSchema.parse(batchFixture))
  expect(parsed.summary.totals[0].subtotal).toBe('1999999999999999.998')
  expect(parsed.lines.map(handoffJson)).toEqual(batchFixture.lines.map(handoffJson))
  const reversed = Object.fromEntries(Object.entries(batchFixture).reverse())
  expect(batchJson(reversed as typeof batchFixture)).toBe(body)
})
it('writes one CSV row per branch with zero context and distinct repeated package metadata', () => {
  const csv = batchCsv(batchFixture)
  expect(csv).toMatchSnapshot('network-batch-v1 CSV')
  expect(csv.charCodeAt(0)).toBe(0xfeff)
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
  expect(parsed.errors).toEqual([])
  expect(parsed.data).toHaveLength(4)
  expect(parsed.data.map((r) => r.handoff_number)).toEqual(['1', '1', '2', '2'])
  expect(parsed.data.map((r) => r.branch_number)).toEqual(['1', '2', '1', '2'])
  expect(parsed.data[0].quantity).toBe('999999999999999.999')
  expect(parsed.data[0].item_code).toBe('000123')
  expect(parsed.data[2].item_code).toBe('000456')
  expect(JSON.parse(parsed.data[0].batch_totals_json)).toEqual(batchFixture.summary.totals)
  expect(parsed.data[1]).toMatchObject({
    quantity: '0.000',
    transfer_status: 'no_transfer_needed',
    dispatch_date: '',
    typical_receipt_date: '',
    slow_receipt_date: '',
    subtotal: '',
  })
})
it.each(['=HYPERLINK("https://invalid")', ' +CMD', '\t=1', '＠SUM(1)', '\u200f-evil'])(
  'neutralizes formula text %s without altering original JSON',
  (reason) => {
    const input = {
      ...batchFixture,
      lines: batchFixture.lines.map((h) => ({
        ...h,
        proposal: { ...h.proposal, reason },
      })),
    }
    const row = Papa.parse<Record<string, string>>(batchCsv(input), {
      header: true,
      skipEmptyLines: true,
    }).data[0]
    expect(row.proposal_reason).toBe("'" + reason)
    expect(JSON.parse(batchJson(input)).lines[0].proposal.reason).toBe(reason)
  },
)
it('validates bounded selections, preserves input for errors and allow-lists filters', () => {
  const ids = batchFixture.lines.map((h) => h.handoff_id)
  expect(batchInputSchema.safeParse(ids).success).toBe(true)
  for (const bad of [[], [ids[0], ids[0]], ['bad'], Array(51).fill(ids[0])])
    expect(batchInputSchema.safeParse(bad).success).toBe(false)
  expect(batchSelection({ handoff: ids })).toEqual(ids)
  expect(batchSelection({ handoff: 'bad' })).toEqual(['bad'])
  expect(batchSelectionHref(ids)).toBe(
    `/replenishment/network/batches/new?handoff=${ids[0]}&handoff=${ids[1]}`,
  )
  expect(
    batchListParams({ selection: 'unavailable', source: 'WAREHOUSE', location: 'hidden' }).filters,
  ).toEqual({ selection: 'unavailable', source: 'WAREHOUSE' })
  expect(batchListParams({ selection: 'bad', source: '%' }).filters).toEqual({})
  expect(batchErrorKey('network_freight_changed')).toBe('priceChanged')
  expect(batchErrorKey('unknown')).toBe('unavailable')
})
