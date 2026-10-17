import type { NextRequest } from 'next/server'
import { handleResourceDetail, type ApiMethod } from '@/lib/api/handler'
import { apiDeps } from '@/lib/api/runtime'

// Saved handoffs have detail routes; unsupported nested paths retain JSON 404s.
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ resource: string; rest: string[] }> }
const route = (method: ApiMethod) => async (request: NextRequest, context: Context) => {
  const { resource, rest } = await context.params
  return handleResourceDetail(request, method, resource, rest, apiDeps)
}
export const GET = route('GET')
export const HEAD = route('HEAD')
export const POST = route('POST')
export const PUT = route('PUT')
export const PATCH = route('PATCH')
export const DELETE = route('DELETE')
export const OPTIONS = route('OPTIONS')
