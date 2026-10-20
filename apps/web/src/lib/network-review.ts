import { z } from 'zod'
import { parseListParams, type RawSearchParams, type ListSpec } from './master-data/list-params'
import { REVIEW_STATUSES } from './transfer-review'

export { proposalSchema, decisionSchema, REVIEW_STATUSES } from './transfer-review'
export const workbenchSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [
    { param: 'allocation', column: 'allocation_id', kind: 'uuid' },
    {
      param: 'source',
      column: 'source_code',
      kind: 'pattern',
      pattern: /^[A-Za-z0-9_.-]{1,64}$/,
    },
    { param: 'status', column: 'status', kind: 'enum', values: REVIEW_STATUSES },
  ],
}
export const workbenchParams = (raw: RawSearchParams) => parseListParams(raw, workbenchSpec)
export const workbenchRowSchema = z.object({
  id: z.guid(),
  estimate_id: z.guid(),
  allocation_id: z.guid(),
  revision: z.number().int().positive(),
  created_at: z.string(),
  status: z.enum(REVIEW_STATUSES),
  selected: z.boolean(),
  item_code: z.string(),
  source_code: z.string(),
  branch_count: z.number().int().min(1).max(20),
  dispatch_date: z.iso.date(),
})

type AllocationLines = { lines: { location_id: string; quantity: string }[] }
// Inputs are validated nonnegative decimal strings. No quantity conversion or pooling.
export const hasPositiveAllocation = (report: AllocationLines) =>
  report.lines.some((line) => /[1-9]/.test(line.quantity))

type ReceiptEvidence = {
  timing_review_required?: boolean | null
  search?: { date?: string | null } | null
}
export function networkTimingBlocked(
  report: AllocationLines & {
    status: string
    source: {
      lines: {
        location_id: string
        status: string
        receipts: Partial<Record<'p50' | 'p90', ReceiptEvidence>>
      }[]
    }
  },
) {
  return (
    report.status !== 'available' ||
    !hasPositiveAllocation(report) ||
    report.lines
      .filter((line) => /[1-9]/.test(line.quantity))
      .some((line) => {
        const dates = report.source.lines.find((date) => date.location_id === line.location_id)
        return (
          dates?.status !== 'available' ||
          dates.receipts.p50?.timing_review_required !== false ||
          dates.receipts.p90?.timing_review_required !== false ||
          !dates.receipts.p50?.search?.date ||
          !dates.receipts.p90?.search?.date
        )
      })
  )
}
