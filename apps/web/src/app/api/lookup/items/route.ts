import { NextResponse, type NextRequest } from 'next/server'
import { getSessionClaims } from '@/lib/auth/session'
import { lookupItems } from '@/lib/master-data/item-codes'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'

/** Per-user data: never cached by the browser, a CDN or the Workers cache. */
const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * Part-code suggestions for the item-code inputs (`?q=` part of a code or name). The organization
 * is the active one from the session, never a parameter; RLS still scopes the rows. At most 20
 * items, matched on the normalized search tokens.
 */
export async function GET(request: NextRequest) {
  const claims = await getSessionClaims()
  if (!claims)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  const context = await getActiveContext()
  if (!context?.active) {
    return NextResponse.json(
      { error: 'no_active_organization' },
      { status: 403, headers: NO_STORE },
    )
  }

  const query = (request.nextUrl.searchParams.get('q') ?? '').slice(0, 100)
  try {
    const items = await lookupItems(await createClient(), context.active.id, query, 20)
    return NextResponse.json({ items }, { headers: NO_STORE })
  } catch (error) {
    console.error('lookup/items failed', { message: (error as Error).message })
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500, headers: NO_STORE })
  }
}
