import { handoffFixture } from './event-purchase-handoffs.fixture'
import type { BatchPayload } from './event-handoff-batches'
const second = structuredClone(handoffFixture)
second.handoff_id = '93000000-0000-4000-8000-000000000002'
second.estimate.source.source.draft.scenario.event.source.item_id = second.handoff_id
second.estimate.source.source.draft.scenario.event.source.item_code = '000124'
second.estimate.source.source.draft.scenario.event.input.unit = 'KG'
second.estimate.source.receipt_date = '2026-10-15'
export const batchFixture: BatchPayload = {
  schema_version: 'event-purchase-handoff-batch-v1',
  purpose: 'planning_only',
  selected_quantity_basis: 'full_event_adjusted',
  notice:
    'As-of planning package of full event-adjusted selections. Baselines and increases are comparison evidence.',
  batch_id: '93000000-0000-4000-8000-000000000003',
  organization_id: handoffFixture.organization_id,
  created_by: handoffFixture.created_by,
  created_at: handoffFixture.created_at,
  summary: {
    supplier_id: handoffFixture.estimate.source.source.supplier.id,
    supplier_code: 'SUP',
    location_id: handoffFixture.estimate.location_id,
    location_code: 'L0',
    currency: 'SAR',
    minor_units: 2,
    order_date: '2026-10-10',
    line_count: 2,
    subtotal: '1999999999999999.998',
    baseline_subtotal: '7.40',
    cost_increase: '1999999999999992.598',
  },
  lines: [handoffFixture, second],
}
