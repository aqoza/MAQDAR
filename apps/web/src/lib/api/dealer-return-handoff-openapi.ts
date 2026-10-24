import { z } from 'zod'
import { returnHandoffPayloadSchema as handoffPayloadSchema } from '../dealer-return-handoffs'
import { returnBatchPayloadSchema as batchPayloadSchema } from '../dealer-return-batches'
import {
  HANDOFF_LIST_DEFAULT,
  HANDOFF_LIST_MAX,
  RETURN_HANDOFF_RESOURCES as HANDOFF_RESOURCES,
  RETURN_HANDOFF_SCOPE as HANDOFF_SCOPE,
  handoffOperationId,
} from './handoffs'
import { deprecationFor } from './versioning'
import type { Schema } from './openapi'

const ref = (kind: string, name: string) => ({ $ref: `#/components/${kind}/${name}` })
const uuid = { type: 'string', format: 'uuid' }
const timestamp = { type: 'string', format: 'date-time' }
const object = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  required: Object.keys(properties),
  properties,
})

export function dealerReturnHandoffSchemas(): Record<string, Schema> {
  const documentedHandoff = handoffPayloadSchema
  const documentedBatch = batchPayloadSchema
  const savedSchema = (schema: typeof documentedHandoff | typeof documentedBatch) => {
    const result = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' })
    delete result.$schema
    return result
  }
  const record = {
    id: uuid,
    created_at: timestamp,
    summary: ref('schemas', 'DealerReturnHandoffSummary'),
    current: ref('schemas', 'DealerReturnHandoffSourceContext'),
  }
  return {
    DealerReturnHandoffSummary: object({
      source_code: { type: 'string' },
      location_code: { type: 'string' },
      requested_return_date: {
        type: 'string',
        format: 'date',
        description: 'Declared requested date, not a scheduled receipt.',
      },
      item_code: {
        type: ['string', 'null'],
        description:
          'Null for batches; quantities and conditions remain separate in each saved line.',
      },
      handoff_count: { type: 'integer', minimum: 1, maximum: 50 },
      handoff_ids: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        uniqueItems: true,
        items: uuid,
        description: 'Original member IDs. May overlap other batches; does not reserve quantity.',
      },
    }),
    DealerReturnHandoffSourceContext: {
      ...object({
        sources_available: { type: 'boolean' },
        checked_at: timestamp,
      }),
      description:
        'Current existence of every original handoff/request, separate from saved authorization. Missing sources never invalidate copied batch files. This does not recheck catalog evidence, eligibility, live stock, or execution.',
    },
    DealerReturnHandoffRecord: object(record),
    DealerReturnHandoffPage: object({
      data: {
        type: 'array',
        maxItems: HANDOFF_LIST_MAX,
        items: ref('schemas', 'DealerReturnHandoffRecord'),
      },
      next_cursor: { type: ['string', 'null'], description: 'Opaque cursor, or null at the end.' },
      as_of: {
        ...timestamp,
        description:
          'Creation-time upper bound fixed by the first page; not a transaction snapshot or status watermark.',
      },
    }),
    DealerReturnHandoffPayload: savedSchema(documentedHandoff),
    DealerReturnHandoffBatchPayload: savedSchema(documentedBatch),
    DealerReturnHandoffDetail: object({
      data: object({ ...record, payload: ref('schemas', 'DealerReturnHandoffPayload') }),
    }),
    DealerReturnHandoffBatchDetail: object({
      data: object({ ...record, payload: ref('schemas', 'DealerReturnHandoffBatchPayload') }),
    }),
  }
}

export function dealerReturnHandoffPaths(): Record<string, Record<string, Schema>> {
  const paths: Record<string, Record<string, Schema>> = {}
  for (const resource of HANDOFF_RESOURCES) {
    for (const detail of [false, true]) {
      const id = handoffOperationId(resource, detail)
      const schema = detail
        ? resource === 'dealer-return-handoffs'
          ? 'DealerReturnHandoffDetail'
          : 'DealerReturnHandoffBatchDetail'
        : 'DealerReturnHandoffPage'
      paths[`/${resource}${detail ? '/{id}' : ''}`] = {
        get: {
          operationId: id,
          ...(deprecationFor(id) ? { deprecated: true } : {}),
          tags: ['Dealer-return handoffs'],
          summary: detail
            ? 'Read saved return authorization'
            : 'List saved return authorization packages',
          description: [
            'Organization-wide access requires dealer_return_handoffs:read. Other scopes grant no return access. Original declarations and approval evidence remain fixed, with exact quantity strings and separate conditions. Requested return dates are not scheduled receipts. Copied batches survive source-request deletion; individual handoffs follow their actual request parent. GET and HEAD create no acknowledgements; reporting uses separate acknowledgement endpoints and permission. These reads create no physical receiving, credits, reservations, inbound or stock changes. Responses are private and no-store.',
            detail
              ? 'data.payload contains the original saved JSON values (including exact decimal strings), equivalent to the application JSON download. The API envelope and JSON whitespace/key order differ. data.current is checked separately at request time. No query parameters are accepted. Missing and other-organization IDs both return 404.'
              : 'Newest created_at first, then UUID ascending. Pass next_cursor unchanged with the same created_since until null; limit may change. created_since is inclusive and creation-based, not a source-change feed. as_of excludes later creation times but does not provide transaction snapshot isolation: late commits or deletions can affect traversal. Reconcile with overlapping creation windows and deduplicate by ID; re-read known IDs for source availability. Unknown, repeated or empty parameters return 400.',
          ].join('\n\n'),
          'x-zeespare-scopes': [HANDOFF_SCOPE],
          parameters: detail
            ? [{ name: 'id', in: 'path', required: true, schema: uuid }]
            : [
                {
                  name: 'limit',
                  in: 'query',
                  schema: {
                    type: 'integer',
                    minimum: 1,
                    maximum: HANDOFF_LIST_MAX,
                    default: HANDOFF_LIST_DEFAULT,
                  },
                },
                ref('parameters', 'Cursor'),
                {
                  name: 'created_since',
                  in: 'query',
                  description:
                    'Inclusive RFC 3339 timestamp with offset. Keep unchanged while following a cursor.',
                  schema: timestamp,
                },
              ],
          responses: {
            '200': {
              description: detail
                ? 'Saved evidence and live source availability.'
                : 'A page of saved summaries and live source availability.',
              headers: { 'X-Request-Id': ref('headers', 'X-Request-Id') },
              content: { 'application/json': { schema: ref('schemas', schema) } },
            },
            '400': ref('responses', 'InvalidParameter'),
            '401': ref('responses', 'Unauthorized'),
            '403': ref('responses', 'Forbidden'),
            ...(detail ? { '404': ref('responses', 'NotFound') } : {}),
            '429': ref('responses', 'TooManyRequests'),
            '500': ref('responses', 'InternalError'),
            '503': ref('responses', 'Unavailable'),
          },
        },
      }
    }
  }
  return paths
}
