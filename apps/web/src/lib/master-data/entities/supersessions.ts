import { z } from 'zod'
import { resolveItemCodeFields } from '../item-codes'
import { codeSchema, dateSchema, moneySchema, noteSchema, NOTE_MAX_LENGTH } from '../schemas'
import { defineEntity, type MasterDataErrorKey } from '../types'

/**
 * Supersessions: part B replaces part A from `effective_on`, with `quantity_factor` units of B per
 * unit of A. The form takes part codes; the database allows one successor per part
 * (item_supersessions_one_successor_key) and refuses cycles (MQ422, hint successor_item_code).
 */

export const supersessionSchema = z
  .object({
    predecessor_item_code: codeSchema({ allowSlash: true }),
    successor_item_code: codeSchema({ allowSlash: true }),
    effective_on: dateSchema,
    quantity_factor: moneySchema({ greaterThan: 0 }),
    note: noteSchema,
  })
  .refine((input) => input.predecessor_item_code !== input.successor_item_code, {
    path: ['successor_item_code'],
    params: { key: 'mustDiffer' },
  })

export type SupersessionInput = z.output<typeof supersessionSchema>

// The two embeds of items are spread through their foreign-key names: two spreads of the same
// table (`...items!a(…), ...items!b(…)`) collide in PostgREST's generated SQL.
const PREDECESSOR = 'item_supersessions_organization_id_predecessor_item_id_fkey'
const SUCCESSOR = 'item_supersessions_organization_id_successor_item_id_fkey'

export const supersessions = defineEntity({
  key: 'supersessions',
  table: 'item_supersessions',
  namespace: 'Supersessions',
  area: 'items',
  tab: 'supersessions',
  basePath: '/items/supersessions',
  listSelect: `id, effective_on, quantity_factor, ...${PREDECESSOR}(predecessor_code:code, predecessor_name:name_en), ...${SUCCESSOR}(successor_code:code, successor_name:name_en)`,
  editSelect: `id, effective_on, quantity_factor, note, updated_at, ...${PREDECESSOR}(predecessor_item_code:code), ...${SUCCESSOR}(successor_item_code:code)`,
  list: {
    // A few rows per part at most; the tenant scan plus a sort is cheap.
    sorts: ['effective_on'],
    defaultSort: 'effective_on',
    defaultDir: 'desc',
    tiebreak: 'id',
    filters: [],
    search: true,
  },
  itemSearchColumns: ['predecessor_item_id', 'successor_item_id'],
  columns: [
    { key: 'predecessor', kind: 'code', field: 'predecessor_code', link: true },
    { key: 'predecessor_name', kind: 'text' },
    { key: 'successor', kind: 'code', field: 'successor_code' },
    { key: 'successor_name', kind: 'text' },
    { key: 'effective_on', kind: 'date', sortable: true },
    { key: 'quantity_factor', kind: 'quantity' },
  ],
  fields: [
    { name: 'predecessor_item_code', kind: 'itemCode', required: true, hint: true },
    { name: 'successor_item_code', kind: 'itemCode', required: true, hint: true },
    { name: 'effective_on', kind: 'date', required: true },
    { name: 'quantity_factor', kind: 'decimal', required: true, hint: true },
    { name: 'note', kind: 'textarea', maxLength: NOTE_MAX_LENGTH },
  ],
  schema: supersessionSchema,
  toRow: async (input, ctx) => {
    const resolved = await resolveItemCodeFields(ctx, {
      predecessor_item_code: input.predecessor_item_code,
      successor_item_code: input.successor_item_code,
    })
    if (!resolved.ok) {
      return { ok: false, fieldErrors: resolved.fieldErrors as Record<string, MasterDataErrorKey> }
    }
    return {
      ok: true,
      row: {
        predecessor_item_id: resolved.ids.predecessor_item_code,
        successor_item_id: resolved.ids.successor_item_code,
        effective_on: input.effective_on,
        quantity_factor: input.quantity_factor,
        note: input.note,
      },
    }
  },
  defaults: () => ({ quantity_factor: '1' }),
  titleOf: (row) =>
    `${String(row.predecessor_item_code ?? '')} → ${String(row.successor_item_code ?? '')}`,
  constraintFields: {
    item_supersessions_one_successor_key: 'predecessor_item_code',
    item_supersessions_organization_id_predecessor_item_id_succ_key: 'predecessor_item_code',
    item_supersessions_organization_id_predecessor_item_id_fkey: 'predecessor_item_code',
    item_supersessions_organization_id_successor_item_id_fkey: 'successor_item_code',
    item_supersessions_check: 'successor_item_code',
  },
  hintMessages: { successor_item_code: 'cycle' },
})
