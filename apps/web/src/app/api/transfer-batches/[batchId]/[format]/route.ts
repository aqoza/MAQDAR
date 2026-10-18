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
import { batchCsv, batchJson, batchPayloadSchema } from '@/lib/transfer-batches'

const ROUTE = 'GET /api/transfer-batches/[batchId]/[format]'
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ batchId: string; format: string }> },
) {
  const auth = await requireSessionRoute()
  if (!auth.ok) return auth.response
  const context = await getActiveContext()
  if (!context?.active) return errorResponse(404, { code: 'MQ404' })
  const { batchId, format } = await params
  if (!parseUuid(batchId) || !['csv', 'json'].includes(format)) return badRequest('batch')
  const result = await auth.supabase
    .from('transfer_handoff_batches')
    .select('payload')
    .eq('organization_id', context.active.id)
    .eq('id', batchId)
    .maybeSingle()
  if (result.error) return rpcErrorResponse({ code: result.error.code }, ROUTE)
  if (!result.data) return errorResponse(404, { code: 'MQ404' })
  const parsed = batchPayloadSchema.safeParse(result.data.payload)
  if (!parsed.success) return errorResponse(500, { code: 'internal' })
  return new Response(format === 'csv' ? batchCsv(parsed.data) : batchJson(parsed.data), {
    headers: noStoreHeaders({
      'Content-Type':
        format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': attachmentDisposition(`transfer-handoff-batch-${batchId}.${format}`),
      'X-Content-Type-Options': 'nosniff',
    }),
  })
}
