import { numberInputValue } from './numbers'
import type { EntityRow, FieldDef, FormValue } from './types'

/**
 * Converting between stored rows, submitted FormData and the string values a form re-fills from
 * after an error (`ActionState.values`). Switches submit 'on' when checked; weekday checkboxes
 * submit one value per ticked day, kept as a comma-separated string in `ActionState.values`.
 *
 * Pure module, so Vitest can load it.
 */

/** Values a stored row gives each field of the form. */
export function formValuesFromRow(
  fields: readonly FieldDef[],
  row: EntityRow,
): Record<string, FormValue> {
  const values: Record<string, FormValue> = {}
  for (const field of fields) {
    const value = row[field.name]
    switch (field.kind) {
      case 'switch':
        values[field.name] = value === true
        break
      case 'integer':
      case 'decimal':
        values[field.name] = numberInputValue(value)
        break
      case 'weekdays':
        values[field.name] = Array.isArray(value) ? value.map(String) : []
        break
      default:
        values[field.name] = value === null || value === undefined ? '' : String(value)
    }
  }
  return values
}

/** The schema input from a submitted form: trimmed strings, booleans and string arrays. */
export function inputFromFormData(
  fields: readonly FieldDef[],
  formData: FormData,
): Record<string, FormValue> {
  const input: Record<string, FormValue> = {}
  for (const field of fields) {
    if (field.kind === 'switch') {
      input[field.name] = formData.get(field.name) === 'on'
    } else if (field.kind === 'weekdays') {
      input[field.name] = formData
        .getAll(field.name)
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
    } else {
      const value = formData.get(field.name)
      input[field.name] = typeof value === 'string' ? value.trim() : ''
    }
  }
  return input
}

/** Flattens form values to strings for `ActionState.values` (switch → 'on' | '', lists → a,b). */
export function submittedValues(values: Record<string, FormValue>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) {
    result[name] =
      typeof value === 'boolean'
        ? value
          ? 'on'
          : ''
        : Array.isArray(value)
          ? value.join(',')
          : value
  }
  return result
}
