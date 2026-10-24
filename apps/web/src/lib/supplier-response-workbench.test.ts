import { describe, expect, it } from 'vitest'
import {
  supplierWorkbenchParams,
  supplierWorkbenchHref,
  supplierWorkbenchRowSchema,
  supplierPublicationHref,
} from './supplier-response-workbench'
describe('supplier response workbench', () => {
  it('bounds URL inputs and never invents delivery or acceptance statuses', () => {
    expect(
      supplierWorkbenchParams({
        page: '999999999',
        size: '1000',
        q: 'a\nb',
        kind: 'event',
        state: 'current',
        status: 'accepted',
        supplier: 'bad\ncode',
        sort: 'reason',
        dir: 'asc',
      }),
    ).toMatchObject({
      page: 100000,
      size: 25,
      q: 'a b',
      sort: 'created_at',
      dir: 'desc',
      filters: {},
    })
    expect(supplierWorkbenchParams({ q: 'x'.repeat(101) }).q).toHaveLength(100)
  })
  it('keeps exact codes, independent state/status and filters through paging', () => {
    const params = supplierWorkbenchParams({
      supplier: ' مورد + /?& ',
      location: 'L0',
      kind: 'batch',
      state: 'withdrawn',
      status: 'received',
      size: '50',
    })
    const url = new URL(supplierWorkbenchHref(params, 2), 'https://example.com')
    expect(supplierWorkbenchParams(Object.fromEntries(url.searchParams))).toMatchObject({
      page: 2,
      size: 50,
      filters: {
        supplier: 'مورد + /?&',
        location: 'L0',
        kind: 'batch',
        state: 'withdrawn',
        status: 'received',
      },
    })
    expect(supplierWorkbenchParams({ status: ['declined', 'received'] }).filters.status).toBe(
      'declined',
    )
  })
  const row = {
    id: '10000000-0000-4000-8000-000000000001',
    source_id: '10000000-0000-4000-8000-000000000002',
    kind: 'batch' as const,
    created_at: '2026-10-23T00:00:00Z',
    withdrawn_at: null,
    supplier_code: 'SUP',
    location_code: 'L0',
    item_codes: ['ITEM'],
    line_count: 1,
    state: 'published',
    status: 'no_response',
    response: null,
  }
  it('keeps event paging and evidence links in the event workspace', () => {
    const params = supplierWorkbenchParams({
      kind: 'batch',
      status: 'no_response',
      state: 'withdrawn',
      q: 'saved code',
      supplier: 'SUP',
      location: 'L0',
      size: '50',
    })
    const url = new URL(supplierWorkbenchHref(params, 2, 'event'), 'https://example.com')
    expect(url.pathname).toBe('/replenishment/events/supplier-responses')
    expect(supplierWorkbenchParams(Object.fromEntries(url.searchParams))).toEqual({
      ...params,
      page: 2,
    })
    expect(supplierPublicationHref(row, 'event')).toBe(
      `/replenishment/events/batches/${row.source_id}/publish`,
    )
    expect(supplierPublicationHref({ ...row, kind: 'handoff' }, 'event')).toBe(
      `/replenishment/events/handoffs/${row.source_id}/publish`,
    )
  })
  it('does not accept inconsistent response/state evidence', () => {
    expect(supplierWorkbenchRowSchema.safeParse(row).success).toBe(true)
    for (const patch of [
      { status: 'received' },
      { state: 'withdrawn' },
      { line_count: 2 },
      { internal_payload: {} },
    ])
      expect(supplierWorkbenchRowSchema.safeParse({ ...row, ...patch }).success).toBe(false)
  })
  it('links to the exact publication history without merging overlapping packages', () => {
    expect(supplierPublicationHref(row)).toBe(`/replenishment/batches/${row.source_id}/publish`)
    expect(supplierPublicationHref({ ...row, kind: 'handoff' })).toBe(
      `/replenishment/handoffs/${row.source_id}/publish`,
    )
  })
})
