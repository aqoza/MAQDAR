import { handoffFixture } from './regional-handoffs.fixture'
import type { BatchPayload } from './regional-batches'
const first = structuredClone(handoffFixture)
const second = structuredClone(handoffFixture)
first.estimate.source.source.destination.policy.item_code = '000123'
second.handoff_id = 'a250f000-0000-4000-8000-000000000002'
second.estimate.source.source.destination.policy.item_code = '000456'
// Contract fixture includes a zero source and very large decimal text.
for (const h of [first, second]) {
  h.estimate.lines[0].quantity = '999999999999999.999'
  h.estimate.lines[1].status = 'no_transfer_needed'
  h.estimate.lines[1].quantity = '0.000'
  h.estimate.lines[1].subtotal = null
  h.estimate.lines[1].exact_product = null
  h.estimate.lines[1].shipment_count = null
  h.estimate.source.lines[1].dispatch = null
  h.estimate.source.lines[1].receipts = {}
}
export const batchFixture: BatchPayload = {
  schema_version: 'regional-handoff-batch-v1',
  purpose: 'planning_only',
  notice: 'Planning package; every source retains its freight.',
  batch_id: 'a250f000-0000-4000-8000-000000000004',
  organization_id: first.organization_id,
  created_by: first.created_by,
  created_at: '2026-10-23T08:00:00.123456Z',
  summary: {
    destination_location_id: first.estimate.source.source.destination_location_id,
    destination_code: first.estimate.source.source.destination.policy.location_code,
    region_id: first.estimate.source.source.region.id,
    region_name: first.estimate.source.source.region.name_en,
    region_name_ar: first.estimate.source.source.region.name_ar,
    requested_date: first.estimate.source.requested_date,
    handoff_count: 2,
    source_row_count: 4,
    totals: [{ currency: 'KWD', minor_units: 3, subtotal: '1999999999999999.998' }],
  },
  lines: [first, second],
  item_identities: [first, second].map((h, i) => ({
    handoff_id: h.handoff_id,
    item_id: `a250f000-0000-4000-8000-00000000000${i + 6}`,
    draft_id: h.estimate.source.source.input.draft_id,
    policy_id: h.estimate.source.source.destination.policy.policy_id,
  })),
}
