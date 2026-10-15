import { z } from 'zod'
import { normalizeDigits } from './master-data/numbers'
import { parseListParams, type RawSearchParams, type ListSpec } from './master-data/list-params'
import { POLICY_STATUSES } from './inventory-policy'

const QUANTITY_PATTERN = /^\d{1,15}(\.\d{1,3})?$/
const quantity = z.string().transform(normalizeDigits).pipe(z.string().regex(QUANTITY_PATTERN))
const reason = z.string().trim().min(1).max(2000)
function thousandths(value: string) {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, '0'))
}
export const proposalSchema = z
  .object({
    policy_id: z.uuid(),
    request_id: z.uuid(),
    reorder_point: quantity,
    order_up_to: quantity,
    reason,
  })
  .refine(
    (v) =>
      !QUANTITY_PATTERN.test(v.reorder_point) ||
      !QUANTITY_PATTERN.test(v.order_up_to) ||
      thousandths(v.reorder_point) <= thousandths(v.order_up_to),
  )
export const decisionSchema = z.object({
  override_id: z.uuid(),
  request_id: z.uuid(),
  decision: z.enum(['approved', 'rejected', 'withdrawn']),
  reason,
})
export const REVIEW_STATUSES = ['none', 'pending', 'approved', 'rejected', 'withdrawn'] as const
export const workbenchSpec: ListSpec = {
  sorts: ['finished_at'],
  defaultSort: 'finished_at',
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
    { param: 'status', column: 'status', kind: 'enum', values: POLICY_STATUSES },
    { param: 'review', column: 'review_status', kind: 'enum', values: REVIEW_STATUSES },
  ],
}
export const workbenchParams = (raw: RawSearchParams) => parseListParams(raw, workbenchSpec)
export const workbenchRowSchema = z.object({
  id: z.uuid(),
  run_id: z.uuid(),
  location_id: z.uuid(),
  item_code: z.string(),
  location_code: z.string(),
  unit: z.string().nullable(),
  status: z.enum(POLICY_STATUSES),
  to_date: z.iso.date(),
  finished_at: z.string(),
  calculated_reorder: z.string().nullable(),
  calculated_maximum: z.string().nullable(),
  approved_reorder: z.string().nullable(),
  approved_maximum: z.string().nullable(),
  review_status: z.enum(REVIEW_STATUSES),
})
