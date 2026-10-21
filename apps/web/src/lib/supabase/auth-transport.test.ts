import { describe, expect, it, vi } from 'vitest'
import { authIpTransport } from './auth-transport'

describe('trusted Auth IP transport', () => {
  const config = {
    url: 'https://auth.example.com',
    publicKey: 'sb_publishable_test',
    secretKey: 'sb_secret_synthetic',
    clientIp: '203.0.113.7',
  }
  it('forwards the trusted IP with the secret apikey only to an allow-listed auth endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'))
    await authIpTransport({ ...config, fetcher })(
      'https://auth.example.com/auth/v1/token?grant_type=password',
      { headers: { apikey: config.publicKey, authorization: `Bearer ${config.publicKey}` } },
    )
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers)
    expect(headers.get('apikey')).toBe(config.secretKey)
    expect(headers.get('sb-forwarded-for')).toBe(config.clientIp)
    expect(headers.has('authorization')).toBe(false)
  })
  it.each([
    '/rest/v1/memberships',
    '/storage/v1/object',
    '/auth/v1/admin/users',
    '/auth/v1/../admin/users',
  ])('never adds privilege to %s', async (path) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'))
    await authIpTransport({ ...config, fetcher })(`https://auth.example.com${path}`)
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has('apikey')).toBe(false)
  })
  it('preserves the end-user JWT and refuses a spoofed forwarding chain', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'))
    await authIpTransport({ ...config, fetcher })('https://auth.example.com/auth/v1/user', {
      headers: { authorization: 'Bearer session-jwt' },
    })
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer session-jwt',
    )
    expect(authIpTransport({ ...config, fetcher, clientIp: '203.0.113.7, 1.1.1.1' })).toBe(fetcher)
  })
  it('never sends the secret to another host', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}'))
    await authIpTransport({ ...config, fetcher })('https://evil.example/auth/v1/token')
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has('apikey')).toBe(false)
  })
})
