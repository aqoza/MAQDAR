import type { NextRequest } from 'next/server'
import {
  badRequest,
  guardMutation,
  jsonResponse,
  parseUuid,
  rpcErrorResponse,
  runSteps,
  stepIsDone,
  unexpectedErrorResponse,
} from '@/lib/imports/route'
import { requireSessionRoute } from '@/lib/imports/route-auth'

const ROUTE = 'POST /api/imports/[id]/cancel'

type Params = { params: Promise<{ id: string }> }

/**
 * Cancels an import that is not committing: calls import_cancel_step (which marks the batch
 * canceled at once and removes staging rows in slices) until it reports `done` or about 20 s have
 * passed. 200 when done, 202 when staging rows remain (call again before deleting). Body: `{}`.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const guard = await guardMutation(request)
  if (!guard.ok) return guard.response
  const batchId = parseUuid((await params).id)
  if (!batchId) return badRequest('batch_id')

  const session = await requireSessionRoute()
  if (!session.ok) return session.response
  try {
    const outcome = await runSteps(
      () => session.supabase.rpc('import_cancel_step', { p_batch_id: batchId }),
      stepIsDone,
    )
    if (outcome.error) return rpcErrorResponse(outcome.error, ROUTE)
    return jsonResponse(outcome.last, outcome.done ? 200 : 202)
  } catch (error) {
    return unexpectedErrorResponse(error, ROUTE)
  }
}
