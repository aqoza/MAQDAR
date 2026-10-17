import { allOperationIds } from './resources'

/**
 * Versioning of `/api/v1`. The version is in the path and v1 changes are additive only (new
 * resources, fields, parameters, codes). Retiring an operation means listing it here first: its
 * answers then carry `Deprecation: @<epoch seconds>` (RFC 9745), `Sunset: <HTTP-date>` (RFC
 * 8594, never earlier than the deprecation) and `Link: <…>; rel="deprecation"`, and the OpenAPI
 * document marks it `deprecated`. The table ships empty. Pure module.
 */

export const API_VERSION = 'v1'
export const OPENAPI_DOCUMENT_VERSION = '1.4.0'

export type DeprecationEntry = {
  /** OpenAPI operationId (`listItems`, `upsertDemandHistory`, `getOrganization`). */
  operationId: string
  /** When the operation was deprecated (ISO 8601 date-time). */
  deprecatedAt: string
  /** When it stops answering (ISO 8601 date-time), if decided. */
  sunsetAt?: string
  /** Where the migration is described. */
  link: string
}

/** Deprecated operations. Empty: nothing in v1 is deprecated. */
export const DEPRECATIONS: readonly DeprecationEntry[] = []

export function deprecationFor(
  operationId: string,
  table: readonly DeprecationEntry[] = DEPRECATIONS,
): DeprecationEntry | null {
  return table.find((entry) => entry.operationId === operationId) ?? null
}

/** The deprecation headers of an operation's answers (none for a current operation). */
export function deprecationHeaders(
  operationId: string,
  table: readonly DeprecationEntry[] = DEPRECATIONS,
): Record<string, string> {
  const entry = deprecationFor(operationId, table)
  if (!entry) return {}
  const headers: Record<string, string> = {
    Deprecation: `@${Math.floor(Date.parse(entry.deprecatedAt) / 1000)}`,
    Link: `<${entry.link}>; rel="deprecation"; type="text/html"`,
  }
  if (entry.sunsetAt) headers.Sunset = new Date(Date.parse(entry.sunsetAt)).toUTCString()
  return headers
}

/**
 * Problems with a deprecation table: unknown operations, duplicates, unparsable dates, a sunset
 * before the deprecation, a link that is not https. The Vitest suite requires none.
 */
export function checkDeprecations(
  table: readonly DeprecationEntry[] = DEPRECATIONS,
  operationIds: readonly string[] = allOperationIds(),
): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const entry of table) {
    if (!operationIds.includes(entry.operationId)) {
      problems.push(`${entry.operationId}: unknown operation`)
    }
    if (seen.has(entry.operationId)) problems.push(`${entry.operationId}: listed twice`)
    seen.add(entry.operationId)
    const deprecated = Date.parse(entry.deprecatedAt)
    if (Number.isNaN(deprecated)) problems.push(`${entry.operationId}: bad deprecatedAt`)
    if (entry.sunsetAt !== undefined) {
      const sunset = Date.parse(entry.sunsetAt)
      if (Number.isNaN(sunset)) problems.push(`${entry.operationId}: bad sunsetAt`)
      else if (!Number.isNaN(deprecated) && sunset < deprecated) {
        problems.push(`${entry.operationId}: sunset before deprecation`)
      }
    }
    if (!/^https:\/\/\S+$/.test(entry.link)) problems.push(`${entry.operationId}: link not https`)
  }
  return problems
}
