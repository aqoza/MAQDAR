import { z } from 'zod'
import { integerSchema, optionalDecimalSchema } from '../numbers'
import { optionalDateSchema, UNITS_OF_MEASURE, uuidSchema } from '../schemas'
import { defineEntity } from '../types'

/**
 * Transfer lanes between two locations: lead times in calendar days (p50 typical, p90 slow) and an
 * optional freight cost per unit or per shipment. locations.parent_location_id stays the default
 * replenishment source; lanes also describe alternate sources. One lane per ordered pair.
 */

export const FREIGHT_BASES = ['none', 'per_unit', 'per_shipment'] as const
export const LEAD_TIME_MAX_DAYS = 3650

const leadTimeSchema = integerSchema({ min: 0, max: LEAD_TIME_MAX_DAYS })

/** A location picked from a select: '' reports `required`. */
const locationIdSchema = z.string().trim().min(1).pipe(uuidSchema)

/** Optional ISO currency; '' becomes null. */
const optionalCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => (value === '' ? null : value))
  .pipe(
    z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
  )

export const networkLinkSchema = z
  .object({
    from_location_id: locationIdSchema,
    to_location_id: locationIdSchema,
    lead_time_days_p50: leadTimeSchema,
    lead_time_days_p90: leadTimeSchema,
    freight_basis: z.enum(FREIGHT_BASES),
    freight_cost: optionalDecimalSchema({ scale: 3, integerDigits: 12, min: 0 }),
    currency: optionalCurrencySchema,
    freight_unit: z
      .union([z.literal(''), z.enum(UNITS_OF_MEASURE)])
      .optional()
      .transform((value) => value || null),
    freight_valid_from: optionalDateSchema.optional().transform((value) => value ?? null),
    is_active: z.boolean(),
  })
  .superRefine((link, ctx) => {
    if (link.from_location_id === link.to_location_id) {
      ctx.addIssue({
        code: 'custom',
        message: 'mustDiffer',
        path: ['to_location_id'],
        params: { key: 'mustDiffer' },
      })
    }
    if (link.lead_time_days_p90 < link.lead_time_days_p50) {
      ctx.addIssue({
        code: 'custom',
        message: 'p90BelowP50',
        path: ['lead_time_days_p90'],
        params: { key: 'p90BelowP50' },
      })
    }
    if (link.freight_basis === 'none') return
    // A cost basis needs both an amount and its currency (network_links_freight_check).
    for (const field of ['freight_cost', 'currency'] as const) {
      if (link[field] === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'required',
          path: [field],
          params: { key: 'required' },
        })
      }
    }
  })

export type NetworkLinkInput = z.output<typeof networkLinkSchema>

/** The row to write: without a cost basis, cost and currency are stored as null. */
export function networkLinkRow(input: NetworkLinkInput): Record<string, unknown> {
  const unconfigured = input.freight_basis === 'none'
  return {
    ...input,
    freight_cost: unconfigured ? null : input.freight_cost,
    currency: unconfigured ? null : input.currency,
    freight_unit: unconfigured ? null : input.freight_unit,
    freight_valid_from: unconfigured ? null : input.freight_valid_from,
  }
}

// The from code is spread to the top level so the first column can link to the edit page; a
// second spread of locations in the same select is refused by PostgREST, so `to` stays an embed.
const FROM_CODE = '...locations!network_links_from_location_fkey(from_code:code)'

export const networkLinks = defineEntity({
  key: 'networkLinks',
  table: 'network_links',
  namespace: 'NetworkLinks',
  area: 'locations',
  tab: 'network',
  basePath: '/locations/network',
  importEntity: 'network_links',
  listSelect: `id, lead_time_days_p50, lead_time_days_p90, freight_basis, freight_cost, currency, is_active, ${FROM_CODE}, to_location:locations!network_links_to_location_fkey(code, name_en)`,
  editSelect: `id, from_location_id, to_location_id, lead_time_days_p50, lead_time_days_p90, freight_basis, freight_cost, currency, freight_unit, freight_valid_from, is_active, updated_at, ${FROM_CODE}, to_location:locations!network_links_to_location_fkey(code)`,
  list: {
    // Lanes number in the hundreds per organization; network_links_lane_key and
    // network_links_to_idx serve the location filters.
    sorts: ['lead_time_days_p50'],
    defaultSort: 'lead_time_days_p50',
    defaultDir: 'asc',
    tiebreak: 'id',
    filters: [
      { param: 'from', column: 'from_location_id', kind: 'uuid' },
      { param: 'to', column: 'to_location_id', kind: 'uuid' },
      { param: 'active', column: 'is_active', kind: 'boolean' },
    ],
    search: false,
  },
  filterOptions: { from: 'locations', to: 'locations' },
  columns: [
    { key: 'from', kind: 'code', field: 'from_code', link: true },
    { key: 'to', kind: 'ref', field: 'to_location' },
    { key: 'lead_time_days_p50', kind: 'integer', sortable: true },
    { key: 'lead_time_days_p90', kind: 'integer' },
    { key: 'freight_basis', kind: 'badge' },
    { key: 'freight_cost', kind: 'money', currencyField: 'currency' },
    { key: 'is_active', kind: 'boolean' },
  ],
  fields: [
    {
      name: 'from_location_id',
      kind: 'select',
      required: true,
      options: { source: 'locations' },
    },
    { name: 'to_location_id', kind: 'select', required: true, options: { source: 'locations' } },
    { name: 'lead_time_days_p50', kind: 'integer', required: true, hint: true },
    { name: 'lead_time_days_p90', kind: 'integer', required: true, hint: true },
    {
      name: 'freight_basis',
      kind: 'select',
      required: true,
      options: { source: 'enum', values: FREIGHT_BASES },
    },
    { name: 'freight_cost', kind: 'decimal', hint: true },
    { name: 'currency', kind: 'select', options: { source: 'currencies' }, hint: true },
    {
      name: 'freight_unit',
      kind: 'select',
      options: { source: 'enum', values: UNITS_OF_MEASURE },
      hint: true,
    },
    { name: 'freight_valid_from', kind: 'date', hint: true },
    { name: 'is_active', kind: 'switch' },
  ],
  schema: networkLinkSchema,
  toRow: (input) => ({ ok: true, row: networkLinkRow(input) }),
  defaults: () => ({ freight_basis: 'none', is_active: true }),
  titleOf: (row) => {
    const to = row.to_location as { code?: string } | null | undefined
    return `${String(row.from_code ?? '—')} → ${to?.code ?? '—'}`
  },
  constraintFields: {
    network_links_check: 'to_location_id',
    network_links_check1: 'lead_time_days_p90',
    network_links_lane_key: 'to_location_id',
    network_links_freight_check: 'freight_cost',
    network_links_from_location_fkey: 'from_location_id',
    network_links_to_location_fkey: 'to_location_id',
  },
})
