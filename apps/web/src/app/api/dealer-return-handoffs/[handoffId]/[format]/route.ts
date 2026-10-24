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
import {
  returnHandoffCsv,
  returnHandoffJson,
  returnHandoffPayloadSchema,
} from '@/lib/dealer-return-handoffs'

const ROUTE = 'GET /api/dealer-return-handoffs/[handoffId]/[format]'
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
    .from('dealer_return_handoffs')
    .select('payload')
    .eq('organization_id', context.active.id)
    .eq('id', handoffId)
    .maybeSingle()
  if (result.error) return rpcErrorResponse({ code: result.error.code }, ROUTE)
  if (!result.data) return errorResponse(404, { code: 'MQ404' })
  const parsed = returnHandoffPayloadSchema.safeParse(result.data.payload)
  if (!parsed.success) return errorResponse(500, { code: 'internal' })
  const body = format === 'csv' ? returnHandoffCsv(parsed.data) : returnHandoffJson(parsed.data)
  return new Response(body, {
    headers: noStoreHeaders({
      'Content-Type':
        format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': attachmentDisposition(`dealer-return-handoff-${handoffId}.${format}`),
      'X-Content-Type-Options': 'nosniff',
    }),
  })
}
