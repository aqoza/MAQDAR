import type { NextRequest } from 'next/server'
import {
  CHUNK_BODY_LIMIT,
  CHUNK_ROWS_LIMIT,
  INT4_MAX,
  MAX_FILE_NO,
  badRequest,
  errorResponse,
  guardChunkBody,
  jsonResponse,
  noStoreHeaders,
  parseIntSegment,
  parseUuid,
  rpcErrorResponse,
  stageChunkPayload,
  unexpectedErrorResponse,
} from '@/lib/imports/route'
import { callRpcRaw, requireSessionRoute } from '@/lib/imports/route-auth'

const ROUTE = 'PUT /api/imports/[id]/files/[fileNo]/chunks/[firstRow]'

type Params = { params: Promise<{ id: string; fileNo: string; firstRow: string }> }

/**
 * Stages one chunk: body `{rows: "<chunk text>"}`, where the text is the JSON array the chunk
 * builder produces (`[[row_no, cell, …], …]`). The text goes to import_stage_chunk as `p_rows`
 * without being parsed here; SQL checks its shape and every cell. An exact replay returns the
 * stored result. The text may hold at most 1,048,576 UTF-8 bytes (SQL answers MQ422 `rows`).
 *
 * The client's body is passed on as it is: its JSON string literal becomes `p_rows` of the RPC
 * body and the RPC's answer is returned as text, so the Worker neither decodes nor re-encodes the
 * megabyte (about 25 ms of CPU per chunk otherwise). A body in any other shape is parsed and sent
 * through supabase-js.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const guard = await guardChunkBody(request, { maxBytes: CHUNK_BODY_LIMIT })
  if (!guard.ok) return guard.response
  const { id, fileNo, firstRow } = await params
  const batchId = parseUuid(id)
  if (!batchId) return badRequest('batch_id')
  const fileNumber = parseIntSegment(fileNo, 1, MAX_FILE_NO)
  if (fileNumber === null) return badRequest('file_no')
  const firstRowNumber = parseIntSegment(firstRow, 1, INT4_MAX)
  if (firstRowNumber === null) return badRequest('first_row')

  let literal: string | null = null
  let rows: unknown = null
  if (guard.literal !== null) {
    literal = guard.literal
    if (literal.length <= 2) return badRequest('rows')
  } else {
    rows = guard.body.rows
    if (typeof rows !== 'string' || rows === '') return badRequest('rows')
    // UTF-8 needs at least one byte per UTF-16 unit, so this cheap bound never refuses a chunk
    // SQL would accept; SQL checks the exact byte length.
    if (rows.length > CHUNK_ROWS_LIMIT) {
      return errorResponse(413, { code: 'payload_too_large', hint: 'rows' })
    }
  }

  const session = await requireSessionRoute()
  if (!session.ok) return session.response
  try {
    if (literal !== null) {
      const result = await callRpcRaw(
        session.supabase,
        'import_stage_chunk',
        stageChunkPayload(batchId, fileNumber, firstRowNumber, literal),
      )
      if (result.kind === 'signed_out') return errorResponse(401, { code: 'MQ401' })
      if (result.kind === 'error') return rpcErrorResponse(result.error, ROUTE)
      const headers = noStoreHeaders({ 'Content-Type': 'application/json; charset=utf-8' })
      return new Response(result.body, { status: 200, headers })
    }
    const { data, error } = await session.supabase.rpc('import_stage_chunk', {
      p_batch_id: batchId,
      p_file_no: fileNumber,
      p_first_row: firstRowNumber,
      p_rows: rows as string,
    })
    if (error) return rpcErrorResponse(error, ROUTE)
    return jsonResponse(data)
  } catch (error) {
    return unexpectedErrorResponse(error, ROUTE)
  }
}
