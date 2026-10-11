import { BRAND_TYPES, brandSchema } from '../schemas'
import { defineEntity } from '../types'

/** Makes and aftermarket brands; items reference them through items_brand_fkey (NO ACTION). */
export const brands = defineEntity({
  key: 'brands',
  table: 'brands',
  namespace: 'Brands',
  area: 'items',
  tab: 'brands',
  basePath: '/items/brands',
  listSelect: 'id, code, name_en, name_ar, brand_type, country_of_origin, is_active',
  editSelect: 'id, code, name_en, name_ar, brand_type, country_of_origin, is_active, updated_at',
  list: {
    // Indexes: brands_organization_id_code_key, brands_name_idx (name_en, code).
    sorts: ['code', 'name_en'],
    defaultSort: 'code',
    defaultDir: 'asc',
    tiebreak: 'code',
    filters: [
      { param: 'brand_type', column: 'brand_type', kind: 'enum', values: BRAND_TYPES },
      { param: 'active', column: 'is_active', kind: 'boolean' },
    ],
    search: true,
  },
  columns: [
    { key: 'code', kind: 'code', sortable: true, link: true },
    { key: 'name', kind: 'name', sortable: true, sortBy: 'name_en' },
    { key: 'brand_type', kind: 'badge' },
    { key: 'country_of_origin', kind: 'code' },
    { key: 'is_active', kind: 'boolean' },
  ],
  fields: [
    { name: 'code', kind: 'code', required: true, maxLength: 64, hint: true },
    { name: 'brand_type', kind: 'select', options: { source: 'enum', values: BRAND_TYPES } },
    { name: 'name_en', kind: 'text', required: true, maxLength: 200 },
    { name: 'name_ar', kind: 'nameAr', maxLength: 200 },
    { name: 'country_of_origin', kind: 'code', maxLength: 2, hint: true },
    { name: 'is_active', kind: 'switch', hint: true },
  ],
  schema: brandSchema,
  toRow: (input) => ({ ok: true, row: { ...input } }),
  defaults: () => ({ is_active: true }),
  titleOf: (row) => String(row.code ?? ''),
})
