import { z } from 'zod'
import {
  parseHandoffQuery,
  isNetworkHandoffResource,
  NETWORK_HANDOFF_RESOURCES,
  isTransferHandoffResource,
  isEventHandoffResource,
  isDispositionHandoffResource,
  DISPOSITION_HANDOFF_RESOURCES,
  EVENT_HANDOFF_RESOURCES,
  HANDOFF_RESOURCES,
  TRANSFER_HANDOFF_RESOURCES,
} from './handoffs'

// Reading a package does not enable acknowledgement routes for that resource.
export const ACKNOWLEDGEMENT_RESOURCES = [
  ...HANDOFF_RESOURCES,
  ...TRANSFER_HANDOFF_RESOURCES,
  ...EVENT_HANDOFF_RESOURCES,
  ...DISPOSITION_HANDOFF_RESOURCES,
  ...NETWORK_HANDOFF_RESOURCES,
] as const
export type AcknowledgementResource = (typeof ACKNOWLEDGEMENT_RESOURCES)[number]
export function isAcknowledgementResource(value: string): value is AcknowledgementResource {
  return (ACKNOWLEDGEMENT_RESOURCES as readonly string[]).includes(value)
}

export const ACKNOWLEDGE_SCOPE = 'purchase_handoffs:acknowledge' as const
export const TRANSFER_ACKNOWLEDGE_SCOPE = 'transfer_handoffs:acknowledge' as const
export const EVENT_ACKNOWLEDGE_SCOPE = 'event_purchase_handoffs:acknowledge' as const
export const DISPOSITION_ACKNOWLEDGE_SCOPE = 'excess_disposition_handoffs:acknowledge' as const
export const NETWORK_ACKNOWLEDGE_SCOPE = 'network_handoffs:acknowledge' as const
export function acknowledgementScope(resource: AcknowledgementResource) {
  if (isNetworkHandoffResource(resource)) return NETWORK_ACKNOWLEDGE_SCOPE
  if (isDispositionHandoffResource(resource)) return DISPOSITION_ACKNOWLEDGE_SCOPE
  if (isEventHandoffResource(resource)) return EVENT_ACKNOWLEDGE_SCOPE
  return isTransferHandoffResource(resource) ? TRANSFER_ACKNOWLEDGE_SCOPE : ACKNOWLEDGE_SCOPE
}
export const ACKNOWLEDGEMENT_BODY_BYTES = 8192

const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) => value.trim().length > 0 && !/[\u0000-\u001f\u007f-\u009f]/.test(value),
      'Supply nonblank text without control characters.',
    )

export const acknowledgementInputSchema = z
  .strictObject({
    client_event_id: z.uuid().transform((value) => value.toLowerCase()),
    external_system: text(80),
    external_reference: text(200),
    status: z.enum(['received', 'rejected']),
    reason: text(1000).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'rejected' && !value.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A rejection requires a reason.' })
    }
  })
export type AcknowledgementInput = z.infer<typeof acknowledgementInputSchema>

export function parseAcknowledgementQuery(params: URLSearchParams) {
  if (params.has('created_since'))
    return {
      ok: false as const,
      code: 'invalid_parameter' as const,
      errors: [{ parameter: 'created_since', detail: 'Unknown parameter; use limit and cursor.' }],
    }
  return parseHandoffQuery(params)
}

export function acknowledgementOperationId(
  resource: AcknowledgementResource,
  action: 'list' | 'get' | 'create',
) {
  const names = {
    'network-handoffs': 'NetworkHandoff',
    'network-handoff-batches': 'NetworkHandoffBatch',
    'excess-disposition-handoffs': 'ExcessDispositionHandoff',
    'excess-disposition-handoff-batches': 'ExcessDispositionHandoffBatch',
    'event-purchase-handoffs': 'EventPurchaseHandoff',
    'event-purchase-handoff-batches': 'EventPurchaseHandoffBatch',
    'purchase-handoffs': 'PurchaseHandoff',
    'purchase-handoff-batches': 'PurchaseHandoffBatch',
    'transfer-handoffs': 'TransferHandoff',
    'transfer-handoff-batches': 'TransferHandoffBatch',
  } as const
  return `${action}${names[resource]}Acknowledgements`
}
