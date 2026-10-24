import { z } from 'zod'
import { codeSchema } from './master-data/schemas'
import { normalizeDigits } from './master-data/numbers'
import { parseListParams, type RawSearchParams, type ListSpec } from './master-data/list-params'

export const dealerReturnsPath = '/replenishment/returns'
export const returnConditions = ['unused', 'used', 'damaged', 'unknown'] as const
export const returnFields = [
  'item_code',
  'source_code',
  'location_code',
  'quantity',
  'unit',
  'requested_date',
  'condition',
  'reason',
  'sale_reference',
] as const
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s))
export const returnReasonSchema = text(1000).refine((s) => s.length > 0)
export const returnQuantitySchema = z
  .string()
  .transform(normalizeDigits)
  .pipe(z.string().regex(/^\d{1,15}(\.\d{1,3})?$/))
  .transform((s) => {
    const [whole, fraction = ''] = s.split('.')
    const tail = fraction.replace(/0+$/, '')
    return `${whole.replace(/^0+(?=\d)/, '')}${tail ? `.${tail}` : ''}`
  })
  .refine((s) => s !== '0')
export const dealerReturnInputSchema = z
  .strictObject({
    item_code: codeSchema({ allowSlash: true }),
    source_code: codeSchema(),
    location_code: codeSchema(),
    quantity: returnQuantitySchema,
    unit: z.enum(['EA', 'SET', 'L', 'KG']),
    requested_date: z.iso.date().refine((s) => !s.startsWith('0000')),
    condition: z.enum(returnConditions),
    reason: returnReasonSchema,
    sale_reference: text(200)
      .nullish()
      .transform((s) => s || null),
    confirmed: z.literal(true),
  })
  .refine((s) => s.source_code !== s.location_code, { path: ['location_code'] })
const identity = z.object({
  id: z.guid(),
  code: z.string(),
  name_en: z.string(),
  name_ar: z.string().nullable(),
})
export const dealerReturnReportSchema = z.object({
  method: z.literal('dealer-return-request-v1'),
  input: dealerReturnInputSchema,
  author: z.string().nullable(),
  item: identity.extend({ unit: z.string(), status: z.string() }),
  source: identity.extend({ location_type: z.literal('branch') }),
  receiver: identity.extend({ location_type: z.enum(['central', 'hub']) }),
})
export const dealerReturnListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [
    { param: 'status', column: 'status', kind: 'enum', values: ['requested', 'withdrawn'] },
  ],
} satisfies ListSpec
export function dealerReturnParams(raw: RawSearchParams) {
  return parseListParams({ ...raw, dir: 'desc' }, dealerReturnListSpec)
}
