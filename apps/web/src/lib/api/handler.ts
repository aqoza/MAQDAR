import type { EntityName } from '../imports/contract'
import {
  acknowledgementScope,
  isAcknowledgementResource,
  type AcknowledgementResource,
  ACKNOWLEDGEMENT_BODY_BYTES,
  acknowledgementInputSchema,
  acknowledgementOperationId,
  parseAcknowledgementQuery,
  type AcknowledgementInput,
} from './acknowledgements'
import {
  handoffReadScope,
  isReadHandoffResource,
  isTransferHandoffResource,
  isEventHandoffResource,
  isDispositionHandoffResource,
  isNetworkHandoffResource,
  isRegionalHandoffResource,
  type ReadHandoffResource,
  handoffIdSchema,
  handoffOperationId,
  parseHandoffQuery,
} from './handoffs'
import { readBodyText } from '../imports/route'
import {
  credentialProblem,
  readCredential,
  resolvePendingProblem,
  scopeFor,
  type ApiScope,
} from './auth'
import type { ApiPlatform } from './bindings'
import { listRpcCall, parseListQuery, type ListQueryFailure, type ParameterIssue } from './cursor'
import { hashApiKey, type KeyHash } from './keys'
import { API_LIMITS } from './limits'
import { logApiRequest, type ApiLogger } from './log'
import {
  API_CACHE_CONTROL,
  JSON_CONTENT_TYPE,
  apiProblemFor,
  bodyReadProblem,
  jsonResponse,
  mapUpsertResult,
  parameterProblem,
  problemResponse,
  requestProblem,
  serverTiming,
  toProblem,
  type ApiProblem,
} from './problem'
import { applyLimits } from './rate-limit'
import { validateUpsertBody } from './records'
import {
  API_DOCS_URL,
  OPENAPI_PATH,
  ORGANIZATION_OPERATION_ID,
  allowHeader,
  methodHint,
  operationId,
  parseResourceSegment,
  type ApiResource,
  type ResourceRoute,
} from './resources'
import type { ApiRpcArgs, ApiRpcName, ApiRpcResult } from './rpc-request'
import { deprecationHeaders } from './versioning'

/**
 * The server side of `/api/v1` (approved plan, "Handler flow"). Route handlers stay thin: they
 * pass the request, the method and the path segment here, together with the runtime
 * dependencies (`src/lib/api/runtime.ts` in production, fakes in `handler.test.ts`).
 *
 * Flow of an authenticated operation (organization, list, upsert):
 * 1. A request id (`crypto.randomUUID()`) and a timer; routing (404 / 405) happens before.
 * 2. The Cloudflare bindings of this request (nulls under `next dev` / `next start`).
 * 3. The IP limiter (`cf-connecting-ip`), 429 `rate_limited`.
 * 4. `Authorization: Bearer <key>`, checked offline (format and checksum): 401 without any
 *    database call.
 * 5. SHA-256 of the key, then the key limiter.
 * 6. Request checks collected as one pending problem: query parameters, and for upserts the
 *    media type, the streamed 1 MiB body, `JSON.parse` and `validateUpsertBody`.
 * 7. A pending problem is answered only after `api_organization` confirmed the key (J8): an
 *    invalid key always gets 401 and a key without the operation's scope 403.
 * 8. The RPC through `src/lib/supabase/api.ts`: list and organization results pass through as
 *    text; upserts send the validated body text spliced in, never re-serialized.
 * 9. Upsert results: `succeeded` 200, `invalid` 422 `validation_failed`, `conflict` 409
 *    `write_conflict`; RPC errors through `apiProblemFor`.
 * 10. Every answer carries `X-Request-Id`, `Server-Timing`, `Cache-Control: no-store` (the
 *     OpenAPI document is cacheable) and the operation's deprecation headers.
 * 11. One log line per request (`log.ts`): ids, codes, timings and an 8-hex hash prefix; never
 *     the Authorization header, the key, the body or a value.
 *
 * HEAD on the list, organization, index and OpenAPI paths is GET without the body (the same
 * checks, limits and database work, so the headers are those of the GET); HEAD on an upsert
 * path is a 405 like GET. OPTIONS answers 204 with the path's own `Allow` and no CORS headers
 * (only the OpenAPI document is readable cross-origin).
 *
 * This module reads no cookies, no session and no active organization: the organization comes
 * only from the key. Relative imports only, so Vitest loads it without the `@/` alias.
 */

export type ApiMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'

export type ApiUpsertInput = {
  keyHash: KeyHash
  entity: EntityName
  bodyText: string
  requestId: string
}

