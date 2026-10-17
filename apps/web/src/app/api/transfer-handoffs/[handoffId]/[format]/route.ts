import type { NextRequest } from 'next/server'
import { getActiveContext } from '@/lib/organizations/context'
import { requireSessionRoute } from '@/lib/imports/route-auth'
import {
  attachmentDisposition,
  badRequest,
  errorResponse,
  noStoreHeaders,
  parseUuid,
  rpcErrorResponse,
} from '@/lib/imports/route'
import { handoffCsv, handoffJson, handoffPayloadSchema } from '@/lib/transfer-handoffs'

const ROUTE = 'GET /api/transfer-handoffs/[handoffId]/[format]'
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ handoffId: string; format: string }> },
) {
  const auth = await requireSessionRoute()
  if (!auth.ok) return auth.response
  const context = await getActiveContext()
  if (!context?.active) return errorResponse(404, { code: 'MQ404' })
  const { handoffId, format } = await params
  if (!parseUuid(handoffId) || !['csv', 'json'].includes(format)) return badRequest('handoff')
  const result = await auth.supabase
    .from('transfer_handoffs')
    .select('payload')
    .eq('organization_id', context.active.id)
    .eq('id', handoffId)
    .maybeSingle()
  if (result.error) return rpcErrorResponse({ code: result.error.code }, ROUTE)
  if (!result.data) return errorResponse(404, { code: 'MQ404' })
  const parsed = handoffPayloadSchema.safeParse(result.data.payload)
  if (!parsed.success) return errorResponse(500, { code: 'internal' })
  const body = format === 'csv' ? handoffCsv(parsed.data) : handoffJson(parsed.data)
  return new Response(body, {
    headers: noStoreHeaders({
      'Content-Type':
        format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': attachmentDisposition(`transfer-handoff-${handoffId}.${format}`),
      'X-Content-Type-Options': 'nosniff',
    }),
  })
}
