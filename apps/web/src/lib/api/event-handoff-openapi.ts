import { z } from 'zod'
import { eventCostReportSchema } from '../event-costs'
import { handoffPayloadSchema } from '../event-purchase-handoffs'
import { batchPayloadSchema } from '../event-handoff-batches'
import {
  HANDOFF_LIST_DEFAULT,
  HANDOFF_LIST_MAX,
  EVENT_HANDOFF_RESOURCES as HANDOFF_RESOURCES,
  EVENT_HANDOFF_SCOPE as HANDOFF_SCOPE,
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

export function eventHandoffSchemas(): Record<string, Schema> {
  // The runtime serializer's custom validator retains complete nested evidence.
  // This documentation-only shape describes its required fields without forbidding
  // additional original forecast/model evidence or reserializing API responses.
  const documentedHandoff = handoffPayloadSchema.extend({ estimate: eventCostReportSchema })
  const documentedBatch = batchPayloadSchema.extend({
    lines: z.array(documentedHandoff).min(1).max(50),
  })
  const savedSchema = (schema: typeof documentedHandoff | typeof documentedBatch) => {
    const result = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' })
    delete result.$schema
    return result
  }
  const record = {
    id: uuid,
    created_at: timestamp,
    summary: ref('schemas', 'EventHandoffSummary'),
    current: ref('schemas', 'EventHandoffSelection'),
  }
  return {
    EventHandoffSummary: object({
      selected_quantity_basis: { type: 'string', const: 'full_event_adjusted' },
      minor_units: { type: 'integer', minimum: 0, maximum: 3 },
      baseline_subtotal: {
        type: 'string',
        pattern: '^\\d+(\\.\\d+)?$',
        description: 'Saved baseline comparison, not an additional order.',
      },
      cost_increase: {
        type: 'string',
        pattern: '^\\d+(\\.\\d+)?$',
        description: 'Adjusted subtotal minus baseline subtotal, using saved rounded line costs.',
      },
      supplier_code: { type: 'string' },
      location_code: { type: 'string' },
      item_code: {
        type: ['string', 'null'],
        description: 'Null for a batch; inspect its saved lines.',
      },
      currency: { type: 'string', pattern: '^[A-Z]{3}$' },
      subtotal: {
        type: 'string',
        pattern: '^\\d+(\\.\\d+)?$',
        description:
          'Full event-adjusted selection as a saved decimal string; no currency conversion.',
      },
      order_date: { type: 'string', format: 'date' },
      line_count: { type: 'integer', minimum: 1, maximum: 50 },
      handoff_ids: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        uniqueItems: true,
        items: uuid,
        description: 'Original member IDs. May overlap other batches; does not reserve quantity.',
      },
    }),
    EventHandoffSelection: {
      ...object({ selected: { type: 'boolean' }, checked_at: timestamp }),
      description:
        'Live selection at request time, separate from saved evidence. For a batch, true only if every original member still exists and its proposal remains selected. This is not a current-price, timing, stock-availability or external-order check.',
    },
    EventHandoffRecord: object(record),
    EventHandoffPage: object({
      data: {
        type: 'array',
        maxItems: HANDOFF_LIST_MAX,
        items: ref('schemas', 'EventHandoffRecord'),
      },
      next_cursor: { type: ['string', 'null'], description: 'Opaque cursor, or null at the end.' },
      as_of: {
        ...timestamp,
        description:
          'Creation-time upper bound fixed by the first page; not a transaction snapshot or status watermark.',
      },
    }),
    EventPurchaseHandoffPayload: savedSchema(documentedHandoff),
    EventPurchaseHandoffBatchPayload: savedSchema(documentedBatch),
    EventPurchaseHandoffDetail: object({
      data: object({ ...record, payload: ref('schemas', 'EventPurchaseHandoffPayload') }),
    }),
    EventPurchaseHandoffBatchDetail: object({
      data: object({ ...record, payload: ref('schemas', 'EventPurchaseHandoffBatchPayload') }),
    }),
  }
}

export function eventHandoffPaths(): Record<string, Record<string, Schema>> {
  const paths: Record<string, Record<string, Schema>> = {}
  for (const resource of HANDOFF_RESOURCES) {
    for (const detail of [false, true]) {
      const id = handoffOperationId(resource, detail)
      const schema = detail
        ? resource === 'event-purchase-handoffs'
          ? 'EventPurchaseHandoffDetail'
          : 'EventPurchaseHandoffBatchDetail'
        : 'EventHandoffPage'
      paths[`/${resource}${detail ? '/{id}' : ''}`] = {
        get: {
          operationId: id,
          ...(deprecationFor(id) ? { deprecated: true } : {}),
          tags: ['Event purchase handoffs'],
          summary: detail ? 'Read saved planning evidence' : 'List saved planning packages',
          description: [
            'Organization-wide access requires event_purchase_handoffs:read. Includes current and historical records. Full adjusted selections and baseline comparisons remain independent of ordinary purchase packages. Existing scopes grant no event access. GET and HEAD never create orders, reserve quantities, acknowledge transmission or change evidence. Responses are private and no-store.',
            detail
              ? 'data.payload contains the original saved JSON values (including exact decimal strings), equivalent to the application JSON download. The API envelope and JSON whitespace/key order differ. data.current is checked separately at request time. No query parameters are accepted. Missing and other-organization IDs both return 404.'
              : 'Newest created_at first, then UUID ascending. Pass next_cursor unchanged with the same created_since until null; limit may change. created_since is inclusive and creation-based, not a selection-change feed. as_of excludes later creation times but does not provide transaction snapshot isolation: late commits or deletions can affect traversal. Reconcile with overlapping creation windows and deduplicate by ID; re-read known IDs for current selection. Unknown, repeated or empty parameters return 400.',
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
                ? 'Saved evidence and live selection.'
                : 'A page of saved summaries and live selection.',
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
