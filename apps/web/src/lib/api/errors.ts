import { CONTRACT } from '../imports/contract'

/**
 * English texts of the codes an API caller can meet in `errors[]` items: every error and warning
 * code of the import contract (the 5a validators answer with them) and the request-shape codes the
 * Worker checks before calling the database. The API speaks English machine codes; only Settings
 * is translated. Pure module.
 */

/** Codes of 422 `invalid_request` items (the Worker's shape checks and the SQL backstop). */
export const REQUEST_ERROR_CODES = [
  'missing_records',
  'not_an_object',
  'inconsistent_fields',
  'unknown_field',
  'missing_key_field',
  'incomplete_group',
  'value_field_required',
  'invalid_type',
  /** The database's shape backstop refused a record the Worker accepted. */
  'invalid_record',
] as const

export type RequestErrorCode = (typeof REQUEST_ERROR_CODES)[number]

export const REQUEST_ERROR_TEXT: Readonly<Record<RequestErrorCode, string>> = {
  missing_records: 'The body must be {"records": [...]} with at least one record.',
  not_an_object: 'Expected a JSON object.',
  inconsistent_fields: 'Every record must carry the same fields as the first record.',
  unknown_field: 'Not a field of this resource.',
  missing_key_field: 'A key field is missing; every record must carry the natural key.',
  incomplete_group: 'These fields are sent together or not at all.',
  value_field_required: 'Send quantity, lost_sales_quantity or both.',
  invalid_type: 'The JSON type is not accepted for this field.',
  invalid_record: 'The record does not follow the request rules.',
}

/** English text per contract error and warning code (`import_errors.code`). */
export const CONTRACT_ERROR_TEXT: Readonly<Record<string, string>> = {
  required: 'A value is required.',
  required_for_new: 'New records need this field; send it, or create the record in MAQDAR first.',
  too_long: 'The value is too long.',
  invalid_code:
    'Not a valid code: 1-64 letters, digits and . _ -, starting with a letter or digit.',
  invalid_item_code:
    'Not a valid part code: 1-64 letters, digits and . _ - /, starting with a letter or digit.',
  invalid_integer: 'Not a whole number.',
  invalid_decimal: 'Not a decimal number (use a dot as the decimal separator).',
  too_many_decimals: 'Too many decimal places.',
  too_many_digits: 'The number has too many digits.',
  out_of_range: 'The value is outside the allowed range.',
  invalid_date: 'Not a valid date (YYYY-MM-DD).',
  invalid_boolean: 'Use true or false.',
  invalid_enum: 'Not one of the allowed values.',
  invalid_weekdays: 'Use distinct ISO weekdays 1-7 (1 = Monday), at most six.',
  invalid_timezone: 'Not a known IANA time zone (for example Asia/Riyadh).',
  unknown_currency: 'Unknown currency code.',
  unknown_country: 'Unknown country code.',
  unknown_reference: 'No record has this code, in your data or in this request.',
  duplicate_key: 'This key appears more than once in the request.',
  end_before_start: 'The end date is before the start date.',
  p90_below_p50: 'The slow (p90) lead time is shorter than the typical (p50) one.',
  must_differ: 'The two codes must be different.',
  freight_mismatch:
    'With freight basis none there is no cost or currency; any other basis needs both.',
  country_required: 'A calendar that observes public holidays needs a country.',
  scope_exactly_one: 'Fill exactly one of country_code and work_calendar_code.',
  holiday_too_long: 'A holiday override lasts at most 366 days.',
  holiday_overlap: 'This overlaps another holiday override of the same country or calendar.',
  supersession_cycle: 'The supersessions would form a cycle.',
  location_cycle: 'The location parents would form a cycle.',
  preferred_conflict: 'Only one supplier per part may be preferred.',
  date_outside_history_window:
    'The date is outside the demand history window (see demand_window in GET /organization).',
  source_size_mismatch: 'The stored original file does not match the file that was read.',
  changed_during_commit: 'Your data changed between the check and the write; send it again.',
  concurrent_change: 'Someone changed the same data at the same time; send it again.',
  zero_row_new_key: 'Both quantities are 0 for a day without demand; the record was skipped.',
  source_missing: 'The original file was not stored.',
}

const FALLBACK_TEXT = 'The value was refused.'

/**
 * The English text of an error code, with the first occurrence for `duplicate_key` when the
 * database reported it (`first_record`, 0-based).
 */
export function errorText(code: string, firstRecord?: number | null): string {
  const text =
    (Object.hasOwn(REQUEST_ERROR_TEXT, code)
      ? REQUEST_ERROR_TEXT[code as RequestErrorCode]
      : CONTRACT_ERROR_TEXT[code]) ?? FALLBACK_TEXT
  if (code === 'duplicate_key' && typeof firstRecord === 'number' && firstRecord >= 0) {
    return `${text} First at record ${firstRecord}.`
  }
  return text
}

/** Contract codes of level `error`, as the OpenAPI document lists them. */
export function contractErrorCodes(level: 'error' | 'warning'): string[] {
  return CONTRACT.error_codes.filter((entry) => entry.level === level).map((entry) => entry.code)
}

/* ------------------------------------------------------------------------------------------ */
/* Pointers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** Characters that need no percent-encoding in a URI fragment (RFC 3986 pchar, `/` and `?`). */
const FRAGMENT_SAFE = /[A-Za-z0-9\-._~!$&'()*+,;=:@/?]/

/**
 * One JSON Pointer reference token (RFC 6901: `~` → `~0`, `/` → `~1`), percent-encoded for the
 * URI fragment form (`#/records/0/unit%20cost`).
 */
export function pointerToken(token: string): string {
  const escaped = token.replaceAll('~', '~0').replaceAll('/', '~1')
  let out = ''
  for (const character of escaped) {
    out += FRAGMENT_SAFE.test(character) ? character : encodeURIComponent(character)
  }
  return out
}

/**
 * The pointer of a record or one of its fields: `#/records`, `#/records/17`,
 * `#/records/17/unit_cost`. `record` is 0-based.
 */
export function recordPointer(record: number | null, field?: string | null): string {
  let pointer = '#/records'
  if (record !== null && Number.isInteger(record) && record >= 0) pointer += `/${record}`
  if (field) pointer += `/${pointerToken(field)}`
  return pointer
}

/**
 * The pointer of a stored import error, as `app.api_error_result` builds it: `row_no` is 1-based
 * (0 for a request-level error) and `column_name` is '' for a record-level error.
 */
export function pointerForRow(rowNo: number, columnName: string): string {
  return recordPointer(rowNo > 0 ? rowNo - 1 : null, columnName === '' ? null : columnName)
}

/** Pointers the API itself produces: `#`, `#/<member>` and the record forms above. */
export const POINTER_PATTERN = /^#(\/records(\/(0|[1-9][0-9]{0,6}))?(\/[a-z][a-z0-9_]{0,62})?)?$/
