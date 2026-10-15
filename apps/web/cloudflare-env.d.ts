// Bindings of the MAQDAR Worker that OpenNext's `CloudflareEnv` does not declare. Written by hand
// because @cloudflare/workers-types is not installed; keep it in sync with wrangler.jsonc.
// Global declarations (no import or export), merged into the interface from
// @opennextjs/cloudflare. Read the bindings only through src/lib/api/bindings.ts.

/** A Workers Rate Limiting binding (`ratelimits` in wrangler.jsonc). */
interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

interface CloudflareEnv {
  /** 120 requests per 60 s per API key (namespace 1001). */
  API_KEY_LIMITER?: RateLimit
  /** 300 requests per 60 s per client IP (namespace 1002). */
  API_IP_LIMITER?: RateLimit
}
