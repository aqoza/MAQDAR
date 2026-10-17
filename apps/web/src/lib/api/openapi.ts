import {
  CONTRACT,
  getEntity,
  type ContractColumn,
  type ContractEntity,
  type EntityName,
} from '../imports/contract'
import { SCOPE_DESCRIPTIONS, API_SCOPES, scopeFor } from './auth'
import { DEMAND_PARAMETERS, MASTER_PARAMETERS } from './cursor'
import { EXAMPLES } from './examples'
import { REQUEST_ERROR_CODES, contractErrorCodes } from './errors'
import { API_KEY_PREFIX } from './keys'
import { API_LIMITS, isTransactionEntity, listLimits, recordCap } from './limits'
import { COUNT_KEYS, PROBLEM_CODES, PROBLEMS } from './problem'
import { ALWAYS_PROVIDED } from './records'
import {
  API_BASE_PATH,
  API_DOCS_URL,
  ORGANIZATION_OPERATION_ID,
  RESOURCES,
  operationId,
  pascalCase,
  resourceForEntity,
  resourcePath,
  type ApiResource,
} from './resources'
import { OPENAPI_DOCUMENT_VERSION, deprecationFor } from './versioning'
import { handoffPaths, handoffSchemas } from './handoff-openapi'
import { acknowledgementPaths, acknowledgementSchemas } from './acknowledgement-openapi'

/**
 * The OpenAPI 3.1.1 document of `/api/v1`, generated from the import contract
 * (`@maqdar/shared/import-format.schema.json`), the resources, limits, problems, versioning and
 * examples of `src/lib/api`. It is committed as `openapi.json` and pinned by a Vitest file
 * snapshot: run `pnpm --filter web gen:openapi` after changing any of them. Pure module.
 */

export type Schema = Record<string, unknown>

export type OpenApiDocument = {
  openapi: string
  info: Schema
  servers: Schema[]
  security: Schema[]
  tags: Schema[]
  paths: Record<string, Record<string, Schema>>
  components: {
    securitySchemes: Record<string, Schema>
    parameters: Record<string, Schema>
    headers: Record<string, Schema>
    responses: Record<string, Schema>
    schemas: Record<string, Schema>
  }
  [extension: `x-${string}`]: unknown
}

export const OPENAPI_VERSION = '3.1.1'

const TAGS = {
  organization: 'Organization',
  master_data: 'Master data',
  transactions: 'Transactions',
} as const

const ref = (kind: 'schemas' | 'parameters' | 'responses' | 'headers', name: string) => ({
  $ref: `#/components/${kind}/${name}`,
})

