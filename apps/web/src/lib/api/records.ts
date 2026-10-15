import { getEntity, type ColumnKind, type EntityName } from '../imports/contract'
import { checkMapping, type ColumnMapping } from '../imports/mapping'
import { REQUEST_ERROR_TEXT, pointerToken, recordPointer, type RequestErrorCode } from './errors'
import { API_LIMITS, recordCap } from './limits'

/**
 * Request-shape checks of an upsert body, run in the Worker before any database call (approved
 * plan, decision 4): the envelope `{"records": [...]}`, the record count, one field set for every
 * record, unknown and key fields, column groups (through the wizard's `checkMapping`, with the
 * field names as a synthetic header), the demand value field and the JSON type of every value.
 * `app.api_check_fields` re-checks the same rules in SQL as a terse backstop; the 5a validators
 * then check every value. Pure module.
 *
 * JSON types per kind: string kinds take strings; `integer` takes an integral number or a string;
 * `decimal` and `money` take a number or a string; `boolean` takes true or false; `weekdays`
 * takes an array of integers. `null` and `""` are accepted for every kind (they clear a nullable
 * field and give `required` on a required one).
 */

/** Read-only fields of listed records, ignored when sent back (never part of the field set). */
export const IGNORED_FIELDS: ReadonlySet<string> = new Set(['updated_at'])

/**
 * Fields every record of the entity provides whether sent or not (absent means null): the
 * holiday override scope, because the natural key coalesces both.
 */
export const ALWAYS_PROVIDED: Readonly<Partial<Record<EntityName, readonly string[]>>> = {
  holiday_overrides: ['country_code', 'work_calendar_code'],
}

export type RequestIssue = {
  pointer: string
  record: number | null
  field: string | null
  code: RequestErrorCode
  detail: string
}

export type UpsertBodyCheck =
  | {
      ok: true
      /** The provided contract columns in contract order (what `import_files.columns` gets). */
      fields: string[]
      records: number
    }
  | { ok: false; code: 'too_many_records'; records: number; limit: number }
  | {
      ok: false
      code: 'invalid_request'
      errors: RequestIssue[]
      /** All issues found, also those beyond the 100 returned. */
      errorCount: number
      truncated: boolean
    }

export type UpsertBodyFailure = Exclude<UpsertBodyCheck, { ok: true }>

const TYPE_TEXT: Readonly<
  Record<'string' | 'integer' | 'number' | 'boolean' | 'weekdays', string>
> = {
  string: 'Expected a string (or null).',
  integer: 'Expected a whole number or a string (or null).',
  number: 'Expected a number or a string (or null).',
  boolean: 'Expected true or false (or null).',
  weekdays: 'Expected an array of whole numbers, ISO weekdays 1-7 (or null).',
}

function typeTextFor(kind: ColumnKind): string {
  switch (kind) {
    case 'integer':
      return TYPE_TEXT.integer
    case 'decimal':
    case 'money':
      return TYPE_TEXT.number
    case 'boolean':
      return TYPE_TEXT.boolean
    case 'weekdays':
      return TYPE_TEXT.weekdays
    default:
      return TYPE_TEXT.string
  }
}

/** Whether a JSON value is accepted for a column of the kind (decision 6). */
export function acceptsJsonValue(kind: ColumnKind, value: unknown): boolean {
  if (value === null || value === '') return true
  switch (kind) {
    case 'integer':
      return typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value))
    case 'decimal':
    case 'money':
      return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    case 'boolean':
      return typeof value === 'boolean'
    case 'weekdays':
      return (
        Array.isArray(value) &&
        value.every((day) => typeof day === 'number' && Number.isInteger(day))
      )
    default:
      return typeof value === 'string'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const NAME_CHARS = 64

function shortName(name: string): string {
  return name.length > NAME_CHARS ? `${name.slice(0, NAME_CHARS)}…` : name
}

function nameList(names: string[]): string {
  const shown = names.slice(0, 10).map(shortName)
  return names.length > shown.length ? `${shown.join(', ')}, …` : shown.join(', ')
}

class Issues {
  readonly list: RequestIssue[] = []
  count = 0

  add(issue: Omit<RequestIssue, 'detail'> & { detail?: string }) {
    this.count += 1
    if (this.list.length < API_LIMITS.requestErrors) {
      this.list.push({ ...issue, detail: issue.detail ?? REQUEST_ERROR_TEXT[issue.code] })
    }
  }

  failure(): UpsertBodyFailure {
    return {
      ok: false,
      code: 'invalid_request',
      errors: this.list,
      errorCount: this.count,
      truncated: this.count > this.list.length,
    }
  }
}

/** The fields of a record that count for the field set (ignored fields left out). */
function recordFields(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) => !IGNORED_FIELDS.has(key))
}

/**
 * Checks a parsed upsert body for `entity`. On success it returns the provided fields in contract
 * order and the record count; otherwise 413 `too_many_records` (checked before the records are
 * read) or 422 `invalid_request` with up to 100 issues, each with a JSON-pointer-style `pointer`.
 */
