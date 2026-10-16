import { z } from 'zod'
import { parseListParams, type RawSearchParams, type ListSpec } from './master-data/list-params'

const reason = z.string().trim().min(1).max(2000)
export const proposalSchema = z.object({ estimate_id: z.uuid(), request_id: z.uuid(), reason })
export const decisionSchema = z.object({
  proposal_id: z.uuid(),
  request_id: z.uuid(),
  reason,
  decision: z.enum(['approved', 'rejected', 'withdrawn']),
})
export const REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const
export const workbenchSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [
    {
      param: 'location',
      column: 'location_code',
      kind: 'pattern',
      pattern: /^[A-Za-z0-9_.-]{1,64}$/,
    },
    {
      param: 'supplier',
      column: 'supplier_code',
      kind: 'pattern',
      pattern: /^[A-Za-z0-9_.-]{1,64}$/,
    },
    {
      param: 'draft',
      column: 'draft_id',
      kind: 'pattern',
      pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    },
    { param: 'status', column: 'status', kind: 'enum', values: REVIEW_STATUSES },
  ],
}
export const workbenchParams = (raw: RawSearchParams) => parseListParams(raw, workbenchSpec)
export const workbenchRowSchema = z.object({
  id: z.uuid(),
  estimate_id: z.uuid(),
  draft_id: z.uuid(),
  revision: z.number().int().positive(),
  created_at: z.string(),
  status: z.enum(REVIEW_STATUSES),
  selected: z.boolean(),
  item_code: z.string(),
  location_code: z.string(),
  supplier_code: z.string(),
  quantity: z.string(),
  unit: z.string(),
  currency: z.string(),
  subtotal: z.string(),
  minor_units: z.number().int(),
  order_date: z.iso.date(),
  receipt_date: z.iso.date(),
})
