import type { NextRequest } from 'next/server'
import {
  badRequest,
  guardMutation,
  jsonResponse,
  parseUuid,
  rpcErrorResponse,
  unexpectedErrorResponse,
} from '@/lib/imports/route'
import { requireSessionRoute } from '@/lib/imports/route-auth'

const ROUTE = 'POST /api/imports/[id]/resume'

type Params = { params: Promise<{ id: string }> }

/**
 * Takes a failed stepped commit back to committing (import_resume); the next commit call retries
 * the unit that failed. Body: `{}` (or empty).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const guard = await guardMutation(request)
  if (!guard.ok) return guard.response
  const batchId = parseUuid((await params).id)
  if (!batchId) return badRequest('batch_id')

  const session = await requireSessionRoute()
  if (!session.ok) return session.response
  try {
    const { data, error } = await session.supabase.rpc('import_resume', { p_batch_id: batchId })
    if (error) return rpcErrorResponse(error, ROUTE)
    return jsonResponse(data)
  } catch (error) {
    return unexpectedErrorResponse(error, ROUTE)
  }
}