/** What the handler needs from the runtime; `runtime.ts` wires the real ones. */
export type ApiDeps = {
  /** `callApiRpc` of `src/lib/supabase/api.ts`. */
  rpc: <N extends ApiRpcName>(name: N, args: ApiRpcArgs[N]) => Promise<ApiRpcResult>
  /** `callApiUpsert` of `src/lib/supabase/api.ts`. */
  upsert: (input: ApiUpsertInput) => Promise<ApiRpcResult>
  /** `apiPlatform` of `bindings.ts`, called once per request inside the handler. */
  platform: () => ApiPlatform
  logger?: ApiLogger
  /** Milliseconds for timings (`performance.now`). */
  now?: () => number
  /** A new request id (`crypto.randomUUID`). */
  requestId?: () => string
}

/** `Allow` of the index and organization paths. */
export const READ_ONLY_ALLOW = 'GET, HEAD'

/** Caching of the OpenAPI document (every other answer is `no-store`). */
export const OPENAPI_CACHE_CONTROL = 'public, max-age=300'

/* ------------------------------------------------------------------------------------------ */
/* Request context, responses and the log line                                                  */
/* ------------------------------------------------------------------------------------------ */

type RequestContext = {
  requestId: string
  started: number
  method: ApiMethod
  cfRay: string | null
  /** The log's operation (`organization`, `list:items`, `upsert:demand_history`, …). */
  operation: string
  /** The OpenAPI operation, for deprecation headers; null for 404, 405 and the public paths. */
  operationId: string | null
  keyHash: KeyHash | null
  dbMs: number | null
  records: number | null
  /** 5xx only: a diagnostic code, never a raw database or exception message. */
  failureCode: string | null
  deps: ApiDeps
}

type Outcome =
  | { kind: 'problem'; problem: ApiProblem }
  /** A string body is sent untouched (PostgREST's text); anything else is serialized. */
  | { kind: 'json'; status: number; body: unknown; headers?: Record<string, string> }
  /** A body sent as it is (or none: 204, 304) with its own headers. */
  | { kind: 'raw'; status: number; body: string | null; headers: Record<string, string> }

function now(deps: ApiDeps): number {
  return deps.now ? deps.now() : performance.now()
}

function begin(
  request: Request,
  method: ApiMethod,
  deps: ApiDeps,
  operation: string,
  operationIdValue: string | null = null,
): RequestContext {
  return {
    requestId: deps.requestId ? deps.requestId() : crypto.randomUUID(),
    started: now(deps),
    method,
    cfRay: request.headers.get('cf-ray'),
    operation,
    operationId: operationIdValue,
    keyHash: null,
    dbMs: null,
    records: null,
    failureCode: null,
    deps,
  }
}

function addDbTime(ctx: RequestContext, ms: number): void {
  if (Number.isFinite(ms)) ctx.dbMs = (ctx.dbMs ?? 0) + Math.max(0, ms)
}

function problemOutcome(problem: ApiProblem): Outcome {
  return { kind: 'problem', problem }
}

/** Builds the Response (without a body for HEAD), adds the common headers and logs the line. */
function finish(ctx: RequestContext, outcome: Outcome): Response {
  const total = now(ctx.deps) - ctx.started
  const common: Record<string, string> = {
    ...(ctx.operationId ? deprecationHeaders(ctx.operationId) : {}),
    'X-Request-Id': ctx.requestId,
    'Server-Timing': serverTiming({ db: ctx.dbMs, total }),
  }

  let response: Response
  let code: string | null = null
  if (outcome.kind === 'problem') {
    response = problemResponse(outcome.problem, common)
    code = outcome.problem.body.code
  } else if (outcome.kind === 'json') {
    response = jsonResponse(outcome.status, outcome.body, { ...common, ...outcome.headers })
  } else {
    const headers = new Headers({ ...outcome.headers, ...common })
    response = new Response(outcome.body, { status: outcome.status, headers })
  }
  if (ctx.method === 'HEAD' && response.body !== null) {
    response = new Response(null, { status: response.status, headers: response.headers })
  }

  logApiRequest(
    {
      requestId: ctx.requestId,
      cfRay: ctx.cfRay,
      method: ctx.method,
      operation: ctx.operation,
      status: response.status,
      code,
      keyHash: ctx.keyHash,
      records: ctx.records,
      dbMs: ctx.dbMs,
      totalMs: total,
      sqlstate: ctx.failureCode,
    },
    ctx.deps.logger,
  )
  return response
}

/** A 500 with a request id; exception messages can contain credentials or submitted data. */
function crashed(ctx: RequestContext): Response {
  return finish(ctx, problemOutcome(toProblem('internal_error', ctx.requestId)))
}

/** The problem for an RPC error, remembering unexpected failures for the log. */
function rpcProblem(
  ctx: RequestContext,
  result: Extract<ApiRpcResult, { ok: false }>,
  requiredScope: ApiScope | null,
): ApiProblem {
  const mapped = apiProblemFor(result.error, {
    requestId: ctx.requestId,
    method: ctx.method,
    requiredScope,
  })
  if (mapped.unexpected || mapped.problem.status >= 500) {
    ctx.failureCode = result.error.code ?? null
  }
  return mapped.problem
}

