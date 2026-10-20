import { handoffFixture as networkFixture } from '../network-handoffs.fixture'
import { batchFixture as networkBatchFixture } from '../network-batches.fixture'
import { handoffFixture as dispositionFixture } from '../excess-disposition-handoffs.fixture'
import { batchFixture as dispositionBatchFixture } from '../excess-disposition-batches.fixture'
import { ACKNOWLEDGEMENT_RESOURCES } from './acknowledgements'
import { handoffFixture as eventHandoffFixture } from '../event-purchase-handoffs.fixture'
import { batchFixture as eventBatchFixture } from '../event-handoff-batches.fixture'
import { handoffFixture as transferFixture } from '../transfer-handoffs.fixture'
import { batchFixture as transferBatchFixture } from '../transfer-batches.fixture'
import { describe, expect, it } from 'vitest'
import { getEntity, ENTITY_NAMES } from '../imports/contract'
import { scopeFor } from './auth'
import { EXAMPLES } from './examples'
import { REQUEST_ERROR_CODES, contractErrorCodes } from './errors'
import { API_LIMITS, listLimits, recordCap } from './limits'
import {
  buildOpenApi,
  openApiText,
  schemaNames,
  type OpenApiDocument,
  type Schema,
} from './openapi'
import { PROBLEM_CODES } from './problem'
import { validateUpsertBody } from './records'
import { RESOURCES, allOperationIds, resourcePath } from './resources'
import { HANDOFF_RESOURCES, READ_HANDOFF_RESOURCES, HANDOFF_SCOPE } from './handoffs'
import { deprecationFor } from './versioning'
import { handoffFixture } from '../purchase-handoffs.fixture'

const doc = buildOpenApi()

type Operation = Schema & { operationId: string }

function operations(document: OpenApiDocument): [string, string, Operation][] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item).map(
      ([method, operation]) =>
        [path, method, operation as Operation] as [string, string, Operation],
    ),
  )
}

function resolve(document: OpenApiDocument, pointer: string): unknown {
  if (!pointer.startsWith('#/')) return undefined
  return pointer
    .slice(2)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>(
      (node, token) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[token]
          : undefined,
      document,
    )
}

function refs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((item) => refs(item, found))
  else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') found.push(value)
      else refs(value, found)
    }
  }
  return found
}

function schema(name: string): Schema {
  const found = doc.components.schemas[name]
  if (!found) throw new Error(`No schema ${name}`)
  return found
}

/* A JSON Schema evaluator for the keywords the document uses (enough to check the examples). */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasType(type: string, value: unknown): boolean {
  switch (type) {
    case 'null':
      return value === null
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'number':
      return typeof value === 'number'
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isObject(value)
    default:
      throw new Error(`unknown type ${type}`)
  }
}

function valid(node: Schema, value: unknown): boolean {
  if (typeof node.$ref === 'string') return valid(resolve(doc, node.$ref) as Schema, value)
  const list = (key: string) => (node[key] as Schema[] | undefined) ?? null
  const oneOf = list('oneOf')
  if (oneOf && oneOf.filter((option) => valid(option, value)).length !== 1) return false
  const anyOf = list('anyOf')
  if (anyOf && !anyOf.some((option) => valid(option, value))) return false
  const allOf = list('allOf')
  if (allOf && !allOf.every((option) => valid(option, value))) return false
  if ('const' in node && value !== node.const) return false
  if (Array.isArray(node.enum) && !node.enum.includes(value)) return false
  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? (node.type as string[]) : [node.type as string]
    if (!types.some((type) => hasType(type, value))) return false
  }
  if (typeof value === 'string') {
    if (typeof node.pattern === 'string' && !new RegExp(node.pattern).test(value)) return false
    if (typeof node.maxLength === 'number' && [...value].length > node.maxLength) return false
    if (typeof node.minLength === 'number' && [...value].length < node.minLength) return false
  }
  if (typeof value === 'number') {
    if (typeof node.minimum === 'number' && value < node.minimum) return false
    if (typeof node.maximum === 'number' && value > node.maximum) return false
    if (typeof node.exclusiveMinimum === 'number' && value <= node.exclusiveMinimum) return false
    if (typeof node.exclusiveMaximum === 'number' && value >= node.exclusiveMaximum) return false
  }
  if (Array.isArray(value)) {
    if (typeof node.maxItems === 'number' && value.length > node.maxItems) return false
    if (typeof node.minItems === 'number' && value.length < node.minItems) return false
    if (
      node.uniqueItems === true &&
      new Set(value.map((v) => JSON.stringify(v))).size !== value.length
    ) {
      return false
    }
    if (isObject(node.items) && !value.every((item) => valid(node.items as Schema, item))) {
      return false
    }
  }
  if (isObject(value)) {
    const required = (node.required as string[] | undefined) ?? []
    if (!required.every((key) => Object.hasOwn(value, key))) return false
    const properties = (node.properties as Record<string, Schema> | undefined) ?? {}
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        if (!valid(properties[key] as Schema, item)) return false
      } else if (node.additionalProperties === false) return false
    }
    const dependent = (node.dependentRequired as Record<string, string[]> | undefined) ?? {}
    for (const [key, others] of Object.entries(dependent)) {
      if (Object.hasOwn(value, key) && !others.every((other) => Object.hasOwn(value, other))) {
        return false
      }
    }
  }
  return true
}

