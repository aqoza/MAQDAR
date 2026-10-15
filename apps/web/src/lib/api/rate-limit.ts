import type { ApiPlatform, RateLimitBinding } from './bindings'
import { keyHashPrefix, type KeyHash } from './keys'
import { toProblem, type ApiProblem } from './problem'

/**
 * Abuse protection with the Workers Rate Limiting bindings: 300 requests per 60 s per client IP
 * (before authentication) and 120 per 60 s per key (after hashing). They count per Cloudflare
 * location and are eventually consistent, so they are not quotas; the hard caps live in Postgres.
 * A missing binding allows the request; a binding that throws fails open with one warning per
 * isolate. Pure module.
 */

export type LimitSubject = {
  requestId: string
  /** `cf-connecting-ip`; the IP limiter is skipped without it. */
  ip?: string | null
  /** The key's hash; the key limiter is skipped without it. */
  keyHash?: KeyHash | null
}

export type Warn = (message: string, details: Record<string, unknown>) => void

let warned = false

/** Resets the once-per-isolate warning (tests). */
export function resetRateLimitWarning(): void {
  warned = false
}

const defaultWarn: Warn = (message, details) => console.warn(message, details)

/** The limiter key of a client IP: `ip:<address>` (at most 64 characters of it). */
export function ipLimitKey(ip: string): string {
  return `ip:${ip.trim().slice(0, 64)}`
}

/** The limiter key of an API key: `key:` + the first 16 hex digits of its hash. */
export function keyLimitKey(hash: KeyHash): string {
  return `key:${keyHashPrefix(hash, 16)}`
}

async function allowed(
  binding: RateLimitBinding,
  key: string,
  which: 'ip' | 'key',
  warn: Warn,
): Promise<boolean> {
  try {
    const outcome = await binding.limit({ key })
    return outcome?.success !== false
  } catch (error) {
    if (!warned) {
      warned = true
      warn('api rate limiter failed; allowing requests', {
        limiter: which,
        error: error instanceof Error ? error.name : 'unknown',
      })
    }
    return true
  }
}

/**
 * Checks the IP limiter, then the key limiter, for what `subject` names. Returns null to go on or
 * a 429 `rate_limited` problem (Retry-After: 60). After a refusal no other limiter is consulted.
 */
export async function applyLimits(
  subject: LimitSubject,
  platform: ApiPlatform,
  warn: Warn = defaultWarn,
): Promise<ApiProblem | null> {
  const ip = subject.ip?.trim()
  if (
    ip &&
    platform.ipLimiter &&
    !(await allowed(platform.ipLimiter, ipLimitKey(ip), 'ip', warn))
  ) {
    return toProblem('rate_limited', subject.requestId, {
      detail: 'Too many requests from this address; retry after the Retry-After delay.',
    })
  }
  if (
    subject.keyHash &&
    platform.keyLimiter &&
    !(await allowed(platform.keyLimiter, keyLimitKey(subject.keyHash), 'key', warn))
  ) {
    return toProblem('rate_limited', subject.requestId, {
      detail: 'Too many requests with this API key; retry after the Retry-After delay.',
    })
  }
  return null
}
