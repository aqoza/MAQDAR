import type { Database } from '@zeespare/shared/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { LOCATION_LOOKUP_LIMIT, lookupLocations } from './location-codes'

function clientWith(result: { data: unknown; error: null | { code: string } }) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    retry: vi.fn().mockResolvedValue(result),
  }
  const from = vi.fn().mockReturnValue(builder)
  return { builder, from, client: { from } as unknown as SupabaseClient<Database> }
}

describe('lookupLocations', () => {
  it('scopes active suggestions to the organization and normalized code/name tokens', async () => {
    const row = { code: 'RUH-1', name_en: 'Riyadh', name_ar: 'الرياض', is_active: true }
    const { client, builder, from } = clientWith({ data: [row], error: null })

    expect(await lookupLocations(client, 'organization-a', 'RÚH الـرِّياض ١')).toEqual([row])
    expect(from).toHaveBeenCalledWith('locations')
    expect(builder.eq.mock.calls).toEqual([
      ['organization_id', 'organization-a'],
      ['is_active', true],
    ])
    expect(builder.like.mock.calls).toEqual([
      ['search_text', '%rúh%'],
      ['search_text', '%الرياض%'],
      ['search_text', '%1%'],
    ])
    expect(builder.select).toHaveBeenCalledWith('code, name_en, name_ar, is_active')
    expect(builder.order).toHaveBeenCalledWith('code')
    expect(builder.limit).toHaveBeenCalledWith(LOCATION_LOOKUP_LIMIT)
    expect(builder.retry).toHaveBeenCalledWith(false)
  })

  it('includes inactive catalog suggestions for historical searches without widening tenant scope', async () => {
    const { client, builder } = clientWith({ data: [], error: null })
    await lookupLocations(client, 'organization-b', 'old branch', true)
    expect(builder.eq.mock.calls).toEqual([['organization_id', 'organization-b']])
    expect(builder.like.mock.calls).toEqual([
      ['search_text', '%old%'],
      ['search_text', '%branch%'],
    ])
  })

  it('offers the first bounded authorized locations for an empty query', async () => {
    const { client, builder } = clientWith({ data: null, error: null })
    expect(await lookupLocations(client, 'organization-a', '')).toEqual([])
    expect(builder.like).not.toHaveBeenCalled()
    expect(builder.limit).toHaveBeenCalledWith(20)
  })

  it('bounds query length and cannot pass wildcard or PostgREST syntax through to LIKE', async () => {
    const { client, builder } = clientWith({ data: [], error: null })
    await lookupLocations(client, 'organization-a', `${'a'.repeat(100)} %_* , ) foreign`)
    expect(builder.like.mock.calls).toEqual([['search_text', `%${'a'.repeat(100)}%`]])
  })

  it('reports query failures instead of presenting a misleading empty list', async () => {
    const { client } = clientWith({ data: null, error: { code: '42501' } })
    await expect(lookupLocations(client, 'organization-a', 'RUH')).rejects.toThrow(
      'lookupLocations failed: 42501',
    )
  })
})
