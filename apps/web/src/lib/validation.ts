import { z } from 'zod'
import en from '../../messages/en.json'
import type { Messages } from '../i18n/messages'

/** Keys of the Validation message namespace (type-checked against en.json). */
export type ValidationKey = keyof Messages['Validation']

/**
 * Minimal translator shape, satisfied by next-intl's `getTranslations('Validation')` and by a stub
 * in unit tests. ICU arguments: `tooShort` and `minValue`/`greaterThan` take {min}, `tooLong`,
 * `maxValue`, `tooMany`, `tooManyDigits` and `precision` take {max}, `decimal` takes {scale}.
 */
export type ValidationTranslator = (
  key: ValidationKey,
  values?: Record<string, string | number>,
) => string

export type FieldErrors = { fieldErrors: Record<string, string> }

const VALIDATION_KEYS = new Set(Object.keys(en.Validation))

export function isValidationKey(value: unknown): value is ValidationKey {
  return typeof value === 'string' && VALIDATION_KEYS.has(value)
}

/** Fields whose format failure has a dedicated message; anything else gets `generic`. */
const FORMAT_KEYS: Record<string, ValidationKey> = {
  slug: 'slugFormat',
  email: 'invalidEmail',
  base_currency: 'currency',
  currency: 'currency',
  from_currency: 'currency',
  to_currency: 'currency',
  home_country: 'country',
  country: 'country',
  country_code: 'country',
  country_of_origin: 'country',
  code: 'codeFormat',
  timezone: 'timeZone',
  time_zone: 'timeZone',
}

/** String formats whose failure reads the same whatever the field. */
const FORMAT_BY_KIND: Partial<Record<string, ValidationKey>> = {
  email: 'invalidEmail',
  date: 'date',
  // A select of references (brand_id, location ids) submitted something that is not an id.
  uuid: 'invalidChoice',
  guid: 'invalidChoice',
}

/**
 * Picks the Validation key (and ICU values) for one zod issue. Exported for tests.
 *
 * - `too_small` / `too_big` read the origin: numbers report `minValue` / `greaterThan` /
 *   `maxValue`, arrays `required` / `tooMany`, strings `required` / `tooShort` / `tooLong`.
 * - `invalid_value` (z.enum) reports `invalidRole` for a field named `role`, else `invalidChoice`.
 * - `custom` (refinements and the number parsers) reports `params.key` when it names a Validation
 *   message, with `params.values` as its ICU arguments: `{ params: { key: 'endBeforeStart' } }`.
 */
export function validationKeyFor(issue: z.core.$ZodIssue): {
  key: ValidationKey
  values?: Record<string, string | number>
} {
  const field = issue.path.map(String).at(-1)
  switch (issue.code) {
    case 'too_small': {
      const minimum = Number(issue.minimum)
      if (issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint') {
        return issue.inclusive === false
          ? { key: 'greaterThan', values: { min: minimum } }
          : { key: 'minValue', values: { min: minimum } }
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return { key: 'required' }
      }
      return minimum <= 1 ? { key: 'required' } : { key: 'tooShort', values: { min: minimum } }
    }
    case 'too_big': {
      const maximum = Number(issue.maximum)
      if (issue.origin === 'number' || issue.origin === 'int' || issue.origin === 'bigint') {
        return { key: 'maxValue', values: { max: maximum } }
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return { key: 'tooMany', values: { max: maximum } }
      }
      return { key: 'tooLong', values: { max: maximum } }
    }
    case 'invalid_format':
      return { key: FORMAT_BY_KIND[issue.format] ?? formatKeyFor(field) }
    case 'invalid_value':
      // z.enum() and z.literal(): a missing or unknown option. zod 4 reports both as invalid_value.
      return { key: field === 'role' ? 'invalidRole' : 'invalidChoice' }
    case 'invalid_type':
      // Form data only ever yields strings or nothing, so a type mismatch means the field was absent
      // (zod 4 does not expose the received input unless parse() is called with reportInput).
      return { key: 'required' }
    case 'custom': {
      const key: unknown = issue.params?.key
      if (!isValidationKey(key)) return { key: 'generic' }
      const values = issue.params?.values as Record<string, string | number> | undefined
      return values ? { key, values } : { key }
    }
    default:
      // zod 3 used `invalid_string` for formats; keep the mapping for pasted-in legacy issues.
      if ((issue.code as string) === 'invalid_string') {
        return { key: formatKeyFor(field) }
      }
      return { key: 'generic' }
  }
}

function formatKeyFor(field: string | undefined): ValidationKey {
  return (field ? FORMAT_KEYS[field] : undefined) ?? 'generic'
}

/**
 * Turns a zod error into translated per-field messages for `ActionState.fieldErrors`. The first
 * issue of each field wins (checks run in declaration order, so `required` beats `slugFormat`).
 * Form-level issues (empty path) land under the `_form` key.
 */
export function fieldErrorsFrom(error: z.ZodError, t: ValidationTranslator): FieldErrors {
  const flattened = z.flattenError(error, (issue) => {
    const { key, values } = validationKeyFor(issue)
    return t(key, values)
  })
  const fieldErrors: Record<string, string> = {}
  for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
    const first = (messages as string[] | undefined)?.[0]
    if (first) fieldErrors[field] = first
  }
  if (flattened.formErrors[0]) fieldErrors._form = flattened.formErrors[0]
  return { fieldErrors }
}
