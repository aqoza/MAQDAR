import { isIP } from 'node:net'

const AUTH_PATHS = new Set([
  '/auth/v1/token',
  '/auth/v1/verify',
  '/auth/v1/otp',
  '/auth/v1/recover',
  '/auth/v1/resend',
  '/auth/v1/user',
  '/auth/v1/logout',
])

/** The secret authenticates forwarding to Auth only. It never changes a data/RLS request. */
export function authIpTransport({
  url,
  publicKey,
  secretKey,
  clientIp,
  fetcher = fetch,
}: {
  url: string
  publicKey: string
  secretKey: string
  clientIp: string
  fetcher?: typeof fetch
}): typeof fetch {
  if (!isIP(clientIp) || !secretKey.startsWith('sb_secret_')) return fetcher
  const origin = new URL(url).origin
  return (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input))
    if (
      target.origin !== origin ||
      target.username ||
      target.password ||
      !AUTH_PATHS.has(target.pathname)
    )
      return fetcher(input, init)
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    headers.set('apikey', secretKey)
    headers.set('sb-forwarded-for', clientIp)
    if (headers.get('authorization') === `Bearer ${publicKey}`) headers.delete('authorization')
    return fetcher(input, { ...init, headers, redirect: 'error' })
  }
}
