import { z } from 'zod'
import { parseHandoffQuery, isTransferHandoffResource, type ReadHandoffResource } from './handoffs'

export const ACKNOWLEDGE_SCOPE = 'purchase_handoffs:acknowledge' as const
export const TRANSFER_ACKNOWLEDGE_SCOPE = 'transfer_handoffs:acknowledge' as const
export function acknowledgementScope(resource: ReadHandoffResource) {
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
  resource: ReadHandoffResource,
  action: 'list' | 'get' | 'create',
) {
  const names = {
    'purchase-handoffs': 'PurchaseHandoff',
    'purchase-handoff-batches': 'PurchaseHandoffBatch',
    'transfer-handoffs': 'TransferHandoff',
    'transfer-handoff-batches': 'TransferHandoffBatch',
  } as const
  return `${action}${names[resource]}Acknowledgements`
}
