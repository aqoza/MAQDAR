import type { NextRequest } from 'next/server'
import { handleResource, type ApiMethod } from '@/lib/api/handler'
import { apiDeps } from '@/lib/api/runtime'

// GET /api/v1/{resource} lists; POST /api/v1/{resource}:upsert upserts. Next.js hands over the
// decoded segment (`items:upsert`, also for `items%3Aupsert`); request.url keeps the escape, so
// routing uses params.resource. Every method is exported so a wrong one gets the 405 problem
// with this path's Allow (Next.js would send a bare 405) and HEAD and OPTIONS are explicit.
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ resource: string }> }

function handler(method: ApiMethod) {
  return async (request: NextRequest, { params }: Params) =>
    handleResource(request, method, (await params).resource, apiDeps)
}

export const GET = handler('GET')
export const HEAD = handler('HEAD')
export const POST = handler('POST')
export const PUT = handler('PUT')
export const PATCH = handler('PATCH')
export const DELETE = handler('DELETE')
export const OPTIONS = handler('OPTIONS')
