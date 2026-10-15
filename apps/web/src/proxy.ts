import { NextResponse, type NextRequest } from 'next/server'
import { isApiV1Path } from '@/lib/api/path'
import { updateSession } from '@/lib/supabase/proxy'

// Next.js 16 proxy (formerly middleware). Runs on the Node.js runtime.
export async function proxy(request: NextRequest) {
  // The REST API authenticates with API keys and never uses the cookie session. The matcher
  // already leaves /api/v1 out; this backstop keeps it out should the matcher change, so no
  // Supabase client is ever built for it.
  if (isApiV1Path(request.nextUrl.pathname)) return NextResponse.next()
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Everything except the REST API (/api/v1 and below, not /api/v1x) and static assets.
    // Server Actions post to their page's path, so app routes stay covered; auth is still
    // re-checked inside layouts and actions. src/proxy.test.ts pins what this matches.
    '/((?!api/v1(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
