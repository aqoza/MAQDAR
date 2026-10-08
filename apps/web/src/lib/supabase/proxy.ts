import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/lib/env'

const PUBLIC_PREFIXES = ['/login', '/auth']

/**
 * Refreshes the Supabase session cookie on every request and guards the app routes.
 * Follows the official @supabase/ssr pattern: nothing runs between createServerClient and
 * getClaims(), and the response built by setAll is the one returned.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          )
        },
      },
    },
  )

  const { data } = await supabase.auth.getClaims()
  const user = data?.claims

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))

  if (!user && !isPublic) {
    return redirectWithCookies(request, '/login', supabaseResponse)
  }
  if (user && pathname.startsWith('/login')) {
    return redirectWithCookies(request, '/dashboard', supabaseResponse)
  }

  return supabaseResponse
}

function redirectWithCookies(request: NextRequest, pathname: string, from: NextResponse) {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  url.search = ''
  const response = NextResponse.redirect(url)
  // Keep any refreshed auth cookies so the browser and server stay in sync.
  for (const cookie of from.cookies.getAll()) response.cookies.set(cookie)
  return response
}
