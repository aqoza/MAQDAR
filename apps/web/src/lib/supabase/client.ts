import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@maqdar/shared/database.types'
import { env } from '@/lib/env'

/** Supabase client for Client Components. */
export function createClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )
}
