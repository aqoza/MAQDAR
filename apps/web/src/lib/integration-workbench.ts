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

export function integrationParams(raw: RawSearchParams): ListParams {
  const parsed = parseListParams(raw, integrationListSpec)
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

export function integrationHref(params: ReturnType<typeof integrationParams>, page: number) {
  return listHref('/replenishment/integrations', integrationListSpec, params, { page })
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

export function integrationEvidenceHref(row: { kind: 'handoff' | 'batch'; id: string }) {
  return `/replenishment/${row.kind === 'batch' ? 'batches' : 'handoffs'}/${row.id}#acknowledgements`
}
