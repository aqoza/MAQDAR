import 'server-only'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { env } from '@/lib/env'
import { serverEnv } from '@/lib/env.server'
import { authIpTransport } from './auth-transport'

/** Trust only Cloudflare's overwritten connecting-IP header, and only behind an explicit rollout flag. */
export function trustedAuthFetch(headers: Pick<Headers, 'get'>): typeof fetch {
  try {
    const context = getCloudflareContext()
    if ((context.env as { AUTH_IP_FORWARDING?: string }).AUTH_IP_FORWARDING !== 'enabled')
      return fetch
  } catch {
    return fetch
  } // Local Next.js requests never trust caller-supplied proxy headers.
  return authIpTransport({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    publicKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secretKey: serverEnv().SUPABASE_SECRET_KEY,
    clientIp: headers.get('cf-connecting-ip') ?? '',
  })
}
