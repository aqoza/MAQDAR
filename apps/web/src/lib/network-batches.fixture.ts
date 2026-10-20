import { handoffFixture } from './network-handoffs.fixture'
import type { BatchPayload } from './network-batches'

const second = structuredClone(handoffFixture)
second.handoff_id = 'a220f000-0000-4000-8000-000000000002'
second.estimate.source.source.item_id = 'a220f000-0000-4000-8000-000000000003'
if (second.estimate.source.source.source_policy)
  second.estimate.source.source.source_policy.item_code = '000456'

export const batchFixture: BatchPayload = {
  schema_version: 'network-handoff-batch-v1',
  purpose: 'planning_only',
  notice: 'Planning package; each branch retains its original freight.',
  batch_id: 'a220f000-0000-4000-8000-000000000004',
  organization_id: handoffFixture.organization_id,
  created_by: handoffFixture.created_by,
  created_at: '2026-10-20T18:00:00.123456Z',
  summary: {
    source_location_id: handoffFixture.estimate.source_location_id,
    source_code: handoffFixture.estimate.source.source.source_location_code,
    dispatch_date: '2026-10-12',
    handoff_count: 2,
    branch_row_count: 4,
    totals: [{ currency: 'KWD', minor_units: 3, subtotal: '1999999999999999.998' }],
  },
  lines: [handoffFixture, second],
}
