import { z } from 'zod'
import {
  acknowledgementInputSchema,
  acknowledgementOperationId,
  acknowledgementScope,
} from './acknowledgements'
import { READ_HANDOFF_RESOURCES, handoffReadScope, isTransferHandoffResource } from './handoffs'
import type { Schema } from './openapi'

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const uuid = { type: 'string', format: 'uuid' }
const timestamp = { type: 'string', format: 'date-time' }
const object = (properties: Record<string, Schema>) => ({
  type: 'object',
  required: Object.keys(properties),
  properties,
})

export function acknowledgementSchemas(): Record<string, Schema> {
  const input = z.toJSONSchema(acknowledgementInputSchema, { target: 'draft-2020-12', io: 'input' })
  delete input.$schema
  return {
    HandoffAcknowledgementInput: {
      ...input,
      description:
        'A rejected report requires a nonblank reason. Text must be nonblank and contain no control characters. 8 KiB body cap. Omitted reason and null are equivalent; UUID letter case is normalized. Other text is preserved exactly. System/reference are caller assertions, not independently verified identities or order numbers.',
      allOf: [
        {
          if: { properties: { status: { const: 'rejected' } }, required: ['status'] },
          then: {
            required: ['reason'],
            properties: { reason: { type: 'string', minLength: 1, maxLength: 1000 } },
          },
        },
      ],
    },
    HandoffAcknowledgement: object({
      id: uuid,
      client_event_id: uuid,
      api_key_id: uuid,
      recorded_at: timestamp,
      resource: { type: 'string', enum: [...READ_HANDOFF_RESOURCES] },
      record_id: uuid,
      external_system: { type: 'string', minLength: 1, maxLength: 80 },
      external_reference: { type: 'string', minLength: 1, maxLength: 200 },
      status: { type: 'string', enum: ['received', 'rejected'] },
      reason: { type: ['string', 'null'], maxLength: 1000 },
    }),
    HandoffAcknowledgementDetail: object({ data: ref('HandoffAcknowledgement') }),
    HandoffAcknowledgementWrite: object({
      data: ref('HandoffAcknowledgement'),
      replayed: { type: 'boolean' },
    }),
    HandoffAcknowledgementPage: object({
      data: { type: 'array', maxItems: 100, items: ref('HandoffAcknowledgement') },
      next_cursor: { type: ['string', 'null'] },
      as_of: timestamp,
    }),
  }
}

export function acknowledgementPaths(): Record<string, Record<string, Schema>> {
  const paths: Record<string, Record<string, Schema>> = {}
  for (const resource of READ_HANDOFF_RESOURCES) {
    const base = `/${resource}/{id}/acknowledgements`
    for (const action of ['list', 'create', 'get'] as const) {
      const path = base + (action === 'get' ? '/{eventId}' : '')
      const schema =
        action === 'create'
          ? 'HandoffAcknowledgementWrite'
          : action === 'get'
            ? 'HandoffAcknowledgementDetail'
            : 'HandoffAcknowledgementPage'
      const success = {
        description:
          action === 'create'
            ? 'Original event (replayed is true for a retry).'
            : 'Recorded reports.',
        content: { 'application/json': { schema: ref(schema) } },
        ...(action === 'create'
          ? {
              headers: {
                Location: {
                  description: 'Relative URL of the recorded event.',
                  schema: { type: 'string' },
                },
              },
            }
          : {}),
      }
      const parameters: Schema[] = [{ name: 'id', in: 'path', required: true, schema: uuid }]
      if (action === 'get')
        parameters.push({ name: 'eventId', in: 'path', required: true, schema: uuid })
      if (action === 'list')
        parameters.push(
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
          { $ref: '#/components/parameters/Cursor' },
        )
      paths[path] ??= {}
      paths[path][action === 'create' ? 'post' : 'get'] = {
        operationId: acknowledgementOperationId(resource, action),
        tags: [isTransferHandoffResource(resource) ? 'Transfer handoffs' : 'Purchase handoffs'],
        summary:
          action === 'create'
            ? 'Record an external receipt or rejection report'
            : 'Read acknowledgement history',
        description: [
          'Organization-wide scoped API-key access. Events are append-only caller reports and do not verify external acceptance, create orders, change inbound or approvals, or alter saved evidence. Historical packages are eligible. Batch reports never propagate to individual handoffs or overlapping batches. recorded_at is server recording time; no global external delivery state is inferred.',
          action === 'create'
            ? "client_event_id is unique across the organization's transfer reports or purchase reports respectively, regardless of key rotation. Identical retries return 200 with the original event; different target/content returns 409. First creation returns 201. No query parameters. JSON body maximum 8192 bytes. Existing keys receive no new scope. Reauthenticate even on retries."
            : action === 'list'
              ? 'Newest recorded_at then UUID ascending. The cursor binds organization, resource and parent. Its creation-time upper bound is not a transactional snapshot; concurrent commits/deletions may affect traversal. Reconcile with overlap and deduplicate by event ID. Only limit and cursor are accepted.'
              : 'The event must belong to this package and organization. Missing/other-organization records return 404. No query parameters.',
          `GET/HEAD require ${handoffReadScope(resource)}; POST requires ${acknowledgementScope(resource)}. Existing events have no PUT/PATCH/DELETE routes. All responses are no-store. Browser sessions are not API credentials.`,
        ].join('\n\n'),
        'x-maqdar-scopes': [
          action === 'create' ? acknowledgementScope(resource) : handoffReadScope(resource),
        ],
        parameters,
        ...(action === 'create'
          ? {
              requestBody: {
                required: true,
                content: { 'application/json': { schema: ref('HandoffAcknowledgementInput') } },
              },
            }
          : {}),
        responses: {
          '200': success,
          ...(action === 'create'
            ? {
                '201': { ...success, description: 'New event recorded.' },
                '409': {
                  description: 'Client event ID already identifies a different target/content.',
                  content: {
                    'application/problem+json': {
                      schema: { $ref: '#/components/schemas/Problem' },
                    },
                  },
                },
                '413': { $ref: '#/components/responses/PayloadTooLarge' },
                '415': { $ref: '#/components/responses/UnsupportedMediaType' },
                '422': {
                  description: 'Invalid acknowledgement fields.',
                  content: {
                    'application/problem+json': {
                      schema: { $ref: '#/components/schemas/Problem' },
                    },
                  },
                },
              }
            : {}),
          '400': { $ref: '#/components/responses/InvalidParameter' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '429': { $ref: '#/components/responses/TooManyRequests' },
          '500': { $ref: '#/components/responses/InternalError' },
          '503': { $ref: '#/components/responses/Unavailable' },
        },
      }
    }
  }
  return paths
}
