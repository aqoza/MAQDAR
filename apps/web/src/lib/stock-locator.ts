import { z } from 'zod'
import { codeSchema, dateSchema, ITEM_STATUSES, UNITS_OF_MEASURE } from './master-data/schemas'
import {
  firstParam,
  parseListParams,
  type ListSpec,
  type RawSearchParams,
} from './master-data/list-params'

export const stockLocatorPath = '/replenishment/stock-locator'
const scopeSchema = z.enum(['exact', 'interchangeable', 'substitutes'])
export const stockLocatorInputSchema = z.object({
  item: codeSchema({ allowSlash: true }),
  receiving: codeSchema(),
  unit: z.enum(UNITS_OF_MEASURE),
  day: dateSchema.refine((value) => value >= '0001-01-01'),
  scope: scopeSchema.default('exact'),
})
const listSpec: ListSpec = {
  sorts: ['distance'],
  defaultSort: 'distance',
  defaultDir: 'asc',
  tiebreak: 'code',
  search: true,
  filters: [
    { param: 'view', column: 'status', kind: 'enum', values: ['matching', 'other', 'all'] },
  ],
}
export function stockLocatorParams(raw: RawSearchParams, today: string) {
  const list = parseListParams(raw, listSpec)
  return {
    item: (firstParam(raw.item) ?? '').trim().slice(0, 65),
    receiving: (firstParam(raw.receiving) ?? '').trim().slice(0, 65),
    unit: firstParam(raw.unit) ?? '',
    day: firstParam(raw.day) ?? today,
    scope: firstParam(raw.scope) ?? 'exact',
    q: list.q.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' '),
    view: list.filters.view ?? 'matching',
    page: list.page,
    size: list.size,
  }
}
export type StockLocatorParams = ReturnType<typeof stockLocatorParams>
export function stockLocatorHref(params: StockLocatorParams, page: number) {
  const query = new URLSearchParams({
    item: params.item,
    receiving: params.receiving,
    unit: params.unit,
    day: params.day,
  })
  if (params.scope !== 'exact') query.set('scope', params.scope)
  if (params.q) query.set('q', params.q)
  if (params.view !== 'matching') query.set('view', params.view)
  if (params.size !== 25) query.set('size', String(params.size))
  if (page > 1) query.set('page', String(page))
  return `${stockLocatorPath}?${query}`
}
const named = z.object({
  id: z.uuid(),
  code: z.string(),
  name_en: z.string(),
  name_ar: z.string().nullable(),
})
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/)
export const stockLocatorResultSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  size: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  checked_at: z.string(),
  day: z.iso.date(),
  unit: z.enum(UNITS_OF_MEASURE),
  scope: scopeSchema,
  item_count: z.number().int().min(1).max(100),
  relationship_status: z.enum(['not_requested', 'ready', 'unit_mismatch']),
  item: named,
  receiving: named.extend({ latitude: z.number().nullable(), longitude: z.number().nullable() }),
  counts: z.object({
    matching: z.number().int().nonnegative(),
    other: z.number().int().nonnegative(),
  }),
  rows: z
    .array(
      named.extend({
        item: named.extend({
          status: z.enum(ITEM_STATUSES),
          unit: z.enum(UNITS_OF_MEASURE),
          updated_at: z.string(),
        }),
        match_kind: z.enum(['exact', 'interchangeable', 'substitute']),
        relationship_path: z
          .array(
            z.object({
              id: z.uuid(),
              direction: z.enum(['two_way', 'one_way']),
              from_code: z.string(),
              to_code: z.string(),
              unit: z.enum(UNITS_OF_MEASURE),
              priority: z.number().int().min(1).max(99),
              note: z.string().nullable().optional(),
              updated_at: z.string(),
              from_updated_at: z.string(),
              to_updated_at: z.string(),
            }),
          )
          .max(99),
        city: z.string().nullable(),
        country_code: z.string(),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        distance_km: z.number().nonnegative().nullable(),
        status: z.enum([
          'matching',
          'missing',
          'stale',
          'unit_unknown',
          'unit_mismatch',
          'no_stock',
        ]),
        snapshot: z
          .object({
            id: z.uuid(),
            date: z.iso.date(),
            updated_at: z.string(),
            age: z.number().int().nonnegative(),
            unit: z.enum(UNITS_OF_MEASURE).nullable(),
            quantity: decimal,
            allocated: decimal,
            net: decimal,
          })
          .nullable(),
        lane: z
          .object({
            id: z.uuid(),
            p50: z.number().int().nonnegative(),
            p90: z.number().int().nonnegative(),
            updated_at: z.string(),
          })
          .nullable(),
      }),
    )
    .max(100),
})
export type StockLocatorResult = z.infer<typeof stockLocatorResultSchema>
