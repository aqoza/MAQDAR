import { z } from 'zod'
import { integerSchema } from '../numbers'
import {
  codeSchema,
  currencyCodeSchema,
  nameArSchema,
  nameEnSchema,
  optionalUuidSchema,
} from '../schemas'
import { defineEntity } from '../types'

/**
 * Suppliers: the companies parts are bought from, with their default currency, typical (p50) and
 * slow (p90) lead times in calendar days and an optional work calendar (none = the country
 * default). Supplier items reference them with ON DELETE CASCADE.
 */

const CURRENCY_PATTERN = /^[A-Z]{3}$/

export const supplierSchema = z
  .object({
    code: codeSchema(),
    name_en: nameEnSchema,
    name_ar: nameArSchema,
    // Any two-letter ISO code: suppliers ship from outside the trading region too, so the column
    // has no reference to the countries table.
    country_code: z
      .string()
      .trim()
      .min(1)
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    currency: z.string().trim().min(1).pipe(currencyCodeSchema),
    lead_time_days_p50: integerSchema({ min: 0 }),
    lead_time_days_p90: integerSchema({ min: 0 }),
    work_calendar_id: optionalUuidSchema,
    is_active: z.boolean(),
  })
  .refine((supplier) => supplier.lead_time_days_p90 >= supplier.lead_time_days_p50, {
    path: ['lead_time_days_p90'],
    params: { key: 'p90BelowP50' },
  })

export type SupplierInput = z.output<typeof supplierSchema>

export const suppliers = defineEntity({
  key: 'suppliers',
  table: 'suppliers',
  namespace: 'Suppliers',
  area: 'suppliers',
  tab: 'suppliers',
  basePath: '/suppliers',
  importEntity: 'suppliers',
  listSelect:
    'id, code, name_en, name_ar, country_code, currency, lead_time_days_p50, lead_time_days_p90, is_active, calendar:work_calendars!suppliers_work_calendar_fkey(code, name_en)',
  editSelect:
    'id, code, name_en, name_ar, country_code, currency, lead_time_days_p50, lead_time_days_p90, work_calendar_id, is_active, updated_at',
  list: {
    // Indexes: suppliers_organization_id_code_key, suppliers_name_idx (name_en, code). The lead
    // time sort reads the organization's suppliers (hundreds, not thousands) without an index.
    sorts: ['code', 'name_en', 'lead_time_days_p50'],
    defaultSort: 'code',
    defaultDir: 'asc',
    tiebreak: 'code',
    filters: [
      { param: 'currency', column: 'currency', kind: 'pattern', pattern: CURRENCY_PATTERN },
      { param: 'active', column: 'is_active', kind: 'boolean' },
    ],
    search: true,
  },
  filterOptions: { currency: 'currencies' },
  columns: [
    { key: 'code', kind: 'code', sortable: true, link: true },
    { key: 'name', kind: 'name', sortable: true, sortBy: 'name_en' },
    { key: 'country_code', kind: 'code' },
    { key: 'currency', kind: 'code' },
    { key: 'lead_time_days_p50', kind: 'integer', sortable: true },
    { key: 'lead_time_days_p90', kind: 'integer' },
    { key: 'calendar', kind: 'ref' },
    { key: 'is_active', kind: 'boolean' },
  ],
  fields: [
    { name: 'code', kind: 'code', required: true, maxLength: 64, hint: true },
    { name: 'country_code', kind: 'code', required: true, maxLength: 2, hint: true },
    { name: 'name_en', kind: 'text', required: true, maxLength: 200 },
    { name: 'name_ar', kind: 'nameAr', maxLength: 200 },
    { name: 'currency', kind: 'select', required: true, options: { source: 'currencies' } },
    {
      name: 'work_calendar_id',
      kind: 'select',
      options: { source: 'work_calendars' },
      hint: true,
    },
    { name: 'lead_time_days_p50', kind: 'integer', required: true, hint: true },
    { name: 'lead_time_days_p90', kind: 'integer', required: true, hint: true },
    { name: 'is_active', kind: 'switch', hint: true },
  ],
  schema: supplierSchema,
  toRow: (input) => ({ ok: true, row: { ...input } }),
  defaults: ({ organization }) => ({
    country_code: organization.home_country,
    currency: organization.base_currency,
    is_active: true,
  }),
  titleOf: (row) => String(row.code ?? ''),
  constraintFields: {
    suppliers_check: 'lead_time_days_p90',
    suppliers_work_calendar_fkey: 'work_calendar_id',
  },
})
