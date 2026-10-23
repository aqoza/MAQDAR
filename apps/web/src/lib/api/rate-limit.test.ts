import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiPlatform, RateLimitBinding } from './bindings'
import { hashApiKey } from './keys'
import { applyLimits, ipLimitKey, keyLimitKey, resetRateLimitWarning } from './rate-limit'

const REQUEST_ID = '9a0d2a45-0f9b-4c55-b2fd-0d9a3f1e2c11'

/** A fake binding: allows `limit` calls per key, then refuses (like the real fixed window). */
function fakeBinding(limit: number) {
  const counts = new Map<string, number>()
  const calls: string[] = []
  const binding: RateLimitBinding = {
    limit: vi.fn(async ({ key }: { key: string }) => {
      calls.push(key)
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return { success: count <= limit }
    }),
  }
  return { binding, calls }
}

function throwingBinding(): RateLimitBinding {
  return {
    limit: vi.fn(async () => {
      throw new Error('binding unavailable')
    }),
  }
}

beforeEach(() => resetRateLimitWarning())

describe('applyLimits', () => {
  it('allows everything without bindings (next dev, next start, CI)', async () => {
    const hash = await hashApiKey('zeespare_sk_a')
    const platform: ApiPlatform = { ipLimiter: null, keyLimiter: null }
    for (let i = 0; i < 500; i++) {
      expect(
        await applyLimits({ requestId: REQUEST_ID, ip: '203.0.113.9', keyHash: hash }, platform),
      ).toBeNull()
    }
  })

  it('answers 429 rate_limited with Retry-After: 60 once a key is over its limit', async () => {
    const hash = await hashApiKey('zeespare_sk_a')
    const key = fakeBinding(120)
    const platform: ApiPlatform = { ipLimiter: null, keyLimiter: key.binding }
    for (let i = 0; i < 120; i++) {
      expect(await applyLimits({ requestId: REQUEST_ID, keyHash: hash }, platform)).toBeNull()
    }
    const problem = await applyLimits({ requestId: REQUEST_ID, keyHash: hash }, platform)
    expect(problem).toMatchObject({
      status: 429,
      headers: { 'Retry-After': '60' },
      body: { code: 'rate_limited', request_id: REQUEST_ID },
    })
    expect(key.calls.every((call) => call === keyLimitKey(hash))).toBe(true)
    // Another key still passes.
    const other = await hashApiKey('zeespare_sk_b')
    expect(await applyLimits({ requestId: REQUEST_ID, keyHash: other }, platform)).toBeNull()
  })

  it('checks the IP before the key and stops at the first refusal', async () => {
    const hash = await hashApiKey('zeespare_sk_a')
    const ip = fakeBinding(0)
    const key = fakeBinding(10)
    const platform: ApiPlatform = { ipLimiter: ip.binding, keyLimiter: key.binding }
    const problem = await applyLimits(
      { requestId: REQUEST_ID, ip: '198.51.100.7', keyHash: hash },
      platform,
    )
    expect(problem?.body.code).toBe('rate_limited')
    expect(problem?.body.detail).toContain('address')
    expect(ip.calls).toEqual(['ip:198.51.100.7'])
    expect(key.calls).toEqual([])
  })

  it('skips the IP limiter without an address and the key limiter without a hash', async () => {
    const ip = fakeBinding(0)
    const key = fakeBinding(0)
    const platform: ApiPlatform = { ipLimiter: ip.binding, keyLimiter: key.binding }
    expect(
      await applyLimits({ requestId: REQUEST_ID, ip: null, keyHash: null }, platform),
    ).toBeNull()
    expect(await applyLimits({ requestId: REQUEST_ID, ip: '  ' }, platform)).toBeNull()
    expect(ip.calls).toEqual([])
    expect(key.calls).toEqual([])
  })

  it('fails open when a binding throws, warning once per isolate', async () => {
    const hash = await hashApiKey('zeespare_sk_a')
    const warn = vi.fn()
    const platform: ApiPlatform = { ipLimiter: throwingBinding(), keyLimiter: throwingBinding() }
    for (let i = 0; i < 3; i++) {
      expect(
        await applyLimits(
          { requestId: REQUEST_ID, ip: '192.0.2.1', keyHash: hash },
          platform,
          warn,
        ),
      ).toBeNull()
    }
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[1]).toEqual({ limiter: 'ip', error: 'Error' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('binding unavailable')
  })

  it('keys limiters by IP and by a 16-hex prefix of the hash only', async () => {
    const hash = await hashApiKey('zeespare_sk_a')
    expect(keyLimitKey(hash)).toMatch(/^key:[0-9a-f]{16}$/)
    expect(ipLimitKey(' 2001:db8::1 ')).toBe('ip:2001:db8::1')
    expect(ipLimitKey('x'.repeat(100))).toBe(`ip:${'x'.repeat(64)}`)
  })
})
