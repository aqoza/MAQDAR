import { getCloudflareContext } from '@opennextjs/cloudflare'

/**
 * Cloudflare bindings the API uses: the two Workers Rate Limiting bindings declared in
 * `wrangler.jsonc` (`API_KEY_LIMITER`, `API_IP_LIMITER`). They exist only on the Worker (deployed
 * or `cf:preview`); under `next dev` and `next start` there is no Cloudflare context
 * (`next.config.ts` never calls `initOpenNextCloudflareForDev`), `getCloudflareContext()` throws
 * and both are null, so requests are not rate-limited there. The Postgres caps hold either way.
 *
 * Call `apiPlatform()` inside a request handler (sync mode reads the context of the current
 * request), never at module scope.
 */

export type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export type ApiPlatform = {
  keyLimiter: RateLimitBinding | null
  ipLimiter: RateLimitBinding | null
}

type ContextSource = () => { env: unknown }

function isRateLimitBinding(value: unknown): value is RateLimitBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { limit?: unknown }).limit === 'function'
  )
}

/** The bindings of the current request, or nulls outside the Workers runtime. */
export function apiPlatform(source: ContextSource = () => getCloudflareContext()): ApiPlatform {
  let env: unknown
  try {
    env = source().env
  } catch {
    return { keyLimiter: null, ipLimiter: null }
  }
  if (typeof env !== 'object' || env === null) return { keyLimiter: null, ipLimiter: null }
  const bindings = env as { API_KEY_LIMITER?: unknown; API_IP_LIMITER?: unknown }
  return {
    keyLimiter: isRateLimitBinding(bindings.API_KEY_LIMITER) ? bindings.API_KEY_LIMITER : null,
    ipLimiter: isRateLimitBinding(bindings.API_IP_LIMITER) ? bindings.API_IP_LIMITER : null,
  }
}
