import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { describeRejectedClaims, parseClaims } from '@/lib/auth/claims'
import { env } from '@/lib/env'

const PUBLIC_PREFIXES = ['/login', '/auth']

/** `/auth` matches `/auth` and `/auth/…`, never `/authors`. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

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

  // Same parser as the layouts (requireClaims), so the proxy never counts a session the app
  // rejects; a mismatch would bounce /login and /dashboard back and forth.
  const { data, error } = await supabase.auth.getClaims()
  const user = data?.claims ? parseClaims(data.claims) : null
  if (error && error.code !== 'session_not_found' && !/session missing/i.test(error.message)) {
    console.warn('proxy: getClaims failed', {
      code: error.code,
      status: error.status,
      message: error.message,
    })
  } else if (data?.claims && !user) {
    console.warn('proxy: claims rejected', describeRejectedClaims(data.claims))
  }

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))

  if (!user && !isPublic) {
    return redirectWithCookies(request, '/login', supabaseResponse)
  }
  if (user && matchesPrefix(pathname, '/login')) {
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
