import { headers } from 'next/headers'

/**
 * Public origin of this deployment, used to build e-mail redirect URLs and to validate absolute
 * destinations. NEXT_PUBLIC_SITE_URL wins when set (hosted); otherwise the request's forwarded
 * host (local development, previews). Read straight from process.env rather than serverEnv() so
 * that signing in never depends on the secret key being configured.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/$/, '')
  const requestHeaders = await headers()
  const host =
    firstValue(requestHeaders.get('x-forwarded-host')) ??
    firstValue(requestHeaders.get('host')) ??
    'localhost:3000'
  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
  const protocol =
    firstValue(requestHeaders.get('x-forwarded-proto')) ?? (isLoopback ? 'http' : 'https')
  return `${protocol}://${host}`
}

/** Proxies may join several hops with commas; the first entry is the client-facing one. */
function firstValue(header: string | null): string | null {
  const value = header?.split(',')[0]?.trim()
  return value ? value : null
}
