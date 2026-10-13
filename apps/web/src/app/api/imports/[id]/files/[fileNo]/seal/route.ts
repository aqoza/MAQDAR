import type { NextRequest } from 'next/server'
import {
  INT4_MAX,
  MAX_FILE_NO,
  badRequest,
  guardMutation,
  jsonResponse,
  parseIntSegment,
  parseIntValue,
  parseUuid,
  rpcErrorResponse,
  unexpectedErrorResponse,
} from '@/lib/imports/route'
import { requireSessionRoute } from '@/lib/imports/route-auth'

const ROUTE = 'POST /api/imports/[id]/files/[fileNo]/seal'

type Params = { params: Promise<{ id: string; fileNo: string }> }

/**
 * Seals a file once all its chunks are staged: body `{rows_total}` (the parser's row count) goes
 * to import_seal_file, which checks the chunks are contiguous, runs the set rules and verifies the
 * original in Storage. Sealing the last file validates the batch. A repeat returns the state.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const guard = await guardMutation(request)
  if (!guard.ok) return guard.response
  const { id, fileNo } = await params
  const batchId = parseUuid(id)
  if (!batchId) return badRequest('batch_id')
  const fileNumber = parseIntSegment(fileNo, 1, MAX_FILE_NO)
  if (fileNumber === null) return badRequest('file_no')
  const rowsTotal = parseIntValue(guard.body.rows_total, 0, INT4_MAX)
  if (rowsTotal === null) return badRequest('rows_total')

  const session = await requireSessionRoute()
  if (!session.ok) return session.response
  try {
    const { data, error } = await session.supabase.rpc('import_seal_file', {
      p_batch_id: batchId,
      p_file_no: fileNumber,
      p_rows_total: rowsTotal,
    })
    if (error) return rpcErrorResponse(error, ROUTE)
    return jsonResponse(data)
  } catch (error) {
    return unexpectedErrorResponse(error, ROUTE)
  }
}