describe('openapi.json', () => {
  it('is the committed snapshot (pnpm --filter web gen:openapi updates it)', async () => {
    await expect(openApiText()).toMatchFileSnapshot('./openapi.json')
  })

  it('is deterministic and OpenAPI 3.1.1', () => {
    expect(openApiText()).toBe(openApiText())
    expect(doc.openapi).toBe('3.1.1')
    expect(doc.servers).toEqual([{ url: '/api/v1' }])
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    })
  })
})

describe('structure', () => {
  it('documents bounded read-only handoffs and validates original evidence values', () => {
    for (const resource of HANDOFF_RESOURCES) {
      expect(Object.keys(doc.paths[`/${resource}`])).toEqual(['get'])
      expect(Object.keys(doc.paths[`/${resource}/{id}`])).toEqual(['get'])
      const parameters = doc.paths[`/${resource}`].get.parameters as Schema[]
      expect(parameters[0].schema).toEqual({
        type: 'integer',
        minimum: 1,
        maximum: 100,
        default: 25,
      })
      expect((doc.paths[`/${resource}/{id}`].get.responses as Schema)['404']).toBeDefined()
    }
    expect(valid(schema('PurchaseHandoffPayload'), handoffFixture)).toBe(true)
    expect(valid(schema('PurchaseHandoffPayload'), { ...handoffFixture, purpose: 'order' })).toBe(
      false,
    )
    expect(
      valid(schema('PurchaseHandoffPayload'), {
        ...handoffFixture,
        estimate: { ...handoffFixture.estimate, subtotal: 123 },
      }),
    ).toBe(false)
    expect((schema('HandoffRecord').properties as Schema).payload).toBeUndefined()
  })
  it('has organization, feed list/upsert and read-only handoff paths', () => {
    const expected = [
      '/organization',
      ...RESOURCES.flatMap((resource) => [
        resourcePath(resource, 'list'),
        resourcePath(resource, 'upsert'),
      ]),
      ...READ_HANDOFF_RESOURCES.flatMap((resource) => [`/${resource}`, `/${resource}/{id}`]),
      ...ACKNOWLEDGEMENT_RESOURCES.flatMap((resource) => [
        `/${resource}/{id}/acknowledgements`,
        `/${resource}/{id}/acknowledgements/{eventId}`,
      ]),
    ]
    expect(Object.keys(doc.paths)).toEqual(expected)
    for (const resource of RESOURCES) {
      expect(Object.keys(doc.paths[resourcePath(resource, 'list')] ?? {})).toEqual(['get'])
      expect(Object.keys(doc.paths[resourcePath(resource, 'upsert')] ?? {})).toEqual(['post'])
    }
    expect(doc['x-maqdar-load-order']).toEqual(RESOURCES.map((resource) => resource.name))
  })

  it('has unique operationIds equal to the served operations', () => {
    const ids = operations(doc).map(([, , operation]) => operation.operationId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const [, , operation] of operations(doc)) {
      expect(Array.isArray(operation.tags)).toBe(true)
      expect((operation.tags as unknown[]).every((tag) => typeof tag === 'string')).toBe(true)
    }
    expect(ids).toEqual(allOperationIds())
  })

  it('resolves every $ref', () => {
    const all = refs(doc)
    expect(all.length).toBeGreaterThan(100)
    for (const pointer of new Set(all)) expect(resolve(doc, pointer), pointer).toBeDefined()
  })

  it('names the scope each operation needs and marks deprecations from versioning.ts', () => {
    for (const [path, method, operation] of operations(doc)) {
      const resource = RESOURCES.find(
        (candidate) =>
          path === resourcePath(candidate, 'list') || path === resourcePath(candidate, 'upsert'),
      )
      const scopes = resource
        ? [scopeFor(resource.entity, method === 'get' ? 'read' : 'write')]
        : path.startsWith('/network-handoff')
          ? [method === 'post' ? 'network_handoffs:acknowledge' : 'network_handoffs:read']
          : path.startsWith('/excess-disposition-handoff')
            ? [
                method === 'post'
                  ? 'excess_disposition_handoffs:acknowledge'
                  : 'excess_disposition_handoffs:read',
              ]
            : path.startsWith('/event-purchase-handoff')
              ? [
                  method === 'post'
                    ? 'event_purchase_handoffs:acknowledge'
                    : 'event_purchase_handoffs:read',
                ]
              : path.startsWith('/transfer-handoff')
                ? [method === 'post' ? 'transfer_handoffs:acknowledge' : 'transfer_handoffs:read']
                : path.startsWith('/purchase-handoff')
                  ? [method === 'post' ? 'purchase_handoffs:acknowledge' : HANDOFF_SCOPE]
                  : []
      expect(operation['x-maqdar-scopes'], operation.operationId).toEqual(scopes)
      expect(operation.deprecated === true).toBe(deprecationFor(operation.operationId) !== null)
    }
  })

  it('lists every problem code and request error code', () => {
    expect((schema('Problem').properties as Record<string, Schema>).code?.enum).toEqual([
      ...PROBLEM_CODES,
    ])
    const requestError = schema('RequestError').properties as Record<string, Schema>
    expect(requestError.code?.enum).toEqual([...REQUEST_ERROR_CODES])
    const resultItem = schema('ResultItem').properties as Record<string, Schema>
    expect(resultItem.code?.enum).toEqual([
      ...contractErrorCodes('error'),
      ...contractErrorCodes('warning'),
    ])
  })

  it('uses the limits of limits.ts', () => {
    for (const resource of RESOURCES) {
      const names = schemaNames(resource.entity)
      const records = (schema(names.request).properties as Record<string, Schema>).records
      expect(records?.maxItems).toBe(recordCap(resource.entity))
      expect(records?.minItems).toBe(1)
      const list = doc.paths[resourcePath(resource, 'list')]?.get as Operation
      const limitRef = (list.parameters as { $ref: string }[]).find((p) => p.$ref.endsWith('Limit'))
      const limit = resolve(doc, limitRef?.$ref ?? '') as Schema
      expect(limit.schema).toMatchObject({
        minimum: listLimits(resource.entity).min,
        maximum: listLimits(resource.entity).max,
        default: listLimits(resource.entity).default,
      })
    }
    expect((doc.components.parameters.Cursor?.schema as Schema).maxLength).toBe(
      API_LIMITS.cursorChars,
    )
  })
})

