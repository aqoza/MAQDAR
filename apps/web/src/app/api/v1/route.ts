import type { NextRequest } from 'next/server'
import { handleIndex } from '@/lib/api/handler'
import { apiDeps } from '@/lib/api/runtime'

// GET /api/v1: where the OpenAPI document and the documentation are. No key needed.
export const dynamic = 'force-dynamic'

export const GET = (request: NextRequest) => handleIndex(request, 'GET', apiDeps)
export const HEAD = (request: NextRequest) => handleIndex(request, 'HEAD', apiDeps)
export const OPTIONS = (request: NextRequest) => handleIndex(request, 'OPTIONS', apiDeps)
export const POST = (request: NextRequest) => handleIndex(request, 'POST', apiDeps)
export const PUT = (request: NextRequest) => handleIndex(request, 'PUT', apiDeps)
export const PATCH = (request: NextRequest) => handleIndex(request, 'PATCH', apiDeps)
export const DELETE = (request: NextRequest) => handleIndex(request, 'DELETE', apiDeps)
