import { z } from 'zod'
import { countryCodeSchema, currencyCodeSchema } from '../organizations/schemas'
import { decimalSchema } from './numbers'

/**
 * Zod schemas for master-data forms. Inputs are the trimmed strings of a FormData (see
 * `src/lib/forms.ts`) plus booleans for switches, so every schema parses strings. Issues carry no
 * messages: `fieldErrorsFrom()` in src/lib/validation.ts translates them, and refinements name
 * their Validation key with `{ params: { key } }`. Database checks stay the authority; these
 * mirror them so users get a field message instead of a constraint error.
 *
 * Shared pieces live here; entity schemas may live here (items, brands) or next to their entity
 * definition. Imports stay relative: Vitest resolves no `@/` alias.
 */

export { countryCodeSchema, currencyCodeSchema }

export const NAME_MAX_LENGTH = 200
export const NOTE_MAX_LENGTH = 1000

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const ITEM_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/

/**
 * A natural key as the database checks it: starts with a letter or digit, then letters, digits,
 * `.`, `_`, `-` (and `/` for item codes), at most 64 characters. Case is kept.
 */
export function codeSchema(options: { allowSlash?: boolean } = {}) {
  const pattern = options.allowSlash ? ITEM_CODE_PATTERN : CODE_PATTERN
  const key = options.allowSlash ? 'itemCodeFormat' : 'codeFormat'
  return z
    .string()
    .trim()
    .min(1)
    .refine((value) => pattern.test(value), { params: { key } })
}

export const nameEnSchema = z.string().trim().min(1).max(NAME_MAX_LENGTH)

/** Optional Arabic name: '' becomes null (the database refuses empty strings). */
export const nameArSchema = z
  .string()
  .trim()
  .max(NAME_MAX_LENGTH)
  .transform((value) => (value === '' ? null : value))

/** Optional free text of at most `max` characters; '' becomes null. */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
}

export const noteSchema = optionalText(NOTE_MAX_LENGTH)

/** A calendar date as YYYY-MM-DD (what `<input type="date">` submits and PostgREST returns). */
export const dateSchema = z.string().trim().min(1).pipe(z.iso.date())

/** Optional date; '' becomes null. */
export const optionalDateSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .pipe(z.iso.date().nullable())

/** Optional reference picked from a select of ids; '' becomes null. */
export const optionalUuidSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value.toLowerCase()))
  .pipe(z.uuid().nullable())

export const uuidSchema = z.string().trim().toLowerCase().pipe(z.uuid())

/** Optional two-letter ISO country code (any code, not only the regional countries); '' → null. */
export const optionalCountryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => (value === '' ? null : value))
  .pipe(
    z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
  )

/** Money and quantities: numeric(18,3), at most 12 integer digits so values stay exact. */
export function moneySchema(bounds: { min?: number; greaterThan?: number } = { min: 0 }) {
  return decimalSchema({ scale: 3, integerDigits: 12, ...bounds })
}

/* ------------------------------------------------------------------------------------------ */
/* Items                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export const ITEM_STATUSES = ['new', 'active', 'phase_out', 'discontinued'] as const
export const UNITS_OF_MEASURE = ['EA', 'SET', 'L', 'KG'] as const
export const PRODUCT_GROUP_MAX_LENGTH = 64

export const itemSchema = z
  .object({
    code: codeSchema({ allowSlash: true }),
    name_en: nameEnSchema,
    name_ar: nameArSchema,
    brand_id: optionalUuidSchema,
    product_group: z.string().trim().min(1).max(PRODUCT_GROUP_MAX_LENGTH),
    unit_of_measure: z.enum(UNITS_OF_MEASURE),
    unit_cost: moneySchema(),
    currency: currencyCodeSchema,
    status: z.enum(ITEM_STATUSES),
    introduced_on: optionalDateSchema,
    discontinued_on: optionalDateSchema,
  })
  .refine(
    (item) =>
      !item.introduced_on || !item.discontinued_on || item.discontinued_on >= item.introduced_on,
    { path: ['discontinued_on'], params: { key: 'endBeforeStart' } },
  )

export type ItemInput = z.output<typeof itemSchema>

/* ------------------------------------------------------------------------------------------ */
/* Brands                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export const BRAND_TYPES = ['oem', 'aftermarket'] as const

export const brandSchema = z.object({
  code: codeSchema(),
  name_en: nameEnSchema,
  name_ar: nameArSchema,
  brand_type: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .pipe(z.enum(BRAND_TYPES).nullable()),
  country_of_origin: optionalCountryCodeSchema,
  is_active: z.boolean(),
})

export type BrandInput = z.output<typeof brandSchema>
