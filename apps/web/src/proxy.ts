import { NextResponse, type NextRequest } from 'next/server'
import { isApiV1Path } from '@/lib/api/path'
import { resolveSite } from '@/lib/workspaces/hosts'
import { updateSession } from '@/lib/supabase/proxy'

// Next.js 16 proxy (formerly middleware). Runs on the Node.js runtime.
export async function proxy(request: NextRequest) {
  // The REST API authenticates with API keys and never uses the cookie session. The matcher
  // already leaves /api/v1 out; this backstop keeps it out should the matcher change, so no
  // Supabase client is ever built for it.
  if (isApiV1Path(request.nextUrl.pathname)) return NextResponse.next()

  const host = request.headers.get('host')
  const forwardedHost = request.headers.get('x-forwarded-host')
  // Next's internal redirect fetch can replace Host with its loopback origin. Refuse that
  // render so it falls back to a browser navigation, preserving the workspace boundary.
  if (forwardedHost && forwardedHost !== host) {
    return new NextResponse(null, {
      status: 400,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
  const site = resolveSite(host)
  if (site.kind === 'unknown') {
    return new NextResponse(null, {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
    request.headers.get('origin') !== site.origin
  ) {
    return NextResponse.json(
      { code: 'cross_origin' },
      {
        status: 403,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    )
  }
  // Keep existing auth URLs on www working; only the public homepage is canonicalized.
  if (request.headers.get('host') === 'www.zeespare.com' && request.nextUrl.pathname === '/') {
    return NextResponse.redirect('https://zeespare.com/', 308)
  }
  if (site.kind === 'public' && ['/', '/workspaces'].includes(request.nextUrl.pathname)) {
    return NextResponse.next()
  }
  const response = await updateSession(request)
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  response.headers.set('Referrer-Policy', 'same-origin')
  return response
}

export const config = {
  matcher: [
    // Everything except the REST API (/api/v1 and below, not /api/v1x) and static assets.
    // Server Actions post to their page's path, so app routes stay covered; auth is still
    // re-checked inside layouts and actions. src/proxy.test.ts pins what this matches.
    '/((?!api/v1(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
