import { z } from 'zod'
import {
  firstParam,
  listHref,
  parseListParams,
  type ListParams,
  type ListSpec,
  type RawSearchParams,
} from './master-data/list-params'

export const integrationListSpec: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  search: true,
  filters: [
    { param: 'kind', column: 'kind', kind: 'enum', values: ['handoff', 'batch'] },
    { param: 'selection', column: 'selected', kind: 'enum', values: ['current', 'historical'] },
    {
      param: 'status',
      column: 'status',
      kind: 'enum',
      values: ['received', 'rejected', 'no_report'],
    },
    {
      param: 'supplier',
      column: 'supplier_code',
      kind: 'pattern',
      pattern: /^[^\u0000-\u001f\u007f-\u009f]+$/,
    },
    {
      param: 'location',
      column: 'location_code',
      kind: 'pattern',
      pattern: /^[^\u0000-\u001f\u007f-\u009f]+$/,
    },
    // The shared link builder serializes this filter; parsing below preserves exact label identity.
    { param: 'system', column: 'external_system', kind: 'pattern', pattern: /^.+$/ },
  ],
}

export const transferIntegrationListSpec: ListSpec = {
  ...integrationListSpec,
  filters: integrationListSpec.filters!.map((filter) =>
    filter.param === 'supplier' ? { ...filter, param: 'source', column: 'source_code' } : filter,
  ),
}

export function integrationPath(transfer = false) {
  return `/replenishment/${transfer ? 'redistribution/' : ''}integrations`
}

export function integrationParams(raw: RawSearchParams, transfer = false): ListParams {
  const parsed = parseListParams(raw, transfer ? transferIntegrationListSpec : integrationListSpec)
  const filters = Object.fromEntries(
    Object.entries(parsed.filters).filter(([key]) => key !== 'system'),
  )
  const system = firstParam(raw.system)
  const validSystem =
    !!system &&
    system.length <= 80 &&
    system.trim().length > 0 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(system)
  return {
    ...parsed,
    dir: 'desc' as const,
    q: parsed.q.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '),
    filters: { ...filters, ...(validSystem ? { system } : {}) },
  }
}

export function integrationHref(params: ListParams, page: number, transfer = false) {
  return listHref(
    integrationPath(transfer),
    transfer ? transferIntegrationListSpec : integrationListSpec,
    params,
    { page },
  )
}

export const integrationResultSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  size: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  as_of: z.string(),
  rows: z
    .array(
      z.object({
        id: z.uuid(),
        kind: z.enum(['handoff', 'batch']),
        created_at: z.string(),
        item_code: z.string().nullable(),
        supplier_code: z.string(),
        location_code: z.string(),
        line_count: z.number().int().positive(),
        selected: z.boolean(),
        event_id: z.uuid().nullable(),
        external_system: z.string().nullable(),
        external_reference: z.string().nullable(),
        status: z.enum(['received', 'rejected', 'no_report']),
        reason: z.string().nullable(),
        recorded_at: z.string().nullable(),
        api_key_id: z.uuid().nullable(),
        client_event_id: z.uuid().nullable(),
      }),
    )
    .max(100),
})

export const transferIntegrationResultSchema = integrationResultSchema.extend({
  rows: z
    .array(
      integrationResultSchema.shape.rows.element
        .omit({ supplier_code: true })
        .extend({ source_code: z.string() }),
    )
    .max(100),
})

export function integrationEvidenceHref(
  row: { kind: 'handoff' | 'batch'; id: string },
  transfer = false,
) {
  return `/replenishment/${transfer ? 'redistribution/' : ''}${row.kind === 'batch' ? 'batches' : 'handoffs'}/${row.id}#acknowledgements`
}
