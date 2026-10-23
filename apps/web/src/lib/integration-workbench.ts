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

export const dispositionIntegrationListSpec: ListSpec = {
  ...integrationListSpec,
  filters: [
    ...integrationListSpec
      .filters!.filter((filter) => filter.param !== 'supplier')
      .map((filter) =>
        filter.param === 'selection'
          ? { ...filter, values: ['current', 'historical', 'unavailable'] }
          : filter,
      ),
    {
      param: 'intent',
      column: 'disposition_kind',
      kind: 'enum',
      values: ['supplier_return', 'scrap'],
    },
  ],
}

export const networkIntegrationListSpec: ListSpec = {
  ...transferIntegrationListSpec,
  filters: transferIntegrationListSpec.filters!.map((filter) =>
    filter.param === 'location'
      ? { ...filter, param: 'branch', column: 'branch_codes' }
      : filter.param === 'selection'
        ? { ...filter, values: ['current', 'historical', 'unavailable'] }
        : filter,
  ),
}

export const regionalIntegrationListSpec: ListSpec = {
  ...transferIntegrationListSpec,
  filters: [
    ...transferIntegrationListSpec.filters.map((filter) =>
      filter.param === 'selection'
        ? { ...filter, values: ['current', 'historical', 'unavailable'] }
        : filter,
    ),
    { param: 'region', column: 'region_id', kind: 'uuid' },
  ],
}

export type IntegrationFamily =
  'purchase' | 'transfer' | 'event' | 'disposition' | 'network' | 'regional'

function integrationSpec(family: IntegrationFamily) {
  if (family === 'regional') return regionalIntegrationListSpec
  if (family === 'network') return networkIntegrationListSpec
  if (family === 'disposition') return dispositionIntegrationListSpec
  if (family === 'transfer') return transferIntegrationListSpec
  return integrationListSpec
}

export const integrationFamilies = {
  regional: {
    prefix: 'regional-stock/sourcing/',
    rpc: 'regional_integration_workbench',
    title: 'regionalTitle',
    context: 'regionalContext',
    navigation: 'regionalStock',
    link: 'regionalLink',
  },
  network: {
    prefix: 'network/',
    rpc: 'network_integration_workbench',
    title: 'networkTitle',
    context: 'networkContext',
    navigation: 'network',
    link: 'networkLink',
  },
  disposition: {
    prefix: 'excess/',
    rpc: 'excess_disposition_integration_workbench',
    title: 'dispositionTitle',
    context: 'dispositionContext',
    navigation: 'excess',
    link: 'dispositionLink',
  },
  purchase: {
    prefix: '',
    rpc: 'handoff_integration_workbench',
    title: 'title',
    context: 'context',
    navigation: 'integrations',
    link: 'purchaseLink',
  },
  transfer: {
    prefix: 'redistribution/',
    rpc: 'transfer_integration_workbench',
    title: 'transferTitle',
    context: 'transferContext',
    navigation: 'redistribution',
    link: 'transferLink',
  },
  event: {
    prefix: 'events/',
    rpc: 'event_purchase_integration_workbench',
    title: 'eventTitle',
    context: 'eventContext',
    navigation: 'eventIntegrations',
    link: 'eventLink',
  },
} as const

export function integrationPath(family: IntegrationFamily = 'purchase') {
  return `/replenishment/${integrationFamilies[family].prefix}integrations`
}

export function integrationParams(
  raw: RawSearchParams,
  family: IntegrationFamily = 'purchase',
): ListParams {
  const parsed = parseListParams(raw, integrationSpec(family))
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

export function integrationHref(
  params: ListParams,
  page: number,
  family: IntegrationFamily = 'purchase',
) {
  return listHref(integrationPath(family), integrationSpec(family), params, { page })
}

export const integrationResultSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  size: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  as_of: z.string(),
  rows: z
    .array(
      z.object({
        id: z.guid(),
        kind: z.enum(['handoff', 'batch']),
        created_at: z.string(),
        item_code: z.string().nullable(),
        supplier_code: z.string(),
        location_code: z.string(),
        line_count: z.number().int().positive(),
        selected: z.boolean(),
        event_id: z.guid().nullable(),
        external_system: z.string().nullable(),
        external_reference: z.string().nullable(),
        status: z.enum(['received', 'rejected', 'no_report']),
        reason: z.string().nullable(),
        recorded_at: z.string().nullable(),
        api_key_id: z.guid().nullable(),
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

export const eventIntegrationResultSchema = integrationResultSchema.extend({
  rows: z
    .array(integrationResultSchema.shape.rows.element.extend({ event_name: z.string().nullable() }))
    .max(100),
})

export const dispositionIntegrationResultSchema = integrationResultSchema.extend({
  rows: z
    .array(
      integrationResultSchema.shape.rows.element
        .omit({ supplier_code: true, selected: true })
        .extend({
          disposition_kind: z.enum(['supplier_return', 'scrap']),
          selection: z.enum(['current', 'historical', 'unavailable']),
        }),
    )
    .max(100),
})

export const networkIntegrationResultSchema = integrationResultSchema.extend({
  rows: z
    .array(
      integrationResultSchema.shape.rows.element
        .omit({ supplier_code: true, location_code: true, selected: true })
        .extend({
          source_code: z.string(),
          branch_codes: z.array(z.string()).min(1).max(1000),
          branch_row_count: z.number().int().min(1).max(1000),
          dispatch_date: z.iso.date(),
          selection: z.enum(['current', 'historical', 'unavailable']),
        }),
    )
    .max(100),
})

export const regionalIntegrationResultSchema = integrationResultSchema.extend({
  rows: z
    .array(
      integrationResultSchema.shape.rows.element
        .omit({ supplier_code: true, selected: true })
        .extend({
          region_id: z.guid(),
          region_name: z.string(),
          region_name_ar: z.string().nullable(),
          source_codes: z.array(z.string()).min(1).max(950),
          source_row_count: z.number().int().min(1).max(950),
          requested_date: z.iso.date(),
          selection: z.enum(['current', 'historical', 'unavailable']),
        }),
    )
    .max(100),
})

export function integrationEvidenceHref(
  row: { kind: 'handoff' | 'batch'; id: string },
  family: IntegrationFamily = 'purchase',
) {
  return `/replenishment/${integrationFamilies[family].prefix}${row.kind === 'batch' ? 'batches' : 'handoffs'}/${row.id}#acknowledgements`
}
