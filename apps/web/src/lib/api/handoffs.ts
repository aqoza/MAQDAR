import { z } from 'zod'
import { isRfc3339DateTime, isWellFormedCursor, type ListQueryFailure } from './cursor'

export const HANDOFF_RESOURCES = ['purchase-handoffs', 'purchase-handoff-batches'] as const
export type HandoffResource = (typeof HANDOFF_RESOURCES)[number]
export const HANDOFF_SCOPE = 'purchase_handoffs:read' as const
export const HANDOFF_LIST_DEFAULT = 25
export const HANDOFF_LIST_MAX = 100
export const HANDOFF_PARAMETERS = ['limit', 'cursor', 'created_since'] as const

export function isHandoffResource(value: string): value is HandoffResource {
  return (HANDOFF_RESOURCES as readonly string[]).includes(value)
}

export function handoffOperationId(resource: HandoffResource, detail: boolean): string {
  return `${detail ? 'get' : 'list'}${resource === 'purchase-handoffs' ? 'PurchaseHandoffs' : 'PurchaseHandoffBatches'}`
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