export function validateUpsertBody(entity: EntityName, parsed: unknown): UpsertBodyCheck {
  const contract = getEntity(entity)
  const issues = new Issues()

  if (!isPlainObject(parsed)) {
    issues.add({
      pointer: '#',
      record: null,
      field: null,
      code: 'not_an_object',
      detail: 'The body must be a JSON object: {"records": [...]}.',
    })
    return issues.failure()
  }
  for (const key of Object.keys(parsed)) {
    if (key === 'records') continue
    issues.add({
      pointer: `#/${pointerToken(key)}`,
      record: null,
      field: shortName(key),
      code: 'unknown_field',
      detail: 'The body takes only "records".',
    })
  }
  const records = parsed.records
  const cap = recordCap(entity)
  if (!Array.isArray(records) || records.length === 0) {
    issues.add({
      pointer: '#/records',
      record: null,
      field: null,
      code: 'missing_records',
      detail: `"records" must be an array of 1 to ${cap} records.`,
    })
    return issues.failure()
  }
  if (records.length > cap) {
    return { ok: false, code: 'too_many_records', records: records.length, limit: cap }
  }

  // The first object record defines the field set.
  let reference = -1
  records.forEach((record, index) => {
    if (isPlainObject(record)) {
      if (reference < 0) reference = index
      return
    }
    issues.add({ pointer: recordPointer(index), record: index, field: null, code: 'not_an_object' })
  })
  if (reference < 0) return issues.failure()
  const referenceRecord = records[reference] as Record<string, unknown>

  const columns = new Map(contract.columns.map((column) => [column.name, column]))
  const referenceFields = recordFields(referenceRecord)
  for (const field of referenceFields) {
    if (columns.has(field)) continue
    issues.add({
      pointer: recordPointer(reference, field),
      record: reference,
      field: shortName(field),
      code: 'unknown_field',
    })
  }

  // Key fields, column groups and the demand value field: the wizard's mapping rules.
  const provided = new Set([
    ...referenceFields.filter((field) => columns.has(field)),
    ...(ALWAYS_PROVIDED[entity] ?? []),
  ])
  const header = contract.columns.filter((column) => provided.has(column.name)).map((c) => c.name)
  const mapping: ColumnMapping = Object.fromEntries(
    header.map((column, index) => [column, { index, source: 'name' as const }]),
  )
  for (const issue of checkMapping(entity, header, mapping)) {
    if (issue.code === 'key_unmapped') {
      issues.add({
        pointer: recordPointer(reference, issue.column),
        record: reference,
        field: issue.column,
        code: 'missing_key_field',
        detail: `Every record must carry the key field ${issue.column}.`,
      })
    } else if (issue.code === 'group_incomplete') {
      for (const column of issue.missing) {
        issues.add({
          pointer: recordPointer(reference, column),
          record: reference,
          field: column,
          code: 'incomplete_group',
          detail: `Send ${issue.group.join(', ')} together or not at all.`,
        })
      }
    } else if (issue.code === 'value_column_required') {
      issues.add({
        pointer: recordPointer(reference),
        record: reference,
        field: null,
        code: 'value_field_required',
        detail: `Send ${issue.columns.join(', ')} or several of them.`,
      })
    }
  }

  // One field set: every record carries exactly the reference record's fields (the fields that
  // are always provided may differ: a holiday override names one side of its scope).
  const alwaysProvided = new Set(ALWAYS_PROVIDED[entity] ?? [])
  const comparable = (record: Record<string, unknown>) =>
    recordFields(record).filter((field) => !alwaysProvided.has(field))
  const referenceComparable = comparable(referenceRecord)
  const referenceSet = new Set(referenceComparable)
  records.forEach((record, index) => {
    if (index === reference || !isPlainObject(record)) return
    const fields = comparable(record)
    if (fields.length === referenceSet.size && fields.every((field) => referenceSet.has(field))) {
      return
    }
    const present = new Set(fields)
    const missing = referenceComparable.filter((field) => !present.has(field))
    const extra = fields.filter((field) => !referenceSet.has(field))
    const parts: string[] = []
    if (missing.length > 0) parts.push(`missing ${nameList(missing)}`)
    if (extra.length > 0) parts.push(`extra ${nameList(extra)}`)
    issues.add({
      pointer: recordPointer(index),
      record: index,
      field: null,
      code: 'inconsistent_fields',
      detail: `Every record must carry the same fields as record ${reference}: ${parts.join('; ')}.`,
    })
  })

  // JSON types.
  records.forEach((record, index) => {
    if (!isPlainObject(record)) return
    for (const [field, value] of Object.entries(record)) {
      const column = columns.get(field)
      if (!column || acceptsJsonValue(column.kind, value)) continue
      issues.add({
        pointer: recordPointer(index, field),
        record: index,
        field,
        code: 'invalid_type',
        detail: typeTextFor(column.kind),
      })
    }
  })

  if (issues.count > 0) return issues.failure()
  return { ok: true, fields: header, records: records.length }
}