describe('entity schemas', () => {
  it('have exactly the contract columns (plus updated_at)', () => {
    for (const entity of ENTITY_NAMES) {
      const names = schemaNames(entity)
      const columns = getEntity(entity).columns.map((column) => column.name)
      const master = entity !== 'demand_history'
      const record = schema(names.record)
      expect(Object.keys(record.properties as Schema)).toEqual(
        master ? [...columns, 'updated_at'] : columns,
      )
      expect(record.required).toEqual(master ? [...columns, 'updated_at'] : columns)
      const upsert = schema(names.upsert)
      expect(Object.keys(upsert.properties as Schema)).toEqual([...columns, 'updated_at'])
      expect(upsert.additionalProperties).toBe(false)
      expect(upsert['x-maqdar-natural-key']).toEqual([...getEntity(entity).natural_key])
    }
  })

  it('carry column groups, the demand value rule and the holiday scope rule', () => {
    expect(schema('ItemsUpsert').dependentRequired).toEqual({
      unit_cost: ['currency'],
      currency: ['unit_cost'],
    })
    expect(schema('DemandHistoryUpsert').anyOf).toEqual([
      { required: ['quantity'] },
      { required: ['lost_sales_quantity'] },
    ])
    expect(schema('HolidayOverridesUpsert').required).toEqual(['starts_on'])
    expect(schema('HolidayOverridesUpsert').oneOf).toHaveLength(2)
    expect(schema('ItemsUpsert').required).toEqual(['item_code'])
  })

  it('accept every example request and refuse broken ones', () => {
    for (const entity of ENTITY_NAMES) {
      const names = schemaNames(entity)
      const body = { records: EXAMPLES[entity] }
      expect(valid(schema(names.request), body), entity).toBe(true)
      expect(validateUpsertBody(entity, body).ok, entity).toBe(true)
      const operation = doc.paths[`/${entity.replaceAll('_', '-')}:upsert`]?.post as Schema
      const content = (operation.requestBody as Schema).content as Record<string, Schema>
      expect(content['application/json']?.example).toEqual(body)
    }
    const item = EXAMPLES.items[0] ?? {}
    const items = schema('ItemsUpsertRequest')
    expect(valid(items, { records: [{ ...item, unit_cost: 185.5 }] })).toBe(true)
    expect(valid(items, { records: [{ ...item, unit_cost: '185.5555' }] })).toBe(false)
    expect(valid(items, { records: [{ ...item, unit_cost: -1 }] })).toBe(false)
    expect(valid(items, { records: [{ ...item, colour: 'red' }] })).toBe(false)
    expect(valid(items, { records: [{ item_code: 'A', unit_cost: '1' }] })).toBe(false)
    expect(valid(items, { records: [{ ...item, brand_code: null, name_ar: '' }] })).toBe(true)
    expect(valid(items, { records: [{ ...item, name_en: null }] })).toBe(false)
    expect(valid(items, { records: [] })).toBe(false)
    const holiday = EXAMPLES.holiday_overrides[0] ?? {}
    expect(
      valid(schema('HolidayOverridesUpsertRequest'), {
        records: [{ ...holiday, country_code: 'SA' }],
      }),
    ).toBe(false)
    const demand = { item_code: 'A', location_code: 'L', demand_date: '2026-01-01' }
    expect(valid(schema('DemandHistoryUpsertRequest'), { records: [demand] })).toBe(false)
    expect(
      valid(schema('DemandHistoryUpsertRequest'), { records: [{ ...demand, quantity: 0 }] }),
    ).toBe(true)
    const calendar = EXAMPLES.work_calendars[0] ?? {}
    expect(
      valid(schema('WorkCalendarsUpsertRequest'), {
        records: [{ ...calendar, weekend_days: [5, 5] }],
      }),
    ).toBe(false)
  })

  it('describe listed records: the examples read back with updated_at are valid records', () => {
    for (const entity of ENTITY_NAMES) {
      const names = schemaNames(entity)
      for (const example of EXAMPLES[entity]) {
        const listed =
          entity === 'demand_history'
            ? { ...example }
            : { ...example, updated_at: '2026-10-14T08:00:00.123456Z' }
        expect(valid(schema(names.record), listed), entity).toBe(true)
      }
    }
    const item = { ...(EXAMPLES.items[0] ?? {}), updated_at: '2026-10-14T08:00:00Z' }
    expect(valid(schema('ItemsRecord'), { ...item, unit_cost: 185.5 })).toBe(false)
    expect(valid(schema('ItemsRecord'), { ...item, unit_cost: '185.50' })).toBe(false)
    expect(valid(schema('ItemsRecord'), { ...item, brand_code: null })).toBe(true)
    const rate = { ...(EXAMPLES.fx_rates[0] ?? {}), updated_at: '2026-10-14T08:00:00Z' }
    expect(valid(schema('FxRatesRecord'), { ...rate, rate: '0.0000000001' })).toBe(true)
    expect(valid(schema('FxRatesRecord'), { ...rate, rate: '3.750' })).toBe(false)
  })
})

