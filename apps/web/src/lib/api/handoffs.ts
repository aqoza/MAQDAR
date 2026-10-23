import { z } from 'zod'
import { isRfc3339DateTime, isWellFormedCursor, type ListQueryFailure } from './cursor'

export const HANDOFF_RESOURCES = ['purchase-handoffs', 'purchase-handoff-batches'] as const
export type HandoffResource = (typeof HANDOFF_RESOURCES)[number]
export const TRANSFER_HANDOFF_RESOURCES = ['transfer-handoffs', 'transfer-handoff-batches'] as const
export type TransferHandoffResource = (typeof TRANSFER_HANDOFF_RESOURCES)[number]
export const EVENT_HANDOFF_RESOURCES = [
  'event-purchase-handoffs',
  'event-purchase-handoff-batches',
] as const
export type EventHandoffResource = (typeof EVENT_HANDOFF_RESOURCES)[number]
export const EVENT_HANDOFF_SCOPE = 'event_purchase_handoffs:read' as const
export const DISPOSITION_HANDOFF_RESOURCES = [
  'excess-disposition-handoffs',
  'excess-disposition-handoff-batches',
] as const
export type DispositionHandoffResource = (typeof DISPOSITION_HANDOFF_RESOURCES)[number]
export const DISPOSITION_HANDOFF_SCOPE = 'excess_disposition_handoffs:read' as const
export const NETWORK_HANDOFF_RESOURCES = ['network-handoffs', 'network-handoff-batches'] as const
export type NetworkHandoffResource = (typeof NETWORK_HANDOFF_RESOURCES)[number]
export const NETWORK_HANDOFF_SCOPE = 'network_handoffs:read' as const
export const REGIONAL_HANDOFF_RESOURCES = ['regional-handoffs', 'regional-handoff-batches'] as const
export type RegionalHandoffResource = (typeof REGIONAL_HANDOFF_RESOURCES)[number]
export const REGIONAL_HANDOFF_SCOPE = 'regional_handoffs:read' as const
export const READ_HANDOFF_RESOURCES = [
  ...HANDOFF_RESOURCES,
  ...TRANSFER_HANDOFF_RESOURCES,
  ...EVENT_HANDOFF_RESOURCES,
  ...DISPOSITION_HANDOFF_RESOURCES,
  ...NETWORK_HANDOFF_RESOURCES,
  ...REGIONAL_HANDOFF_RESOURCES,
] as const
export type ReadHandoffResource = (typeof READ_HANDOFF_RESOURCES)[number]
export const TRANSFER_HANDOFF_SCOPE = 'transfer_handoffs:read' as const
export const HANDOFF_SCOPE = 'purchase_handoffs:read' as const
export const HANDOFF_LIST_DEFAULT = 25
export const HANDOFF_LIST_MAX = 100
export const HANDOFF_PARAMETERS = ['limit', 'cursor', 'created_since'] as const

export function isHandoffResource(value: string): value is HandoffResource {
  return (HANDOFF_RESOURCES as readonly string[]).includes(value)
}

