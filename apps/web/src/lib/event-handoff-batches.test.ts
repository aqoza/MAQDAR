import { expect, it } from 'vitest'
import originalEvent from './event-purchase-handoffs.fixture.json'
import Papa from 'papaparse'
import { batchFixture } from './event-handoff-batches.fixture'
import {
  batchJson,
  batchCsv,
  batchInputSchema,
  batchSelection,
  batchSelectionHref,
  batchErrorKey,
  batchListParams,
} from './event-handoff-batches'

it('preserves complete exact evidence with deterministic JSON serialization', () => {
  const json = batchJson(batchFixture)
  expect(json).toMatchSnapshot('event-purchase-handoff-batch-v1 JSON')
  expect(JSON.parse(json)).toEqual(batchFixture)
  expect(JSON.parse(json).lines[0].estimate).toEqual(originalEvent.estimate)
  expect(json).toContain('"subtotal": "1999999999999999.998"')
  const reordered = Object.fromEntries(Object.entries(batchFixture).reverse())
  expect(batchJson(reordered as typeof batchFixture)).toBe(json)
})
it('exports two distinct CSV lines with exact amounts, units, dates and evidence references', () => {
  const csv = batchCsv(batchFixture)
  expect(csv).toMatchSnapshot('event-purchase-handoff-batch-v1 CSV')
  expect(csv.charCodeAt(0)).toBe(0xfeff)
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
  expect(parsed.errors).toEqual([])
  expect(parsed.data).toHaveLength(2)
  expect(parsed.data[0]).toMatchObject({
    line_number: '1',
    selected_adjusted_quantity: '999999999999999.999',
    baseline_comparison_quantity: '3',
    line_baseline_comparison_subtotal: '3.70',
    selected_quantity_basis: 'full_event_adjusted',
    batch_adjusted_subtotal: '1999999999999999.998',
    line_adjusted_subtotal: '999999999999999.999',
    unit: 'EA',
    item_code: '000123',
    proposal_reason: '\'="quoted",\nقطعة',
    purpose: 'planning_only',
  })
  expect(parsed.data[1]).toMatchObject({
    line_number: '2',
    unit: 'KG',
    receipt_date: '2026-10-15',
    handoff_id: batchFixture.lines[1].handoff_id,
  })
  expect(batchCsv(batchFixture)).toBe(csv)
})
it.each(['=HYPERLINK("https://invalid")', ' +CMD', '\t=1', '＠SUM(1)', '\u200f-evil'])(
  'neutralizes CSV formula text %s without changing source JSON',
  (reason) => {
    const input = structuredClone(batchFixture)
    input.lines[0].proposal.reason = reason
    const rows = Papa.parse<Record<string, string>>(batchCsv(input), {
      header: true,
      skipEmptyLines: true,
    }).data
    expect(rows[0].proposal_reason).toBe("'" + reason)
    expect(JSON.parse(batchJson(input)).lines[0].proposal.reason).toBe(reason)
  },
)
it('bounds selections and rejects malformed or repeated identities', () => {
  const id = batchFixture.lines[0].handoff_id
  for (const input of [[], [null], ['bad'], [id, id], Array(51).fill(id)])
    expect(batchInputSchema.safeParse(input).success).toBe(false)
  const ids = Array.from(
    { length: 50 },
    (_, i) => `93000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  )
  expect(batchInputSchema.safeParse(ids).success).toBe(true)
  expect(batchSelection({ handoff: id })).toEqual([id])
  expect(batchSelection({ handoff: ids })).toEqual(ids)
  expect(batchSelection({})).toEqual([])
  expect(batchSelectionHref([id])).toBe(`/replenishment/events/batches/new?handoff=${id}`)
})
it('allow-lists history filters and maps only known error hints', () => {
  expect(batchListParams({ selection: 'current', supplier: '%', location: 'L1' }).filters).toEqual({
    selection: 'current',
    location: 'L1',
  })
  expect(batchErrorKey('event_purchase_price_changed')).toBe('priceChanged')
  expect(batchErrorKey('private database message')).toBe('unavailable')
  expect(batchErrorKey(null)).toBe('unavailable')
  expect(batchErrorKey('event_purchase_timing_required')).toBe('timingRequired')
})
