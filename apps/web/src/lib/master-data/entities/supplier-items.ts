import { z } from 'zod'
import { resolveItemCodeFields } from '../item-codes'
import { integerSchema, optionalIntegerSchema } from '../numbers'
import {
  codeSchema,
  currencyCodeSchema,
  moneySchema,
  optionalDateSchema,
  optionalText,
} from '../schemas'
import {
  defineEntity,
  type EntityContext,
  type MasterDataErrorKey,
  type ToRowResult,
} from '../types'

/**
 * Supplier items: what each supplier sells, with its lead time, minimum order quantity, pack size
 * (order multiple) and price in the supplier's currency. One row per supplier and item, and at
 * most one preferred supplier per item (supplier_items_one_preferred_key): saving a row as
 * preferred first clears the item's previous preferred row.
 */

export const SUPPLIER_PART_NUMBER_MAX_LENGTH = 100

export const supplierItemSchema = z
  .object({
    supplier_id: z.string().trim().min(1).toLowerCase().pipe(z.uuid()),
    item_code: codeSchema({ allowSlash: true }),
    supplier_part_number: optionalText(SUPPLIER_PART_NUMBER_MAX_LENGTH),
    lead_time_days: integerSchema({ min: 0 }),
    lead_time_days_p90: optionalIntegerSchema({ min: 0 }),
    min_order_quantity: moneySchema(),
    pack_size: moneySchema({ greaterThan: 0 }),
    unit_price: moneySchema(),
    currency: z.string().trim().min(1).pipe(currencyCodeSchema),
    is_preferred: z.boolean(),
    valid_from: optionalDateSchema,
  })
  .refine(
    (input) =>
      input.lead_time_days_p90 === null || input.lead_time_days_p90 >= input.lead_time_days,
    { path: ['lead_time_days_p90'], params: { key: 'p90BelowP50' } },
  )

export type SupplierItemInput = z.output<typeof supplierItemSchema>

/**
 * Clears the item's current preferred row (another supplier's) before this row is saved as
 * preferred, so the one-preferred index does not refuse the save. PostgREST runs each request in
 * its own transaction, so this is a separate update; it is skipped when the save is bound to fail
 * anyway (this supplier already lists the item in another row, or the edited row changed since
 * the form was read), so a refused save does not leave the item without a preferred supplier.
 * Returns a field error, or null to go ahead.
 */
export async function clearPreviousPreferred(
  ctx: EntityContext,
  supplierId: string,
  itemId: string,
): Promise<Extract<ToRowResult, { ok: false }> | null> {
  const { supabase, organizationId } = ctx
  const id = ctx.id ?? null

  const { data: existing, error: existingError } = await supabase
    .from('supplier_items')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('supplier_id', supplierId)
    .eq('item_id', itemId)
    .maybeSingle()
    .retry(false)
  if (existingError) throw new Error(`clearPreviousPreferred failed: ${existingError.code}`)
  if (existing && existing.id !== id) return { ok: false, fieldErrors: { item_code: 'duplicate' } }

  if (id !== null) {
    const { data: current, error: currentError } = await supabase
      .from('supplier_items')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', id)
      .eq('updated_at', ctx.updatedAt ?? '')
      .maybeSingle()
      .retry(false)
    if (currentError) throw new Error(`clearPreviousPreferred failed: ${currentError.code}`)
    // Changed or deleted since the form was read: the update reports it and nothing is cleared.
    if (!current) return null
  }

  let clear = supabase
    .from('supplier_items')
    .update({ is_preferred: false })
    .eq('organization_id', organizationId)
    .eq('item_id', itemId)
    .eq('is_preferred', true)
  if (id !== null) clear = clear.neq('id', id)
  const { error } = await clear
  if (error) throw new Error(`clearPreviousPreferred failed: ${error.code}`)
  return null
}

const SUPPLIER = 'supplier_items_organization_id_supplier_id_fkey'
const ITEM = 'supplier_items_organization_id_item_id_fkey'