export function isTransferHandoffResource(value: string): value is TransferHandoffResource {
  return (TRANSFER_HANDOFF_RESOURCES as readonly string[]).includes(value)
}
export function isEventHandoffResource(value: string): value is EventHandoffResource {
  return (EVENT_HANDOFF_RESOURCES as readonly string[]).includes(value)
}
export function isDispositionHandoffResource(value: string): value is DispositionHandoffResource {
  return (DISPOSITION_HANDOFF_RESOURCES as readonly string[]).includes(value)
}
export function isNetworkHandoffResource(value: string): value is NetworkHandoffResource {
  return (NETWORK_HANDOFF_RESOURCES as readonly string[]).includes(value)
}
export function isRegionalHandoffResource(value: string): value is RegionalHandoffResource {
  return (REGIONAL_HANDOFF_RESOURCES as readonly string[]).includes(value)
}
export function isReadHandoffResource(value: string): value is ReadHandoffResource {
  return (
    isHandoffResource(value) ||
    isTransferHandoffResource(value) ||
    isEventHandoffResource(value) ||
    isDispositionHandoffResource(value) ||
    isNetworkHandoffResource(value) ||
    isRegionalHandoffResource(value)
  )
}
export function handoffReadScope(resource: ReadHandoffResource) {
  if (isRegionalHandoffResource(resource)) return REGIONAL_HANDOFF_SCOPE
  if (isNetworkHandoffResource(resource)) return NETWORK_HANDOFF_SCOPE
  if (isDispositionHandoffResource(resource)) return DISPOSITION_HANDOFF_SCOPE
  return isEventHandoffResource(resource)
    ? EVENT_HANDOFF_SCOPE
    : isTransferHandoffResource(resource)
      ? TRANSFER_HANDOFF_SCOPE
      : HANDOFF_SCOPE
}
export function handoffOperationId(resource: ReadHandoffResource, detail: boolean): string {
  const names = {
    'regional-handoffs': 'RegionalHandoffs',
    'regional-handoff-batches': 'RegionalHandoffBatches',
    'network-handoffs': 'NetworkHandoffs',
    'network-handoff-batches': 'NetworkHandoffBatches',
    'excess-disposition-handoffs': 'ExcessDispositionHandoffs',
    'excess-disposition-handoff-batches': 'ExcessDispositionHandoffBatches',
    'event-purchase-handoffs': 'EventPurchaseHandoffs',
    'event-purchase-handoff-batches': 'EventPurchaseHandoffBatches',
    'purchase-handoffs': 'PurchaseHandoffs',
    'purchase-handoff-batches': 'PurchaseHandoffBatches',
    'transfer-handoffs': 'TransferHandoffs',
    'transfer-handoff-batches': 'TransferHandoffBatches',
  } as const
  return `${detail ? 'get' : 'list'}${names[resource]}`
}

export const handoffIdSchema = z.uuid()

export function parseHandoffQuery(
  params: URLSearchParams,
):
  | { ok: true; limit: number; cursor: string | null; createdSince: string | null }
  | ListQueryFailure {
  const errors: { parameter: string; detail: string }[] = []
  const seen = new Set<string>()
  for (const [name, value] of params) {
    if (!(HANDOFF_PARAMETERS as readonly string[]).includes(name)) {
      errors.push({ parameter: name.slice(0, 64), detail: 'Unknown parameter.' })
    } else if (seen.has(name) || value === '') {
      errors.push({ parameter: name, detail: 'Supply a nonempty value once.' })
    }
    seen.add(name)
  }
  const rawLimit = params.get('limit')
  const limit = rawLimit === null ? HANDOFF_LIST_DEFAULT : Number(rawLimit)
  if (rawLimit !== null && (!/^[1-9]\d{0,2}$/.test(rawLimit) || limit > HANDOFF_LIST_MAX)) {
    errors.push({
      parameter: 'limit',
      detail: `Must be a whole number from 1 to ${HANDOFF_LIST_MAX}.`,
    })
  }
  const cursor = params.get('cursor')
  if (cursor !== null && !isWellFormedCursor(cursor)) {
    errors.push({ parameter: 'cursor', detail: 'Pass the previous next_cursor unchanged.' })
  }
  const createdSince = params.get('created_since')
  if (createdSince !== null && !isRfc3339DateTime(createdSince)) {
    errors.push({
      parameter: 'created_since',
      detail: 'Must be an RFC 3339 timestamp with an offset.',
    })
  }
  if (errors.length) {
    return {
      ok: false,
      code: errors.every((e) => e.parameter === 'cursor') ? 'invalid_cursor' : 'invalid_parameter',
      errors,
    }
  }
  return { ok: true, limit, cursor, createdSince }
}