/* ------------------------------------------------------------------------------------------ */
/* Request checks                                                                               */
/* ------------------------------------------------------------------------------------------ */

/** `invalid_parameter` for every query parameter of an endpoint that takes none. */
export function noParameters(params: URLSearchParams): ListQueryFailure | null {
  const errors: ParameterIssue[] = []
  const seen = new Set<string>()
  for (const name of params.keys()) {
    if (seen.has(name)) continue
    seen.add(name)
    errors.push({
      parameter: name.slice(0, 64),
      detail: 'Unknown parameter; this endpoint takes none.',
    })
  }
  return errors.length > 0 ? { ok: false, code: 'invalid_parameter', errors } : null
}

/**
 * Whether a Content-Type names JSON: `application/json` or `application/<x>+json`, with an
 * optional `charset` that must be UTF-8.
 */
export function isJsonMediaType(value: string | null): boolean {
  if (value === null) return false
  const [essence = '', ...parameters] = value.split(';')
  const type = essence.trim().toLowerCase()
  if (type !== 'application/json' && !/^application\/[a-z0-9!#$&^_.-]+\+json$/.test(type)) {
    return false
  }
  for (const parameter of parameters) {
    const separator = parameter.indexOf('=')
    if (separator < 0) continue
    const name = parameter.slice(0, separator).trim().toLowerCase()
    const raw = parameter.slice(separator + 1).trim()
    const unquoted = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
    if (name === 'charset' && !/^utf-?8$/i.test(unquoted)) return false
  }
  return true
}

/** Whether a Content-Encoding other than `identity` was declared (compressed bodies: 415). */
export function hasContentEncoding(value: string | null): boolean {
  const encodings = (value ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '' && part !== 'identity')
  return encodings.length > 0
}

type CheckedUpsert =
  { ok: true; bodyText: string; records: number } | { ok: false; problem: ApiProblem }

/** Step 6 for an upsert: query string, media type, body size, JSON and the request rules. */
async function checkUpsertRequest(
  request: Request,
  resource: ApiResource,
  requestId: string,
): Promise<CheckedUpsert> {
  const parameters = noParameters(new URL(request.url).searchParams)
  if (parameters) return { ok: false, problem: parameterProblem(parameters, requestId) }
  if (
    !isJsonMediaType(request.headers.get('content-type')) ||
    hasContentEncoding(request.headers.get('content-encoding'))
  ) {
    return { ok: false, problem: toProblem('unsupported_media_type', requestId) }
  }
  const body = await readBodyText(request, API_LIMITS.bodyBytes)
  if (!body.ok) return { ok: false, problem: bodyReadProblem(body.response.status, requestId) }
  let parsed: unknown
  try {
    parsed = JSON.parse(body.text)
  } catch {
    return { ok: false, problem: toProblem('invalid_json', requestId) }
  }
  const check = validateUpsertBody(resource.entity, parsed)
  if (!check.ok) return { ok: false, problem: requestProblem(check, requestId) }
  return { ok: true, bodyText: body.text, records: check.records }
}

/* ------------------------------------------------------------------------------------------ */
/* Authenticated operations                                                                     */
/* ------------------------------------------------------------------------------------------ */

type Operation =
  | {
      kind: 'acknowledgement'
      resource: AcknowledgementResource
      id: string
      eventId: string | null
      write: boolean
    }
  | { kind: 'handoff'; resource: ReadHandoffResource; id: string | null }
  | { kind: 'organization' }
  | { kind: 'list'; resource: ApiResource }
  | { kind: 'upsert'; resource: ApiResource }

function requiredScopeOf(operation: Operation): ApiScope | null {
  if (operation.kind === 'acknowledgement')
    return operation.write
      ? acknowledgementScope(operation.resource)
      : handoffReadScope(operation.resource)
  if (operation.kind === 'handoff') return handoffReadScope(operation.resource)
  if (operation.kind === 'organization') return null
  return scopeFor(operation.resource.entity, operation.kind === 'list' ? 'read' : 'write')
}

function logOperation(operation: Operation): string {
  if (operation.kind === 'acknowledgement')
    return `${operation.write ? 'create' : operation.eventId ? 'get' : 'list'}:${operation.resource.replaceAll('-', '_')}_acknowledgements`
  if (operation.kind === 'handoff')
    return `${operation.id === null ? 'list' : 'get'}:${operation.resource.replaceAll('-', '_')}`
  return operation.kind === 'organization'
    ? 'organization'
    : `${operation.kind}:${operation.resource.entity}`
}

function operationIdOf(operation: Operation): string {
  if (operation.kind === 'acknowledgement')
    return acknowledgementOperationId(
      operation.resource,
      operation.write ? 'create' : operation.eventId ? 'get' : 'list',
    )
  if (operation.kind === 'handoff')
    return handoffOperationId(operation.resource, operation.id !== null)
  return operation.kind === 'organization'
    ? ORGANIZATION_OPERATION_ID
    : operationId(operation.resource.entity, operation.kind)
}

/** Step 7: confirm the key (and its scope) before answering a request-shape problem. */
async function confirmKeyThen(
  ctx: RequestContext,
  keyHash: KeyHash,
  requiredScope: ApiScope | null,
  pending: ApiProblem,
): Promise<ApiProblem> {
  const result = await ctx.deps.rpc('api_organization', { p_key_hash: keyHash })
  addDbTime(ctx, result.ms)
  if (!result.ok) return rpcProblem(ctx, result, requiredScope)
  const problem = resolvePendingProblem({
    organizationText: result.text,
    requiredScope,
    pending,
    requestId: ctx.requestId,
  })
  return problem
}

async function runOperation(
  request: Request,
  method: 'GET' | 'HEAD' | 'POST',
  operation: Operation,
  deps: ApiDeps,
): Promise<Response> {
  const ctx = begin(request, method, deps, logOperation(operation), operationIdOf(operation))
  try {
    const { requestId } = ctx
    const platform = deps.platform()

    const ipRefusal = await applyLimits(
      { requestId, ip: request.headers.get('cf-connecting-ip') },
      platform,
    )
    if (ipRefusal) return finish(ctx, problemOutcome(ipRefusal))

    const credential = readCredential(request.headers)
    if (!credential.ok) {
      return finish(ctx, problemOutcome(credentialProblem(credential.code, requestId)))
    }
    const keyHash = await hashApiKey(credential.token)
    ctx.keyHash = keyHash

    const keyRefusal = await applyLimits({ requestId, keyHash }, platform)
    if (keyRefusal) return finish(ctx, problemOutcome(keyRefusal))

    const requiredScope = requiredScopeOf(operation)
    const url = new URL(request.url)

    if (operation.kind === 'acknowledgement')
      return await runAcknowledgement(request, ctx, keyHash, operation)

    if (operation.kind === 'handoff') {
      const query = parseHandoffQuery(url.searchParams)
      const detailProblem = operation.id !== null ? noParameters(url.searchParams) : null
      const invalidId = operation.id !== null && !handoffIdSchema.safeParse(operation.id).success
      const failure = detailProblem ?? (!query.ok ? query : null)
      if (!query.ok || detailProblem || invalidId) {
        const pending = parameterProblem(
          failure ?? {
            ok: false,
            code: 'invalid_parameter',
            errors: [{ parameter: 'id', detail: 'Must be a UUID.' }],
          },
          requestId,
        )
        return finish(
          ctx,
          problemOutcome(await confirmKeyThen(ctx, keyHash, requiredScope, pending)),
        )
      }
      const resource = operation.resource
      const result = isRegionalHandoffResource(resource)
        ? operation.id !== null
          ? await deps.rpc('api_regional_handoff_get', {
              p_key_hash: keyHash,
              p_resource: resource,
              p_id: operation.id,
            })
          : await deps.rpc('api_regional_handoff_list', {
              p_key_hash: keyHash,
              p_resource: resource,
              p_limit: query.limit,
              p_after: query.cursor,
              p_created_since: query.createdSince,
            })
        : isNetworkHandoffResource(resource)
          ? operation.id !== null
            ? await deps.rpc('api_network_handoff_get', {
                p_key_hash: keyHash,
                p_resource: resource,
                p_id: operation.id,
              })
            : await deps.rpc('api_network_handoff_list', {
                p_key_hash: keyHash,
                p_resource: resource,
                p_limit: query.limit,
                p_after: query.cursor,
                p_created_since: query.createdSince,
              })
          : isDispositionHandoffResource(resource)
            ? operation.id !== null
              ? await deps.rpc('api_excess_disposition_handoff_get', {
                  p_key_hash: keyHash,
                  p_resource: resource,
                  p_id: operation.id,
                })
              : await deps.rpc('api_excess_disposition_handoff_list', {
                  p_key_hash: keyHash,
                  p_resource: resource,
                  p_limit: query.limit,
                  p_after: query.cursor,
                  p_created_since: query.createdSince,
                })
            : isEventHandoffResource(resource)
              ? operation.id !== null
                ? await deps.rpc('api_event_purchase_handoff_get', {
                    p_key_hash: keyHash,
                    p_resource: resource,
                    p_id: operation.id,
                  })
                : await deps.rpc('api_event_purchase_handoff_list', {
                    p_key_hash: keyHash,
                    p_resource: resource,
                    p_limit: query.limit,
                    p_after: query.cursor,
                    p_created_since: query.createdSince,
                  })
              : isTransferHandoffResource(resource)
                ? operation.id !== null
                  ? await deps.rpc('api_transfer_handoff_get', {
                      p_key_hash: keyHash,
                      p_resource: resource,
                      p_id: operation.id,
                    })
                  : await deps.rpc('api_transfer_handoff_list', {
                      p_key_hash: keyHash,
                      p_resource: resource,
                      p_limit: query.limit,
                      p_after: query.cursor,
                      p_created_since: query.createdSince,
                    })
                : operation.id !== null
                  ? await deps.rpc('api_handoff_get', {
                      p_key_hash: keyHash,
                      p_resource: resource,
                      p_id: operation.id,
                    })
                  : await deps.rpc('api_handoff_list', {
                      p_key_hash: keyHash,
                      p_resource: resource,
                      p_limit: query.limit,
                      p_after: query.cursor,
                      p_created_since: query.createdSince,
                    })
      addDbTime(ctx, result.ms)
      if (!result.ok) return finish(ctx, problemOutcome(rpcProblem(ctx, result, requiredScope)))
      return finish(ctx, { kind: 'json', status: 200, body: result.text })
    }

    if (operation.kind === 'organization') {
      const parameters = noParameters(url.searchParams)
      if (parameters) {
        const pending = parameterProblem(parameters, requestId)
        return finish(ctx, problemOutcome(await confirmKeyThen(ctx, keyHash, null, pending)))
      }
      const result = await deps.rpc('api_organization', { p_key_hash: keyHash })
      addDbTime(ctx, result.ms)
      if (!result.ok) return finish(ctx, problemOutcome(rpcProblem(ctx, result, null)))
      return finish(ctx, { kind: 'json', status: 200, body: result.text })
    }

    if (operation.kind === 'list') {
      const parsed = parseListQuery(operation.resource.entity, url.searchParams)
      if (!parsed.ok) {
        const pending = parameterProblem(parsed, requestId)
        return finish(
          ctx,
          problemOutcome(await confirmKeyThen(ctx, keyHash, requiredScope, pending)),
        )
      }
      const call = listRpcCall(parsed.query, keyHash)
      const result =
        call.name === 'api_list'
          ? await deps.rpc('api_list', call.args)
          : await deps.rpc('api_list_demand', call.args)
      addDbTime(ctx, result.ms)
      if (!result.ok) return finish(ctx, problemOutcome(rpcProblem(ctx, result, requiredScope)))
      return finish(ctx, { kind: 'json', status: 200, body: result.text })
    }

    const checked = await checkUpsertRequest(request, operation.resource, requestId)
    if (!checked.ok) {
      return finish(
        ctx,
        problemOutcome(await confirmKeyThen(ctx, keyHash, requiredScope, checked.problem)),
      )
    }
    ctx.records = checked.records
    const result = await deps.upsert({
      keyHash,
      entity: operation.resource.entity,
      bodyText: checked.bodyText,
      requestId,
    })
    addDbTime(ctx, result.ms)
    if (!result.ok) return finish(ctx, problemOutcome(rpcProblem(ctx, result, requiredScope)))

    let value: unknown
    try {
      value = JSON.parse(result.text)
    } catch {
      return finish(ctx, problemOutcome(toProblem('internal_error', requestId)))
    }
    const outcome = mapUpsertResult(value, { requestId, resource: operation.resource.name })
    if (outcome.ok) return finish(ctx, { kind: 'json', status: outcome.status, body: outcome.body })
    return finish(ctx, problemOutcome(outcome.problem))
  } catch {
    return crashed(ctx)
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Routing answers                                                                              */
/* ------------------------------------------------------------------------------------------ */

/** 404 `not_found` (unknown resource, unknown path below a resource). */
export function notFound(request: Request, method: ApiMethod, deps: ApiDeps): Response {
  const ctx = begin(request, method, deps, 'not_found')
  return finish(ctx, problemOutcome(toProblem('not_found', ctx.requestId)))
}

function methodNotAllowed(
  request: Request,
  method: ApiMethod,
  deps: ApiDeps,
  operation: string,
  allow: string,
  detail?: string,
): Response {
  const ctx = begin(request, method, deps, operation)
  return finish(
    ctx,
    problemOutcome(toProblem('method_not_allowed', ctx.requestId, { allow, detail })),
  )
}

/** 204 for OPTIONS with the path's `Allow` (plus OPTIONS itself); no CORS headers. */
function options(request: Request, deps: ApiDeps, operation: string, allow: string): Response {
  const ctx = begin(request, 'OPTIONS', deps, operation)
  return finish(ctx, {
    kind: 'raw',
    status: 204,
    body: null,
    headers: { Allow: `${allow}, OPTIONS`, 'Cache-Control': API_CACHE_CONTROL },
  })
}

/* ------------------------------------------------------------------------------------------ */
/* Entry points of the route files                                                              */
/* ------------------------------------------------------------------------------------------ */

/** `/api/v1/{resource}` and `/api/v1/{resource}:upsert` (`params.resource`, already decoded). */
export async function handleResource(
  request: Request,
  method: ApiMethod,
  segment: string,
  deps: ApiDeps,
): Promise<Response> {
  if (isReadHandoffResource(segment)) return handleHandoff(request, method, segment, null, deps)
  const route: ResourceRoute | null = parseResourceSegment(segment)
  if (!route) return notFound(request, method, deps)

  const { resource, action } = route
  const operation = `${action}:${resource.entity}`
  if (method === 'OPTIONS') return options(request, deps, operation, allowHeader(action))
  if (action === 'list' && (method === 'GET' || method === 'HEAD')) {
    return runOperation(request, method, { kind: 'list', resource }, deps)
  }
  if (action === 'upsert' && method === 'POST') {
    return runOperation(request, method, { kind: 'upsert', resource }, deps)
  }
  return methodNotAllowed(
    request,
    method,
    deps,
    operation,
    allowHeader(action),
    methodHint(route, method),
  )
}

/** Saved planning artifacts; reading cannot create, approve, export to ERP or acknowledge orders. */
export async function handleHandoff(
  request: Request,
  method: ApiMethod,
  resource: ReadHandoffResource,
  id: string | null,
  deps: ApiDeps,
): Promise<Response> {
  const operation = `${id === null ? 'list' : 'get'}:${resource.replaceAll('-', '_')}`
  if (method === 'OPTIONS') return options(request, deps, operation, READ_ONLY_ALLOW)
  if (method === 'GET' || method === 'HEAD')
    return runOperation(request, method, { kind: 'handoff', resource, id }, deps)
  return methodNotAllowed(request, method, deps, operation, READ_ONLY_ALLOW)
}

/** Only saved handoff resources have detail routes; other nested paths retain JSON 404s. */
export async function handleResourceDetail(
  request: Request,
  method: ApiMethod,
  resource: string,
  rest: string[],
  deps: ApiDeps,
): Promise<Response> {
  if (
    isAcknowledgementResource(resource) &&
    (rest.length === 2 || rest.length === 3) &&
    rest[1] === 'acknowledgements'
  ) {
    const eventId = rest[2] ?? null
    const allow = eventId === null ? 'GET, HEAD, POST' : READ_ONLY_ALLOW
    const operation = `acknowledgements:${resource.replaceAll('-', '_')}`
    if (method === 'OPTIONS') return options(request, deps, operation, allow)
    if (method === 'GET' || method === 'HEAD' || (method === 'POST' && eventId === null))
      return runOperation(
        request,
        method,
        { kind: 'acknowledgement', resource, id: rest[0], eventId, write: method === 'POST' },
        deps,
      )
    return methodNotAllowed(request, method, deps, operation, allow)
  }
  if (!isReadHandoffResource(resource) || rest.length !== 1) return notFound(request, method, deps)
  return handleHandoff(request, method, resource, rest[0], deps)
}

async function checkAcknowledgementBody(
  request: Request,
  requestId: string,
): Promise<{ ok: true; body: AcknowledgementInput } | { ok: false; problem: ApiProblem }> {
  if (
    !isJsonMediaType(request.headers.get('content-type')) ||
    hasContentEncoding(request.headers.get('content-encoding'))
  )
    return { ok: false, problem: toProblem('unsupported_media_type', requestId) }
  const body = await readBodyText(request, ACKNOWLEDGEMENT_BODY_BYTES)
  if (!body.ok)
    return {
      ok: false,
      problem:
        body.response.status === 413
          ? toProblem('payload_too_large', requestId, {
              detail: `The acknowledgement body exceeds ${ACKNOWLEDGEMENT_BODY_BYTES} bytes.`,
            })
          : bodyReadProblem(body.response.status, requestId),
    }
  let value: unknown
  try {
    value = JSON.parse(body.text)
  } catch {
    return { ok: false, problem: toProblem('invalid_json', requestId) }
  }
  const parsed = acknowledgementInputSchema.safeParse(value)
  if (!parsed.success)
    return {
      ok: false,
      problem: toProblem('invalid_request', requestId, {
        extensions: {
          errors: parsed.error.issues.slice(0, 20).map((issue) => ({
            field: String(issue.path[0] ?? 'body'),
            detail: 'Invalid acknowledgement field; see the documented request schema.',
          })),
        },
      }),
    }
  return { ok: true, body: parsed.data }
}

async function runAcknowledgement(
  request: Request,
  ctx: RequestContext,
  keyHash: KeyHash,
  operation: Extract<Operation, { kind: 'acknowledgement' }>,
): Promise<Response> {
  const params = new URL(request.url).searchParams
  const query = parseAcknowledgementQuery(params)
  const failure =
    operation.write || operation.eventId !== null ? noParameters(params) : !query.ok ? query : null
  const invalidId =
    !handoffIdSchema.safeParse(operation.id).success ||
    (operation.eventId !== null && !handoffIdSchema.safeParse(operation.eventId).success)
  const scope = requiredScopeOf(operation)
  if (failure || invalidId)
    return finish(
      ctx,
      problemOutcome(
        await confirmKeyThen(
          ctx,
          keyHash,
          scope,
          parameterProblem(
            failure ?? {
              ok: false,
              code: 'invalid_parameter',
              errors: [{ parameter: 'id', detail: 'Must be a UUID.' }],
            },
            ctx.requestId,
          ),
        ),
      ),
    )
  if (operation.write) {
    const checked = await checkAcknowledgementBody(request, ctx.requestId)
    if (!checked.ok)
      return finish(ctx, problemOutcome(await confirmKeyThen(ctx, keyHash, scope, checked.problem)))
    const args = { p_key_hash: keyHash, p_id: operation.id, p_body: checked.body }
    const result = isRegionalHandoffResource(operation.resource)
      ? await ctx.deps.rpc('api_regional_handoff_acknowledge', {
          ...args,
          p_resource: operation.resource,
        })
      : isNetworkHandoffResource(operation.resource)
        ? await ctx.deps.rpc('api_network_handoff_acknowledge', {
            ...args,
            p_resource: operation.resource,
          })
        : isDispositionHandoffResource(operation.resource)
          ? await ctx.deps.rpc('api_excess_disposition_handoff_acknowledge', {
              ...args,
              p_resource: operation.resource,
            })
          : isEventHandoffResource(operation.resource)
            ? await ctx.deps.rpc('api_event_purchase_handoff_acknowledge', {
                ...args,
                p_resource: operation.resource,
              })
            : isTransferHandoffResource(operation.resource)
              ? await ctx.deps.rpc('api_transfer_handoff_acknowledge', {
                  ...args,
                  p_resource: operation.resource,
                })
              : await ctx.deps.rpc('api_handoff_acknowledge', {
                  ...args,
                  p_resource: operation.resource,
                })
    addDbTime(ctx, result.ms)
    if (!result.ok) return finish(ctx, problemOutcome(rpcProblem(ctx, result, scope)))
    const response: { data?: { id?: unknown }; replayed?: unknown } = JSON.parse(result.text)
    if (
      typeof response?.replayed !== 'boolean' ||
      !handoffIdSchema.safeParse(response?.data?.id).success
    )
      return crashed(ctx)
    return finish(ctx, {
      kind: 'json',
      status: response.replayed ? 200 : 201,
      body: result.text,
      headers: {
        Location: `/api/v1/${operation.resource}/${operation.id}/acknowledgements/${response.data!.id}`,
      },
    })
  }
  if (!query.ok) return crashed(ctx) // Detail queries were refused above; lists were validated.
  const args = {
    p_key_hash: keyHash,
    p_id: operation.id,
    p_event_id: operation.eventId,
    p_after: query.cursor,
    p_limit: query.limit,
  }
  const result = isRegionalHandoffResource(operation.resource)
    ? await ctx.deps.rpc('api_regional_handoff_acknowledgements', {
        ...args,
        p_resource: operation.resource,
      })
    : isNetworkHandoffResource(operation.resource)
      ? await ctx.deps.rpc('api_network_handoff_acknowledgements', {
          ...args,
          p_resource: operation.resource,
        })
      : isDispositionHandoffResource(operation.resource)
        ? await ctx.deps.rpc('api_excess_disposition_handoff_acknowledgements', {
            ...args,
            p_resource: operation.resource,
          })
        : isEventHandoffResource(operation.resource)
          ? await ctx.deps.rpc('api_event_purchase_handoff_acknowledgements', {
              ...args,
              p_resource: operation.resource,
            })
          : isTransferHandoffResource(operation.resource)
            ? await ctx.deps.rpc('api_transfer_handoff_acknowledgements', {
                ...args,
                p_resource: operation.resource,
              })
            : await ctx.deps.rpc('api_handoff_acknowledgements', {
                ...args,
                p_resource: operation.resource,
              })
  addDbTime(ctx, result.ms)
  return finish(
    ctx,
    result.ok
      ? { kind: 'json', status: 200, body: result.text }
      : problemOutcome(rpcProblem(ctx, result, scope)),
  )
}

/** `/api/v1/organization`: the key and its organization (any valid key). */
export async function handleOrganization(
  request: Request,
  method: ApiMethod,
  deps: ApiDeps,
): Promise<Response> {
  if (method === 'OPTIONS') return options(request, deps, 'organization', READ_ONLY_ALLOW)
  if (method === 'GET' || method === 'HEAD') {
    return runOperation(request, method, { kind: 'organization' }, deps)
  }
  return methodNotAllowed(
    request,
    method,
    deps,
    'organization',
    READ_ONLY_ALLOW,
    `/api/v1/organization answers ${READ_ONLY_ALLOW} only.`,
  )
}

/** The body of `GET /api/v1`. */
export const INDEX_BODY = { openapi: OPENAPI_PATH, docs: API_DOCS_URL } as const

/** `/api/v1`: where the OpenAPI document and the documentation are. No key needed. */
export async function handleIndex(
  request: Request,
  method: ApiMethod,
  deps: ApiDeps,
): Promise<Response> {
  if (method === 'OPTIONS') return options(request, deps, 'index', READ_ONLY_ALLOW)
  if (method !== 'GET' && method !== 'HEAD') {
    return methodNotAllowed(
      request,
      method,
      deps,
      'index',
      READ_ONLY_ALLOW,
      `/api/v1 answers ${READ_ONLY_ALLOW} only.`,
    )
  }
  const ctx = begin(request, method, deps, 'index')
  return finish(ctx, { kind: 'json', status: 200, body: INDEX_BODY })
}

/* ------------------------------------------------------------------------------------------ */
/* The OpenAPI document                                                                         */
/* ------------------------------------------------------------------------------------------ */

export type OpenApiDocument = { text: string; etag: string }

/** A lazy source of the document and its strong ETag, computed once per isolate. */
export type OpenApiSource = () => Promise<OpenApiDocument>

function hex(bytes: ArrayBuffer): string {
  let out = ''
  for (const byte of new Uint8Array(bytes)) out += byte.toString(16).padStart(2, '0')
  return out
}

/** The strong ETag of a text: the quoted hex SHA-256 of its UTF-8 bytes. */
export async function strongEtag(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return `"${hex(digest)}"`
}

/**
 * Memoizes the document text and its ETag on first use (never at module scope: Workers allow
 * no async work outside a request). A failure is not cached.
 */
export function openApiSource(getText: () => string): OpenApiSource {
  let cached: Promise<OpenApiDocument> | null = null
  return () => {
    if (!cached) {
      cached = (async () => {
        const text = getText()
        return { text, etag: await strongEtag(text) }
      })()
      cached.catch(() => {
        cached = null
      })
    }
    return cached
  }
}

/** Whether an If-None-Match header matches the ETag (weak comparison, RFC 9110 §13.1.2). */
export function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (header === null) return false
  const value = header.trim()
  if (value === '*') return true
  return value
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === etag)
}

const OPENAPI_ALLOW = READ_ONLY_ALLOW

/** CORS headers of the OpenAPI document (public, so readable from any origin). */
const OPENAPI_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'ETag, X-Request-Id',
}

