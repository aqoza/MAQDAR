import { z } from 'zod'
import { isRole, type Role } from './roles'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The claims MAQDAR reads from a verified access token. `org_id` and `org_role` come from the
 * custom access-token hook (app.custom_access_token_hook) and name the user's active organization.
 * Only `sub` is required: anything unexpected in the other claims is treated as absent, never as an
 * error, because the database re-checks memberships on every statement and the app falls back to
 * the organizations hub. The proxy and the layouts both use this parser, so they always agree on
 * whether a session counts (otherwise /login and /dashboard redirect to each other forever).
 */
export const claimsSchema = z
  .object({
    sub: z.string().regex(UUID_RE),
    email: z
      .unknown()
      .optional()
      .transform((value) => (typeof value === 'string' ? value : undefined)),
    org_id: z
      .unknown()
      .optional()
      .transform((value) =>
        typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : null,
      ),
    org_role: z
      .unknown()
      .optional()
      .transform((value): Role | null => (isRole(value) ? value : null)),
  })
  .loose()

export type MaqdarClaims = z.infer<typeof claimsSchema>

export function parseClaims(raw: unknown): MaqdarClaims | null {
  const result = claimsSchema.safeParse(raw)
  return result.success ? result.data : null
}

/** Why claims were rejected, safe to log: issue paths and codes plus claim names, no values. */
export function describeRejectedClaims(raw: unknown): Record<string, unknown> {
  const result = claimsSchema.safeParse(raw)
  return {
    issues: result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
    keys: raw && typeof raw === 'object' ? Object.keys(raw) : typeof raw,
  }
}
