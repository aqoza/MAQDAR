import { getTranslations } from 'next-intl/server'
import type { NextRequest } from 'next/server'
import { csvReportStream, type ReportField } from '@/lib/imports/report'
import {
  ERROR_REPORT_HEADER,
  ERROR_REPORT_PAGE,
  attachmentDisposition,
  badRequest,
  errorMessageFormatter,
  errorReportFields,
  errorResponse,
  noStoreHeaders,
  parseUuid,
  rpcErrorResponse,
  unexpectedErrorResponse,
  unlistedReportLines,
  type ImportErrorRow,
  type ReportFile,
} from '@/lib/imports/route'
import { requireEditorRoute } from '@/lib/imports/route-auth'

const ROUTE = 'GET /api/imports/[id]/errors'

type Params = { params: Promise<{ id: string }> }

const ERROR_COLUMNS = 'id, file_no, row_no, column_name, code, level, value, detail'

/**
 * The error report of an import as a CSV download: every stored error and warning, read through
 * RLS in keyset pages of 1,000 by id and streamed as the client reads (UTF-8 with BOM, every field
 * quoted, formula injection neutralized; see report.ts), then one line per file whose details
 * were not all stored (at most 10,000 per file) with the complete totals per code. Messages come
 * from the ImportErrors namespace in the user's language.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireEditorRoute()
  if (!auth.ok) return auth.response
  const batchId = parseUuid((await params).id)
  if (!batchId) return badRequest('batch_id')

  try {
    const [batch, files] = await Promise.all([
      auth.supabase
        .from('import_batches')
        .select('id')
        .eq('organization_id', auth.organizationId)
        .eq('id', batchId)
        .maybeSingle(),
      auth.supabase
        .from('import_files')
        .select('file_no, original_name, error_count, warning_count, errors_stored, error_counts')
        .eq('organization_id', auth.organizationId)
        .eq('batch_id', batchId),
    ])
    if (batch.error) return rpcErrorResponse(batch.error, ROUTE)
    if (!batch.data) return errorResponse(404, { code: 'MQ404', hint: 'batch_id' })
    if (files.error) return rpcErrorResponse(files.error, ROUTE)
    const fileNames = new Map((files.data ?? []).map((file) => [file.file_no, file.original_name]))

    const fetchPage = (afterId: number) =>
      auth.supabase
        .from('import_errors')
        .select(ERROR_COLUMNS)
        .eq('organization_id', auth.organizationId)
        .eq('batch_id', batchId)
        .gt('id', afterId)
        .order('id')
        .limit(ERROR_REPORT_PAGE)
    // The first page is read before answering, so a failing query still gets a proper status.
    const first = await fetchPage(0)
    if (first.error) return rpcErrorResponse(first.error, ROUTE)

    const t = await getTranslations('ImportErrors')
    type Key = Parameters<typeof t>[0]
    const message = errorMessageFormatter({
      has: (code) => t.has(code as Key),
      raw: (code) => t.raw(code as Key),
      format: (code, values) => t(code as Key, values),
    })

    const tReport = await getTranslations('Imports.report')
    const unlisted = unlistedReportLines((files.data ?? []) as ReportFile[], (values) =>
      tReport('notListed', values),
    )
    const rows = reportRows(
      first.data as ImportErrorRow[],
      fetchPage,
      (row) => {
        const fileName = fileNames.get(row.file_no) ?? ''
        return errorReportFields(row, fileName, message(row, fileName))
      },
      unlisted,
    )
    const headers = noStoreHeaders({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': attachmentDisposition(`import-errors-${batchId.slice(0, 8)}.csv`),
      'X-Content-Type-Options': 'nosniff',
    })
    return new Response(csvReportStream(ERROR_REPORT_HEADER, rows), { status: 200, headers })
  } catch (error) {
    return unexpectedErrorResponse(error, ROUTE)
  }
}

/**
 * Report lines, page by page, then the closing lines; a page that fails after the download started
 * ends the stream.
 */
async function* reportRows(
  first: ImportErrorRow[],
  fetchPage: (afterId: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  toFields: (row: ImportErrorRow) => ReportField[],
  closing: readonly ReportField[][],
): AsyncGenerator<ReportField[], void, undefined> {
  let page = first
  for (;;) {
    for (const row of page) yield toFields(row)
    const last = page.at(-1)
    if (page.length < ERROR_REPORT_PAGE || !last) {
      yield* closing
      return
    }
    const next = await fetchPage(last.id)
    if (next.error) {
      console.error('imports route failed', { route: ROUTE, message: next.error.message })
      throw new Error('error report page failed')
    }
    page = (next.data ?? []) as ImportErrorRow[]
  }
}