export const supplierItems = defineEntity({
  key: 'supplierItems',
  table: 'supplier_items',
  namespace: 'SupplierItems',
  area: 'suppliers',
  tab: 'supplierItems',
  basePath: '/suppliers/supplier-items',
  importEntity: 'supplier_items',
  listSelect: `id, supplier_part_number, lead_time_days, min_order_quantity, pack_size, unit_price, currency, is_preferred, ...${SUPPLIER}(supplier_code:code), ...${ITEM}(item_code:code, name_en, name_ar)`,
  editSelect: `id, supplier_id, supplier_part_number, lead_time_days, lead_time_days_p90, min_order_quantity, pack_size, unit_price, currency, is_preferred, valid_from, updated_at, ...${SUPPLIER}(supplier_code:code), ...${ITEM}(item_code:code)`,
  list: {
    // Default order follows supplier_items_organization_id_supplier_id_item_id_key (rows of one
    // supplier together; an incremental sort by id breaks ties).
    sorts: ['supplier_id', 'lead_time_days', 'unit_price'],
    defaultSort: 'supplier_id',
    defaultDir: 'asc',
    tiebreak: 'id',
    filters: [
      { param: 'supplier', column: 'supplier_id', kind: 'uuid' },
      { param: 'preferred', column: 'is_preferred', kind: 'boolean' },
    ],
    search: true,
  },
  itemSearchColumns: ['item_id'],
  filterOptions: { supplier: 'suppliers' },
  columns: [
    { key: 'supplier', kind: 'code', field: 'supplier_code' },
    { key: 'item', kind: 'code', field: 'item_code', link: true },
    { key: 'name', kind: 'name' },
    { key: 'supplier_part_number', kind: 'code' },
    { key: 'lead_time_days', kind: 'integer', sortable: true },
    { key: 'min_order_quantity', kind: 'quantity' },
    { key: 'pack_size', kind: 'quantity' },
    { key: 'unit_price', kind: 'money', currencyField: 'currency', sortable: true },
    { key: 'is_preferred', kind: 'boolean' },
  ],
  fields: [
    { name: 'supplier_id', kind: 'select', required: true, options: { source: 'suppliers' } },
    { name: 'item_code', kind: 'itemCode', required: true },
    {
      name: 'supplier_part_number',
      kind: 'code',
      maxLength: SUPPLIER_PART_NUMBER_MAX_LENGTH,
    },
    { name: 'valid_from', kind: 'date', hint: true },
    { name: 'lead_time_days', kind: 'integer', required: true, hint: true },
    { name: 'lead_time_days_p90', kind: 'integer', hint: true },
    { name: 'min_order_quantity', kind: 'decimal', required: true, hint: true },
    { name: 'pack_size', kind: 'decimal', required: true, hint: true },
    { name: 'unit_price', kind: 'decimal', required: true, hint: true },
    { name: 'currency', kind: 'select', required: true, options: { source: 'currencies' } },
    { name: 'is_preferred', kind: 'switch', hint: true, wide: true },
  ],
  schema: supplierItemSchema,
  toRow: async (input, ctx) => {
    const resolved = await resolveItemCodeFields(ctx, { item_code: input.item_code })
    if (!resolved.ok) {
      return { ok: false, fieldErrors: resolved.fieldErrors as Record<string, MasterDataErrorKey> }
    }
    const itemId = resolved.ids.item_code
    if (itemId === null) return { ok: false, fieldErrors: { item_code: 'unknownItem' } }
    if (input.is_preferred) {
      const refused = await clearPreviousPreferred(ctx, input.supplier_id, itemId)
      if (refused) return refused
    }
    return {
      ok: true,
      row: {
        supplier_id: input.supplier_id,
        item_id: itemId,
        supplier_part_number: input.supplier_part_number,
        lead_time_days: input.lead_time_days,
        lead_time_days_p90: input.lead_time_days_p90,
        min_order_quantity: input.min_order_quantity,
        pack_size: input.pack_size,
        unit_price: input.unit_price,
        currency: input.currency,
        is_preferred: input.is_preferred,
        valid_from: input.valid_from,
      },
    }
  },
  defaults: ({ organization }) => ({
    min_order_quantity: '0',
    pack_size: '1',
    currency: organization.base_currency,
    is_preferred: false,
  }),
  titleOf: (row) => `${String(row.supplier_code ?? '')} · ${String(row.item_code ?? '')}`,
  constraintFields: {
    supplier_items_organization_id_supplier_id_item_id_key: 'item_code',
    supplier_items_organization_id_item_id_fkey: 'item_code',
    supplier_items_one_preferred_key: 'is_preferred',
    supplier_items_check: 'lead_time_days_p90',
  },
})
