import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@zeespare/shared'
import {
  dashboardLocationHref,
  loadDashboardLocations,
  type DashboardKpis,
} from './dashboard-locations'

const summary: DashboardKpis = {
  day: '2026-10-17',
  location_code: null,
  available_pairs: 1,
  observed_pairs: 2,
  unobserved_pairs: 1,
  stock_outs: 1,
  stale_pairs: 0,
  oldest_snapshot: '2026-10-17',
  inventory_value: [{ currency: 'KWD', value: '1.125' }],
  demand: [],
}

function database(count: number, error: unknown = null) {
  const locations = Array.from({ length: count }, (_, index) => ({
    code: `L-${index}`,
    name_en: `Location ${index}`,
    name_ar: null,
  }))
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.order.mockReturnValue(query)
  query.limit.mockResolvedValue({ data: locations, error })
  const rpc = vi.fn().mockResolvedValue({ data: summary, error: null })
  const client = {
    from: vi.fn().mockReturnValue(query),
    rpc,
  } as unknown as SupabaseClient<Database>
  return { client, query, rpc }
}

describe('bounded dashboard location reads', () => {
  const organization = '00000000-0000-4000-8000-000000000001'
  const location = { code: 'L-0', name_en: 'Location 0', name_ar: null }
  function projection() {
    return {
      location_preview: {
        organization_id: organization,
        day: summary.day,
        location_code: null,
        suggestions: [location],
        rows: [
          {
            location,
            summary: { available_pairs: 1, observed_pairs: 2, unobserved_pairs: 1, stale_pairs: 0 },
          },
        ],
        limited: false,
      },
    }
  }
  it('uses the same-response projection without another catalog query or KPI fan-out', async () => {
    const { client, rpc } = database(1)
    const result = await loadDashboardLocations(client, organization, summary, projection())
    expect(result.rows[0].summary).toEqual({
      available_pairs: 1,
      observed_pairs: 2,
      unobserved_pairs: 1,
      stale_pairs: 0,
    })
    expect(client.from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('retains zero observations as known missing coverage in the projection', async () => {
    const { client, rpc } = database(1)
    const raw = projection()
    raw.location_preview.rows[0].summary = {
      available_pairs: 0,
      observed_pairs: 0,
      unobserved_pairs: 3,
      stale_pairs: 0,
    }
    const result = await loadDashboardLocations(client, organization, summary, raw)
    expect(result.rows[0].summary?.observed_pairs).toBe(0)
    expect(result.rows[0].summary?.unobserved_pairs).toBe(3)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(['organization_id', 'day', 'location_code'] as const)(
    'falls back for a mismatched %s',
    async (field) => {
      const { client, rpc } = database(1)
      const raw = projection()
      const mismatched = {
        ...raw.location_preview,
        [field]:
          field === 'organization_id'
            ? '00000000-0000-4000-8000-000000000002'
            : field === 'day'
              ? '2026-10-16'
              : 'HIDDEN',
      }
      await loadDashboardLocations(client, organization, summary, { location_preview: mismatched })
      expect(rpc).toHaveBeenCalledTimes(1)
    },
  )
  it('falls back for oversized or inconsistent projected location sets', async () => {
    for (const raw of [
      {
        location_preview: {
          ...projection().location_preview,
          suggestions: Array.from({ length: 51 }, () => location),
        },
      },
      { location_preview: { ...projection().location_preview, rows: [] } },
    ]) {
      const { client, rpc } = database(1)
      await loadDashboardLocations(client, organization, summary, raw)
      expect(rpc).toHaveBeenCalledTimes(1)
    }
  })
  it('accepts a selected location beyond the bounded suggestion page', async () => {
    const { client, rpc } = database(1)
    const raw = projection()
    const selected = { ...summary, location_code: 'Z-999' }
    const projected = {
      ...raw.location_preview,
      location_code: 'Z-999',
      rows: [{ ...raw.location_preview.rows[0], location: { ...location, code: 'Z-999' } }],
    }
    const result = await loadDashboardLocations(client, organization, selected, {
      location_preview: projected,
    })
    expect(result.rows[0].location.code).toBe('Z-999')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('scopes active suggestions to the tenant, caps payloads and makes at most five summary calls', async () => {
    const { client, query, rpc } = database(51)
    const result = await loadDashboardLocations(client, 'active-org', summary)
    expect(query.eq.mock.calls).toEqual([
      ['organization_id', 'active-org'],
      ['is_active', true],
    ])
    expect(query.limit).toHaveBeenCalledWith(51)
    expect(result.suggestions).toHaveLength(50)
    expect(result.rows).toHaveLength(5)
    expect(result.limited).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(5)
    expect(rpc).toHaveBeenNthCalledWith(1, 'dashboard_kpis', {
      p_organization_id: 'active-org',
      p_day: '2026-10-17',
      p_location_code: 'L-0',
    })
  })
  it('reuses the validated selected-location result even beyond the suggestion page', async () => {
    const { client, rpc } = database(51)
    const selected = { ...summary, location_code: 'Z-999' }
    const result = await loadDashboardLocations(client, 'active-org', selected)
    expect(result.rows).toEqual([
      { location: { code: 'Z-999', name_en: 'Z-999', name_ar: null }, summary: selected },
    ])
    expect(rpc).not.toHaveBeenCalled()
  })
  it('keeps failed or malformed individual reads unavailable without discarding successful rows', async () => {
    const { client, rpc } = database(4)
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'MQ404' } })
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockRejectedValueOnce(new Error('network'))
    const result = await loadDashboardLocations(client, 'active-org', summary)
    expect(result.rows.map((row) => row.summary)).toEqual([null, null, null, summary])
  })
  it('does not turn a failed location query into zero availability or query hidden locations', async () => {
    const { client, rpc } = database(10, { code: 'failed' })
    const result = await loadDashboardLocations(client, 'active-org', summary)
    expect(result.rows).toEqual([])
    expect(result.suggestions).toEqual([])
    expect(result.unavailable).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('preserves valid zero observations rather than treating the row as a failed request', async () => {
    const { client, rpc } = database(1)
    const empty = { ...summary, observed_pairs: 0, available_pairs: 0, stock_outs: 0 }
    rpc.mockResolvedValue({ data: empty, error: null })
    const result = await loadDashboardLocations(client, 'active-org', summary)
    expect(result.rows[0].summary).toEqual(empty)
  })
  it('keeps a rejected optional location read from failing the main dashboard', async () => {
    const { client, query, rpc } = database(1)
    query.limit.mockRejectedValue(new Error('network'))
    const result = await loadDashboardLocations(client, 'active-org', summary)
    expect(result.unavailable).toBe(true)
    expect(result.rows).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })
  it('encodes filter navigation without interpolating URL syntax', () => {
    expect(dashboardLocationHref('2026-10-17', 'DXB.1')).toBe(
      '/dashboard?day=2026-10-17&location=DXB.1',
    )
  })
})