/** Schema names of an entity. */
export function schemaNames(entity: EntityName) {
  const base = pascalCase(entity)
  return {
    record: `${base}Record`,
    upsert: `${base}Upsert`,
    request: `${base}UpsertRequest`,
    page: `${base}Page`,
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Column schemas                                                                               */
/* ------------------------------------------------------------------------------------------ */

/** Whether the column's numbers can be negative (no lower bound at or above 0). */
function allowsNegative(column: ContractColumn): boolean {
  if (column.min_value !== null && column.min_value >= 0) return false
  if (column.greater_than !== null && column.greater_than >= 0) return false
  return true
}

function sign(column: ContractColumn): string {
  return allowsNegative(column) ? '-?' : ''
}

/** Integer digits allowed for a numeric column (the contract's, 9 for integers without one). */
function integerDigits(column: ContractColumn): number {
  return column.integer_digits ?? 9
}

/** A decimal string within the column's digits and scale (request form). */
function decimalRequestPattern(column: ContractColumn): string {
  const digits = integerDigits(column)
  const scale = column.scale ?? 0
  const fraction = scale > 0 ? `(\\.[0-9]{1,${scale}})?` : ''
  return `^${sign(column)}(0|[1-9][0-9]{0,${digits - 1}})${fraction}$`
}

/** The canonical decimal string lists return (`trim_scale`: no trailing zeros, no bare dot). */
function decimalResponsePattern(column: ContractColumn): string {
  const digits = integerDigits(column)
  const scale = column.scale ?? 0
  const fraction = scale > 0 ? `(\\.[0-9]{0,${scale - 1}}[1-9])?` : ''
  return `^${sign(column)}(0|[1-9][0-9]{0,${digits - 1}})${fraction}$`
}

function integerBounds(column: ContractColumn): Schema {
  const limit = 10 ** integerDigits(column) - 1
  return {
    minimum: column.min_value ?? (column.greater_than !== null ? column.greater_than + 1 : -limit),
    maximum: column.max_value ?? limit,
  }
}

function decimalNumberBounds(column: ContractColumn): Schema {
  const limit = 10 ** integerDigits(column)
  const bounds: Schema = {}
  if (column.min_value !== null) bounds.minimum = column.min_value
  if (column.greater_than !== null) bounds.exclusiveMinimum = column.greater_than
  if (column.min_value === null && column.greater_than === null) bounds.exclusiveMinimum = -limit
  if (column.max_value !== null) bounds.maximum = column.max_value
  else bounds.exclusiveMaximum = limit
  return bounds
}

function stringSchema(column: ContractColumn, required: boolean): Schema {
  const schema: Schema = { type: 'string' }
  if (column.pattern) schema.pattern = column.pattern
  if (column.max_length !== null) schema.maxLength = column.max_length
  if (required && !column.pattern) schema.minLength = 1
  return schema
}

const WEEKDAYS: Schema = {
  type: 'array',
  items: { type: 'integer', minimum: 1, maximum: 7 },
  uniqueItems: true,
  maxItems: 6,
}

/** The value schema of a column in a request (non-null form). */
function requestValueSchema(column: ContractColumn): Schema {
  switch (column.kind) {
    case 'integer':
      return {
        oneOf: [
          { type: 'integer', ...integerBounds(column) },
          {
            type: 'string',
            pattern: `^${sign(column)}(0|[1-9][0-9]{0,${integerDigits(column) - 1}})$`,
          },
        ],
      }
    case 'decimal':
    case 'money':
      return {
        oneOf: [
          { type: 'number', ...decimalNumberBounds(column) },
          { type: 'string', pattern: decimalRequestPattern(column) },
        ],
      }
    case 'boolean':
      return { type: 'boolean' }
    case 'weekdays':
      return { ...WEEKDAYS }
    case 'enum':
      return { type: 'string', enum: [...(column.enum ?? [])] }
    case 'date':
      return { type: 'string', format: 'date', pattern: column.pattern }
    default:
      return stringSchema(column, column.required)
  }
}

/** The value schema of a column in a listed record (non-null form). */
function responseValueSchema(column: ContractColumn): Schema {
  switch (column.kind) {
    case 'integer':
      return { type: 'integer', ...integerBounds(column) }
    case 'decimal':
    case 'money':
      return { type: 'string', pattern: decimalResponsePattern(column) }
    case 'boolean':
      return { type: 'boolean' }
    case 'weekdays':
      return { ...WEEKDAYS }
    case 'enum':
      return { type: 'string', enum: [...(column.enum ?? [])] }
    case 'date':
      return { type: 'string', format: 'date' }
    default:
      return stringSchema(column, column.required)
  }
}

/** A request schema that also accepts null and "" (both clear a nullable field). */
function clearable(schema: Schema): Schema {
  if (Array.isArray(schema.oneOf)) {
    return { ...schema, oneOf: [...schema.oneOf, { type: 'null' }, { const: '' }] }
  }
  // Plain text without a pattern or minimum length already accepts "".
  if (schema.type === 'string' && !schema.pattern && !schema.enum && !schema.format) {
    return { ...schema, type: ['string', 'null'] }
  }
  return { oneOf: [schema, { type: 'null' }, { const: '' }] }
}

/** A response schema that also allows null. */
function nullable(schema: Schema): Schema {
  const out: Schema = { ...schema, type: [schema.type, 'null'] }
  if (Array.isArray(schema.enum)) out.enum = [...schema.enum, null]
  return out
}

function columnExtensions(column: ContractColumn, mode: 'request' | 'response'): Schema {
  const out: Schema = { description: column.description, 'x-maqdar-kind': column.kind }
  if (column.references) out['x-maqdar-reference'] = column.references
  if (column.lookup) out['x-maqdar-lookup'] = resourceForEntity(column.lookup).name
  if (mode === 'request') {
    if (column.default !== null) out['x-maqdar-default-for-new'] = column.default
    if (column.required_for_new) out['x-maqdar-required-for-new'] = true
  }
  return out
}

/** The property schema of a column in an upsert record. */
export function requestColumnSchema(column: ContractColumn): Schema {
  const value = requestValueSchema(column)
  return { ...(column.required ? value : clearable(value)), ...columnExtensions(column, 'request') }
}

/** The property schema of a column in a listed record. */
export function responseColumnSchema(column: ContractColumn): Schema {
  const value = responseValueSchema(column)
  // Weekdays come back as a sorted array, never null ([] for none).
  const optional = !column.required && column.kind !== 'weekdays'
  return { ...(optional ? nullable(value) : value), ...columnExtensions(column, 'response') }
}

/* ------------------------------------------------------------------------------------------ */
/* Entity schemas                                                                               */
/* ------------------------------------------------------------------------------------------ */

const UPDATED_AT_RECORD: Schema = {
  type: 'string',
  format: 'date-time',
  readOnly: true,
  description: 'Last change (UTC, microseconds). Ignored when the record is sent back.',
}

function rules(entity: ContractEntity): Schema[] {
  return [
    ...entity.row_rules.map((rule) => ({ ...rule, scope: 'record' })),
    ...entity.set_rules.map((rule) => ({ ...rule, scope: 'set' })),
  ]
}

function recordSchema(entity: ContractEntity): Schema {
  const master = entity.name !== 'demand_history'
  const properties: Record<string, Schema> = {}
  for (const column of entity.columns) properties[column.name] = responseColumnSchema(column)
  if (master) properties.updated_at = UPDATED_AT_RECORD
  return {
    type: 'object',
    description: `${entity.description} Every field is always present; decimals are canonical strings.`,
    required: [...entity.columns.map((column) => column.name), ...(master ? ['updated_at'] : [])],
    properties,
    'x-maqdar-natural-key': [...entity.natural_key],
  }
}

function upsertSchema(entity: ContractEntity): Schema {
  const always = new Set(ALWAYS_PROVIDED[entity.name] ?? [])
  const properties: Record<string, Schema> = {}
  for (const column of entity.columns) properties[column.name] = requestColumnSchema(column)
  properties.updated_at = {
    description: 'Read-only; ignored, so that listed records can be sent back unchanged.',
  }
  const schema: Schema = {
    type: 'object',
    description:
      `${entity.description} Every record of a request carries the same fields; a field left out ` +
      'of every record keeps its stored value, and null or "" clears a nullable field.',
    required: entity.natural_key.filter((column) => !always.has(column)),
    additionalProperties: false,
    properties,
  }
  const dependent: Record<string, string[]> = {}
  for (const group of entity.column_groups) {
    for (const column of group) {
      dependent[column] = group.filter((other) => other !== column)
    }
  }
  if (Object.keys(dependent).length > 0) schema.dependentRequired = dependent
  if (entity.monthly_parts) {
    const values = ['quantity', 'lost_sales_quantity']
    schema.anyOf = values.map((column) => ({ required: [column] }))
  }
  if (always.size > 0) {
    schema.oneOf = [...always].map((column) => ({
      required: [column],
      properties: { [column]: { type: 'string', minLength: 1 } },
    }))
  }
  schema['x-maqdar-natural-key'] = [...entity.natural_key]
  schema['x-maqdar-load-order'] = entity.load_order
  if (entity.unordered_pair) schema['x-maqdar-unordered-pair'] = true
  const entityRules = rules(entity)
  if (entityRules.length > 0) schema['x-maqdar-rules'] = entityRules
  return schema
}

function requestSchema(entity: ContractEntity): Schema {
  const names = schemaNames(entity.name)
  return {
    type: 'object',
    required: ['records'],
    additionalProperties: false,
    properties: {
      records: {
        type: 'array',
        minItems: 1,
        maxItems: recordCap(entity.name),
        items: ref('schemas', names.upsert),
      },
    },
  }
}

function pageSchema(entity: ContractEntity): Schema {
  const names = schemaNames(entity.name)
  return {
    type: 'object',
    required: ['data', 'next_cursor', 'as_of'],
    properties: {
      data: { type: 'array', items: ref('schemas', names.record) },
      next_cursor: {
        type: ['string', 'null'],
        maxLength: API_LIMITS.cursorChars,
        description: 'Pass as cursor to get the next page; null on the last page.',
      },
      as_of: {
        type: 'string',
        format: 'date-time',
        description:
          'When the first page was read; carried by the cursor. Use it (minus a minute) as the next updated_since.',
      },
    },
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Shared schemas                                                                               */
/* ------------------------------------------------------------------------------------------ */

const NULLABLE_INT: Schema = { type: ['integer', 'null'], minimum: 0 }
const COUNT: Schema = { type: 'integer', minimum: 0 }
const PER_CATEGORY: Schema = {
  type: 'object',
  properties: { master_data: COUNT, demand_history: COUNT },
}
const ERROR_COUNTS: Schema = {
  type: 'object',
  description: 'Complete counts per code and field ("" for record-level codes).',
  additionalProperties: { type: 'object', additionalProperties: COUNT },
}

function sharedSchemas(): Record<string, Schema> {
  const contractCodes = [...contractErrorCodes('error'), ...contractErrorCodes('warning')]
  return {
    Problem: {
      type: 'object',
      description: 'RFC 9457 problem details.',
      required: ['type', 'title', 'status', 'detail', 'instance', 'code', 'request_id'],
      properties: {
        type: { type: 'string', description: 'urn:maqdar:problem:<code>' },
        title: { type: 'string' },
        status: { type: 'integer' },
        detail: { type: 'string' },
        instance: { type: 'string', description: 'urn:uuid:<request_id>' },
        code: { type: 'string', enum: [...PROBLEM_CODES] },
        request_id: { type: 'string', format: 'uuid' },
      },
    },
    ParameterProblem: {
      allOf: [
        ref('schemas', 'Problem'),
        {
          type: 'object',
          properties: {
            errors: {
              type: 'array',
              items: {
                type: 'object',
                required: ['parameter', 'detail'],
                properties: { parameter: { type: 'string' }, detail: { type: 'string' } },
              },
            },
          },
        },
      ],
    },
    ScopeProblem: {
      allOf: [
        ref('schemas', 'Problem'),
        {
          type: 'object',
          properties: { required_scope: { type: 'string', enum: [...API_SCOPES] } },
        },
      ],
    },
    LimitProblem: {
      allOf: [
        ref('schemas', 'Problem'),
        {
          type: 'object',
          properties: { limit: COUNT, records: COUNT },
        },
      ],
    },
    RequestError: {
      type: 'object',
      required: ['pointer', 'record', 'field', 'code', 'detail'],
      properties: {
        pointer: { type: 'string', description: 'Where: #/records/<index>/<field>.' },
        record: { ...NULLABLE_INT, description: '0-based index in records.' },
        field: { type: ['string', 'null'] },
        code: { type: 'string', enum: [...REQUEST_ERROR_CODES] },
        detail: { type: 'string' },
      },
    },
    RequestProblem: {
      allOf: [
        ref('schemas', 'Problem'),
        {
          type: 'object',
          properties: {
            error_count: COUNT,
            errors: {
              type: 'array',
              maxItems: API_LIMITS.requestErrors,
              items: ref('schemas', 'RequestError'),
            },
            errors_truncated: { type: 'boolean' },
          },
        },
      ],
    },
    ResultItem: {
      type: 'object',
      required: ['pointer', 'record', 'field', 'code', 'detail'],
      properties: {
        pointer: { type: 'string', description: 'Where: #/records/<index>/<field>.' },
        record: { ...NULLABLE_INT, description: '0-based index in records.' },
        field: { type: ['string', 'null'] },
        code: { type: 'string', enum: contractCodes },
        value: {
          type: ['string', 'null'],
          maxLength: API_LIMITS.valueChars,
          description: 'The value as sent (as text), clipped.',
        },
        detail: { type: 'string' },
        first_record: { ...COUNT, description: 'duplicate_key: the first record with this key.' },
        stored: {
          type: 'object',
          description: 'Two-field rules: the stored values the record was compared with.',
          additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
        },
      },
    },
    ValidationProblem: {
      allOf: [
        ref('schemas', 'Problem'),
        {
          type: 'object',
          properties: {
            error_count: COUNT,
            error_counts: ERROR_COUNTS,
            errors: {
              type: 'array',
              maxItems: API_LIMITS.validationErrors,
              items: ref('schemas', 'ResultItem'),
            },
            errors_truncated: { type: 'boolean' },
            warning_count: COUNT,
            warnings: {
              type: 'array',
              maxItems: API_LIMITS.warnings,
              items: ref('schemas', 'ResultItem'),
            },
            warnings_truncated: { type: 'boolean' },
          },
        },
      ],
    },
    ConflictProblem: {
      allOf: [
        ref('schemas', 'Problem'),
        {
          type: 'object',
          properties: {
            failure_code: { type: 'string' },
            error_count: COUNT,
            error_counts: ERROR_COUNTS,
            errors: {
              type: 'array',
              maxItems: API_LIMITS.validationErrors,
              items: ref('schemas', 'ResultItem'),
            },
            errors_truncated: { type: 'boolean' },
          },
        },
      ],
    },
    UpsertResult: {
      type: 'object',
      required: [
        'import_id',
        'recorded',
        'request_id',
        'resource',
        'records',
        'counts',
        'warning_count',
        'warnings',
        'warnings_truncated',
      ],
      properties: {
        import_id: {
          type: ['string', 'null'],
          format: 'uuid',
          description: 'The import in MAQDAR history; null when nothing changed (not recorded).',
        },
        recorded: {
          type: 'boolean',
          description: 'False when nothing changed: the write left no import record.',
        },
        request_id: { type: 'string', format: 'uuid' },
        resource: { type: 'string', enum: RESOURCES.map((resource) => resource.name) },
        records: COUNT,
        counts: {
          type: 'object',
          required: ['inserted', 'updated', 'unchanged', 'deleted', 'skipped'],
          properties: Object.fromEntries(COUNT_KEYS.map((key) => [key, COUNT])),
        },
        warning_count: COUNT,
        warnings: {
          type: 'array',
          maxItems: API_LIMITS.warnings,
          items: ref('schemas', 'ResultItem'),
        },
        warnings_truncated: { type: 'boolean' },
      },
    },
    Organization: {
      type: 'object',
      required: ['organization', 'key', 'demand_window', 'limits'],
      properties: {
        organization: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            slug: { type: 'string' },
            base_currency: { type: 'string', pattern: '^[A-Z]{3}$' },
            home_country: { type: ['string', 'null'], pattern: '^[A-Z]{2}$' },
            time_zone: { type: ['string', 'null'] },
          },
        },
        key: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            display: { type: 'string', description: `${API_KEY_PREFIX}AbCd…wxyz` },
            scopes: { type: 'array', items: { type: 'string', enum: [...API_SCOPES] } },
            created_at: { type: 'string', format: 'date-time' },
            expires_at: { type: 'string', format: 'date-time' },
          },
        },
        demand_window: {
          type: 'object',
          description: 'Demand dates MAQDAR accepts: from (inclusive) to until_exclusive.',
          properties: {
            from: { type: 'string', format: 'date' },
            until_exclusive: { type: 'string', format: 'date' },
          },
        },
        limits: {
          type: 'object',
          description: 'The API limits that apply to this key.',
          properties: {
            body_bytes: COUNT,
            upsert_records: PER_CATEGORY,
            list_limit: PER_CATEGORY,
            list_default_limit: PER_CATEGORY,
            demand_list_days: COUNT,
            recorded_writes_per_day: COUNT,
            active_keys: COUNT,
          },
        },
      },
    },
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Parameters, headers, responses                                                               */
/* ------------------------------------------------------------------------------------------ */

const PARAMETER_REFS: Readonly<Record<string, string>> = {
  limit: 'Limit',
  cursor: 'Cursor',
  updated_since: 'UpdatedSince',
  from: 'From',
  to: 'To',
  item_code: 'ItemCode',
  location_code: 'LocationCode',
}

function limitParameter(entity: EntityName): Schema {
  const limits = listLimits(entity)
  return {
    name: 'limit',
    in: 'query',
    required: false,
    description: 'Records per page. Out of range is a 400, not clamped.',
    schema: { type: 'integer', minimum: limits.min, maximum: limits.max, default: limits.default },
  }
}

function parameters(): Record<string, Schema> {
  const demand = getEntity('demand_history')
  const pattern = (column: string) =>
    demand.columns.find((candidate) => candidate.name === column)?.pattern ?? undefined
  return {
    Limit: limitParameter('items'),
    TransactionLimit: limitParameter('demand_history'),
    Cursor: {
      name: 'cursor',
      in: 'query',
      required: false,
      description: 'next_cursor of the previous page, unchanged, with the same other parameters.',
      schema: { type: 'string', maxLength: API_LIMITS.cursorChars, pattern: '^[A-Za-z0-9_-]+$' },
    },
    UpdatedSince: {
      name: 'updated_since',
      in: 'query',
      required: false,
      description: 'Only records changed at or after this instant (RFC 3339 with an offset).',
      schema: { type: 'string', format: 'date-time' },
    },
    From: {
      name: 'from',
      in: 'query',
      required: true,
      description: 'First demand date (inclusive).',
      schema: { type: 'string', format: 'date' },
    },
    To: {
      name: 'to',
      in: 'query',
      required: true,
      description: `Last demand date (inclusive); at most ${API_LIMITS.demandRangeDays} days in all.`,
      schema: { type: 'string', format: 'date' },
    },
    ItemCode: {
      name: 'item_code',
      in: 'query',
      required: false,
      description: 'Only this part.',
      schema: { type: 'string', pattern: pattern('item_code'), maxLength: 64 },
    },
    LocationCode: {
      name: 'location_code',
      in: 'query',
      required: false,
      description: 'Only this location.',
      schema: { type: 'string', pattern: pattern('location_code'), maxLength: 64 },
    },
  }
}

function headers(): Record<string, Schema> {
  return {
    'X-Request-Id': {
      description: 'The request id; quote it to support.',
      schema: { type: 'string', format: 'uuid' },
    },
    'Retry-After': {
      description: 'Seconds to wait before retrying.',
      schema: { type: 'integer', minimum: 0 },
    },
    'WWW-Authenticate': {
      description: 'Bearer challenge (RFC 6750).',
      schema: { type: 'string' },
    },
  }
}

function problemResponse(description: string, schema: string, extraHeaders: string[] = []): Schema {
  const responseHeaders: Record<string, Schema> = { 'X-Request-Id': ref('headers', 'X-Request-Id') }
  for (const name of extraHeaders) responseHeaders[name] = ref('headers', name)
  return {
    description,
    headers: responseHeaders,
    content: { 'application/problem+json': { schema: ref('schemas', schema) } },
  }
}

function codesFor(status: number): string {
  return PROBLEM_CODES.filter((code) => PROBLEMS[code].status === status).join(', ')
}

function responses(): Record<string, Schema> {
  return {
    NotFound: problemResponse('No record with this ID in the key organization.', 'Problem'),
    InvalidParameter: problemResponse(
      'Bad query parameters (invalid_parameter, invalid_cursor).',
      'ParameterProblem',
    ),
    UpsertBadRequest: problemResponse(
      'The body is not valid JSON (invalid_json), or the URL has a query string (invalid_parameter).',
      'ParameterProblem',
    ),
    Unauthorized: problemResponse(`No valid API key (${codesFor(401)}).`, 'Problem', [
      'WWW-Authenticate',
    ]),
    Forbidden: problemResponse('The key lacks the scope (insufficient_scope).', 'ScopeProblem', [
      'WWW-Authenticate',
    ]),
    Conflict: problemResponse(
      `Another write holds the organization, or the data changed (${codesFor(409)}).`,
      'ConflictProblem',
      ['Retry-After'],
    ),
    PayloadTooLarge: problemResponse(`Too large (${codesFor(413)}).`, 'LimitProblem'),
    UnsupportedMediaType: problemResponse(
      'Send Content-Type: application/json (unsupported_media_type).',
      'Problem',
    ),
    UnprocessableEntity: {
      description: `Nothing was saved (${codesFor(422)}).`,
      headers: { 'X-Request-Id': ref('headers', 'X-Request-Id') },
      content: {
        'application/problem+json': {
          schema: {
            oneOf: [ref('schemas', 'RequestProblem'), ref('schemas', 'ValidationProblem')],
          },
        },
      },
    },
    TooManyRequests: problemResponse(`Slow down (${codesFor(429)}).`, 'Problem', ['Retry-After']),
    InternalError: problemResponse('Unexpected failure (internal_error).', 'Problem'),
    Unavailable: problemResponse(`Retry later (${codesFor(503)}).`, 'Problem', ['Retry-After']),
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Operations                                                                                   */
/* ------------------------------------------------------------------------------------------ */

function okHeaders(): Schema {
  return { 'X-Request-Id': ref('headers', 'X-Request-Id') }
}

function withDeprecation(id: string, operation: Schema): Schema {
  return deprecationFor(id) ? { ...operation, deprecated: true } : operation
}

function listOperation(resource: ApiResource): Schema {
  const entity = getEntity(resource.entity)
  const names = schemaNames(resource.entity)
  const scope = scopeFor(resource.entity, 'read')
  const transaction = isTransactionEntity(resource.entity)
  const demand = resource.entity === 'demand_history'
  const parameterNames = demand ? DEMAND_PARAMETERS : MASTER_PARAMETERS
  const id = operationId(resource.entity, 'list')
  return withDeprecation(id, {
    operationId: id,
    summary: `List ${resource.name}`,
    description: demand
      ? 'Demand in a date range, in key order. from and to are required.'
      : 'Records in a stable order, with cursor paging and an optional updated_since filter.',
    tags: [transaction ? TAGS.transactions : TAGS.master_data],
    'x-maqdar-scopes': [scope],
    'x-maqdar-entity': entity.name,
    parameters: parameterNames.map((name) =>
      ref(
        'parameters',
        name === 'limit' && demand ? 'TransactionLimit' : (PARAMETER_REFS[name] ?? name),
      ),
    ),
    responses: {
      '200': {
        description: 'One page.',
        headers: okHeaders(),
        content: { 'application/json': { schema: ref('schemas', names.page) } },
      },
      '400': ref('responses', 'InvalidParameter'),
      '401': ref('responses', 'Unauthorized'),
      '403': ref('responses', 'Forbidden'),
      '429': ref('responses', 'TooManyRequests'),
      '500': ref('responses', 'InternalError'),
      '503': ref('responses', 'Unavailable'),
    },
  })
}

function upsertOperation(resource: ApiResource): Schema {
  const entity = getEntity(resource.entity)
  const names = schemaNames(resource.entity)
  const scope = scopeFor(resource.entity, 'write')
  const transaction = isTransactionEntity(resource.entity)
  const id = operationId(resource.entity, 'upsert')
  const description = [
    `Inserts or updates up to ${recordCap(resource.entity)} records by natural key ` +
      `(${entity.natural_key.join(', ')}), all or nothing. Load order ${entity.load_order}: ` +
      'send parents before children.',
    transaction
      ? 'A record with both quantities 0 deletes that day.'
      : 'Records that match the stored data are left untouched.',
    'A write that changes nothing is not recorded (recorded: false).',
  ].join(' ')
  return withDeprecation(id, {
    operationId: id,
    summary: `Upsert ${resource.name}`,
    description,
    tags: [transaction ? TAGS.transactions : TAGS.master_data],
    'x-maqdar-scopes': [scope],
    'x-maqdar-entity': entity.name,
    'x-maqdar-load-order': entity.load_order,
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: ref('schemas', names.request),
          example: { records: EXAMPLES[resource.entity] },
        },
      },
    },
    responses: {
      '200': {
        description: 'Written (or nothing to change).',
        headers: okHeaders(),
        content: { 'application/json': { schema: ref('schemas', 'UpsertResult') } },
      },
      '400': ref('responses', 'UpsertBadRequest'),
      '401': ref('responses', 'Unauthorized'),
      '403': ref('responses', 'Forbidden'),
      '409': ref('responses', 'Conflict'),
      '413': ref('responses', 'PayloadTooLarge'),
      '415': ref('responses', 'UnsupportedMediaType'),
      '422': ref('responses', 'UnprocessableEntity'),
      '429': ref('responses', 'TooManyRequests'),
      '500': ref('responses', 'InternalError'),
      '503': ref('responses', 'Unavailable'),
    },
  })
}

function organizationOperation(): Schema {
  return withDeprecation(ORGANIZATION_OPERATION_ID, {
    operationId: ORGANIZATION_OPERATION_ID,
    summary: 'The key and its organization',
    description:
      'The organization the key belongs to, the key itself, the demand history window and the limits. Any valid key.',
    tags: [TAGS.organization],
    'x-maqdar-scopes': [],
    responses: {
      '200': {
        description: 'The organization.',
        headers: okHeaders(),
        content: { 'application/json': { schema: ref('schemas', 'Organization') } },
      },
      '400': ref('responses', 'InvalidParameter'),
      '401': ref('responses', 'Unauthorized'),
      '429': ref('responses', 'TooManyRequests'),
      '500': ref('responses', 'InternalError'),
      '503': ref('responses', 'Unavailable'),
    },
  })
}

/* ------------------------------------------------------------------------------------------ */
/* Document                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const INFO_DESCRIPTION = [
  'Bulk upserts and lists of MAQDAR master data and demand history, per organization.',
  'Read saved purchase handoffs and batches with explicit organization-wide purchase_handoffs:read permission. These are planning evidence, not external orders.',
  '',
  `Authenticate with \`Authorization: Bearer ${API_KEY_PREFIX}…\`; an owner or admin creates keys in Settings. Keys are scoped (${API_SCOPES.join(', ')}), expire, and stop working when their creator is no longer an owner or admin.`,
  '',
  'Upserts are `POST /{resource}:upsert` with `{"records": [...]}`: all or nothing, by natural key, with the same field rules as the import wizard. Every record carries the same fields; a field left out keeps its stored value; null or "" clears a nullable field. Decimals are accepted as JSON numbers or strings and always returned as canonical strings. Load parents before children (x-maqdar-load-order).',
  '',
  'Errors are RFC 9457 problems (`application/problem+json`) with a stable `code` and a `request_id`. Honour `Retry-After` on 409, 429 and 503.',
  '',
  `Documentation: ${API_DOCS_URL}`,
].join('\n')

/** Builds the OpenAPI document. Deterministic: the committed openapi.json is its snapshot. */
export function buildOpenApi(): OpenApiDocument {
  const paths: Record<string, Record<string, Schema>> = {
    '/organization': { get: organizationOperation() },
  }
  for (const resource of RESOURCES) {
    paths[resourcePath(resource, 'list')] = { get: listOperation(resource) }
    paths[resourcePath(resource, 'upsert')] = { post: upsertOperation(resource) }
  }

  const schemas: Record<string, Schema> = {}
  for (const resource of RESOURCES) {
    const entity = getEntity(resource.entity)
    const names = schemaNames(resource.entity)
    schemas[names.record] = recordSchema(entity)
    schemas[names.upsert] = upsertSchema(entity)
    schemas[names.request] = requestSchema(entity)
    schemas[names.page] = pageSchema(entity)
  }
  Object.assign(paths, handoffPaths())
  Object.assign(paths, acknowledgementPaths())
  Object.assign(schemas, sharedSchemas(), handoffSchemas(), acknowledgementSchemas())

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'MAQDAR API',
      version: OPENAPI_DOCUMENT_VERSION,
      description: INFO_DESCRIPTION,
      'x-maqdar-import-format': CONTRACT.format_version,
    },
    servers: [{ url: API_BASE_PATH }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: TAGS.organization, description: 'The key and its organization.' },
      { name: TAGS.master_data, description: 'Calendars, locations, items, suppliers and rates.' },
      { name: TAGS.transactions, description: 'Demand history.' },
      {
        name: 'Purchase handoffs',
        description: 'Read-only saved planning evidence and live selection.',
      },
    ],
    'x-maqdar-load-order': RESOURCES.map((resource) => resource.name),
    'x-maqdar-scopes': Object.fromEntries(
      API_SCOPES.map((scope) => [scope, SCOPE_DESCRIPTIONS[scope]]),
    ),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: `${API_KEY_PREFIX}…`,
          description: 'A MAQDAR API key. Operations list the scope they need in x-maqdar-scopes.',
        },
      },
      parameters: parameters(),
      headers: headers(),
      responses: responses(),
      schemas,
    },
  }
}

/** The document as committed (`openapi.json`): two-space JSON and a final newline. */
export function openApiText(): string {
  return `${JSON.stringify(buildOpenApi(), null, 2)}\n`
}
