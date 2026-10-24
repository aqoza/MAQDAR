import { returnHandoffFixture } from './dealer-return-handoffs.fixture'
import type { ReturnBatchPayload } from './dealer-return-batches'
const r = returnHandoffFixture.request.report
export const returnBatchFixture: ReturnBatchPayload = {
  schema_version: 'dealer-return-batch-v1',
  purpose: 'internal_return_authorization',
  notice: 'Requested dates are not scheduled receipts; no operational or financial changes.',
  batch_id: 'cd270000-0000-4000-8000-000000000001',
  organization_id: returnHandoffFixture.organization_id,
  created_by: returnHandoffFixture.created_by,
  created_by_email: null,
  created_at: '2026-10-24T12:00:00Z',
  summary: {
    source_location_id: r.source.id,
    source_code: r.source.code,
    location_id: r.receiver.id,
    location_code: r.receiver.code,
    requested_date: r.input.requested_date,
    line_count: 1,
  },
  lines: [returnHandoffFixture],
}
