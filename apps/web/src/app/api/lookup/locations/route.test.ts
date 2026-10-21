import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  claims: vi.fn(),
  context: vi.fn(),
  client: vi.fn(),
  lookup: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSessionClaims: mocks.claims }))
vi.mock('@/lib/organizations/context', () => ({ getActiveContext: mocks.context }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
vi.mock('@/lib/master-data/location-codes', () => ({
  LOCATION_LOOKUP_QUERY_LIMIT: 100,
  lookupLocations: mocks.lookup,
}))

const serverClient = { authenticated: true }

function request(params = '') {
  return new NextRequest(`http://localhost:3000/api/lookup/locations${params}`)
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.claims.mockResolvedValue({ sub: 'member-a' })
  mocks.context.mockResolvedValue({ active: { id: 'organization-a' } })
  mocks.client.mockResolvedValue(serverClient)
  mocks.lookup.mockResolvedValue([])
})

describe('location lookup route', () => {
  it('requires authentication and does not create a database client when signed out', async () => {
    mocks.claims.mockResolvedValue(null)
    const response = await GET(request('?q=branch'))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthorized' })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it('requires an active organization', async () => {
    mocks.context.mockResolvedValue({ active: null })
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it('ignores a caller-supplied organization and limits the query before a server read', async () => {
    const response = await GET(
      request(`?organization_id=foreign&q=${'a'.repeat(110)}&include_inactive=1`),
    )
    expect(response.status).toBe(200)
    expect(mocks.lookup).toHaveBeenCalledWith(
      serverClient,
      'organization-a',
      'a'.repeat(100),
      false,
    )
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('allows historical suggestions only through the explicit include-inactive flag', async () => {
    const location = { code: 'OLD-1', name_en: 'Old branch', name_ar: null, is_active: false }
    mocks.lookup.mockResolvedValue([location])
    const response = await GET(request('?q=old&include_inactive=true'))
    expect(mocks.lookup).toHaveBeenCalledWith(serverClient, 'organization-a', 'old', true)
    expect(await response.json()).toEqual({ locations: [location] })
  })

  it('returns a generic uncached error without exposing database details', async () => {
    mocks.lookup.mockRejectedValue(new Error('private database information'))
    const response = await GET(request('?q=branch'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'lookup_failed' })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