/**
 * `/api/v1/openapi.json`: the committed document, `Cache-Control: public, max-age=300`, a strong
 * ETag with 304 on `If-None-Match`, and `Access-Control-Allow-Origin: *`. No key and no limiter.
 */
export async function handleOpenApi(
  request: Request,
  method: ApiMethod,
  source: OpenApiSource,
  deps: ApiDeps,
): Promise<Response> {
  if (method === 'OPTIONS') {
    const ctx = begin(request, method, deps, 'openapi')
    return finish(ctx, {
      kind: 'raw',
      status: 204,
      body: null,
      headers: {
        Allow: `${OPENAPI_ALLOW}, OPTIONS`,
        'Cache-Control': API_CACHE_CONTROL,
        ...OPENAPI_CORS,
        'Access-Control-Allow-Methods': `${OPENAPI_ALLOW}, OPTIONS`,
        'Access-Control-Allow-Headers': 'If-None-Match',
        'Access-Control-Max-Age': '86400',
      },
    })
  }
  if (method !== 'GET' && method !== 'HEAD') {
    return methodNotAllowed(
      request,
      method,
      deps,
      'openapi',
      OPENAPI_ALLOW,
      `${OPENAPI_PATH} answers ${OPENAPI_ALLOW} only.`,
    )
  }
  const ctx = begin(request, method, deps, 'openapi')
  try {
    const document = await source()
    const headers = {
      ETag: document.etag,
      'Cache-Control': OPENAPI_CACHE_CONTROL,
      ...OPENAPI_CORS,
    }
    if (ifNoneMatchHits(request.headers.get('if-none-match'), document.etag)) {
      return finish(ctx, { kind: 'raw', status: 304, body: null, headers })
    }
    return finish(ctx, {
      kind: 'raw',
      status: 200,
      body: document.text,
      headers: { ...headers, 'Content-Type': JSON_CONTENT_TYPE },
    })
  } catch {
    return crashed(ctx)
  }
}
