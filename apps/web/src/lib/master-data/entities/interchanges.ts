import { z } from 'zod'
import { resolveItemCodeFields } from '../item-codes'
import { integerSchema } from '../numbers'
import { codeSchema, noteSchema, NOTE_MAX_LENGTH } from '../schemas'
import { defineEntity, type MasterDataErrorKey } from '../types'

/**
 * Interchanges: pairs of parts that may be issued for each other. `one_way` lets the alternate be
 * issued when the item is requested (never the reverse), `two_way` both ways; priority 1 is tried
 * first. One row per unordered pair (item_interchanges_pair_key on least/greatest), so a pair and
 * its reverse cannot both exist.
 */

export const INTERCHANGE_DIRECTIONS = ['one_way', 'two_way'] as const

export const interchangeSchema = z
  .object({
    item_code: codeSchema({ allowSlash: true }),
    alternate_item_code: codeSchema({ allowSlash: true }),
    direction: z.enum(INTERCHANGE_DIRECTIONS),
    priority: integerSchema({ min: 1, max: 99 }),
    note: noteSchema,
  })
  .refine((input) => input.item_code !== input.alternate_item_code, {
    path: ['alternate_item_code'],
    params: { key: 'mustDiffer' },
  })

export type InterchangeInput = z.output<typeof interchangeSchema>

const ITEM = 'item_interchanges_item_fkey'
const ALTERNATE = 'item_interchanges_alternate_item_fkey'

export const interchanges = defineEntity({
  key: 'interchanges',
  table: 'item_interchanges',
  namespace: 'Interchanges',
  area: 'items',
  tab: 'interchanges',
  basePath: '/items/interchanges',
  // Spread through the foreign-key names (two spreads of `items` would collide in PostgREST).
  listSelect: `id, direction, priority, ...${ITEM}(item_code:code, item_name:name_en), ...${ALTERNATE}(alternate_code:code, alternate_name:name_en)`,
  editSelect: `id, direction, priority, note, updated_at, ...${ITEM}(item_code:code), ...${ALTERNATE}(alternate_item_code:code)`,
  list: {
    sorts: ['priority'],
    defaultSort: 'priority',
    defaultDir: 'asc',
    tiebreak: 'id',
    filters: [
      { param: 'direction', column: 'direction', kind: 'enum', values: INTERCHANGE_DIRECTIONS },
    ],
    search: true,
  },
  itemSearchColumns: ['item_id', 'alternate_item_id'],
  columns: [
    { key: 'item', kind: 'code', field: 'item_code', link: true },
    { key: 'item_name', kind: 'text' },
    { key: 'alternate', kind: 'code', field: 'alternate_code' },
    { key: 'alternate_name', kind: 'text' },
    { key: 'direction', kind: 'badge' },
    { key: 'priority', kind: 'integer', sortable: true },
  ],
  fields: [
    { name: 'item_code', kind: 'itemCode', required: true },
    { name: 'alternate_item_code', kind: 'itemCode', required: true, hint: true },
    {
      name: 'direction',
      kind: 'select',
      required: true,
      hint: true,
      options: { source: 'enum', values: INTERCHANGE_DIRECTIONS },
    },
    { name: 'priority', kind: 'integer', required: true, hint: true },
    { name: 'note', kind: 'textarea', maxLength: NOTE_MAX_LENGTH },
  ],
  schema: interchangeSchema,
  toRow: async (input, ctx) => {
    const resolved = await resolveItemCodeFields(ctx, {
      item_code: input.item_code,
      alternate_item_code: input.alternate_item_code,
    })
    if (!resolved.ok) {
      return { ok: false, fieldErrors: resolved.fieldErrors as Record<string, MasterDataErrorKey> }
    }
    return {
      ok: true,
      row: {
        item_id: resolved.ids.item_code,
        alternate_item_id: resolved.ids.alternate_item_code,
        direction: input.direction,
        priority: input.priority,
        note: input.note,
      },
    }
  },
  defaults: () => ({ direction: 'two_way', priority: '1' }),
  titleOf: (row) =>
    `${String(row.item_code ?? '')} ${row.direction === 'one_way' ? '→' : '⇄'} ${String(row.alternate_item_code ?? '')}`,
  constraintFields: {
    item_interchanges_pair_key: 'alternate_item_code',
    item_interchanges_item_fkey: 'item_code',
    item_interchanges_alternate_item_fkey: 'alternate_item_code',
    item_interchanges_check: 'alternate_item_code',
  },
})
