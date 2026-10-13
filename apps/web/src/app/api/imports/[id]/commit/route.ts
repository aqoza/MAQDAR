import type { NextRequest } from 'next/server'
import {
  INT4_MAX,
  badRequest,
  guardMutation,
  jsonResponse,
  parseIntValue,
  parseUuid,
  rpcErrorResponse,
  runSteps,
  stepIsDone,
  unexpectedErrorResponse,
} from '@/lib/imports/route'
import { requireSessionRoute } from '@/lib/imports/route-auth'

const ROUTE = 'POST /api/imports/[id]/commit'

type Params = { params: Promise<{ id: string }> }

/**
 * Commits a validated import: calls import_commit_step until it reports `done` or about 20 s of
 * wall time have passed, then returns the last result: 200 when done (status succeeded, or
 * failed / invalid when a unit failed), 202 while the commit goes on (the client calls again).
 * A batch of at most 5,000 rows commits atomically in the first call. Body `{max_rows?}` caps
 * the rows per merge unit (the client lowers it after a 503 timeout). Lock conflicts are retried
 * briefly; after progress they end the loop with 202 instead of an error.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const guard = await guardMutation(request)
  if (!guard.ok) return guard.response
  const batchId = parseUuid((await params).id)
  if (!batchId) return badRequest('batch_id')
  const rawMaxRows = guard.body.max_rows
  const maxRows =
    rawMaxRows === undefined || rawMaxRows === null ? null : parseIntValue(rawMaxRows, 1, INT4_MAX)
  if (rawMaxRows !== undefined && rawMaxRows !== null && maxRows === null) {
    return badRequest('max_rows')
  }

  const session = await requireSessionRoute()
  if (!session.ok) return session.response
  try {
    const args =
      maxRows === null ? { p_batch_id: batchId } : { p_batch_id: batchId, p_max_rows: maxRows }
    const outcome = await runSteps(
      () => session.supabase.rpc('import_commit_step', args),
      stepIsDone,
    )
    if (outcome.error) return rpcErrorResponse(outcome.error, ROUTE)
    return jsonResponse(outcome.last, outcome.done ? 200 : 202)
  } catch (error) {
    return unexpectedErrorResponse(error, ROUTE)
  }
}
