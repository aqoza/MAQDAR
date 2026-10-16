import { z } from 'zod'
import { comparisonSchema } from './stock-comparison'
import { normalizeDigits } from './master-data/numbers'
import { parseListParams, type ListSpec, type RawSearchParams } from './master-data/list-params'

export const replenishmentStatuses = [
  'available',
  'policy_unavailable',
  'prepared_group',
  'group_not_interchangeable',
  'date_mismatch',
  'policy_unit_unknown',
  'stock_missing',
  'stock_stale',
  'stock_unit_unknown',
  'unit_mismatch',
  'stock_date_mismatch',
  'inbound_limit',
  'inbound_unit_unknown',
  'inbound_unit_mismatch',
  'orders_unconfirmed',
  'quantity_out_of_range',
] as const
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/)
const quantity = z
  .string()
  .transform(normalizeDigits)
  .pipe(z.string().regex(/^\d{1,15}(\.\d{1,3})?$/))
const selection = z.object({
  policy: z.uuid(),
  basis: z.enum(['calculated', 'approved']),
  override: z.uuid().optional(),
})
const explicitBasis = (v: z.infer<typeof selection>) =>
  (v.basis === 'approved') === Boolean(v.override)
export const draftSelectionSchema = selection.refine(explicitBasis)
export const draftInputSchema = selection
  .extend({
    backorders: quantity,
    confirmed: z.enum(['true', 'false']),
  })
  .refine(explicitBasis)
export const draftSaveSchema = selection
  .extend({
    backorders: quantity,
    confirmed: z.enum(['true', 'false']),
    request_id: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .refine(explicitBasis)
export function draftParams(raw: RawSearchParams) {
  const first = (key: string) => (Array.isArray(raw[key]) ? raw[key][0] : raw[key])
  return {
    policy: first('policy'),
    basis: first('basis'),
    override: first('override') || undefined,
    backorders: first('backorders'),
    confirmed: first('confirmed') ?? 'false',
  }
}
export const replenishmentReportSchema = z.object({
  method: z.literal('replenishment-gap-v1'),
  status: z.enum(replenishmentStatuses),
  policy: comparisonSchema,
  location_id: z.uuid(),
  protection_end: z.iso.date().nullable(),
  backorders: decimal,
  orders_confirmed: z.boolean(),
  orders_truncated: z.boolean(),
  inbound_quantity: decimal.nullable(),
  inventory_position: decimal.nullable(),
  gap: decimal.nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  orders: z
    .array(
      z.object({
        id: z.uuid(),
        order_code: z.string(),
        line_code: z.string(),
        supplier_id: z.uuid(),
        supplier_code: z.string().nullable(),
        expected_date: z.iso.date(),
        quantity: decimal,
        unit: z.string().nullable(),
        updated_at: z.string(),
        overdue: z.boolean(),
        late: z.boolean().nullable(),
      }),
    )
    .max(1000),
})
export type ReplenishmentReport = z.infer<typeof replenishmentReportSchema>
export const draftListSpec: ListSpec = {
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
    { param: 'status', column: 'status', kind: 'enum', values: replenishmentStatuses },
  ],
}
export const draftListParams = (raw: RawSearchParams) => parseListParams(raw, draftListSpec)
