import { handoffFixture } from './transfer-handoffs.fixture'
import { type BatchPayload } from './transfer-batches'

const second = structuredClone(handoffFixture)
second.handoff_id = '93000000-0000-4000-8000-000000000002'
second.estimate.source.source.destination.policy.item_code = '000456'
second.estimate.source.source.destination.policy.unit = 'KG'
second.estimate.source.receipts.p90!.search.date = '2026-10-15'

export const batchFixture: BatchPayload = {
  schema_version: 'transfer-handoff-batch-v1',
  purpose: 'planning_only',
  notice: 'Each line retains its freight charge. Not a consolidated shipment or transfer order.',
  batch_id: '93000000-0000-4000-8000-000000000010',
  organization_id: handoffFixture.organization_id,
  created_by: handoffFixture.created_by,
  created_at: handoffFixture.created_at,
  summary: {
    lane_id: handoffFixture.estimate.terms!.id,
    source_location_id: handoffFixture.estimate.source_location_id,
    source_code: handoffFixture.estimate.source.source.source_location_code!,
    location_id: handoffFixture.estimate.location_id,
    location_code: handoffFixture.estimate.source.source.destination.policy.location_code,
    currency: handoffFixture.estimate.terms!.currency!,
    minor_units: handoffFixture.estimate.terms!.minor_units!,
    dispatch_date: handoffFixture.estimate.source.dispatch!.date!,
    line_count: 2,
    subtotal: '1999999999999999.998',
  },
  lines: [handoffFixture, second],
}
