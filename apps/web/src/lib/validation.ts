import { z } from 'zod'
import type { Messages } from '../i18n/messages'

/** Keys of the Validation message namespace (type-checked against en.json). */
export type ValidationKey = keyof Messages['Validation']

/**
 * Minimal translator shape, satisfied by next-intl's `getTranslations('Validation')` and by a stub
 * in unit tests. ICU arguments: `tooShort` takes {min}, `tooLong` takes {max}.
 */
export type ValidationTranslator = (
  key: ValidationKey,
  values?: Record<string, string | number>,
) => string

export type FieldErrors = { fieldErrors: Record<string, string> }

/** Fields whose format failure has a dedicated message; anything else gets `generic`. */
const FORMAT_KEYS: Record<string, ValidationKey> = {
  slug: 'slugFormat',
  email: 'invalidEmail',
  base_currency: 'currency',
  currency: 'currency',
  home_country: 'country',
  country: 'country',
}

/** Picks the Validation key (and ICU values) for one zod issue. Exported for tests. */
export function validationKeyFor(issue: z.core.$ZodIssue): {
  key: ValidationKey
  values?: Record<string, string | number>
} {
  const field = issue.path.map(String).at(-1)
  switch (issue.code) {
    case 'too_small': {
      const minimum = Number(issue.minimum)
      return minimum <= 1 ? { key: 'required' } : { key: 'tooShort', values: { min: minimum } }
    }
    case 'too_big':
      return { key: 'tooLong', values: { max: Number(issue.maximum) } }
    case 'invalid_format':
      if (issue.format === 'email') return { key: 'invalidEmail' }
      return { key: formatKeyFor(field) }
    case 'invalid_value':
      // z.enum(): a missing or unknown role. zod 4 reports both as invalid_value.
      return { key: 'invalidRole' }
    case 'invalid_type':
      // Form data only ever yields strings or nothing, so a type mismatch means the field was absent
      // (zod 4 does not expose the received input unless parse() is called with reportInput).
      return { key: 'required' }
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
