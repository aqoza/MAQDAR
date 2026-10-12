import { ITEM_STATUSES, UNITS_OF_MEASURE, itemSchema } from '../schemas'
import { defineEntity } from '../types'

/** Service parts. The pattern the other master-data entities copy. */
export const items = defineEntity({
  key: 'items',
  table: 'items',
  namespace: 'Items',
  area: 'items',
  tab: 'items',
  basePath: '/items',
  listSelect:
    'id, code, name_en, name_ar, product_group, status, unit_cost, currency, brand:brands!items_brand_fkey(code, name_en)',
  editSelect:
    'id, code, name_en, name_ar, brand_id, product_group, unit_of_measure, unit_cost, currency, status, introduced_on, discontinued_on, updated_at',
  list: {
    // Indexes: items_organization_id_code_key, items_name_idx (name_en, code),
    // items_product_group_idx, items_status_idx (status, code), items_brand_idx (brand_id, code).
    sorts: ['code', 'name_en', 'product_group', 'status'],
    defaultSort: 'code',
    defaultDir: 'asc',
    tiebreak: 'code',
    filters: [
      { param: 'status', column: 'status', kind: 'enum', values: ITEM_STATUSES },
      { param: 'brand', column: 'brand_id', kind: 'uuid' },
    ],
    search: true,
  },
  filterOptions: { brand: 'brands' },
  columns: [
    { key: 'code', kind: 'code', sortable: true, link: true },
    { key: 'name', kind: 'name', sortable: true, sortBy: 'name_en' },
    { key: 'brand', kind: 'ref' },
    { key: 'product_group', kind: 'text', sortable: true },
    { key: 'status', kind: 'badge', sortable: true },
    { key: 'unit_cost', kind: 'money', currencyField: 'currency' },
  ],
  fields: [
    { name: 'code', kind: 'code', required: true, maxLength: 64, hint: true },
    {
      name: 'status',
      kind: 'select',
      required: true,
      options: { source: 'enum', values: ITEM_STATUSES },
    },
    { name: 'name_en', kind: 'text', required: true, maxLength: 200 },
    { name: 'name_ar', kind: 'nameAr', maxLength: 200 },
    { name: 'brand_id', kind: 'select', options: { source: 'brands' } },
    { name: 'product_group', kind: 'text', required: true, maxLength: 64 },
    {
      name: 'unit_of_measure',
      kind: 'select',
      required: true,
      options: { source: 'enum', values: UNITS_OF_MEASURE },
    },
    { name: 'unit_cost', kind: 'decimal', required: true, hint: true },
    { name: 'currency', kind: 'select', required: true, options: { source: 'currencies' } },
    { name: 'introduced_on', kind: 'date' },
    { name: 'discontinued_on', kind: 'date' },
  ],
  schema: itemSchema,
  toRow: (input) => ({ ok: true, row: { ...input } }),
  defaults: ({ organization }) => ({
    status: 'active',
    unit_of_measure: 'EA',
    currency: organization.base_currency,
  }),
  titleOf: (row) => String(row.code ?? ''),
  constraintFields: {
    items_brand_fkey: 'brand_id',
    items_check: 'discontinued_on',
  },
})
