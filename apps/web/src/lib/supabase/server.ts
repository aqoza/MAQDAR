import { createServerClient } from '@supabase/ssr'
import type { Database } from '@zeespare/shared/database.types'
import { cookies, headers } from 'next/headers'
import { env } from '@/lib/env'
import { trustedAuthFetch } from './auth-forwarding'

/** Supabase client for Server Components, Server Actions and Route Handlers. Create one per request. */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { fetch: trustedAuthFetch(await headers()) },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component, where cookies cannot be written.
            // The proxy refreshes sessions, so this can be ignored.
          }
        },
      },
    },
  )
}
