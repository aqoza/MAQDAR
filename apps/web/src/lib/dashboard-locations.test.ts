import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@maqdar/shared'
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
