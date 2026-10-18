import { z } from 'zod'
import { excessReportSchema } from './excess-stock'
import { normalizeDigits } from './master-data/numbers'
import { parseListParams, type ListSpec, type RawSearchParams } from './master-data/list-params'
import { decisionSchema, REVIEW_STATUSES } from './purchase-review'

export { decisionSchema, REVIEW_STATUSES }
export const DISPOSITION_KINDS = ['supplier_return', 'scrap'] as const
export const dispositionSourceSchema = z.object({
  assessment_id: z.guid(),
  location_id: z.guid(),
  location_code: z.string(),
  cutoff: z.iso.date(),
  matches: z.boolean(),
  line: excessReportSchema.shape.lines.element,
})
export type DispositionSource = z.infer<typeof dispositionSourceSchema>
export const dispositionInputSchema = z.object({
  assessment_id: z.guid(),
  item_id: z.guid(),
  request_id: z.uuid(),
  kind: z.enum(DISPOSITION_KINDS),
  quantity: z
    .string()
    .transform(normalizeDigits)
    .pipe(z.string().regex(/^\d{1,15}(\.\d{1,3})?$/))
    .refine((value) => /[1-9]/.test(value)),
  reason: z.string().trim().min(1).max(2000),
})
export const dispositionRowSchema = z.object({
  id: z.guid(),
  assessment_id: z.guid(),
  item_id: z.guid(),
  location_id: z.guid(),
  item_code: z.string(),
  location_code: z.string(),
  cutoff: z.iso.date(),
  kind: z.enum(DISPOSITION_KINDS),
  quantity: z.string(),
  reference_value: z.string(),
  unit: z.string(),
  currency: z.string(),
  revision: z.number().int().positive(),
  created_at: z.string(),
  status: z.enum(REVIEW_STATUSES),
  selected: z.boolean(),
})
export const dispositionListSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [
    { param: 'location', column: 'location_code', kind: 'pattern', pattern: /^[\w.-]{1,64}$/ },
    { param: 'status', column: 'status', kind: 'enum', values: REVIEW_STATUSES },
    { param: 'kind', column: 'kind', kind: 'enum', values: DISPOSITION_KINDS },
    { param: 'assessment', column: 'assessment_id', kind: 'uuid' },
    { param: 'item', column: 'item_id', kind: 'uuid' },
  ],
}
export const dispositionListParams = (raw: RawSearchParams) =>
  parseListParams(raw, dispositionListSpec)
export const positiveExcess = (quantity: string | null) =>
  Boolean(quantity && /^\d+(\.\d+)?$/.test(quantity) && /[1-9]/.test(quantity))
