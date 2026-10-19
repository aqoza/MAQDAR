import { handoffFixture } from './excess-disposition-handoffs.fixture'
import type { BatchPayload } from './excess-disposition-batches'

const second = structuredClone(handoffFixture)
second.handoff_id = 'a2000000-0000-4000-8000-000000000099'
second.disposition = {
  ...second.disposition,
  item_id: '92000000-0000-4000-8000-000000000098',
  item_code: 'SECOND',
  unit: 'KG',
}
second.proposal.id = '92000000-0000-4000-8000-000000000097'
second.line.item_id = second.disposition.item_id
second.line.comparison.item_code = 'SECOND'
second.line.comparison.unit = 'KG'
if (!second.line.comparison.unit_provenance || !second.line.comparison.snapshot)
  throw new Error('The handoff fixture must include unit and snapshot evidence')
second.line.comparison.unit_provenance = {
  ...second.line.comparison.unit_provenance,
  unit: 'KG',
  units: ['KG'],
}
second.line.comparison.snapshot.unit = 'KG'
export const batchFixture: BatchPayload = {
  schema_version: 'excess-disposition-handoff-batch-v1',
  purpose: 'planning_only',
  notice: 'Planning package only',
  batch_id: '92000000-0000-4000-8000-000000000100',
  organization_id: handoffFixture.organization_id,
  created_by: handoffFixture.created_by,
  created_at: '2026-10-19T00:00:00.123456Z',
  summary: {
    location_id: handoffFixture.disposition.location_id,
    location_code: handoffFixture.disposition.location_code,
    kind: handoffFixture.disposition.kind,
    currency: handoffFixture.disposition.currency,
    cutoff: handoffFixture.disposition.cutoff,
    line_count: 2,
    reference_value: '7.499250',
  },
  lines: [handoffFixture, second],
}
