import type { NextRequest } from 'next/server'
import { getSessionClaims } from '@/lib/auth/session'
import { getEntity, isEntityName } from '@/lib/imports/contract'
import { csvReport } from '@/lib/imports/report'
import { attachmentDisposition, errorResponse, noStoreHeaders } from '@/lib/imports/route'

type Params = { params: Promise<{ entity: string }> }

/**
 * A header-only CSV template of an import entity: the contract's column names in contract order,
 * UTF-8 with BOM (so spreadsheets read Arabic values typed into it), named `<entity>.csv` so the
 * wizard recognizes the file when it comes back. 404 for an unknown entity.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  if (!(await getSessionClaims())) return errorResponse(401, { code: 'MQ401' })
  const { entity } = await params
  if (!isEntityName(entity)) return errorResponse(404, { code: 'MQ404', hint: 'entity' })

  const header = getEntity(entity).columns.map((column) => column.name)
  const body = [...csvReport(header, [])].join('')
  const headers = noStoreHeaders({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': attachmentDisposition(`${entity}.csv`),
    'X-Content-Type-Options': 'nosniff',
  })
  return new Response(body, { status: 200, headers })
}
