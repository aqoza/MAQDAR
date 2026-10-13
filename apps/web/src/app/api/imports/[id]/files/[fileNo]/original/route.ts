import type { NextRequest } from 'next/server'
import {
  IMPORTS_BUCKET,
  MAX_FILE_NO,
  ORIGINAL_URL_SECONDS,
  badRequest,
  errorResponse,
  parseIntSegment,
  parseUuid,
  redirectResponse,
  rpcErrorResponse,
  unexpectedErrorResponse,
} from '@/lib/imports/route'
import { requireEditorRoute } from '@/lib/imports/route-auth'

const ROUTE = 'GET /api/imports/[id]/files/[fileNo]/original'

type Params = { params: Promise<{ id: string; fileNo: string }> }

/**
 * Downloads the original of a file: a 302 to a signed Storage URL that lives 60 seconds, signed
 * with the user's client (the Storage select policy applies) and served as an attachment under
 * the uploaded file name. 404 `original` when the original never reached Storage.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireEditorRoute()
  if (!auth.ok) return auth.response
  const { id, fileNo } = await params
  const batchId = parseUuid(id)
  if (!batchId) return badRequest('batch_id')
  const fileNumber = parseIntSegment(fileNo, 1, MAX_FILE_NO)
  if (fileNumber === null) return badRequest('file_no')

  try {
    const file = await auth.supabase
      .from('import_files')
      .select('storage_path, original_name')
      .eq('organization_id', auth.organizationId)
      .eq('batch_id', batchId)
      .eq('file_no', fileNumber)
      .maybeSingle()
    if (file.error) return rpcErrorResponse(file.error, ROUTE)
    if (!file.data) return errorResponse(404, { code: 'MQ404', hint: 'file_no' })

    const { data, error } = await auth.supabase.storage
      .from(IMPORTS_BUCKET)
      .createSignedUrl(file.data.storage_path, ORIGINAL_URL_SECONDS)
    if (error || !data?.signedUrl) {
      const status = error && 'status' in error ? error.status : undefined
      if (status === 400 || status === 404 || /not found/i.test(error?.message ?? '')) {
        return errorResponse(404, { code: 'MQ404', hint: 'original' })
      }
      return rpcErrorResponse({ code: 'storage', message: error?.message ?? 'no URL' }, ROUTE)
    }
    // storage-js would percent-encode the download name twice (URLSearchParams, then encodeURI),
    // so the name is appended here, encoded once; Storage sends it back in Content-Disposition.
    const separator = data.signedUrl.includes('?') ? '&' : '?'
    const location = `${data.signedUrl}${separator}download=${encodeURIComponent(file.data.original_name)}`
    return redirectResponse(location, 302)
  } catch (error) {
    return unexpectedErrorResponse(error, ROUTE)
  }
}
