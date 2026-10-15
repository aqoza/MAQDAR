import type { NextRequest } from 'next/server'
import { handleOpenApi, openApiSource } from '@/lib/api/handler'
import document from '@/lib/api/openapi.json'
import { apiDeps } from '@/lib/api/runtime'

// GET /api/v1/openapi.json: the committed OpenAPI document, public and cacheable
// (Cache-Control: public, max-age=300; a strong ETag with 304; Access-Control-Allow-Origin: *).
// Re-serializing the imported JSON reproduces the committed file byte for byte (it is written
// with JSON.stringify(…, null, 2) and a final newline; handler.test.ts checks it). The text and
// its ETag are computed once per isolate, on the first request.
export const dynamic = 'force-dynamic'

const source = openApiSource(() => `${JSON.stringify(document, null, 2)}\n`)

export const GET = (request: NextRequest) => handleOpenApi(request, 'GET', source, apiDeps)
export const HEAD = (request: NextRequest) => handleOpenApi(request, 'HEAD', source, apiDeps)
export const OPTIONS = (request: NextRequest) => handleOpenApi(request, 'OPTIONS', source, apiDeps)
export const POST = (request: NextRequest) => handleOpenApi(request, 'POST', source, apiDeps)
export const PUT = (request: NextRequest) => handleOpenApi(request, 'PUT', source, apiDeps)
export const PATCH = (request: NextRequest) => handleOpenApi(request, 'PATCH', source, apiDeps)
export const DELETE = (request: NextRequest) => handleOpenApi(request, 'DELETE', source, apiDeps)
