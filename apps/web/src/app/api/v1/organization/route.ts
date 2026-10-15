import type { NextRequest } from 'next/server'
import { handleOrganization } from '@/lib/api/handler'
import { apiDeps } from '@/lib/api/runtime'

// GET /api/v1/organization: the key and its organization (any valid key). Other methods get the
// 405 problem with Allow (Next.js would answer them with a bare 405).
export const dynamic = 'force-dynamic'

export const GET = (request: NextRequest) => handleOrganization(request, 'GET', apiDeps)
export const HEAD = (request: NextRequest) => handleOrganization(request, 'HEAD', apiDeps)
export const OPTIONS = (request: NextRequest) => handleOrganization(request, 'OPTIONS', apiDeps)
export const POST = (request: NextRequest) => handleOrganization(request, 'POST', apiDeps)
export const PUT = (request: NextRequest) => handleOrganization(request, 'PUT', apiDeps)
export const PATCH = (request: NextRequest) => handleOrganization(request, 'PATCH', apiDeps)
export const DELETE = (request: NextRequest) => handleOrganization(request, 'DELETE', apiDeps)
