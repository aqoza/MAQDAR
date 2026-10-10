import { z } from 'zod'
import { isRole, type Role } from './roles'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The claims MAQDAR reads from a verified access token. `org_id` and `org_role` come from the
 * custom access-token hook (app.custom_access_token_hook) and name the user's active organization.
 * Anything unexpected in those two claims is treated as absent, never as an error: the database
 * re-checks memberships on every statement and the app falls back to the organizations hub.
 */
export const claimsSchema = z
  .object({
    sub: z.string().regex(UUID_RE),
    email: z.string().optional(),
    org_id: z
      .string()
      .nullish()
      .transform((value) => (value && UUID_RE.test(value) ? value.toLowerCase() : null)),
    org_role: z.unknown().transform((value): Role | null => (isRole(value) ? value : null)),
  })
  .loose()

export type MaqdarClaims = z.infer<typeof claimsSchema>

export function parseClaims(raw: unknown): MaqdarClaims | null {
  const result = claimsSchema.safeParse(raw)
  return result.success ? result.data : null
}
