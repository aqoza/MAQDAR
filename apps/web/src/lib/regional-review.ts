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
    { param: 'sourcing', column: 'sourcing_id', kind: 'uuid' },
    {
      param: 'destination',
      column: 'destination_code',
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
  sourcing_id: z.guid(),
  revision: z.number().int().positive(),
  created_at: z.string(),
  status: z.enum(REVIEW_STATUSES),
  selected: z.boolean(),
  item_code: z.string(),
  destination_code: z.string(),
  source_count: z.number().int().min(1).max(19),
  cutoff: z.iso.date(),
  region_name: z.string(),
  region_name_ar: z.string().nullable(),
})

export {
  hasPositiveAllocation,
  networkTimingBlocked as regionalTimingBlocked,
} from './network-review'
