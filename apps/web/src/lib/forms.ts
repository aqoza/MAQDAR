/**
 * Shared state for Server Actions driven by `useActionState(action, idleState)`. Messages are
 * translated inside the action (`getTranslations`), so client components render them as given.
 * React resets uncontrolled inputs after an action: forms re-fill from `values` with `defaultValue`.
 */
export type ActionStatus = 'idle' | 'error' | 'success'

export type ActionState = {
  status: ActionStatus
  /** Translated message for the whole form (RPC or auth errors, success confirmations). */
  message?: string
  /** Translated message per field name. */
  fieldErrors?: Record<string, string>
  /** Submitted values to re-fill the form after an error. */
  values?: Record<string, string>
  /** Machine-readable cause (SQLSTATE, auth error code or validation issue) for tests and logging. */
  code?: string
}

export const idleState: ActionState = { status: 'idle' }

/** Picks the named fields from a FormData as trimmed strings (missing fields become ''). */
export function fieldValues(formData: FormData, names: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const name of names) {
    const value = formData.get(name)
    values[name] = typeof value === 'string' ? value.trim() : ''
  }
  return values
}

/** Base UI Switch and native checkboxes submit 'on' only when checked. */
export function checkboxValue(formData: FormData, name: string): boolean {
  return formData.get(name) === 'on'
}
