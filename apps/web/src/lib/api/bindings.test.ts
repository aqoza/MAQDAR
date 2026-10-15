import { describe, expect, it, vi } from 'vitest'
import { apiPlatform } from './bindings'

const limiter = () => ({ limit: vi.fn(async () => ({ success: true })) })

describe('apiPlatform', () => {
  it('returns nulls outside the Workers runtime (getCloudflareContext throws)', () => {
    expect(apiPlatform()).toEqual({ keyLimiter: null, ipLimiter: null })
    expect(
      apiPlatform(() => {
        throw new Error('initOpenNextCloudflareForDev')
      }),
    ).toEqual({ keyLimiter: null, ipLimiter: null })
  })

  it('returns the two rate-limit bindings of the Worker', () => {
    const key = limiter()
    const ip = limiter()
    expect(
      apiPlatform(() => ({ env: { API_KEY_LIMITER: key, API_IP_LIMITER: ip, ASSETS: {} } })),
    ).toEqual({ keyLimiter: key, ipLimiter: ip })
  })

  it('ignores missing or malformed bindings', () => {
    expect(apiPlatform(() => ({ env: {} }))).toEqual({ keyLimiter: null, ipLimiter: null })
    expect(apiPlatform(() => ({ env: null }))).toEqual({ keyLimiter: null, ipLimiter: null })
    expect(
      apiPlatform(() => ({ env: { API_KEY_LIMITER: { limit: 'no' }, API_IP_LIMITER: 1 } })),
    ).toEqual({ keyLimiter: null, ipLimiter: null })
  })
})
