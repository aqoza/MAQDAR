import { handoffFixture } from './purchase-handoffs.fixture'
import type { BatchPayload } from './handoff-batches'
const second = structuredClone(handoffFixture)
second.handoff_id = '93000000-0000-4000-8000-000000000002'
second.estimate.source.item_id = second.handoff_id
second.estimate.source.item_code = '000124'
second.estimate.source.unit = 'KG'
second.estimate.source.receipt_date = '2026-10-15'
export const batchFixture: BatchPayload = {
  schema_version: 'purchase-handoff-batch-v1',
  purpose: 'planning_only',
  notice:
    'As-of planning package only. Overlapping packages may contain the same lines. Not an order, reservation or inbound quantity.',
  batch_id: '93000000-0000-4000-8000-000000000003',
  organization_id: handoffFixture.organization_id,
  created_by: handoffFixture.created_by,
  created_at: handoffFixture.created_at,
  summary: {
    supplier_id: handoffFixture.estimate.source.supplier_id!,
    supplier_code: 'SUP',
    location_id: handoffFixture.estimate.location_id,
    location_code: 'BRANCH',
    currency: 'KWD',
    minor_units: 3,
    order_date: '2026-10-10',
    line_count: 2,
    subtotal: '1999999999999999.998',
  },
  lines: [handoffFixture, second],
}
