import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'
import { emailDestination } from '@/lib/auth/email-destination'
import { siteOrigin } from '@/lib/auth/origin'

/** Preserve the requesting tenant host. Invite GETs still never consume the one-time token. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ destination: string[] }> },
) {
  await siteOrigin()
  const next = emailDestination((await params).destination)
  const token = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type')
  // During rollout old templates put this callback in `next` after verifying the token.
  // A token-free visit can safely continue: the destination's own auth guards still apply.
  if (next && !token && !type) redirect(next)
  if (!next || !token || !['email', 'invite'].includes(type ?? '')) redirect('/login?error=link')
  const query = new URLSearchParams({ token_hash: token, type: type!, next })
  redirect(`/auth/${type === 'invite' ? 'invite' : 'confirm'}?${query}`)
}
