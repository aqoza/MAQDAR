import { z } from 'zod'
import { supplierResponseSchema } from './supplier-responses'
import {
  firstParam,
  listHref,
  parseListParams,
  type ListSpec,
  type RawSearchParams,
} from './master-data/list-params'

export const supplierWorkbenchPath = '/replenishment/supplier-responses'
export const supplierWorkbenchSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [
    ...(['supplier', 'location'] as const).map((param) => ({
      param,
      column: param,
      kind: 'pattern' as const,
      pattern: /^[^\u0000-\u001f\u007f]+$/,
    })),
    { param: 'kind', column: 'kind', kind: 'enum', values: ['handoff', 'batch'] },
    { param: 'state', column: 'state', kind: 'enum', values: ['published', 'withdrawn'] },
    {
      param: 'status',
      column: 'status',
      kind: 'enum',
      values: ['received', 'declined', 'no_response'],
    },
  ],
} satisfies ListSpec
export function supplierWorkbenchParams(raw: RawSearchParams) {
  return parseListParams(
    { ...raw, dir: 'desc', q: (firstParam(raw.q) ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ') },
    supplierWorkbenchSpec,
  )
}
export function supplierWorkbenchHref(
  params: ReturnType<typeof supplierWorkbenchParams>,
  page: number,
) {
  return listHref(supplierWorkbenchPath, supplierWorkbenchSpec, params, { page })
}
export const supplierWorkbenchRowSchema = z
  .strictObject({
    id: z.guid(),
    source_id: z.guid(),
    kind: z.enum(['handoff', 'batch']),
    created_at: z.string(),
    withdrawn_at: z.string().nullable(),
    supplier_code: z.string(),
    location_code: z.string(),
    item_codes: z.array(z.string()).min(1).max(50),
    line_count: z.number().int().min(1).max(50),
    state: z.enum(['published', 'withdrawn']),
    status: z.enum(['received', 'declined', 'no_response']),
    response: supplierResponseSchema.nullable(),
  })
  .refine(
    (r) =>
      r.status === (r.response?.status ?? 'no_response') &&
      r.state === (r.withdrawn_at ? 'withdrawn' : 'published') &&
      r.line_count === r.item_codes.length,
  )
export const supplierWorkbenchResultSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  size: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  as_of: z.string(),
  rows: z.array(supplierWorkbenchRowSchema).max(100),
})
export function supplierPublicationHref(
  row: Pick<z.infer<typeof supplierWorkbenchRowSchema>, 'source_id' | 'kind'>,
) {
  return `/replenishment/${row.kind === 'batch' ? 'batches' : 'handoffs'}/${row.source_id}/publish`
}
