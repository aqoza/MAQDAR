import type { NextRequest } from 'next/server'
import { notFound } from '@/lib/api/handler'
import { apiDeps } from '@/lib/api/runtime'

// Anything below a resource (/api/v1/items/x, /api/v1/organization/x): a 404 problem for every
// method, instead of the app's HTML not-found page.
export const dynamic = 'force-dynamic'

export const GET = (request: NextRequest) => notFound(request, 'GET', apiDeps)
export const HEAD = (request: NextRequest) => notFound(request, 'HEAD', apiDeps)
export const POST = (request: NextRequest) => notFound(request, 'POST', apiDeps)
export const PUT = (request: NextRequest) => notFound(request, 'PUT', apiDeps)
export const PATCH = (request: NextRequest) => notFound(request, 'PATCH', apiDeps)
export const DELETE = (request: NextRequest) => notFound(request, 'DELETE', apiDeps)
export const OPTIONS = (request: NextRequest) => notFound(request, 'OPTIONS', apiDeps)
