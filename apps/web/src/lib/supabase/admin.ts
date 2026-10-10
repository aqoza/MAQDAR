import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@maqdar/shared/database.types'
import { env } from '@/lib/env'
import { serverEnv } from '@/lib/env.server'

/**
 * Service-role client for admin auth calls (auth.admin.inviteUserByEmail, user seeding). It
 * bypasses row-level security, so it is never used for tenant data and never passed to components.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SECRET_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    },
  )
}