it('documents original transfer payloads, exact freight and source/destination identities', () => {
  expect(valid(schema('TransferHandoffPayload'), transferFixture)).toBe(true)
  expect(valid(schema('TransferHandoffBatchPayload'), transferBatchFixture)).toBe(true)
  expect(
    valid(schema('TransferHandoffPayload'), {
      ...transferFixture,
      estimate: { ...transferFixture.estimate, subtotal: 123 },
    }),
  ).toBe(false)
  const summary = schema('TransferHandoffSummary').properties as Record<string, Schema>
  expect(summary).toMatchObject({
    lane_id: { format: 'uuid' },
    source_location_id: { format: 'uuid' },
    location_id: { format: 'uuid' },
    dispatch_date: { format: 'date' },
    subtotal: { type: 'string' },
    minor_units: { type: 'integer' },
  })
  expect((schema('TransferHandoffRecord').properties as Schema).payload).toBeUndefined()
  expect(doc.paths['/transfer-handoffs/{id}/acknowledgements']?.post).toBeDefined()
})

it('documents complete event evidence with independent read and acknowledgement scopes', () => {
  expect(valid(schema('EventPurchaseHandoffPayload'), eventHandoffFixture)).toBe(true)
  expect(valid(schema('EventPurchaseHandoffBatchPayload'), eventBatchFixture)).toBe(true)
  expect(
    valid(schema('EventPurchaseHandoffPayload'), {
      ...eventHandoffFixture,
      estimate: {
        ...eventHandoffFixture.estimate,
        adjusted: { ...eventHandoffFixture.estimate.adjusted, subtotal: 123 },
      },
    }),
  ).toBe(false)
  for (const resource of ['event-purchase-handoffs', 'event-purchase-handoff-batches']) {
    expect(doc.paths[`/${resource}`]?.get?.['x-maqdar-scopes']).toEqual([
      'event_purchase_handoffs:read',
    ])
    expect(doc.paths[`/${resource}/{id}/acknowledgements`]?.post?.['x-maqdar-scopes']).toEqual([
      'event_purchase_handoffs:acknowledge',
    ])
    expect(doc.paths[`/${resource}/{id}/acknowledgements`]?.get?.['x-maqdar-scopes']).toEqual([
      'event_purchase_handoffs:read',
    ])
  }
})

