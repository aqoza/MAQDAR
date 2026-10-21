import { NextResponse, type NextRequest } from 'next/server'
import { getSessionClaims } from '@/lib/auth/session'
import { LOCATION_LOOKUP_QUERY_LIMIT, lookupLocations } from '@/lib/master-data/location-codes'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/** The organization and branch access always come from the session, never lookup parameters. */
export async function GET(request: NextRequest) {
  const claims = await getSessionClaims()
  if (!claims) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }
  const context = await getActiveContext()
  if (!context?.active) {
    return NextResponse.json(
      { error: 'no_active_organization' },
      { status: 403, headers: NO_STORE },
    )
  }

  const query = (request.nextUrl.searchParams.get('q') ?? '').slice(0, LOCATION_LOOKUP_QUERY_LIMIT)
  const includeInactive = request.nextUrl.searchParams.get('include_inactive') === 'true'
  try {
    const locations = await lookupLocations(
      await createClient(),
      context.active.id,
      query,
      includeInactive,
    )
    return NextResponse.json({ locations }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500, headers: NO_STORE })
  }
}
