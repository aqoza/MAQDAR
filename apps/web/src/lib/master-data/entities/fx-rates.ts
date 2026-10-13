import { z } from 'zod'
import { formValuesFromRow } from '../form-values'
import { decimalSchema, numberInputValue } from '../numbers'
import { currencyCodeSchema, dateSchema, noteSchema, NOTE_MAX_LENGTH } from '../schemas'
import { defineEntity, type FieldDef } from '../types'

/**
 * Exchange rates of the organization: 1 from_currency = rate to_currency from valid_from until the
 * next row of the same pair. The rate is numeric(20,10), a ratio rather than money, so it keeps 10
 * fractional digits. A pair and its reverse cannot both exist for one date
 * (fx_rates_unordered_pair_date_key).
 */

const CURRENCY_PATTERN = /^[A-Z]{3}$/

/** A currency picked from the select; '' reports `required`. */
const requiredCurrencySchema = z.string().trim().min(1).pipe(currencyCodeSchema)

/** numeric(20,10): 10 integer and 10 fractional digits (and at most 15 significant, numbers.ts). */
export const RATE_FORMAT = { scale: 10, integerDigits: 10 } as const

export const fxRateSchema = z
  .object({
    from_currency: requiredCurrencySchema,
    to_currency: requiredCurrencySchema,
    valid_from: dateSchema,
    rate: decimalSchema({ ...RATE_FORMAT, greaterThan: 0 }),
    note: noteSchema,
  })
  .refine((rate) => rate.from_currency !== rate.to_currency, {
    path: ['to_currency'],
    params: { key: 'mustDiffer' },
  })

export type FxRateInput = z.output<typeof fxRateSchema>

/**
 * The stored rate as the edit input shows it. The edit query selects `rate::text`, so the exact
 * decimal arrives as a string ("3.6725000000"); trailing fractional zeros are dropped.
 */
export function rateInputValue(value: unknown): string {
  if (typeof value !== 'string') return numberInputValue(value)
  const text = value.trim()
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

const FIELDS = [
  { name: 'from_currency', kind: 'select', required: true, options: { source: 'currencies' } },
  { name: 'to_currency', kind: 'select', required: true, options: { source: 'currencies' } },
  { name: 'valid_from', kind: 'date', required: true, hint: true },
  { name: 'rate', kind: 'decimal', required: true, hint: true },
  { name: 'note', kind: 'textarea', maxLength: NOTE_MAX_LENGTH },
] as const satisfies readonly FieldDef[]

export const fxRates = defineEntity({
  key: 'fxRates',
  table: 'fx_rates',
  namespace: 'FxRates',
  area: 'suppliers',
  tab: 'fxRates',
  basePath: '/suppliers/fx-rates',
  importEntity: 'fx_rates',
  // The list shows the rate as a number with at most 10 decimals (the `rate` cell), which is exact
  // for every rate the form accepts (15 significant digits at most).
  listSelect: 'id, from_currency, to_currency, valid_from, rate, note',
  editSelect: 'id, from_currency, to_currency, valid_from, rate::text, note, updated_at',
  list: {
    // A few hundred rows per organization: the date sort needs no index of its own, and the
    // currency filters lead fx_rates_pair_date_key (from_currency, to_currency, valid_from).
    sorts: ['valid_from'],
    defaultSort: 'valid_from',
    defaultDir: 'desc',
    tiebreak: 'id',
    filters: [
      { param: 'from', column: 'from_currency', kind: 'pattern', pattern: CURRENCY_PATTERN },
      { param: 'to', column: 'to_currency', kind: 'pattern', pattern: CURRENCY_PATTERN },
    ],
    search: false,
  },
  filterOptions: { from: 'currencies', to: 'currencies' },
  columns: [
    { key: 'from_currency', kind: 'code', link: true },
    { key: 'to_currency', kind: 'code' },
    { key: 'valid_from', kind: 'date', sortable: true },
    { key: 'rate', kind: 'rate' },
    { key: 'note', kind: 'text' },
  ],
  fields: FIELDS,
  schema: fxRateSchema,
  toRow: (input) => ({ ok: true, row: { ...input } }),
  toForm: (row) => ({ ...formValuesFromRow(FIELDS, row), rate: rateInputValue(row.rate) }),
  defaults: ({ organization }) => ({ to_currency: organization.base_currency }),
  titleOf: (row) =>
    `${String(row.from_currency ?? '')} → ${String(row.to_currency ?? '')} · ${String(row.valid_from ?? '')}`,
  constraintFields: {
    fx_rates_check: 'to_currency',
    fx_rates_pair_date_key: 'valid_from',
    fx_rates_unordered_pair_date_key: 'valid_from',
  },
  constraintMessages: {
    fx_rates_unordered_pair_date_key: 'reverseRateExists',
  },
})
