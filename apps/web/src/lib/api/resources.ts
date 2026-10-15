import { entitiesInLoadOrder, getEntity, isEntityName, type EntityName } from '../imports/contract'
import { isTransactionEntity } from './limits'

/**
 * The resources of `/api/v1`: one per contract entity, named like the entity with `-` for `_`
 * (`demand_history` is `demand-history`), in load order. Lists are `GET /{resource}` and upserts
 * `POST /{resource}:upsert`. Pure module: the routes, the handler and the OpenAPI document share it.
 */

export const API_BASE_PATH = '/api/v1'

/** Where the OpenAPI document is served. */
export const OPENAPI_PATH = `${API_BASE_PATH}/openapi.json`

/** The human documentation (quick start, keys, limits, problems). */
export const API_DOCS_URL = 'https://github.com/aqoza/MAQDAR/blob/main/docs/api.md'

/** The custom-method suffix of upserts (`POST /api/v1/items:upsert`). */
export const UPSERT_SUFFIX = ':upsert'

export type ResourceCategory = 'master_data' | 'transactions'

export type ApiResource = {
  /** Path segment: `items`, `demand-history`. */
  name: string
  entity: EntityName
  category: ResourceCategory
  /** Contract load order (parents first), 1-based. */
  loadOrder: number
}

export type ResourceAction = 'list' | 'upsert'

/** The resource name of an entity (`work_calendars` → `work-calendars`). */
export function resourceName(entity: EntityName): string {
  return getEntity(entity).name.replaceAll('_', '-')
}

/** Every resource in load order (parents before children). */
export const RESOURCES: readonly ApiResource[] = entitiesInLoadOrder().map((entity) => ({
  name: resourceName(entity.name),
  entity: entity.name,
  category: isTransactionEntity(entity.name) ? 'transactions' : 'master_data',
  loadOrder: entity.load_order,
}))

const BY_NAME = new Map(RESOURCES.map((resource) => [resource.name, resource]))
const BY_ENTITY = new Map(RESOURCES.map((resource) => [resource.entity, resource]))

export function resourceByName(name: string): ApiResource | null {
  return BY_NAME.get(name) ?? null
}

export function resourceForEntity(entity: EntityName): ApiResource {
  const resource = BY_ENTITY.get(entity)
  if (!resource) throw new Error(`No API resource for entity ${entity}`)
  return resource
}

export type ResourceRoute = { resource: ApiResource; action: ResourceAction }

/**
 * The resource and action of the `[resource]` path segment: `items` lists, `items:upsert`
 * upserts. Next.js hands route handlers the decoded segment (a `%3A` arrives as `:`); a segment
 * that still carries percent escapes is decoded once more. Unknown resources, other suffixes and
 * malformed escapes give null (404).
 */
export function parseResourceSegment(segment: string): ResourceRoute | null {
  let decoded = segment
  if (segment.includes('%')) {
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return null
    }
  }
  const upsert = decoded.endsWith(UPSERT_SUFFIX)
  const name = upsert ? decoded.slice(0, -UPSERT_SUFFIX.length) : decoded
  const resource = resourceByName(name)
  if (!resource) return null
  return { resource, action: upsert ? 'upsert' : 'list' }
}

/** The single method each action answers (405 `method_not_allowed` names it in `Allow`). */
export const ACTION_METHOD: Readonly<Record<ResourceAction, 'GET' | 'POST'>> = {
  list: 'GET',
  upsert: 'POST',
}

/** The `Allow` header of an action: lists also answer HEAD (the route exports it). */
export function allowHeader(action: ResourceAction): string {
  return action === 'list' ? 'GET, HEAD' : 'POST'
}

/** The path of an action relative to the base path (`/items`, `/items:upsert`). */
export function resourcePath(resource: ApiResource, action: ResourceAction): string {
  return action === 'list' ? `/${resource.name}` : `/${resource.name}${UPSERT_SUFFIX}`
}

/** PascalCase of an entity name (`item_supersessions` → `ItemSupersessions`). */
export function pascalCase(entity: string): string {
  return entity
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/** The OpenAPI operationId of the organization endpoint. */
export const ORGANIZATION_OPERATION_ID = 'getOrganization'

/** OpenAPI operationId of a resource action (`listItems`, `upsertDemandHistory`). */
export function operationId(entity: EntityName, action: ResourceAction): string {
  return `${action}${pascalCase(entity)}`
}

/** Every operationId the API serves, in document order. */
export function allOperationIds(): string[] {
  return [
    ORGANIZATION_OPERATION_ID,
    ...RESOURCES.flatMap((resource) => [
      operationId(resource.entity, 'list'),
      operationId(resource.entity, 'upsert'),
    ]),
  ]
}

/**
 * A short hint for a request that used the wrong method on a resource path: POST on a list path
 * points to the upsert path and the other way round.
 */
export function methodHint(route: ResourceRoute, method: string): string {
  const base = API_BASE_PATH
  if (route.action === 'list' && method === 'POST') {
    return `Upserts use POST ${base}${resourcePath(route.resource, 'upsert')}.`
  }
  if (route.action === 'upsert' && (method === 'GET' || method === 'HEAD')) {
    return `Lists use GET ${base}${resourcePath(route.resource, 'list')}.`
  }
  return `${base}${resourcePath(route.resource, route.action)} answers ${allowHeader(route.action)} only.`
}

export function isResourceEntity(value: unknown): value is EntityName {
  return isEntityName(value) && BY_ENTITY.has(value)
}
