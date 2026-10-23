import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@zeespare/shared/database.types'
import { loadPlannerActions } from './planner-actions-data'

vi.mock('server-only', () => ({}))
const organization = '00000000-0000-4000-8000-000000000001'
type Query = { table: string; filters: Record<string, unknown>; limit: number; orders: string[] }
type Reply = { data: unknown[] | null; error: { message: string } | null }
function client(reply: (query: Query) => Reply) {
  const queries: Query[] = []
  const db = {
    from(table: string) {
      const query: Query = { table, filters: {}, limit: 0, orders: [] }
      queries.push(query)
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          query.filters[key] = value
          return builder
        },
        in: (key: string, value: unknown) => {
          query.filters[key] = value
          return builder
        },
        order: (key: string) => {
          query.orders.push(key)
          return builder
        },
        limit: (limit: number) => {
          query.limit = limit
          return builder
        },
        abortSignal: () => builder,
        then: (resolve: (value: Reply) => void) => resolve(reply(query)),
      }
      return builder
    },
    rpc: vi.fn(),
  }
  return { db: db as unknown as SupabaseClient<Database>, queries, rpc: db.rpc }
}

it('bounds every source and scopes all queries to the active organization', async () => {
  const mock = client(() => ({ data: [], error: null }))
  const result = await loadPlannerActions(mock.db, organization)
  expect(result.actions).toEqual([])
  expect(result.sources.every((source) => !source.failed)).toBe(true)
  expect(mock.queries).toHaveLength(5)
  for (const query of mock.queries) {
    expect(query.filters.organization_id).toBe(organization)
    expect(query.limit).toBe(query.table === 'policy_workbench' ? 11 : 26)
    expect(query.orders).toContain('id')
  }
  expect(mock.rpc).not.toHaveBeenCalled()
})

it('reports failures and malformed responses as incomplete rather than clean zero results', async () => {
  const mock = client((query) =>
    query.table === 'forecast_quality'
      ? { data: [{ id: 'malformed' }], error: null }
      : { data: null, error: { message: 'sensitive database detail' } },
  )
  const result = await loadPlannerActions(mock.db, organization)
  expect(result.sources.every((source) => source.failed)).toBe(true)
  expect(JSON.stringify(result)).not.toContain('sensitive')
})

it('keeps successful sources when another source fails', async () => {
  const mock = client((query) => ({
    data: [],
    error: query.table === 'transfer_review_list' ? { message: 'timeout' } : null,
  }))
  const result = await loadPlannerActions(mock.db, organization)
  expect(result.sources.filter((source) => source.failed).map((source) => source.source)).toEqual([
    'transfer',
  ])
})

it('excludes packaged approvals within the bounded set without losing the truncation warning', async () => {
  const rows = Array.from({ length: 26 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    estimate_id: organization,
    draft_id: organization,
    revision: 1,
    created_at: '2026-10-23T00:00:00Z',
    status: 'approved',
    selected: true,
    item_code: `ITEM-${index}`,
    location_code: 'MCT',
    supplier_code: 'SUP',
    quantity: '12.125',
    unit: 'KG',
    currency: 'OMR',
    subtotal: '12.329375',
    minor_units: 3,
    order_date: '2026-10-23',
    receipt_date: '2026-10-30',
  }))
  const mock = client((query) => ({
    error: null,
    data:
      query.table === 'purchase_handoffs'
        ? [{ proposal_id: rows[0].id }]
        : query.table === 'purchase_review_list' && query.filters.status === 'approved'
          ? rows
          : [],
  }))
  const result = await loadPlannerActions(mock.db, organization)
  expect(result.actions).toHaveLength(24)
  expect(result.actions.some((action) => action.id === `handoff:${rows[0].id}`)).toBe(false)
  expect(result.actions.some((action) => action.id === `handoff:${rows[25].id}`)).toBe(false)
  expect(result.sources.find((source) => source.source === 'handoff')).toMatchObject({
    limited: true,
    failed: false,
  })
  const lookup = mock.queries.find((query) => query.table === 'purchase_handoffs')!
  expect(lookup.filters.organization_id).toBe(organization)
  expect(lookup.filters.proposal_id).toHaveLength(25)
})

it('checks only ten original policy cutoffs and reports individual RPC failures', async () => {
  const policies = Array.from({ length: 11 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    to_date: '2026-10-10',
    finished_at: '2026-10-23T00:00:00Z',
  }))
  const mock = client((query) => ({
    data: query.table === 'policy_workbench' ? policies : [],
    error: null,
  }))
  mock.rpc.mockImplementation((_name, args) => ({
    abortSignal: () =>
      Promise.resolve(
        args.p_policy_id === policies[0].id
          ? { data: null, error: { message: 'failed comparison' } }
          : {
              data: {
                status: 'stock_missing',
                policy_id: args.p_policy_id,
                run_id: organization,
                forecast_id: organization,
                item_code: 'ITEM',
                location_code: 'MCT',
                day: args.p_day,
                cutoff: args.p_day,
                basis: args.p_basis,
                unit: 'EA',
                unit_provenance: null,
                override_id: null,
                revision: null,
                maximum: '20',
                quantity_above: null,
                value_above: null,
                snapshot: null,
              },
              error: null,
            },
      ),
  }))
  const result = await loadPlannerActions(mock.db, organization)
  expect(mock.rpc).toHaveBeenCalledTimes(10)
  expect(result.actions).toHaveLength(9)
  expect(result.sources.find((source) => source.source === 'stock')).toMatchObject({
    failed: true,
    limited: true,
  })
  for (const [name, args] of mock.rpc.mock.calls) {
    expect(name).toBe('policy_stock_comparison')
    expect(args).toMatchObject({
      p_organization_id: organization,
      p_day: '2026-10-10',
      p_basis: 'calculated',
    })
  }
})
