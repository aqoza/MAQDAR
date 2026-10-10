import 'server-only'
import { z } from 'zod'

const serverEnvSchema = z.object({
  /** Service-role key. Only ever read here and used by src/lib/supabase/admin.ts. */
  SUPABASE_SECRET_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

let cached: ServerEnv | undefined

/**
 * Server-only variables, parsed lazily so that importing a module which needs the secret does not
 * fail at build time or in unit tests that never call it.
 */
export function serverEnv(): ServerEnv {
  cached ??= serverEnvSchema.parse({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  })
  return cached
}