it('documents exact disposition files, unavailable live context and read-only scope', () => {
  expect(valid(schema('ExcessDispositionHandoffPayload'), dispositionFixture)).toBe(true)
  expect(valid(schema('ExcessDispositionHandoffBatchPayload'), dispositionBatchFixture)).toBe(true)
  expect(
    valid(schema('ExcessDispositionHandoffPayload'), {
      ...dispositionFixture,
      disposition: { ...dispositionFixture.disposition, reference_value: 7.49925 },
    }),
  ).toBe(false)
  for (const selection of ['current', 'historical', 'unavailable'])
    expect(
      valid(schema('DispositionHandoffSelection'), {
        selection,
        checked_at: '2026-10-19T00:00:00Z',
      }),
    ).toBe(true)
  expect(
    valid(schema('DispositionHandoffSelection'), {
      selected: false,
      checked_at: '2026-10-19T00:00:00Z',
    }),
  ).toBe(false)
  for (const resource of ['excess-disposition-handoffs', 'excess-disposition-handoff-batches']) {
    expect(doc.paths[`/${resource}`].get['x-maqdar-scopes']).toEqual([
      'excess_disposition_handoffs:read',
    ])
    expect(doc.paths[`/${resource}/{id}/acknowledgements`]?.post?.['x-maqdar-scopes']).toEqual([
      'excess_disposition_handoffs:acknowledge',
    ])
    expect(doc.paths[`/${resource}/{id}/acknowledgements`]?.get?.['x-maqdar-scopes']).toEqual([
      'excess_disposition_handoffs:read',
    ])
  }
})

it('documents complete network evidence, separate currency totals and explicit acknowledgement scopes', () => {
  expect(valid(schema('NetworkHandoffPayload'), networkFixture)).toBe(true)
  expect(valid(schema('NetworkHandoffBatchPayload'), networkBatchFixture)).toBe(true)
  expect(
    valid(schema('NetworkHandoffPayload'), {
      ...networkFixture,
      estimate: {
        ...networkFixture.estimate,
        totals: [{ currency: 'KWD', minor_units: 3, subtotal: 17.53 }],
      },
    }),
  ).toBe(false)
  for (const selection of ['current', 'historical', 'unavailable'])
    expect(
      valid(schema('NetworkHandoffSelection'), { selection, checked_at: '2026-10-20T00:00:00Z' }),
    ).toBe(true)
  for (const resource of ['network-handoffs', 'network-handoff-batches']) {
    expect(doc.paths[`/${resource}`].get['x-maqdar-scopes']).toEqual(['network_handoffs:read'])
    expect(doc.paths[`/${resource}/{id}`].get['x-maqdar-scopes']).toEqual(['network_handoffs:read'])
    expect(doc.paths[`/${resource}/{id}/acknowledgements`].post['x-maqdar-scopes']).toEqual([
      'network_handoffs:acknowledge',
    ])
    expect(doc.paths[`/${resource}/{id}/acknowledgements`].get['x-maqdar-scopes']).toEqual([
      'network_handoffs:read',
    ])
    expect(doc.paths[`/${resource}`].post).toBeUndefined()
  }
})
